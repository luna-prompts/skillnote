"""Integration tests for /setup/openclaw + /v1/openclaw-bundle.zip.

These endpoints don't touch the DB — we mount only the setup router on a
fresh in-process FastAPI app, just like test_openclaw_usage.py mounts the
openclaw router. No DB fixture needed.
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


# ── fixture ─────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    """Fresh FastAPI app mounting only the setup router."""
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)
    app.include_router(router)
    return TestClient(app)


# ── /v1/openclaw-bundle.zip ─────────────────────────────────────────────


def test_bundle_zip_returns_valid_archive(client):
    r = client.get("/v1/openclaw-bundle.zip")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(zf.namelist())
    assert "skillnote-awareness/SKILL.md" in names
    assert "skillnote-resolver/SKILL.md" in names
    assert "config.template.json" in names


def test_bundle_zip_substitutes_host_placeholder(client):
    r = client.get("/v1/openclaw-bundle.zip")
    assert r.status_code == 200

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    content = zf.read("skillnote-awareness/SKILL.md").decode("utf-8")
    # {{HOST}} must be substituted (not literal anywhere).
    assert "{{HOST}}" not in content
    # The TestClient default host is "testserver"; the API URL is built from
    # _derive_urls → http://testserver:8082 (unless SKILLNOTE_API_URL env set).
    # We assert the substitution shape instead of an exact URL so the test
    # survives env-var overrides used in some Docker contexts.
    assert "http://" in content


def test_bundle_zip_substitutes_web_placeholder(client):
    r = client.get("/v1/openclaw-bundle.zip")
    assert r.status_code == 200

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    content = zf.read("skillnote-awareness/SKILL.md").decode("utf-8")
    assert "{{WEB_URL}}" not in content
    # Web URL contains :3000 by default; if overridden via env, still must be
    # an http(s) URL — the placeholder is gone either way.
    assert "http://" in content


def test_setup_openclaw_returns_bash(client):
    r = client.get("/setup/openclaw")
    assert r.status_code == 200, r.text
    # Content-Type may include charset; assert the prefix.
    assert r.headers["content-type"].startswith("text/plain")
    body = r.text
    assert body.startswith("#!/bin/bash")
    assert "set -euo pipefail" in body


def test_setup_openclaw_substitutes_urls(client):
    r = client.get("/setup/openclaw")
    assert r.status_code == 200
    body = r.text
    assert "__API_URL__" not in body
    assert "__WEB_URL__" not in body
    # The substituted URL appears in the API_URL=... and WEB_URL=... assignments.
    assert 'API_URL="http://' in body
    assert 'WEB_URL="http://' in body


def test_setup_openclaw_script_is_syntactically_valid_bash(client):
    r = client.get("/setup/openclaw")
    assert r.status_code == 200
    result = subprocess.run(
        ["bash", "-n"],
        input=r.text,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"bash -n failed: {result.stderr}"


def test_bundle_zip_includes_config_template(client):
    r = client.get("/v1/openclaw-bundle.zip")
    assert r.status_code == 200

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    raw = zf.read("config.template.json").decode("utf-8")
    # Placeholder must be substituted before the file becomes valid JSON-with-URLs.
    assert "{{HOST}}" not in raw
    assert "{{WEB_URL}}" not in raw
    # The substituted template must still be valid JSON.
    cfg = json.loads(raw)
    # Sanity-check the keys the OpenClaw runtime expects.
    expected_keys = {
        "skillnote_base_url",
        "skillnote_web_url",
        "agent_name",
        "auto_resolve_skills",
        "write_reflections",
        "allow_draft_creation",
        "allow_auto_marketplace_install",
    }
    assert expected_keys.issubset(set(cfg.keys()))
    # The substituted base URL must be a real http(s) URL, not a placeholder.
    assert cfg["skillnote_base_url"].startswith("http")
    assert cfg["skillnote_web_url"].startswith("http")


def test_bundle_zip_excludes_pycache(client):
    """The handler filters out __pycache__ entries. plugin-openclaw has no
    Python sources so there's nothing to exclude in practice — this test
    documents that the filter is in place by inspecting the archive for any
    accidental cache leakage from the source tree.
    """
    r = client.get("/v1/openclaw-bundle.zip")
    assert r.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    for name in zf.namelist():
        assert "__pycache__" not in name, f"unexpected pycache entry: {name}"
