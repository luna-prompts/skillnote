import io
import json
import urllib.error
import urllib.request
import zipfile

import pytest

BASE_URL = "http://127.0.0.1:8080"
ADMIN_TOKEN = "skn_admin_demo_token"
USER_TOKEN = "skn_dev_demo_token"


def _multipart_publish(token: str, name: str, version: str):
    boundary = "----skillnote-boundary-pytest"
    buff = io.BytesIO()
    with zipfile.ZipFile(buff, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "SKILL.md",
            f"---\nname: {name}\ndescription: test publish\n---\n\n# {name}\n",
        )

    body = io.BytesIO()
    for k, v in {"version": version}.items():
        body.write(f"--{boundary}\r\n".encode())
        body.write(f"Content-Disposition: form-data; name=\"{k}\"\r\n\r\n".encode())
        body.write(v.encode())
        body.write(b"\r\n")

    body.write(f"--{boundary}\r\n".encode())
    body.write(b"Content-Disposition: form-data; name=\"bundle\"; filename=\"skill.zip\"\r\n")
    body.write(b"Content-Type: application/zip\r\n\r\n")
    body.write(buff.getvalue())
    body.write(b"\r\n")
    body.write(f"--{boundary}--\r\n".encode())

    req = urllib.request.Request(
        f"{BASE_URL}/v1/publish",
        method="POST",
        data=body.getvalue(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable for publish integration test: {e}")


def test_publish_requires_admin():
    status, body = _multipart_publish(USER_TOKEN, "user-should-fail", "0.1.0")
    assert status == 403
    assert body["error"]["code"] == "FORBIDDEN"


def test_publish_with_admin_success():
    status, body = _multipart_publish(ADMIN_TOKEN, "admin-published-skill", "0.1.0")
    assert status == 200
    assert body["skill"] == "admin-published-skill"
    assert body["version"] == "0.1.0"
    assert body["checksumSha256"]
