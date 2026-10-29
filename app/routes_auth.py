"""Register, sign in, sign out. Passwords are checked here, never in the browser."""
from __future__ import annotations

import sqlite3

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.routing import Route

from .auth import (COOKIE_NAME, client_ip, clear_session_cookie, create_session, destroy_session,
                   endpoint, parse_body, set_session_cookie)
from .db import now_iso
from .errors import ApiError
from .schemas import LoginIn, RegisterIn
from .security import (burn_password_check, hash_password, normalise_email, password_problem,
                       phone_key, verify_password)

LOGIN_LIMIT, LOGIN_WINDOW = 8, 15 * 60          # 8 failures / 15 min per account from one address
IP_LIMIT = 40                                    # 40 failures / 15 min per address (any account)
ACCOUNT_LIMIT = 60                               # 60 failures / 15 min per account from all addresses combined
BAD_LOGIN = "Invalid credentials. Please check your details and try again."


async def _check(password: str, stored):
    if stored:
        return await run_in_threadpool(verify_password, password, stored)
    await run_in_threadpool(burn_password_check, password)
    return False


def _issue(request, conn, settings, role, user_id, editor_id, user_json):
    token, max_age = create_session(conn, settings, role, user_id, editor_id, client_ip(request, settings))
    response = JSONResponse({"user": user_json})
    set_session_cookie(response, settings, token, max_age)
    return response


@endpoint(public=True)
async def register(request, conn: sqlite3.Connection, principal):
    settings = request.app.state.settings
    limiter = request.app.state.limiter
    ip = client_ip(request, settings)
    if not limiter.allow(f"register:{ip}", 10, 3600):
        raise ApiError(429, "Too many sign-up attempts. Please try again later.")
    data = await parse_body(request, RegisterIn)
    problem = password_problem(data.password)
    if problem:
        raise ApiError(422, problem)
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (data.email,)).fetchone():
        raise ApiError(409, "An account with this email already exists. Please log in.")
    hashed = await run_in_threadpool(hash_password, data.password)
    try:
        cur = conn.execute(
            "INSERT INTO users(role,name,email,phone,phone_key,password_hash,created_at) "
            "VALUES ('CLIENT',?,?,?,?,?,?)",
            (data.name, data.email, data.phone, phone_key(data.phone), hashed, now_iso()),
        )
    except sqlite3.IntegrityError:
        raise ApiError(409, "An account with this email already exists. Please log in.")
    user = {"name": data.name, "email": data.email, "phone": data.phone, "role": "CLIENT"}
    return _issue(request, conn, settings, "CLIENT", cur.lastrowid, None, user)


@endpoint(public=True)
async def login(request, conn: sqlite3.Connection, principal):
    settings = request.app.state.settings
    limiter = request.app.state.limiter
    ip = client_ip(request, settings)
    data = await parse_body(request, LoginIn)

    # Work out which account is being targeted (used as the lockout key).
    if data.role == "EDITOR":
        identifier = (data.editorId or "").strip()
    elif data.role == "ADMIN":
        identifier = normalise_email(data.email or "")
    else:
        identifier = normalise_email(data.email) if data.email else f"phone:{phone_key(data.phone or '')}"
    if not identifier or identifier == "phone:":
        raise ApiError(401, BAD_LOGIN)

    # The per-account limit is tracked per visitor address, so a stranger who deliberately fails logins
    # for YOUR account can only lock out their own address - never you. A much higher account-wide
    # limit still stops a botnet that spreads guesses over many addresses.
    id_key = f"login:id:{data.role}:{identifier}:{ip}"
    acct_key = f"login:acct:{data.role}:{identifier}"
    ip_key = f"login:ip:{ip}"
    if (limiter.is_blocked(id_key, LOGIN_LIMIT, LOGIN_WINDOW) or limiter.is_blocked(ip_key, IP_LIMIT, LOGIN_WINDOW)
            or limiter.is_blocked(acct_key, ACCOUNT_LIMIT, LOGIN_WINDOW)):
        raise ApiError(429, "Too many failed attempts. Please wait 15 minutes and try again.")

    ok, user_row, editor_row = False, None, None
    if data.role == "EDITOR":
        editor_row = conn.execute("SELECT * FROM editors WHERE id = ? AND active = 1", (identifier,)).fetchone()
        ok = await _check(data.password, editor_row["passcode_hash"] if editor_row else None)
    elif data.role == "ADMIN":
        user_row = conn.execute("SELECT * FROM users WHERE email = ? AND role = 'ADMIN'", (identifier,)).fetchone()
        ok = await _check(data.password, user_row["password_hash"] if user_row else None)
    else:
        if data.email:
            candidates = conn.execute("SELECT * FROM users WHERE email = ? AND role = 'CLIENT'", (identifier,)).fetchall()
        else:
            key = phone_key(data.phone or "")
            candidates = conn.execute("SELECT * FROM users WHERE phone_key = ? AND role = 'CLIENT'", (key,)).fetchall() if key else []
        if not candidates:
            await _check(data.password, None)
        for cand in candidates:
            if await _check(data.password, cand["password_hash"]):
                ok, user_row = True, cand
                break

    if not ok:
        limiter.hit(id_key, LOGIN_WINDOW)
        limiter.hit(acct_key, LOGIN_WINDOW)
        limiter.hit(ip_key, LOGIN_WINDOW)
        raise ApiError(401, BAD_LOGIN)

    limiter.reset(id_key)
    if editor_row is not None:
        user = {"name": editor_row["name"], "email": editor_row["email"], "role": "EDITOR",
                "editorId": editor_row["id"]}
        return _issue(request, conn, settings, "EDITOR", None, editor_row["id"], user)
    user = {"name": user_row["name"], "email": user_row["email"], "phone": user_row["phone"],
            "role": user_row["role"]}
    return _issue(request, conn, settings, user_row["role"], user_row["id"], None, user)


@endpoint(public=True)
async def logout(request, conn, principal):
    settings = request.app.state.settings
    destroy_session(conn, settings, request.cookies.get(COOKIE_NAME))
    response = JSONResponse({"ok": True})
    clear_session_cookie(response, settings)
    return response


@endpoint(public=True)
async def me(request, conn, principal):
    return JSONResponse({"user": principal.public() if principal else None})


routes = [
    Route("/api/auth/register", register, methods=["POST"]),
    Route("/api/auth/login", login, methods=["POST"]),
    Route("/api/auth/logout", logout, methods=["POST"]),
    Route("/api/auth/me", me, methods=["GET"]),
]
