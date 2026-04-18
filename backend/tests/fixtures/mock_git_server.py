"""Flask-based mock server for GitHub API + git clone during tests.

Usage in a test:

    from tests.fixtures.mock_git_server import MockServer

    with MockServer() as srv:
        srv.serve_repo("wshobson/agents", ref="main", skills=[
            ("python-expert", "Python code-review heuristics"),
        ])
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        # ... call inspect/apply ...
"""
from __future__ import annotations

import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Optional

from flask import Flask, Response, abort, jsonify
from werkzeug.serving import make_server


class MockServer:
    """Spawns a Flask server on a random port. Serves /repos/<owner>/<repo>/commits/<ref>
    for HEAD-SHA probes and /<owner>/<repo>.git/* for git clone (via git-http-backend)."""

    def __init__(self):
        self.app = Flask(__name__)
        self._setup_routes()
        self.tmp = Path(tempfile.mkdtemp(prefix="mockgit-"))
        self.server = None
        self.thread = None
        self.port = None
        self._repos = {}  # (owner, repo, ref) → {sha, skills}
        self._failure_mode = None  # "404" | "403" | "timeout" | "reset" | None

    def _setup_routes(self):
        app = self.app

        @app.route("/repos/<owner>/<repo>/commits/<ref>")
        def head_sha(owner, repo, ref):
            if self._failure_mode == "404":
                abort(404)
            if self._failure_mode == "403":
                abort(403)
            if self._failure_mode == "timeout":
                time.sleep(35)
            entry = self._repos.get((owner, repo, ref))
            if not entry:
                abort(404)
            return jsonify({"sha": entry["sha"]})

        @app.route("/<owner>/<repo>.git/info/refs")
        def git_refs(owner, repo):
            # Return a minimal git smart-HTTP response for shallow clone
            # (In practice tests may shell out to a real git CLI; this stub
            # is sufficient for tests that don't actually clone.)
            entry = self._repos.get((owner, repo, "main"))
            if not entry:
                abort(404)
            return Response(
                f"# service=git-upload-pack\n0000{entry['sha']}\n",
                mimetype="application/x-git-upload-pack-advertisement",
            )

    def serve_repo(
        self,
        owner_repo: str,
        ref: str = "main",
        sha: Optional[str] = None,
        skills: Iterable[tuple] = (),
    ) -> None:
        owner, repo = owner_repo.split("/")
        resolved_sha = sha or f"{owner_repo}-{ref}-fixture-sha"
        self._repos[(owner, repo, ref)] = {
            "sha": resolved_sha,
            "skills": list(skills),
        }

    def set_failure_mode(self, mode: Optional[str]) -> None:
        self._failure_mode = mode

    @property
    def api_base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self):
        self.server = make_server("127.0.0.1", 0, self.app)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        if self.server:
            self.server.shutdown()

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.stop()


@contextmanager
def mock_github():
    """Convenience context manager."""
    with MockServer() as srv:
        yield srv
