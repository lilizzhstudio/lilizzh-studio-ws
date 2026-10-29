"""First-run data: editor profiles, the rate card and (optionally) demo orders.

No passwords live in this file. Editor passcodes are generated randomly by
`python manage.py init` and shown once; only their scrypt hashes are stored.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
from pathlib import Path
from typing import Optional

from .config import BASE_DIR, Settings
from .db import clock_label, date_label, dumps, now_iso, transaction
from .security import hash_password, normalise_email, phone_key

_VIDEO_A = "https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-screens-and-code-31969-large.mp4"
_VIDEO_B = "https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-1610-large.mp4"

EDITORS = [
    {
        "id": "ed-1", "name": "Marcus Vance", "role_title": "Elite Cinematic Colorist", "tag": "YouTube",
        "rating": "4.98", "speed": "< 18h", "badge": "Top Rated", "email": "marcus@lilizzh.studio",
        "avatar": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
        "bio": "Specializing in high-budget YouTube documentaries, DaVinci Resolve narrative grading, and dynamic cinematic pacing with over 8 years in commercial post-production.",
        "portfolio": [
            {"title": "Cinematic Documentary Master Cut", "url": _VIDEO_A},
            {"title": "Color Grade & Sound Design Showcase", "url": _VIDEO_B},
        ],
    },
    {
        "id": "ed-2", "name": "Elena Rostova", "role_title": "Viral TikTok & Shorts Maestro", "tag": "Shorts",
        "rating": "5.0", "speed": "< 12h", "badge": "Viral Expert", "email": "elena@lilizzh.studio",
        "avatar": "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80",
        "bio": "Crafts lightning-fast, high-retention short-form content with motion sound effects, subtitles, and psychological hook cuts that maximize watch time.",
        "portfolio": [{"title": "Viral Shorts Reel 2026", "url": _VIDEO_A}],
    },
    {
        "id": "ed-3", "name": "Devon Sterling", "role_title": "High-Ticket Docu-Series Editor", "tag": "Documentary",
        "rating": "4.95", "speed": "< 24h", "badge": "Cinematic", "email": "devon@lilizzh.studio",
        "avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
        "bio": "Master of emotional story arcs, multi-cam timeline assembly, audio cleanup, and feature-length documentary series editing for high-profile creators.",
        "portfolio": [{"title": "Investigative Series Teaser", "url": _VIDEO_B}],
    },
    {
        "id": "ed-4", "name": "Aria Chen", "role_title": "Commercial & E-Commerce Ads Pro", "tag": "Ads",
        "rating": "4.97", "speed": "< 16h", "badge": "ROAS Focus", "email": "aria@lilizzh.studio",
        "avatar": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80",
        "bio": "Direct-response advertising specialist focusing on scroll-stopping product launches, conversion hooks, and ROAS-optimized variants for Meta and TikTok Ads.",
        "portfolio": [{"title": "E-Commerce Product Launch Reel", "url": _VIDEO_A}],
    },
]

_PASSCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def random_secret(length: int = 14) -> str:
    return "".join(secrets.choice(_PASSCODE_ALPHABET) for _ in range(length))


def seed_rate_card(conn: sqlite3.Connection, path: Optional[Path] = None) -> int:
    path = path or (BASE_DIR / "seed" / "rate_card.json")
    rows = json.loads(path.read_text(encoding="utf-8"))
    with transaction(conn):
        conn.execute("DELETE FROM rate_card")
        for i, row in enumerate(rows):
            conn.execute("INSERT INTO rate_card(id, sort_order, data) VALUES (?,?,?)",
                         (row["id"], i, dumps(row)))
    return len(rows)


def seed_editors(conn: sqlite3.Connection) -> dict:
    """Create missing editor profiles. Returns {editor_id: new_passcode} for newly created ones."""
    created = {}
    with transaction(conn):
        for i, ed in enumerate(EDITORS):
            if conn.execute("SELECT 1 FROM editors WHERE id = ?", (ed["id"],)).fetchone():
                continue
            passcode = random_secret(12)
            conn.execute(
                "INSERT INTO editors(id,name,role_title,tag,rating,speed,avatar,badge,email,bio,"
                "portfolio_json,passcode_hash,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
                (ed["id"], ed["name"], ed["role_title"], ed["tag"], ed["rating"], ed["speed"],
                 ed["avatar"], ed["badge"], ed["email"], ed["bio"], dumps(ed["portfolio"]),
                 hash_password(passcode), i),
            )
            created[ed["id"]] = passcode
    return created


def create_admin(conn: sqlite3.Connection, name: str, email: str, password: str) -> bool:
    email = normalise_email(email)
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        return False
    conn.execute(
        "INSERT INTO users(role,name,email,phone,phone_key,password_hash,created_at) VALUES ('ADMIN',?,?,?,?,?,?)",
        (name, email, "", "", hash_password(password), now_iso()),
    )
    return True


def has_admin(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM users WHERE role = 'ADMIN'").fetchone() is not None


def _add_msg(conn, order_id, sender, text, label, visibility="all"):
    conn.execute(
        "INSERT INTO messages(order_id,sender,text,time_label,visibility,created_at) VALUES (?,?,?,?,?,?)",
        (order_id, sender, text, label, visibility, now_iso()),
    )


def seed_demo(conn: sqlite3.Connection, settings: Settings) -> dict:
    """Two sample clients with sample orders (like the original demo). Returns generated passwords."""
    creds = {}
    clients = [
        ("Alex Rivers", "alex@creator.io", "+91 9876543210"),
        ("Sarah Jenkins", "sarah@creatorhub.io", "+91 9123456789"),
    ]
    ids = {}
    with transaction(conn):
        for name, email, phone in clients:
            row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if row:
                ids[email] = row["id"]
                continue
            password = random_secret(14)
            cur = conn.execute(
                "INSERT INTO users(role,name,email,phone,phone_key,password_hash,created_at) "
                "VALUES ('CLIENT',?,?,?,?,?,?)",
                (name, email, phone, phone_key(phone), hash_password(password), now_iso()),
            )
            ids[email] = cur.lastrowid
            creds[email] = password

        folders = ["Raw Footage", "Audio & Music", "Graphics & B-Roll", "Color LUTs"]
        label, today = clock_label(settings.tz_offset_minutes), date_label(settings.tz_offset_minutes)
        if not conn.execute("SELECT 1 FROM orders WHERE id = 'ORD-8821'").fetchone():
            conn.execute(
                "INSERT INTO orders(id,client_user_id,client_name,client_email,phone,project_type,aspect_ratio,"
                "editor_id,status,price,editor_payout,negotiation_json,order_date,unlocked,payment_json,"
                "draft_url,clean_url,folders_json,created_at,updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)",
                ("ORD-8821", ids["alex@creator.io"], "Alex Rivers", "alex@creator.io", "+91 7020082894",
                 "Long video", "16:9 Landscape", "ed-1", "IN PRODUCTION", 160, 65, None, today,
                 dumps({"utr": "UTR9928374102", "status": "PENDING_APPROVAL",
                        "method": "UPI", "timestamp": today}),
                 _VIDEO_A, _VIDEO_A, dumps(folders), now_iso(), now_iso()),
            )
            _add_msg(conn, "ORD-8821", "system", "Welcome to Lilizzh Studio 6.0 Secure Workspace! Raw files are ready for editing.", label)
            _add_msg(conn, "ORD-8821", "client", "Hey Marcus, please give the A-Roll documentary a gritty cinematic film-grain look!", label)
            _add_msg(conn, "ORD-8821", "editor", "On it Alex! Adding Kodak 2383 LUT emulation and matching primary grades.", label)
        if not conn.execute("SELECT 1 FROM orders WHERE id = 'ORD-9042'").fetchone():
            conn.execute(
                "INSERT INTO orders(id,client_user_id,client_name,client_email,phone,project_type,aspect_ratio,"
                "editor_id,status,price,editor_payout,negotiation_json,order_date,unlocked,payment_json,"
                "draft_url,clean_url,folders_json,created_at,updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,?,?,?,?,?)",
                ("ORD-9042", ids["sarah@creatorhub.io"], "Sarah Jenkins", "sarah@creatorhub.io", "+91 9123456789",
                 "Batch of 10 Short / Reel", "9:16 Vertical", "ed-2", "DRAFT REVIEW READY", 275, 135,
                 dumps({"proposedPrice": 260, "clientNote": "Can we do $260 for this initial 10-video batch test?",
                        "status": "PENDING_ADMIN_REVIEW"}),
                 today, _VIDEO_A, _VIDEO_A, dumps(folders[:3]), now_iso(), now_iso()),
            )
            _add_msg(conn, "ORD-9042", "system", "Project initialized for Elena Rostova workspace.", label)
            _add_msg(conn, "ORD-9042", "editor", "First 3 short-form clips cut and exported for review.", label)
    return creds
