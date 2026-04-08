"""SkillNote host resolution — single source of truth for Python scripts."""
import os


def get_host() -> str:
    """Resolve the SkillNote server host.

    Priority:
      1. CLAUDE_PLUGIN_OPTION_HOST env var (set by Claude Code plugin config)
      2. ~/.skillnote/host file (written by setup script at install time)
      3. "localhost" fallback (local dev only)
    """
    host = os.environ.get("CLAUDE_PLUGIN_OPTION_HOST", "").strip()
    if host:
        return host

    host_file = os.path.expanduser("~/.skillnote/host")
    if os.path.isfile(host_file):
        try:
            with open(host_file) as f:
                val = f.read().strip()
            if val:
                return val
        except Exception:
            pass

    return "localhost"
