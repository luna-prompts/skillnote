"""Integration test for the per-collection plugin-group endpoints — the
git-free 'Upload plugin' path where each published collection becomes its own
"SkillNote: <name>" group.

Flow: create a skill in a fresh collection → publish that collection
(PUT /v1/collections/{name}/claude-ai) → pair an extension → GET
/extension/plugin-groups (lists the group) → GET
/extension/plugin-bundle?group=<slug> (the branded ZIP). Skips if the live API
is unreachable (matches the other claude-ai integration tests)."""
from __future__ import annotations

import io
import json
import os
import urllib.request
import uuid
import zipfile

import pytest


def _bearer_get(token, path):
    import urllib.error

    base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
    req = urllib.request.Request(
        f"{base}{path}", method="GET", headers={"Authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(req) as r:  # noqa: S310
            headers = {k.lower(): v for k, v in dict(r.headers).items()}
            return r.status, r.read(), headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {k.lower(): v for k, v in dict(e.headers).items()}


@pytest.fixture
def paired_token(api_request):
    status, pair = api_request(
        "POST", "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "plugin-group test"},
    )
    if status != 201:
        pytest.skip(f"pair endpoint returned {status}")
    api_request(
        "POST", "/v1/integrations/claude-ai/pair/approve",
        body={"pairing_code": pair["pairing_code"]},
    )
    _, body = api_request(
        "GET",
        f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}",
    )
    assert body["extension_token"]
    return body["extension_token"]


def test_published_collection_becomes_a_group_bundle(api_request, paired_token):
    coll = f"pg-{uuid.uuid4().hex[:8]}"
    slug = f"pg-skill-{uuid.uuid4().hex[:8]}"

    # 1. create a skill in a fresh collection
    status, _ = api_request(
        "POST", "/v1/skills",
        body={
            "name": slug,
            "slug": slug,
            "description": "plugin group test skill",
            "content_md": "# Group test\n\nbody",
            "collections": [coll],
        },
    )
    if status != 201:
        pytest.fail(f"skill create failed: {status}")

    # 2. publish the collection to claude.ai
    status, body = api_request(
        "PUT", f"/v1/collections/{coll}/claude-ai", body={"published": True}
    )
    assert status == 200, body
    assert body["published_to_claude_ai"] is True

    # 3. the extension's groups list includes it
    st, data, _ = _bearer_get(paired_token, "/v1/integrations/claude-ai/extension/plugin-groups")
    assert st == 200
    groups = json.loads(data)["groups"]
    ours = [g for g in groups if g["name"] == coll]
    assert len(ours) == 1, groups
    assert ours[0]["display_name"] == f"SkillNote: {coll}"
    assert ours[0]["skill_count"] >= 1

    # 4. the group bundle is a valid branded plugin ZIP with the skill
    st, zdata, headers = _bearer_get(
        paired_token, f"/v1/integrations/claude-ai/extension/plugin-bundle?group={coll}"
    )
    assert st == 200
    assert headers.get("etag")
    with zipfile.ZipFile(io.BytesIO(zdata)) as zf:
        names = zf.namelist()
        assert ".claude-plugin/plugin.json" in names
        assert f"skills/{slug}/SKILL.md" in names
        manifest = json.loads(zf.read(".claude-plugin/plugin.json"))
        assert manifest["name"] == coll
        assert manifest["displayName"] == f"SkillNote: {coll}"

    # 5. unknown group → 404
    st, _, _ = _bearer_get(
        paired_token, "/v1/integrations/claude-ai/extension/plugin-bundle?group=does-not-exist-xyz"
    )
    assert st == 404

    # cleanup: unpublish
    api_request("PUT", f"/v1/collections/{coll}/claude-ai", body={"published": False})
