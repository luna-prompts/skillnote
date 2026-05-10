"""
Tests for the sync.sh footer-injection logic.

The build_skill_content() helper below mirrors the Python section of
plugin-openclaw/skillnote/sync.sh exactly, making the footer logic
independently testable without shelling out.

Run: python3 -m pytest plugin-openclaw/tests/test_sync_footer.py -v
"""

import json
import re


# ---------------------------------------------------------------------------
# Helper extracted from sync.sh (lines 121-141)
# ---------------------------------------------------------------------------

def build_skill_content(
    slug: str,
    desc: str,
    skill_id: str,
    colls: list,
    body: str,
    host: str,
) -> str:
    """Reproduce the Python snippet from sync.sh that produces a SKILL.md file."""
    local_name = f"sn-{slug}"
    fm_lines = [f"name: {local_name}", f"description: {desc}"]
    if skill_id:
        fm_lines.append(f"id: {skill_id}")
    if colls:
        fm_lines.append(f"collections: [{', '.join(colls)}]")

    rating_cmd = (
        f"curl -sf -X POST {host}/v1/skills/{slug}/comments "
        f'-H "Content-Type: application/json" '
        f"-d '{{\"author\":\"main\",\"author_type\":\"agent\","
        f"\"comment_type\":\"agent_success_note\",\"rating\":5,"
        f"\"body\":\"<one line: what helped or what failed>\"}}'"
    )
    rating_footer = (
        "\n\n---\n"
        "*Used this skill? Rate it now (in this same turn):*\n\n"
        f"`{rating_cmd}`\n\n"
        "Change `agent_success_note` → `agent_issue` if it failed. "
        "Skip entirely if you did not use this skill."
    )
    return "---\n" + "\n".join(fm_lines) + "\n---\n\n" + body + rating_footer


# ---------------------------------------------------------------------------
# Shared fixture values
# ---------------------------------------------------------------------------

_HOST = "http://localhost:8082"
_SLUG = "code-review-checklist"
_DESC = "Runs a structured code review on changed files."
_ID = "abc-123"
_COLLS = ["engineering", "qa"]
_BODY = "## Instructions\n\nDo the review.\n"


def _build(**overrides) -> str:
    kwargs = dict(
        slug=_SLUG,
        desc=_DESC,
        skill_id=_ID,
        colls=_COLLS,
        body=_BODY,
        host=_HOST,
    )
    kwargs.update(overrides)
    return build_skill_content(**kwargs)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_footer_present():
    """Content ends with the canonical closing line."""
    content = _build()
    assert content.endswith("Skip entirely if you did not use this skill.")


def test_footer_contains_host():
    """Host URL appears in the footer curl command."""
    content = _build()
    assert _HOST in content


def test_footer_contains_slug():
    """The skill slug appears in the curl command URL."""
    content = _build()
    # Should appear in the POST path e.g. /v1/skills/code-review-checklist/comments
    assert f"/v1/skills/{_SLUG}/comments" in content


def test_body_preserved():
    """Original body text appears before the footer separator."""
    content = _build()
    # Body comes before the footer '---' separator
    body_idx = content.find(_BODY)
    footer_idx = content.rfind("\n\n---\n")
    assert body_idx != -1, "Body not found in content"
    assert body_idx < footer_idx, "Body appears after the footer separator"


def test_footer_curl_json_valid():
    """Extract the JSON from -d '...' in the footer, parse it, verify required keys."""
    content = _build()
    # Find the -d '...' fragment — the JSON is enclosed in single quotes after -d
    match = re.search(r"-d '(\{.*?\})'", content, re.DOTALL)
    assert match is not None, "Could not find -d '...' JSON in footer"
    raw_json = match.group(1)
    data = json.loads(raw_json)
    assert "author" in data
    assert "author_type" in data
    assert "comment_type" in data
    assert data["comment_type"] == "agent_success_note"
    assert "rating" in data
    assert data["rating"] == 5
    assert "body" in data


def test_frontmatter_name_prefixed():
    """SKILL.md frontmatter name is sn-{slug}."""
    content = _build()
    assert f"name: sn-{_SLUG}" in content


def test_frontmatter_description():
    """SKILL.md frontmatter description matches input desc."""
    content = _build()
    assert f"description: {_DESC}" in content


def test_frontmatter_id_included_when_present():
    """SKILL.md frontmatter includes id when skill_id is non-empty."""
    content = _build(skill_id="xyz-999")
    assert "id: xyz-999" in content


def test_frontmatter_id_omitted_when_empty():
    """SKILL.md frontmatter omits id when skill_id is empty/None."""
    content = _build(skill_id="")
    assert "\nid:" not in content

    content2 = _build(skill_id=None)
    assert "\nid:" not in content2


def test_frontmatter_collections_included():
    """SKILL.md frontmatter includes collections when provided."""
    content = _build(colls=["alpha", "beta"])
    assert "collections: [alpha, beta]" in content


def test_frontmatter_collections_omitted_when_empty():
    """SKILL.md frontmatter omits collections when list is empty/None."""
    content = _build(colls=[])
    assert "collections:" not in content

    content2 = _build(colls=None)
    assert "collections:" not in content2


def test_different_hosts_produce_different_content():
    """Two different hosts produce distinct content (URL not hardcoded)."""
    c1 = _build(host="http://server-a:8082")
    c2 = _build(host="http://server-b:9000")
    assert c1 != c2
    assert "server-a:8082" in c1
    assert "server-b:9000" in c2


def test_rating_anchor_text_present():
    """The user-facing prompt text is present in the footer."""
    content = _build()
    assert "Used this skill? Rate it now" in content


def test_footer_change_instruction_present():
    """The instruction to change agent_success_note to agent_issue is present."""
    content = _build()
    assert "agent_success_note" in content
    assert "agent_issue" in content
