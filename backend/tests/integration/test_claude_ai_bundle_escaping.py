"""Bundle-generation escaping tests.

The skill-bundle endpoint composes a SKILL.md with YAML frontmatter from
the skill's name + description. A naive `f"---\\nname: {x}\\n---"` is
vulnerable to YAML injection — a description containing `\\n---\\n` or
`\\n` + arbitrary keys could smuggle frontmatter fields into the
uploaded skill. yaml.safe_dump escapes correctly.

These tests upload skills with adversarial descriptions and verify the
generated SKILL.md round-trips through the same YAML parser without
yielding extra keys.
"""
from __future__ import annotations

import io
import json
import os
import urllib.error
import urllib.request
import uuid
import zipfile

import pytest
import yaml

BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _post(path, body=None, headers=None):
    h = {"Content-Type": "application/json"} if body is not None else {}
    if headers:
        h.update(headers)
    req = urllib.request.Request(
        f"{BASE}{path}",
        method="POST",
        data=(json.dumps(body).encode() if body is not None else None),
        headers=h,
    )
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        return e.code, (json.loads(txt) if txt else None)


def _get_bytes(path, headers=None):
    req = urllib.request.Request(f"{BASE}{path}", headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


@pytest.fixture
def bearer_and_skill():
    """Pair an extension and create a skill with the given description.
    Returns (extension_token, skill_id, version_id)."""
    def _make(description: str):
        # Pair
        s, pair = _post("/v1/integrations/claude-ai/extension/pair",
                        body={"browser_label": "bundle test"})
        if s != 201:
            pytest.skip(f"pair endpoint returned {s}")
        _post("/v1/integrations/claude-ai/pair/approve",
              body={"pairing_code": pair["pairing_code"]})
        from urllib.request import Request, urlopen
        with urlopen(Request(
            f"{BASE}/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}"
        )) as r:
            redeemed = json.loads(r.read().decode())
        token = redeemed["extension_token"]

        # Create a skill with the adversarial description.
        slug = f"esc-{uuid.uuid4().hex[:6]}"
        s, body = _post(
            "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": description,
                "content_md": "# Test\n\nsome body.",
                "collections": [f"esc-bucket-{uuid.uuid4().hex[:8]}"],
            },
        )
        assert s == 201, f"skill create: {s} {body}"
        skill_id = body["id"]

        # Fetch the upload op to get the version_id.
        from urllib.request import Request, urlopen
        with urlopen(Request(
            f"{BASE}/v1/integrations/claude-ai/extension/operations",
            headers={"Authorization": f"Bearer {token}"},
        )) as r:
            ops = json.loads(r.read().decode())
        ours = [op for op in ops if op["payload"].get("name") == slug][0]
        return token, skill_id, ours["payload"]["version_id"]
    return _make


def _parse_frontmatter(skill_md: str) -> dict:
    """Mimic the upstream parser claude.ai uses on uploaded skills."""
    import re
    m = re.match(r"^---\n(.*?)\n---\n", skill_md, re.DOTALL)
    assert m, f"missing frontmatter:\n{skill_md[:200]}"
    return yaml.safe_load(m.group(1)) or {}


class TestBundleYAMLEscaping:
    def test_description_with_newlines(self, bearer_and_skill):
        token, skill_id, version_id = bearer_and_skill(
            "Line 1\nLine 2\nLine 3"
        )
        s, raw = _get_bytes(
            f"/v1/integrations/claude-ai/extension/skill-bundle"
            f"?skill_id={skill_id}&version_id={version_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert s == 200

        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            skill_md_path = next(n for n in zf.namelist() if n.endswith("SKILL.md"))
            skill_md = zf.read(skill_md_path).decode("utf-8")

        fm = _parse_frontmatter(skill_md)
        # The full description is preserved (yaml multiline format).
        assert "Line 1" in fm["description"]
        assert "Line 2" in fm["description"]
        # And no extra keys were smuggled in.
        assert set(fm.keys()) == {"name", "description"}

    def test_description_with_yaml_special_chars(self, bearer_and_skill):
        # All these would break naive interpolation.
        adversarial = 'colons: are special, "quotes" too, and #hashes'
        token, skill_id, version_id = bearer_and_skill(adversarial)
        s, raw = _get_bytes(
            f"/v1/integrations/claude-ai/extension/skill-bundle"
            f"?skill_id={skill_id}&version_id={version_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert s == 200

        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            skill_md_path = next(n for n in zf.namelist() if n.endswith("SKILL.md"))
            skill_md = zf.read(skill_md_path).decode("utf-8")

        fm = _parse_frontmatter(skill_md)
        assert fm["description"] == adversarial
        assert set(fm.keys()) == {"name", "description"}

    def test_description_attempting_yaml_injection(self, bearer_and_skill):
        """The exact attack: try to inject an extra frontmatter key by
        terminating the description and adding a new key.

        Naive code: f'description: {x}' with x='hi\\n---\\nname: hacked'
        produces a SKILL.md with TWO --- separators — claude.ai's parser
        would read either the first or second block, and we have no
        control over which.

        yaml.safe_dump encodes newlines correctly so this becomes
        a multi-line string value, not an escape."""
        adversarial = "innocent\n---\nname: hacked-name\n---\n"
        token, skill_id, version_id = bearer_and_skill(adversarial)
        s, raw = _get_bytes(
            f"/v1/integrations/claude-ai/extension/skill-bundle"
            f"?skill_id={skill_id}&version_id={version_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert s == 200

        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            skill_md_path = next(n for n in zf.namelist() if n.endswith("SKILL.md"))
            skill_md = zf.read(skill_md_path).decode("utf-8")

        # CRITICAL: there must be exactly one --- pair as frontmatter
        # delimiters (line == '---', no leading whitespace). The injected
        # `---` lines inside the description are indented by yaml.safe_dump
        # as part of a block-scalar string, which is correctly NOT
        # interpreted as a frontmatter delimiter.
        delimiter_lines = [
            line for line in skill_md.splitlines() if line == "---"
        ]
        assert len(delimiter_lines) == 2, (
            f"YAML injection vulnerability! Expected 2 --- delimiters, got "
            f"{len(delimiter_lines)}. SKILL.md:\n{skill_md}"
        )

        fm = _parse_frontmatter(skill_md)
        # The injected `name: hacked-name` MUST not appear as a top-level key.
        assert fm["name"] != "hacked-name"
        assert set(fm.keys()) == {"name", "description"}

    def test_description_with_unicode(self, bearer_and_skill):
        # Emoji, RTL marks, zero-width spaces should round-trip.
        token, skill_id, version_id = bearer_and_skill(
            "Emoji 🌶 and Arabic مرحبا plus ZWS​here"
        )
        s, raw = _get_bytes(
            f"/v1/integrations/claude-ai/extension/skill-bundle"
            f"?skill_id={skill_id}&version_id={version_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert s == 200

        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            skill_md_path = next(n for n in zf.namelist() if n.endswith("SKILL.md"))
            skill_md = zf.read(skill_md_path).decode("utf-8")

        fm = _parse_frontmatter(skill_md)
        assert "🌶" in fm["description"]
        assert "مرحبا" in fm["description"]
