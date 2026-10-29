"""SQLite storage. One short-lived connection per request, autocommit by default,
explicit transactions (`transaction(conn)`) wherever several writes must succeed together."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    role          TEXT NOT NULL CHECK (role IN ('CLIENT','ADMIN')),
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone         TEXT NOT NULL DEFAULT '',
    phone_key     TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_phone_key ON users(phone_key);

CREATE TABLE IF NOT EXISTS editors (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    role_title     TEXT NOT NULL,
    tag            TEXT NOT NULL,
    rating         TEXT NOT NULL,
    speed          TEXT NOT NULL,
    avatar         TEXT NOT NULL,
    badge          TEXT NOT NULL,
    email          TEXT NOT NULL DEFAULT '',
    bio            TEXT NOT NULL,
    portfolio_json TEXT NOT NULL DEFAULT '[]',
    passcode_hash  TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    role       TEXT NOT NULL,
    user_id    INTEGER,
    editor_id  TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_ip    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS rate_card (
    id         TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL DEFAULT 0,
    data       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    client_user_id  INTEGER NOT NULL REFERENCES users(id),
    client_name     TEXT NOT NULL,
    client_email    TEXT NOT NULL,
    phone           TEXT NOT NULL DEFAULT '',
    project_type    TEXT NOT NULL,
    aspect_ratio    TEXT NOT NULL DEFAULT '',
    editor_id       TEXT NOT NULL REFERENCES editors(id),
    status          TEXT NOT NULL,
    price           REAL NOT NULL,
    editor_payout   REAL NOT NULL,
    negotiation_json TEXT,
    order_date      TEXT NOT NULL,
    unlocked        INTEGER NOT NULL DEFAULT 0,
    payment_json    TEXT,
    draft_url       TEXT NOT NULL DEFAULT '',
    clean_url       TEXT NOT NULL DEFAULT '',
    folders_json    TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_editor ON orders(editor_id);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sender     TEXT NOT NULL CHECK (sender IN ('client','editor','system')),
    text       TEXT NOT NULL,
    time_label TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all','private')),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id, id);

CREATE TABLE IF NOT EXISTS files (
    id          TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    folder      TEXT NOT NULL,
    time_label  TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_order ON files(order_id);

CREATE TABLE IF NOT EXISTS inquiries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
"""


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), timeout=30, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection):
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


# ---------------------------------------------------------------- time helpers
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def local_now(tz_offset_minutes: int) -> datetime:
    return datetime.now(timezone(timedelta(minutes=tz_offset_minutes)))


def clock_label(tz_offset_minutes: int) -> str:
    """'10:45 AM' – same look as the original browser-side labels."""
    return local_now(tz_offset_minutes).strftime("%I:%M %p")


def date_label(tz_offset_minutes: int) -> str:
    return local_now(tz_offset_minutes).strftime("%Y-%m-%d")


def stamp_label(tz_offset_minutes: int) -> str:
    return local_now(tz_offset_minutes).strftime("%Y-%m-%d, %I:%M %p")


# ---------------------------------------------------------------- json helpers
def loads(value: Optional[str], default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------- rate card
def load_rate_card(conn: sqlite3.Connection) -> list:
    rows = conn.execute("SELECT data FROM rate_card ORDER BY sort_order, id").fetchall()
    return [json.loads(r["data"]) for r in rows]
