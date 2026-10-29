"""Pure-ASGI middleware: CSRF guard, request-size limits and security headers."""
from __future__ import annotations

import json
from urllib.parse import urlparse

from starlette.datastructures import MutableHeaders

from .config import Settings

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "lilizzh-web"
JSON_LIMIT = 1_048_576  # 1 MB for every normal API request


class BodyTooLarge(Exception):
    pass


PAGE_CSP = "; ".join([
    "default-src 'self'",
    # Tailwind CDN + Babel (in-browser JSX) need 'unsafe-eval'; no inline scripts are allowed.
    "script-src 'self' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])
API_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox"


class SecurityMiddleware:
    def __init__(self, app, settings: Settings):
        self.app = app
        self.settings = settings
        self.upload_limit = settings.max_upload_mb * 1024 * 1024 + 65_536

    # ------------------------------------------------------------- helpers
    @staticmethod
    def _is_upload(path: str, method: str) -> bool:
        return method == "POST" and path.startswith("/api/orders/") and path.endswith("/files")

    def _csrf_error(self, headers: dict):
        if headers.get(CSRF_HEADER) != CSRF_VALUE:
            return "Missing security header. Please reload the page and try again."
        origin = headers.get("origin")
        if origin and origin != "null":
            host = urlparse(origin).netloc.lower()
            allowed = {headers.get("host", "").lower(), *self.settings.allowed_origins}
            if self.settings.trust_proxy and headers.get("x-forwarded-host"):
                allowed.add(headers["x-forwarded-host"].split(",")[0].strip().lower())
            if host not in allowed:
                return "Cross-site request blocked."
        elif origin == "null":
            return "Cross-site request blocked."
        return None

    async def _reply(self, send, status: int, detail: str):
        body = json.dumps({"detail": detail}).encode()
        await send({"type": "http.response.start", "status": status, "headers": [
            (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    def _limited_receive(self, receive, limit: int):
        seen = 0

        async def wrapper():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise BodyTooLarge()
            return message

        return wrapper

    def _add_headers(self, headers: MutableHeaders, path: str) -> None:
        headers["X-Content-Type-Options"] = "nosniff"
        headers["X-Frame-Options"] = "DENY"
        headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if self.settings.cookie_secure:
            headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if path.startswith("/api/"):
            headers["Cache-Control"] = "no-store"
            headers["Content-Security-Policy"] = API_CSP
        elif path == "/":
            name = ("Content-Security-Policy-Report-Only" if self.settings.csp_report_only
                    else "Content-Security-Policy")
            headers[name] = PAGE_CSP
            headers["Cache-Control"] = "no-cache"

    # ---------------------------------------------------------------- ASGI
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method, path = scope["method"], scope["path"]
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        started = False

        async def send_wrapper(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                self._add_headers(MutableHeaders(scope=message), path)
            await send(message)

        if path.startswith("/api/") and method in UNSAFE_METHODS:
            problem = self._csrf_error(headers)
            if problem:
                await self._reply(send_wrapper, 403, problem)
                return
            limit = self.upload_limit if self._is_upload(path, method) else JSON_LIMIT
            declared = headers.get("content-length", "")
            if declared.isdigit() and int(declared) > limit:
                await self._reply(send_wrapper, 413, "That request is too large.")
                return
            receive = self._limited_receive(receive, limit)

        try:
            await self.app(scope, receive, send_wrapper)
        except BodyTooLarge:
            if not started:
                await self._reply(send_wrapper, 413, "That request is too large.")
