import json, os, pytest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def test_inspect_rate_limit():
    """Fire 15 rapid inspects; expect 429 somewhere in the tail."""
    results = []
    for i in range(15):
        req = Request(f"{BASE_URL}/v1/import/inspect",
                      method="POST",
                      headers={"Content-Type": "application/json"},
                      data=json.dumps({"input": f"test{i}/nope"}).encode())
        try:
            with urlopen(req) as r:
                results.append(r.status)
        except HTTPError as e:
            results.append(e.code)
        except Exception as e:
            pytest.skip(f"API not reachable: {e}")
    assert 429 in results, f"rate limit not hit: {results}"
