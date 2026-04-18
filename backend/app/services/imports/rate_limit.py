"""Simple in-memory token-bucket rate limiter keyed by client IP.

Thread-safe. Sufficient for single-process FastAPI. Replace with Redis or
slowapi for multi-worker deployments (noted for v2).
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Dict, Tuple

from fastapi import Request, HTTPException


class TokenBucket:
    def __init__(self, rate: int, per_seconds: int):
        self.rate = rate
        self.per = per_seconds
        self._buckets: Dict[str, Tuple[float, float]] = defaultdict(
            lambda: (float(rate), time.monotonic())
        )
        self._lock = threading.Lock()

    def take(self, key: str) -> bool:
        with self._lock:
            tokens, last = self._buckets[key]
            now = time.monotonic()
            refill = (now - last) * (self.rate / self.per)
            tokens = min(float(self.rate), tokens + refill)
            if tokens < 1:
                self._buckets[key] = (tokens, now)
                return False
            self._buckets[key] = (tokens - 1, now)
            return True


# Two buckets: imports (10/min) + marketplace (60/min)
_imports = TokenBucket(rate=10, per_seconds=60)
_marketplace = TokenBucket(rate=60, per_seconds=60)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_imports_rate(request: Request):
    ip = _client_ip(request)
    if not _imports.take(ip):
        raise HTTPException(
            status_code=429,
            detail={"code": "RATE_LIMITED", "message": "Too many imports. Try again in 1 minute."},
        )


def check_marketplace_rate(request: Request):
    ip = _client_ip(request)
    if not _marketplace.take(ip):
        raise HTTPException(
            status_code=429,
            detail={"code": "RATE_LIMITED", "message": "Too many requests. Try again in 1 minute."},
        )
