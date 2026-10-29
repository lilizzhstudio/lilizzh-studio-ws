"""Password hashing, input normalisation and a small in-memory rate limiter."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import threading
import time
from collections import defaultdict, deque
from typing import Optional

# ------------------------------------------------------------------ passwords
_N, _R, _P = 2 ** 14, 8, 1
_MAXMEM = 64 * 1024 * 1024


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=32, maxmem=_MAXMEM
    )
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: Optional[str]) -> bool:
    if not stored:
        return False
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=int(n), r=int(r), p=int(p),
            dklen=len(expected), maxmem=_MAXMEM,
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


_dummy_hash: Optional[str] = None


def burn_password_check(password: str) -> None:
    """Spend the same time as a real check so unknown accounts can't be detected by timing."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password("timing-equaliser-not-a-real-password")
    verify_password(password, _dummy_hash)


_COMMON = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890",
    "qwerty123", "qwertyui", "iloveyou", "admin123", "admin1234", "letmein123",
    "welcome123", "lilizzh123", "lilizzh@123",
    # Appeared in the old public page source: treat as permanently compromised.
    "lilizzh@7218",
}


def password_problem(password: str) -> Optional[str]:
    if len(password) < 8:
        return "Password must be at least 8 characters long."
    if len(password) > 128:
        return "Password must be at most 128 characters long."
    if password.lower() in _COMMON or len(set(password)) < 4:
        return "That password is too easy to guess. Please choose a stronger one."
    return None


# ------------------------------------------------------------ normalisation
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def normalise_email(value: str) -> str:
    return value.strip().lower()


def valid_email(value: str) -> bool:
    return len(value) <= 254 and bool(_EMAIL_RE.match(value))


def phone_key(value: str) -> str:
    """Last 10 digits – lets '+91 98765 43210' and '9876543210' match each other."""
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else ""


# --------------------------------------------------------------- rate limits
class RateLimiter:
    """Sliding-window limiter kept in memory (per process)."""

    def __init__(self) -> None:
        self._hits: dict = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def _prune(self, key: str, window: float, now: float) -> deque:
        q = self._hits[key]
        while q and now - q[0] > window:
            q.popleft()
        return q

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < 600:
            return
        self._last_sweep = now
        for key in [k for k, q in self._hits.items() if not q or now - q[-1] > 3600]:
            self._hits.pop(key, None)

    def is_blocked(self, key: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            return len(self._prune(key, window, now)) >= limit

    def hit(self, key: str, window: float) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(key, window, now).append(now)

    def allow(self, key: str, limit: int, window: float) -> bool:
        """Record one hit and say whether it is within the limit."""
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            q = self._prune(key, window, now)
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)
