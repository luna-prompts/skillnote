"""Integration tests for /setup/codex + /v1/codex-bundle.zip.

Mirrors test_openclaw_setup.py: mount only the setup router on a fresh
in-process FastAPI app. These endpoints don't touch the DB.
"""
from __future__ import annotations

import io
import json
import subprocess
import zipfile

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.api.setup import router
from app.main import (
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)


@pytest.fixture
def client():
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)
    app.include_router(router)
    return TestClient(app)


# ── /v1/codex-bundle.zip ────────────────────────────────────────────────


def test_codex_bundle_returns_valid_archive(client):
    r = client.get("/v1/codex-bundle.zip")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(zf.namelist())
    # Manifest, hooks, a handler, a bundled skill, a branding sidecar, an asset.
    assert ".codex-plugin/plugin.json" in names
    assert "hooks/hooks.json" in names
    assert "hooks/handlers/sync.sh" in names
    assert "skills/skillnote/SKILL.md" in names
    assert "skills/collection/agents/openai.yaml" in names
    assert "assets/logo.png" in names


def test_codex_plugin_manifest_is_valid_and_branded(client):
    r = client.get("/v1/codex-bundle.zip")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    manifest = json.loads(zf.read(".codex-plugin/plugin.json").decode("utf-8"))
    assert manifest["name"] == "skillnote"
    # Branding lives in the interface block.
    assert manifest["interface"]["displayName"] == "SkillNote"
    assert manifest["interface"]["brandColor"].startswith("#")
    assert manifest["interface"]["logo"].endswith(".png")
    # The plugin must NOT declare a `hooks` field — the plugin-creator validator
    # rejects it; Codex auto-loads hooks/hooks.json from the default path.
    assert "hooks" not in manifest


def test_codex_hooks_json_has_lifecycle_events(client):
    r = client.get("/v1/codex-bundle.zip")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    hooks = json.loads(zf.read("hooks/hooks.json").decode("utf-8"))["hooks"]
    assert "SessionStart" in hooks
    assert "UserPromptSubmit" in hooks  # mid-session sync
    assert "PostToolUse" in hooks       # analytics
    # SessionStart wires the sync handler via the plugin-root env var.
    cmd = hooks["SessionStart"][0]["hooks"][0]["command"]
    assert "${PLUGIN_ROOT}" in cmd
    assert "sync.sh" in cmd


def test_codex_asset_is_binary_intact(client):
    """PNG assets must be copied verbatim (not run through URL substitution)."""
    r = client.get("/v1/codex-bundle.zip")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    logo = zf.read("assets/logo.png")
    assert logo[:8] == b"\x89PNG\r\n\x1a\n"  # valid PNG signature


def test_codex_bundle_excludes_pycache(client):
    r = client.get("/v1/codex-bundle.zip")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    for name in zf.namelist():
        assert "__pycache__" not in name, f"unexpected pycache entry: {name}"


# ── /setup/codex ────────────────────────────────────────────────────────


def test_setup_codex_returns_bash(client):
    r = client.get("/setup/codex")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/plain")
    body = r.text
    assert body.startswith("#!/bin/bash")
    assert "set -euo pipefail" in body


def test_setup_codex_substitutes_urls(client):
    r = client.get("/setup/codex")
    body = r.text
    assert "__API_URL__" not in body
    assert "__WEB_URL__" not in body
    assert 'API_URL="http://' in body
    assert 'WEB_URL="http://' in body


def test_setup_codex_script_is_valid_bash(client):
    r = client.get("/setup/codex")
    result = subprocess.run(["bash", "-n"], input=r.text, capture_output=True, text=True)
    assert result.returncode == 0, f"bash -n failed: {result.stderr}"


def test_setup_codex_uses_correct_marketplace_flow(client):
    """The script must use the native install flow discovered from the Codex
    source: manifest at .agents/plugins/, INSTALLED_BY_DEFAULT, marketplace
    add + plugin add, and a codex() shell wrapper running the picker.
    """
    body = client.get("/setup/codex").text
    assert ".agents/plugins/marketplace.json" in body
    assert "INSTALLED_BY_DEFAULT" in body
    assert "codex plugin marketplace add" in body
    assert "codex plugin add skillnote@skillnote-local" in body
    assert 'mkdir -p "$CODEX_HOME"' in body
    # No invalid auth value (only ON_INSTALL/ON_USE exist; we omit the key).
    assert '"authentication": "NONE"' not in body
    # The shell wrapper runs the picker + a pre-trust sync before launching codex.
    assert "SKILLNOTE CODEX WRAPPER BEGIN" in body
    assert "skillnote-pick" in body


# ── dispatcher ──────────────────────────────────────────────────────────


def test_agent_dispatch_handles_codex(client):
    body = client.get("/setup/agent").text
    assert "codex|cx)" in body
    assert "/setup/codex" in body
