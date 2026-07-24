from starlette.requests import Request

from app.api.setup import (
    SUPPORTED_AGENTS,
    get_agent_dispatch_script,
    get_agent_prompt,
    get_codex_setup_script,
)


def _request() -> Request:
    return Request({"type": "http", "headers": [(b"host", b"skillnote.test:8082")]})


def test_codex_is_a_supported_agent() -> None:
    assert "codex" in SUPPORTED_AGENTS


def test_codex_installer_uses_official_global_skill_location() -> None:
    script = get_codex_setup_script(_request()).body.decode()
    assert 'SKILLS_DIR="$HOME/.agents/skills"' in script
    assert 'MANIFEST="$STATE_DIR/manifest.json"' in script
    assert 'SYNC_SCRIPT="$STATE_DIR/sync.py"' in script
    assert 'HOOKS_FILE="$CODEX_DIR/hooks.json"' in script
    assert 'PYTHON_CMD="py -3"' in script
    assert '*WindowsApps*|*windowsapps*' in script
    assert '$PYTHON_CMD "$SYNC_SCRIPT" "$API_URL" "$SKILLS_DIR" "$MANIFEST"' in script
    assert '"SessionStart"' in script
    assert 'startup|resume|clear|compact' in script
    assert 'Refreshing SkillNote skills' in script
    assert "subprocess.list2cmdline" in script
    assert 'codex mcp add skillnote --url "$MCP_URL"' in script
    assert '"agent": "codex"' in script


def test_codex_sync_script_is_served_separately() -> None:
    from app.api.setup import get_codex_sync_script

    script = get_codex_sync_script().body.decode()
    assert 'api_url.rstrip("/") + "/v1/skills"' in script
    assert 'current/download' in script
    assert 'content_version == 0' in script
    assert 'urllib.parse.quote(source_slug, safe="")' in script
    assert 'local_slug(source_slug)' in script
    assert 'previous_slugs - managed' in script
    assert 'destination already exists and is not managed by SkillNote' in script
    assert "bundle contains a symbolic link" in script


def test_unified_installer_dispatches_codex() -> None:
    script = get_agent_dispatch_script(_request()).body.decode()
    assert "codex|codex-cli|codex_cli)" in script
    assert 'TARGET_PATH="/setup/codex"' in script


def test_codex_copy_prompt_uses_resolved_host() -> None:
    response = get_agent_prompt(_request(), agent="codex-cli")
    prompt = response.body.decode()
    assert "--agent codex" in prompt
    assert "http://skillnote.test:8082" in prompt
