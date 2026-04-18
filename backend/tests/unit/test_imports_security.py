"""Tests for import security layer: URL scheme allowlist + private-IP block."""
import pytest

from app.services.imports.security import (
    is_scheme_allowed,
    is_private_address,
    validate_import_url,
    SecurityError,
)


@pytest.mark.parametrize("url,allowed", [
    ("https://github.com/x/y", True),
    ("http://example.com", True),
    ("git@github.com:x/y.git", True),
    ("ssh://user@host/repo", True),
    ("file:///etc/passwd", False),
    ("javascript:alert(1)", False),
    ("ftp://example.com/foo", False),
    ("data:text/plain;base64,xxx", False),
])
def test_scheme_allowlist(url, allowed):
    assert is_scheme_allowed(url) == allowed


@pytest.mark.parametrize("ip,private", [
    ("10.0.0.1", True),
    ("172.16.0.1", True),
    ("172.31.255.254", True),
    ("192.168.0.1", True),
    ("127.0.0.1", True),
    ("169.254.169.254", True),  # AWS metadata
    ("100.64.0.1", True),        # CGNAT
    ("::1", True),                # IPv6 loopback
    ("fe80::1", True),            # IPv6 link-local
    ("fc00::1", True),            # IPv6 unique-local
    ("8.8.8.8", False),
    ("1.1.1.1", False),
    ("2606:4700::1", False),
])
def test_private_address(ip, private):
    assert is_private_address(ip) == private


def test_validate_import_url_ok():
    validate_import_url("https://github.com/wshobson/agents")


def test_validate_import_url_bad_scheme():
    with pytest.raises(SecurityError, match="URL_SCHEME_FORBIDDEN"):
        validate_import_url("file:///etc/passwd")


def test_validate_import_url_private_ip_hostname():
    with pytest.raises(SecurityError, match="URL_SCHEME_FORBIDDEN"):
        validate_import_url("http://169.254.169.254/latest/meta-data/")


def test_validate_import_url_localhost():
    with pytest.raises(SecurityError, match="URL_SCHEME_FORBIDDEN"):
        validate_import_url("http://localhost:8082/")
