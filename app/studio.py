"""Editor roster and rate-card management.

One implementation shared by the `manage.py` commands and the Admin dashboard, so both follow the same
rules. Everything here raises `StudioError` (a plain, human-readable message) when something is wrong.
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import quote, urlparse

from .db import dumps, load_rate_card, loads
from .security import hash_password, normalise_email, valid_email
from .seed import random_secret

KNOWN_TAGS = ("YouTube", "Shorts", "Documentary", "Ads")   # the filter buttons on the website
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class StudioError(ValueError):
    """A problem the person using the tool / dashboard can fix. The message is safe to show."""


# ------------------------------------------------------------------ validation
def clean_text(label: str, value, maxlen: int) -> str:
    value = ("" if value is None else str(value)).strip()
    if not value or len(value) > maxlen or _CONTROL.search(value):
        raise StudioError(f"{label} must be 1-{maxlen} characters with no line breaks.")
    return value


def clean_url(label: str, value) -> str:
    value = ("" if value is None else str(value)).strip()
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or len(value) > 2048 or re.search(r"\s", value):
        raise StudioError(f"{label} must be a full http(s) link.")
    return value


def placeholder_avatar(name: str) -> str:
    letter = (name.strip()[:1] or "?").upper()
    letter = letter.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    svg = ("<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'>"
           "<rect width='150' height='150' fill='#1e293b'/>"
           f"<text x='50%' y='54%' font-size='64' font-family='Arial' fill='#94a3b8' "
           f"text-anchor='middle' dominant-baseline='middle'>{letter}</text></svg>")
    return "data:image/svg+xml;utf8," + quote(svg)


def parse_portfolio(items: Optional[Iterable]) -> list:
    """Accepts [{'title','url'}, ...] (dashboard) or ['Title|https://...', ...] (command line)."""
    out = []
    for item in items or []:
        if isinstance(item, str):
            title, sep, url = item.partition("|")
            if not sep:
                raise StudioError('Portfolio entries must look like "Video title|https://link-to-video.mp4".')
        else:
            title, url = item.get("title"), item.get("url")
        out.append({"title": clean_text("Portfolio title", title, 80), "url": clean_url("Portfolio link", url)})
    return out[:12]


def tag_note(tag: str) -> Optional[str]:
    if tag.lower() in {t.lower() for t in KNOWN_TAGS}:
        return None
    return (f"The website's filter buttons are {', '.join(KNOWN_TAGS)}. "
            f"The tag '{tag}' will only show under 'All'.")


# --------------------------------------------------------------------- editors
_TEXT_FIELDS = {  # input key -> (database column, label, max length)
    "name": ("name", "Name", 60), "role_title": ("role_title", "Role title", 60),
    "tag": ("tag", "Tag", 30), "rating": ("rating", "Rating", 10), "speed": ("speed", "Turnaround", 20),
    "badge": ("badge", "Badge", 30), "bio": ("bio", "Bio", 600),
}
_CREATE_DEFAULTS = {"rating": "New", "speed": "< 24h", "badge": "New Editor",
                    "bio": "New member of the Lilizzh Studio editing team."}


def _validated_columns(data: dict, creating: bool) -> dict:
    cols = {}
    for key, (column, label, maxlen) in _TEXT_FIELDS.items():
        value = data.get(key)
        if value is None and creating:
            value = _CREATE_DEFAULTS.get(key)
        if value is not None:
            cols[column] = clean_text(label, value, maxlen)
    if data.get("email") is not None:
        email = normalise_email(str(data["email"]))
        if not valid_email(email):
            raise StudioError("That e-mail address does not look right.")
        cols["email"] = email
    if data.get("avatar"):
        cols["avatar"] = clean_url("Photo link", data["avatar"])
    if data.get("portfolio") is not None:
        cols["portfolio_json"] = dumps(parse_portfolio(data["portfolio"]))
    return cols


def editor_row(conn: sqlite3.Connection, editor_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM editors WHERE id = ?", (editor_id,)).fetchone()
    if row is None:
        ids = ", ".join(r["id"] for r in conn.execute("SELECT id FROM editors ORDER BY sort_order, id"))
        raise StudioError(f"Unknown editor '{editor_id}'. Choose one of: {ids}")
    return row


def revoke_editor_sessions(conn: sqlite3.Connection, editor_id: str) -> None:
    conn.execute("DELETE FROM sessions WHERE editor_id = ?", (editor_id,))


def _next_editor_id(conn: sqlite3.Connection) -> str:
    nums = [int(m.group(1)) for r in conn.execute("SELECT id FROM editors")
            if (m := re.fullmatch(r"ed-(\d+)", r["id"]))]
    return f"ed-{max(nums, default=0) + 1}"


def create_editor(conn: sqlite3.Connection, data: dict) -> tuple:
    """Hire an editor. Returns (editor_id, one-time passcode)."""
    for key, label in (("name", "Name"), ("role_title", "Role title"), ("tag", "Tag"), ("email", "E-mail")):
        if not (data.get(key) or "").strip():
            raise StudioError(f"{label} is required.")
    cols = _validated_columns(data, creating=True)
    cols.setdefault("avatar", placeholder_avatar(cols["name"]))
    cols.setdefault("portfolio_json", "[]")
    if conn.execute("SELECT 1 FROM editors WHERE lower(email) = ?", (cols["email"],)).fetchone():
        raise StudioError("An editor with that e-mail already exists.")
    editor_id = _next_editor_id(conn)
    order = conn.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM editors").fetchone()[0]
    passcode = random_secret(12)
    cols.update(id=editor_id, passcode_hash=hash_password(passcode), active=1, sort_order=order)
    conn.execute(f"INSERT INTO editors({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", tuple(cols.values()))
    return editor_id, passcode


def update_editor(conn: sqlite3.Connection, editor_id: str, data: dict) -> tuple:
    """Change an editor's profile. Returns (row, list of changed columns)."""
    row = editor_row(conn, editor_id)
    cols = _validated_columns(data, creating=False)
    if not cols:
        raise StudioError("Nothing to change. Give at least one field, e.g. a new name.")
    if "email" in cols and conn.execute(
            "SELECT 1 FROM editors WHERE lower(email) = ? AND id != ?", (cols["email"], row["id"])).fetchone():
        raise StudioError("Another editor already uses that e-mail.")
    conn.execute(f"UPDATE editors SET {', '.join(f'{c} = ?' for c in cols)} WHERE id = ?", (*cols.values(), row["id"]))
    return row, list(cols)


def open_order_ids(conn: sqlite3.Connection, editor_id: str) -> list:
    return [r["id"] for r in conn.execute(
        "SELECT id FROM orders WHERE editor_id = ? AND unlocked = 0 ORDER BY id", (editor_id,))]


def set_editor_active(conn: sqlite3.Connection, editor_id: str, active: bool) -> tuple:
    """Remove (hide + block login) or restore an editor. Returns (row, unfinished order ids)."""
    row = editor_row(conn, editor_id)
    if active:
        if row["active"]:
            raise StudioError(f"{row['name']} is already active.")
        conn.execute("UPDATE editors SET active = 1 WHERE id = ?", (row["id"],))
        return row, []
    if not row["active"]:
        raise StudioError(f"{row['name']} is already removed.")
    if conn.execute("SELECT COUNT(*) FROM editors WHERE active = 1").fetchone()[0] <= 1:
        raise StudioError("You can't remove the last active editor (new orders need someone to be assigned to).")
    conn.execute("UPDATE editors SET active = 0 WHERE id = ?", (row["id"],))
    revoke_editor_sessions(conn, row["id"])
    return row, open_order_ids(conn, row["id"])


def reset_passcode(conn: sqlite3.Connection, editor_id: str) -> tuple:
    """Give an editor a new random passcode (ends their current sign-ins). Returns (row, passcode)."""
    row = editor_row(conn, editor_id)
    passcode = random_secret(12)
    conn.execute("UPDATE editors SET passcode_hash = ? WHERE id = ?", (hash_password(passcode), row["id"]))
    revoke_editor_sessions(conn, row["id"])
    return row, passcode


def admin_editor_view(row: sqlite3.Row, open_orders: int) -> dict:
    """An editor as the studio owner sees it (includes e-mail and active flag; never the passcode hash)."""
    return {
        "id": row["id"], "name": row["name"], "roleTitle": row["role_title"], "tag": row["tag"],
        "rating": row["rating"], "speed": row["speed"], "badge": row["badge"], "avatar": row["avatar"],
        "bio": row["bio"], "email": row["email"], "portfolio": loads(row["portfolio_json"], []),
        "active": bool(row["active"]), "openOrders": open_orders,
    }


def list_editors_admin(conn: sqlite3.Connection) -> list:
    out = []
    for row in conn.execute("SELECT * FROM editors ORDER BY sort_order, id").fetchall():
        out.append(admin_editor_view(row, len(open_order_ids(conn, row["id"]))))
    return out


# ------------------------------------------------------------------- rate card
_RANGE = re.compile(r"\s*\$?\s*(\d+(?:\.\d+)?)\s*[-–]\s*\$?\s*(\d+(?:\.\d+)?)\s*")


def parse_range(label: str, value: str) -> tuple:
    m = _RANGE.fullmatch(value or "")
    if not m or float(m.group(1)) > float(m.group(2)):
        raise StudioError(f'{label} must look like "25 - 35" (low - high, in US dollars).')
    return float(m.group(1)), float(m.group(2))


def _usd(n: float) -> str:
    return f"${n:,.0f}" if float(n).is_integer() else f"${n:,.2f}"


def _inr(n: float, rate: float) -> str:
    return f"₹{int(round(n * rate / 100.0) * 100):,}"


def _as_number(value: float):
    return int(value) if float(value).is_integer() else value


def apply_rate_changes(row: dict, changes: dict, usd_to_inr: float) -> list:
    """Edit one rate-card entry in place. `changes` keys: price, payout, price_range, payout_range,
    turnaround, description (all optional). Returns a list of what changed."""
    changed = []
    price = changes.get("price")
    payout = changes.get("payout")
    new_price = row["clientPriceDefault"] if price is None else price
    new_payout = row["editorPayoutDefault"] if payout is None else payout
    if new_price <= 0 or new_price > 100000 or new_payout < 0 or new_payout > new_price:
        raise StudioError("The price must be above 0 and the editor payout can't be more than the price.")
    if price is not None:
        row["clientPriceDefault"] = _as_number(price)
        changed.append("price")
    if payout is not None:
        row["editorPayoutDefault"] = _as_number(payout)
        changed.append("payout")
    if changes.get("price_range") or changes.get("payout_range"):
        pr = parse_range("Price range", changes["price_range"]) if changes.get("price_range") else parse_range(
            "Stored price range", row["clientPriceRangeUSD"])
        er = parse_range("Payout range", changes["payout_range"]) if changes.get("payout_range") else parse_range(
            "Stored payout range", row["editorPayoutRangeUSD"])
        row["clientPriceRangeUSD"] = f"{_usd(pr[0])} - {_usd(pr[1])}"
        row["clientPriceRangeINR"] = f"{_inr(pr[0], usd_to_inr)} - {_inr(pr[1], usd_to_inr)}"
        row["editorPayoutRangeUSD"] = f"{_usd(er[0])} - {_usd(er[1])}"
        row["editorPayoutRangeINR"] = f"{_inr(er[0], usd_to_inr)} - {_inr(er[1], usd_to_inr)}"
        lo, hi = max(pr[0] - er[0], 0), max(pr[1] - er[1], 0)
        row["profitRangeUSD"] = f"{_usd(lo)} - {_usd(hi)}"
        row["profitRangeINR"] = f"{_inr(lo, usd_to_inr)} - {_inr(hi, usd_to_inr)}"
        changed.append("price/payout ranges (and the ₹ and profit ranges derived from them)")
    if changes.get("turnaround") is not None:
        row["typicalTurnaround"] = clean_text("Turnaround", changes["turnaround"], 30)
        changed.append("turnaround")
    if changes.get("description") is not None:
        row["description"] = clean_text("Description", changes["description"], 300)
        changed.append("description")
    if not changed:
        raise StudioError("Nothing to change.")
    return changed


def find_rate(rows: list, key: str) -> dict:
    key = (key or "").strip().lower()
    for row in rows:
        if key in (row["id"].lower(), row["type"].lower()):
            return row
    names = "; ".join(f'{r["id"]} ("{r["type"]}")' for r in rows)
    raise StudioError(f"Unknown package '{key}'. Choose one of: {names}")


def save_rate(conn: sqlite3.Connection, row: dict) -> None:
    conn.execute("UPDATE rate_card SET data = ? WHERE id = ?", (dumps(row), row["id"]))


def write_rate_file(rows: list, path: Path) -> bool:
    """Keep seed/rate_card.json in step with the database (best effort: a read-only host is fine)."""
    try:
        path.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return True
    except OSError:
        return False
