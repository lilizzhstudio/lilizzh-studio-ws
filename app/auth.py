"""Sessions, the signed-in 'principal', and the `endpoint` decorator that every route uses."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlparse

from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import Response

from .config import Settings
from .db import connect, now_iso
from .errors import ApiError

COOKIE_NAME = "lz_session"


@dataclass
class Principal:
    role: str  # CLIENT | EDITOR | ADMIN
    user_id: Optional[int]
    editor_id: Optional[str]
    name: str
    email: str
    phone: str

    def public(self) -> dict:
        data = {"name": self.name, "email": self.email, "phone": self.phone, "role": self.role}
        if self.editor_id:
            data["editorId"] = self.editor_id
        return data


def _token_hash(settings: Settings, token: str) -> str:
    return hmac.new(settings.secret_key.encode(), token.encode(), hashlib.sha256).hexdigest()


def client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def create_session(conn: sqlite3.Connection, settings: Settings, role: str,
                   user_id: Optional[int], editor_id: Optional[str], ip: str) -> tuple:
    token = secrets.token_urlsafe(32)
    hours = settings.admin_session_hours if role == "ADMIN" else settings.session_hours
    now = datetime.now(timezone.utc)
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now.isoformat(timespec="seconds"),))
    conn.execute(
        "INSERT INTO sessions(token_hash, role, user_id, editor_id, created_at, expires_at, last_ip) "
        "VALUES (?,?,?,?,?,?,?)",
        (_token_hash(settings, token), role, user_id, editor_id, now_iso(),
         (now + timedelta(hours=hours)).isoformat(timespec="seconds"), ip),
    )
    return token, hours * 3600


def destroy_session(conn: sqlite3.Connection, settings: Settings, token: Optional[str]) -> None:
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(settings, token),))


def set_session_cookie(response: Response, settings: Settings, token: str, max_age: int) -> None:
    response.set_cookie(
        COOKIE_NAME, token, max_age=max_age, httponly=True,
        secure=settings.cookie_secure, samesite="lax", path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True,
                           secure=settings.cookie_secure, samesite="lax")


def load_principal(conn: sqlite3.Connection, settings: Settings, request: Request) -> Optional[Principal]:
    token = request.cookies.get(COOKIE_NAME)
    if not token or len(token) > 200:
        return None
    row = conn.execute(
        "SELECT * FROM sessions WHERE token_hash = ?", (_token_hash(settings, token),)
    ).fetchone()
    if row is None:
        return None
    if row["expires_at"] < now_iso():
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (row["token_hash"],))
        return None
    if row["role"] == "EDITOR":
        ed = conn.execute("SELECT * FROM editors WHERE id = ? AND active = 1", (row["editor_id"],)).fetchone()
        if ed is None:
            return None
        return Principal("EDITOR", None, ed["id"], ed["name"], ed["email"], "")
    user = conn.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
    if user is None or user["role"] != row["role"]:
        return None
    return Principal(user["role"], user["id"], None, user["name"], user["email"], user["phone"])


def endpoint(*roles: str, public: bool = False):
    """Wrap `async def handler(request, conn, principal)`.

    * opens/closes the database connection
    * signed-in users only (unless public=True), optionally restricted to `roles`
    """
    def decorator(fn):
        async def wrapper(request: Request) -> Response:
            settings: Settings = request.app.state.settings
            conn = connect(settings.db_path)
            try:
                principal = load_principal(conn, settings, request)
                if not public:
                    if principal is None:
                        raise ApiError(401, "Please sign in to continue.")
                    if roles and principal.role not in roles:
                        raise ApiError(403, "You do not have permission to do that.")
                return await fn(request, conn, principal)
            finally:
                conn.close()

        wrapper.__name__ = fn.__name__
        return wrapper

    return decorator


async def parse_body(request: Request, model):
    try:
        raw = await request.json()
    except Exception:
        raise ApiError(400, "Request body must be valid JSON.")
    if not isinstance(raw, dict):
        raise ApiError(400, "Request body must be a JSON object.")
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(p) for p in first["loc"]) or "request"
        message = str(first["msg"]).removeprefix("Value error, ")
        raise ApiError(422, f"Please check '{field}': {message}")


def clean_http_url(value: str) -> str:
    """Only plain http(s) links are accepted for video URLs (blocks javascript:/data: tricks)."""
    value = (value or "").strip()
    parsed = urlparse(value)
    if (parsed.scheme not in ("http", "https") or not parsed.netloc or len(value) > 2048
            or any(ch.isspace() or ord(ch) < 32 for ch in value)):
        raise ApiError(422, "Please provide a valid http(s) link to the video file.")
    return value
