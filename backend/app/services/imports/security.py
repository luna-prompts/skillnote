"""Security checks for import URLs: scheme allowlist + private-IP block.

Pure functions (no I/O, no state) except for DNS resolution inside
validate_import_url. No rate-limiting here — that lives on the API layer.
"""
from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlparse


class SecurityError(Exception):
    """Raised when an import URL fails a security gate.

    Message is the error code (e.g. 'URL_SCHEME_FORBIDDEN') so callers can
    inspect and remap to user-friendly copy.
    """


ALLOWED_SCHEMES = {"http", "https", "git", "ssh"}
SSH_FORM_RE = re.compile(r"^[a-zA-Z0-9._-]+@[^:]+:")


def is_scheme_allowed(url: str) -> bool:
    """Check whether a URL uses an allowed scheme. SSH-form URLs (user@host:path)
    are treated as allowed."""
    if not url:
        return False
    if SSH_FORM_RE.match(url):
        return True
    parsed = urlparse(url)
    return parsed.scheme in ALLOWED_SCHEMES


def is_private_address(addr: str) -> bool:
    """Check if a string IP address is in a private/reserved/loopback range.

    Blocks RFC1918, CGNAT, link-local, loopback, and IPv6 equivalents.
    Unresolvable strings return True (fail-closed)."""
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return True  # fail-closed
    # Python's standard library covers most private ranges; we check explicitly
    # where stdlib misses (e.g., CGNAT, AWS metadata endpoint)
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
        return True
    # CGNAT 100.64.0.0/10 is NOT private in Python's stdlib
    if isinstance(ip, ipaddress.IPv4Address):
        if ip in ipaddress.ip_network("100.64.0.0/10"):
            return True
    return False


def _host_of(url: str) -> str:
    """Extract hostname from either an SSH-form URL or a standard URL."""
    m = SSH_FORM_RE.match(url)
    if m:
        # user@host:path → extract host
        at = url.index("@")
        colon = url.index(":", at)
        return url[at + 1:colon]
    parsed = urlparse(url)
    return parsed.hostname or ""


def validate_import_url(url: str) -> None:
    """Raise SecurityError if the URL fails any pre-clone gate."""
    if not is_scheme_allowed(url):
        raise SecurityError("URL_SCHEME_FORBIDDEN")
    host = _host_of(url)
    if not host:
        raise SecurityError("URL_SCHEME_FORBIDDEN")
    # Localhost literal
    if host.lower() in ("localhost", "ip6-localhost"):
        raise SecurityError("URL_SCHEME_FORBIDDEN")
    # Resolve and check every A/AAAA record
    try:
        addrs = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # Let the clone itself fail with network error; don't block at this layer
        return
    for _fam, _typ, _proto, _canon, sockaddr in addrs:
        ip = sockaddr[0]
        if is_private_address(ip):
            raise SecurityError("URL_SCHEME_FORBIDDEN")
