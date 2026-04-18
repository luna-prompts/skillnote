import requests

from tests.fixtures.mock_git_server import MockServer


def test_mock_head_sha():
    with MockServer() as srv:
        srv.serve_repo("wshobson/agents", ref="main", sha="abc123")
        r = requests.get(f"{srv.api_base}/repos/wshobson/agents/commits/main")
        assert r.status_code == 200
        assert r.json() == {"sha": "abc123"}


def test_mock_404_mode():
    with MockServer() as srv:
        srv.set_failure_mode("404")
        r = requests.get(f"{srv.api_base}/repos/a/b/commits/main")
        assert r.status_code == 404


def test_mock_nonexistent_repo_returns_404():
    with MockServer() as srv:
        r = requests.get(f"{srv.api_base}/repos/no/such/commits/main")
        assert r.status_code == 404


def test_mock_reset_mode():
    import requests
    with MockServer() as srv:
        srv.serve_repo("a/b", ref="main", sha="deadbeef")
        srv.set_failure_mode("reset")
        r = requests.get(f"{srv.api_base}/repos/a/b/commits/main")
        assert r.status_code == 502
