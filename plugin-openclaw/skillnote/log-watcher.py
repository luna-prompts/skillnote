#!/usr/bin/env python3
"""
log-watcher.py — Watch OpenClaw session JSONL files for skill reads and post
analytics events to SkillNote.

Usage:
    python3 log-watcher.py <host> <sessions_dir> <state_dir>

Args:
    host         e.g. http://localhost:8082
    sessions_dir e.g. ~/.openclaw/agents/main/sessions
    state_dir    e.g. ~/.openclaw/skills/skillnote
"""

import json
import os
import signal
import sys
import time
import urllib.request

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
POLL_INTERVAL = 2  # seconds between scans


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def post_skill_used(host: str, slug: str, session_id: str) -> None:
    """Fire-and-forget POST to /v1/hooks/skill-used."""
    payload = json.dumps(
        {
            "skill_slug": slug,
            "agent_name": "openclaw-main",
            "session_id": session_id or "",
        }
    ).encode()
    req = urllib.request.Request(
        f"{host}/v1/hooks/skill-used",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # fire-and-forget — network errors are silently ignored


# ---------------------------------------------------------------------------
# File processing
# ---------------------------------------------------------------------------

def process_file(path: str, state: dict, host: str, daemon_start_time: float) -> None:
    """
    Read new lines from a JSONL session file, emit skill-used events for any
    skill reads found, and update state in-place.

    `daemon_start_time` is the wall-clock time (epoch seconds) when the daemon
    process started — used to distinguish files that pre-existed the daemon
    (skip to EOF; almost certainly already fired in a previous daemon lifecycle)
    from files that were created/modified during this daemon's lifetime
    (process from offset 0).
    """
    is_new_to_state = path not in state
    file_state = state.get(
        path,
        {"inode": None, "offset": 0, "session_id": "", "seen_slugs": []},
    )

    try:
        current_size = os.path.getsize(path)
        current_inode = os.stat(path).st_ino
        current_mtime = os.path.getmtime(path)
    except OSError:
        # File disappeared between scan and stat — skip silently.
        return

    if current_inode != file_state["inode"]:
        # We have no record of this (file, inode) before. Two distinct cases:
        #
        #   A. File pre-existed the current daemon process (either we're a
        #      restart with state wiped, or a state-corruption recovery):
        #      → skip to current EOF. Don't replay historical events that
        #        almost certainly already fired in a previous daemon lifecycle.
        #
        #   B. File appeared during this daemon's lifetime (new session created
        #      after we started; "agent crashes mid-session" recovery is
        #      indistinguishable from this case and should also process):
        #      → start at offset 0 and read it all.
        #
        # Heuristic: file's last-modified time vs daemon-start time. If mtime
        # predates the daemon, file pre-existed → skip to EOF. Otherwise it
        # was touched during our lifetime → process normally.
        if is_new_to_state and current_size > 0 and current_mtime < daemon_start_time:
            start_offset = current_size
        else:
            start_offset = 0
        file_state = {
            "inode": current_inode,
            "offset": start_offset,
            "session_id": "",
            "seen_slugs": [],
        }

    try:
        with open(path) as f:
            f.seek(file_state["offset"])
            for line in f:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    # Partial line (write in progress) — skip and keep reading.
                    continue

                # Track the session id; reset per-session deduplication.
                if event.get("type") == "session":
                    file_state["session_id"] = event.get("id", "")
                    file_state["seen_slugs"] = []

                # Look for tool calls that read a skill file.
                if event.get("type") == "message":
                    msg = event.get("message", {})
                    content = msg.get("content", [])
                    if not isinstance(content, list):
                        continue
                    for item in content:
                        if not isinstance(item, dict):
                            continue
                        if (
                            item.get("type") != "toolCall"
                            or item.get("name") != "read"
                        ):
                            continue
                        path_arg = item.get("arguments", {}).get("path", "")
                        # Match paths like: .../sn-{slug}/SKILL.md
                        if "/sn-" in path_arg and path_arg.endswith("/SKILL.md"):
                            parts = path_arg.split("/sn-")
                            slug = parts[-1].replace("/SKILL.md", "")
                            if slug and slug not in file_state["seen_slugs"]:
                                file_state["seen_slugs"].append(slug)
                                post_skill_used(
                                    host, slug, file_state["session_id"]
                                )

            file_state["offset"] = f.tell()
    except OSError:
        # File disappeared mid-read — skip this iteration.
        return

    state[path] = file_state


# ---------------------------------------------------------------------------
# State persistence
# ---------------------------------------------------------------------------

def load_state(state_file: str) -> dict:
    """Load watcher state from disk, or return an empty dict on any error."""
    try:
        with open(state_file) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(state_file: str, state: dict) -> None:
    """Persist watcher state to disk (best-effort)."""
    try:
        with open(state_file, "w") as f:
            json.dump(state, f)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Session file discovery
# ---------------------------------------------------------------------------

def find_session_files(sessions_dir: str) -> list:
    """
    Return a sorted list of *.jsonl paths inside sessions_dir, excluding
    trajectory and reset files.
    """
    results = []
    try:
        entries = os.listdir(sessions_dir)
    except OSError:
        return results

    for name in entries:
        if not name.endswith(".jsonl"):
            continue
        # Exclude trajectory and reset variants.
        if ".trajectory." in name or ".reset." in name:
            continue
        results.append(os.path.join(sessions_dir, name))

    results.sort()
    return results


# ---------------------------------------------------------------------------
# PID file management
# ---------------------------------------------------------------------------

def write_pid(pid_file: str) -> None:
    """Write the current process PID to pid_file."""
    with open(pid_file, "w") as f:
        f.write(str(os.getpid()))


def remove_pid(pid_file: str) -> None:
    """Remove the PID file (best-effort)."""
    try:
        os.remove(pid_file)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) != 4:
        print(
            "Usage: python3 log-watcher.py <host> <sessions_dir> <state_dir>",
            file=sys.stderr,
        )
        sys.exit(1)

    host = sys.argv[1]
    sessions_dir = os.path.expanduser(sys.argv[2])
    state_dir = os.path.expanduser(sys.argv[3])

    state_file = os.path.join(state_dir, ".log-watcher-state.json")
    pid_file = os.path.join(state_dir, ".log-watcher.pid")

    # Ensure state_dir exists before writing the PID file.
    os.makedirs(state_dir, exist_ok=True)

    # --- PID file ---
    write_pid(pid_file)

    # --- Signal handling (clean exit on SIGTERM) ---
    def _handle_sigterm(signum, frame):  # noqa: ANN001
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _handle_sigterm)

    # --- Main loop ---
    # Capture wall-clock start time. process_file uses this to distinguish
    # files that pre-existed our launch (skip to EOF) from files that
    # appeared/grew during our lifetime (process normally).
    daemon_start_time = time.time()
    state = load_state(state_file)
    try:
        while True:
            # Gracefully handle a missing sessions_dir (wait and retry).
            if not os.path.isdir(sessions_dir):
                time.sleep(POLL_INTERVAL)
                continue

            for path in find_session_files(sessions_dir):
                process_file(path, state, host, daemon_start_time)

            save_state(state_file, state)
            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        pass
    finally:
        remove_pid(pid_file)


if __name__ == "__main__":
    main()
