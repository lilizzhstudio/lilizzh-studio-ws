"""Turns database rows into the JSON shape the front-end already expects.

This is where "who may see what" is decided:
  * the clean 4K master URL is only sent to the admin, or to the paying client once unlocked
  * editors never see payment proofs, price negotiations or the editor-payout figures
  * clients never see editor payouts or studio margins
"""
from __future__ import annotations

import sqlite3

from .auth import Principal
from .config import Settings
from .db import load_rate_card, loads

PUBLIC_RATE_KEYS = ("id", "type", "description", "clientPriceDefault",
                    "clientPriceRangeUSD", "clientPriceRangeINR", "typicalTurnaround")


def num(value: float):
    return int(value) if float(value).is_integer() else round(float(value), 2)


def inr(settings: Settings, usd: float) -> int:
    return int(round(float(usd) * settings.usd_to_inr))


def human_size(size_bytes: int) -> str:
    return f"{size_bytes / (1024 * 1024):.2f} MB"


def serialize_editor(row: sqlite3.Row) -> dict:
    """Public editor profile – never includes e-mail, passcode hash or internal flags."""
    return {
        "id": row["id"], "name": row["name"], "role": row["role_title"], "tag": row["tag"],
        "rating": row["rating"], "speed": row["speed"], "avatar": row["avatar"], "badge": row["badge"],
        "bio": row["bio"], "portfolioVideos": loads(row["portfolio_json"], []),
    }


def serialize_rate_card(conn: sqlite3.Connection, include_margins: bool) -> list:
    rows = load_rate_card(conn)
    if include_margins:
        return rows
    return [{k: r[k] for k in PUBLIC_RATE_KEYS if k in r} for r in rows]


def serialize_order(conn: sqlite3.Connection, settings: Settings, row: sqlite3.Row, role: str) -> dict:
    messages = conn.execute(
        "SELECT sender, text, time_label, visibility FROM messages WHERE order_id = ? ORDER BY id",
        (row["id"],),
    ).fetchall()
    if role == "EDITOR":
        messages = [m for m in messages if m["visibility"] == "all"]
    files = conn.execute(
        "SELECT id, name, size_bytes, folder, time_label FROM files WHERE order_id = ? ORDER BY created_at, id",
        (row["id"],),
    ).fetchall()
    editor = conn.execute("SELECT name FROM editors WHERE id = ?", (row["editor_id"],)).fetchone()
    unlocked = bool(row["unlocked"])

    order = {
        "id": row["id"],
        "clientName": row["client_name"],
        "clientEmail": row["client_email"],
        "phone": row["phone"],
        "projectType": row["project_type"],
        "aspectRatio": row["aspect_ratio"],
        "editor": editor["name"] if editor else "Unassigned",
        "editorId": row["editor_id"],
        "status": row["status"],
        "price": num(row["price"]),
        "date": row["order_date"],
        "unlocked": unlocked,
        "draftUrl": row["draft_url"],
        "chatMessages": [{"sender": m["sender"], "text": m["text"], "time": m["time_label"],
                          "private": m["visibility"] == "private"} for m in messages],
        "uploadedFiles": [
            {"id": f["id"], "name": f["name"], "size": human_size(f["size_bytes"]), "folder": f["folder"],
             "date": f["time_label"], "url": f"/api/orders/{row['id']}/files/{f['id']}"}
            for f in files
        ],
        "folders": loads(row["folders_json"], ["Raw Footage"]),
    }
    if role in ("ADMIN", "CLIENT"):
        order["negotiation"] = loads(row["negotiation_json"])
        order["paymentProof"] = loads(row["payment_json"])
    else:
        order["negotiation"] = None
        order["paymentProof"] = None
    if role == "ADMIN":
        order["editorPayout"] = num(row["editor_payout"])
        order["cleanUrl"] = row["clean_url"]
    elif role == "CLIENT" and unlocked:
        order["cleanUrl"] = row["clean_url"]
    return order


def orders_for(conn: sqlite3.Connection, principal: Principal) -> list:
    if principal.role == "ADMIN":
        return conn.execute("SELECT * FROM orders ORDER BY created_at DESC, id DESC").fetchall()
    if principal.role == "CLIENT":
        return conn.execute("SELECT * FROM orders WHERE client_user_id = ? ORDER BY created_at DESC, id DESC",
                            (principal.user_id,)).fetchall()
    return conn.execute("SELECT * FROM orders WHERE editor_id = ? ORDER BY created_at DESC, id DESC",
                        (principal.editor_id,)).fetchall()
