"""Application factory. Serves the website (frontend/) and the JSON API (/api/...) from one origin."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import routes_admin, routes_auth, routes_orders, routes_public
from .config import BASE_DIR, Settings, load_settings
from .db import connect, init_db
from .errors import ApiError
from .middleware import SecurityMiddleware
from .security import RateLimiter
from .seed import create_admin, has_admin, seed_editors, seed_rate_card

log = logging.getLogger("lilizzh")
FRONTEND_DIR = BASE_DIR / "frontend"


def create_app(settings: Optional[Settings] = None) -> Starlette:
    settings = settings or load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    init_db(settings.db_path)

    conn = connect(settings.db_path)
    try:
        if not conn.execute("SELECT 1 FROM rate_card").fetchone():
            seed_rate_card(conn)
        if not has_admin(conn) and settings.bootstrap_admin_email and settings.bootstrap_admin_password:
            create_admin(conn, settings.bootstrap_admin_name, settings.bootstrap_admin_email,
                         settings.bootstrap_admin_password)
            log.warning("Admin account created from ADMIN_EMAIL / ADMIN_PASSWORD. "
                        "Remove ADMIN_PASSWORD from your environment now.")
        if not has_admin(conn):
            log.warning("No admin account exists yet. Run: python manage.py init")
        if not conn.execute("SELECT 1 FROM editors").fetchone():
            log.warning("No editors exist yet. Run: python manage.py init")
        for gap in settings.payment_problems:
            log.warning("Payment settings: %s", gap)
    finally:
        conn.close()

    async def api_error(request, exc: ApiError):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    async def http_error(request, exc: HTTPException):
        message = {404: "Not found.", 405: "Method not allowed."}.get(exc.status_code, str(exc.detail))
        return JSONResponse({"detail": message}, status_code=exc.status_code)

    async def server_error(request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Something went wrong on the server. Please try again."}, status_code=500)

    async def index(request):
        return FileResponse(FRONTEND_DIR / "index.html", media_type="text/html")

    routes = [
        *routes_public.routes, *routes_auth.routes, *routes_orders.routes, *routes_admin.routes,
        Route("/", index, methods=["GET"]),
        Mount("/static", app=StaticFiles(directory=str(FRONTEND_DIR)), name="static"),
    ]
    app = Starlette(
        routes=routes,
        middleware=[Middleware(SecurityMiddleware, settings=settings)],
        exception_handlers={ApiError: api_error, HTTPException: http_error, Exception: server_error},
    )
    app.state.settings = settings
    app.state.limiter = RateLimiter()
    return app


def app_factory() -> Starlette:
    """Entry point for `uvicorn app.main:app_factory --factory`."""
    return create_app()
