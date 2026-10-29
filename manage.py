#!/usr/bin/env python3
"""Lilizzh Studio admin tool.

    python manage.py init                  first-time setup (secret key, admin login, editor passcodes)
    python manage.py run                   start the website + API on http://127.0.0.1:8000
    python manage.py set-admin-password    change the admin password
    python manage.py set-editor-passcode   change (or randomly reset) one editor's passcode
    python manage.py create-admin          add another studio admin
    python manage.py seed-demo             add the two demo clients/orders from the original design
    python manage.py inquiries             list messages sent through the website's inquiry form
    python manage.py check                 audit your configuration before going live
    python manage.py set-payment           your UPI ID + payee name (clients pay by UPI only)
    python manage.py set-contact           contact e-mail / WhatsApp, shown to signed-in clients only

  Editors (hire / rename / remove):
    python manage.py list-editors
    python manage.py add-editor --name "Jo Lee" --role-title "Podcast Editor" --tag YouTube --email jo@lilizzh.studio
    python manage.py edit-editor ed-5 --name "Joanne Lee" --speed "< 20h"
    python manage.py remove-editor ed-5        (hides them and blocks login; orders are kept)
    python manage.py restore-editor ed-5

  Default package prices (the rate card):
    python manage.py show-rates
    python manage.py set-rate "Long video" --price 180 --payout 70
    python manage.py set-rate rate-short --price-range "30 - 40" --turnaround "< 12h"
    add --file-only to change only seed/rate_card.json (for hosts where you have no shell)

Passwords are typed at a hidden prompt (or piped with --password-stdin) and stored only as scrypt hashes.
Nothing here ever prints a stored password - hashes cannot be turned back into passwords.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import secrets
import sys
from pathlib import Path
from urllib.parse import quote, urlparse

from app import studio
from app.config import BASE_DIR, UPI_RE, Settings, load_dotenv
from app.db import connect, dumps, init_db, load_rate_card, transaction
from app.security import hash_password, normalise_email, password_problem, valid_email
from app.seed import (EDITORS, create_admin, has_admin, random_secret, seed_demo, seed_editors,
                      seed_rate_card)

ENV_PATH = BASE_DIR / ".env"
DEFAULT_ADMIN_NAME = "Lilesh Pravin Patil (Lead Admin)"
DEFAULT_ADMIN_EMAIL = ""   # deliberately empty: pick a login address that is NOT shown on your website

ENV_TEMPLATE = """\
# Lilizzh Studio - private settings. NEVER commit or share this file (it is in .gitignore).
# Written by `python manage.py init`; edit freely.

# "development" for testing on your own computer, "production" once the site is live on HTTPS.
APP_ENV=development
SECRET_KEY={secret}

# What a client sees to pay you (only after they sign in and open the payment window for their own order).
# Clients pay by UPI only. Your bank account number / IFSC are never needed and never shown.
PAY_UPI_ID=
PAY_ACCOUNT_NAME=

# Your personal contact details. Shown ONLY to people who are signed in (visitors use the inquiry form).
# Set PUBLIC_CONTACT=1 if you want them visible to everyone.
CONTACT_EMAIL=
CONTACT_WHATSAPP=
PUBLIC_CONTACT=0

# Set to 1 to show "Editor Payout" and "Studio Profit" columns to everyone in the public rate card
# (this is how the original page looked). Default 0 keeps your margins private.
PUBLIC_RATE_CARD_SHOWS_MARGINS=0

# Production extras (see README):
# COOKIE_SECURE=1        (default in production; needs HTTPS)
# TRUST_PROXY=1          (when running behind nginx / Cloudflare / a hosting platform's proxy)
# ALLOWED_ORIGINS=https://yourdomain.com
# MAX_UPLOAD_MB=1024
# DATA_DIR=/var/lib/lilizzh
"""


# ---------------------------------------------------------------- helpers
def read_env() -> dict:
    values = {}
    if ENV_PATH.is_file():
        for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if raw.strip() and not raw.lstrip().startswith("#") and "=" in raw:
                key, value = raw.split("=", 1)
                values[key.strip()] = value.strip()
    return values


def set_env(key: str, value: str) -> None:
    """Add or replace KEY=value in .env (keeps comments and other lines)."""
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.is_file() else []
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*=")
    for i, line in enumerate(lines):
        if pattern.match(line):
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        os.chmod(ENV_PATH, 0o600)
    except OSError:
        pass


def ensure_env() -> bool:
    """Create .env with a fresh SECRET_KEY if it doesn't exist. Returns True if created."""
    if ENV_PATH.is_file():
        values = read_env()
        if len(values.get("SECRET_KEY", "")) < 32:
            set_env("SECRET_KEY", secrets.token_urlsafe(48))
        return False
    ENV_PATH.write_text(ENV_TEMPLATE.format(secret=secrets.token_urlsafe(48)), encoding="utf-8")
    try:
        os.chmod(ENV_PATH, 0o600)
    except OSError:
        pass
    return True


def open_db() -> tuple:
    load_dotenv(ENV_PATH)
    settings = Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    init_db(settings.db_path)
    return settings, connect(settings.db_path)


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or default


def read_password(args, label: str, minimum: int = 12) -> str:
    """Hidden prompt (twice) or a single line from stdin with --password-stdin."""
    if getattr(args, "password_stdin", False):
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        while True:
            password = getpass.getpass(f"{label}: ")
            if getpass.getpass("Type it again to confirm: ") == password:
                break
            print("  The two entries did not match - try again.")
    if len(password) < minimum:
        sys.exit(f"Error: the password must be at least {minimum} characters long.")
    problem = password_problem(password)
    if problem:
        sys.exit(f"Error: {problem}")
    return password


def revoke_sessions(conn, *, user_id=None, editor_id=None) -> None:
    if user_id is not None:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    if editor_id is not None:
        conn.execute("DELETE FROM sessions WHERE editor_id = ?", (editor_id,))


# --------------------------------------------------------------- commands
def cmd_init(args) -> None:
    created = ensure_env()
    print(("Created" if created else "Using existing"), f"{ENV_PATH.name} (private settings, permissions 600).")
    settings, conn = open_db()
    try:
        if not conn.execute("SELECT 1 FROM rate_card").fetchone():
            print(f"Loaded rate card ({seed_rate_card(conn)} tiers).")

        passcodes = seed_editors(conn)

        if has_admin(conn) and not args.force:
            print("An admin account already exists - leaving it unchanged "
                  "(use `set-admin-password` to change the password).")
        else:
            print("\n--- Admin account ---")
            name = args.admin_name or (DEFAULT_ADMIN_NAME if args.password_stdin else ask("Admin display name", DEFAULT_ADMIN_NAME))
            if not args.admin_email and args.password_stdin:
                sys.exit("Error: pass --admin-email when using --password-stdin.")
            print("Tip: use a login e-mail that is NOT shown on your website, so strangers can't guess it.")
            email = normalise_email(args.admin_email or ask("Admin login e-mail"))
            if not valid_email(email):
                sys.exit("Error: that e-mail address does not look right.")
            password = read_password(args, "Choose an admin password (12+ characters)")
            if not create_admin(conn, name, email, password):
                sys.exit("Error: a user with that e-mail already exists. Use `set-admin-password` instead.")
            print(f"Admin account created for {email}.")

        if not args.password_stdin and not read_env().get("PAY_UPI_ID"):
            print("\n--- How clients pay you (optional - press Enter to skip; change later with `set-payment`) ---")
            while True:
                upi = ask("Your UPI ID (like name@bank)")
                if not upi or UPI_RE.fullmatch(upi):
                    break
                print("  That doesn't look like a UPI ID (expected name@bank).")
            if upi:
                set_env("PAY_UPI_ID", upi)
                set_env("PAY_ACCOUNT_NAME", ask("Name shown to clients when they pay", DEFAULT_ADMIN_NAME.split(" (")[0]))
        if not args.password_stdin and not read_env().get("CONTACT_WHATSAPP"):
            print("\n--- Your contact details for signed-in clients (optional; change later with `set-contact`) ---")
            email_c, wa = ask("Contact e-mail"), ask("WhatsApp number with country code, e.g. +91 98xxxxxx")
            if email_c and valid_email(normalise_email(email_c)):
                set_env("CONTACT_EMAIL", normalise_email(email_c))
            if wa and 10 <= len(re.sub(r"\D", "", wa)) <= 15:
                set_env("CONTACT_WHATSAPP", wa)

        if passcodes:
            print("\n--- Editor passcodes (shown ONCE - give each editor theirs, then clear your screen) ---")
            for ed in EDITORS:
                if ed["id"] in passcodes:
                    print(f"  {ed['name']:<16} ({ed['id']})   {passcodes[ed['id']]}")
            print("Only secure hashes are stored. Forgot one? `python manage.py set-editor-passcode ed-1 --random`")
        print("\nAll set. Start the site with:  python manage.py run")
    finally:
        conn.close()


def cmd_run(args) -> None:
    try:
        import uvicorn
    except ImportError:
        sys.exit("uvicorn is not installed. Run: pip install -r requirements.txt")
    load_dotenv(ENV_PATH)
    settings = Settings.from_env()
    if settings.is_production and args.host == "127.0.0.1":
        print("Production mode: put this behind HTTPS (nginx / Caddy / your host's proxy) and set TRUST_PROXY=1.")
    uvicorn.run("app.main:app_factory", factory=True, host=args.host, port=args.port,
                proxy_headers=settings.trust_proxy, forwarded_allow_ips="*" if settings.trust_proxy else None)


def cmd_set_admin_password(args) -> None:
    ensure_env()
    settings, conn = open_db()
    try:
        email = normalise_email(args.email) if args.email else None
        row = (conn.execute("SELECT * FROM users WHERE role='ADMIN' AND email = ?", (email,)).fetchone() if email
               else conn.execute("SELECT * FROM users WHERE role='ADMIN' ORDER BY id LIMIT 1").fetchone())
        if row is None:
            sys.exit("No such admin. Run `python manage.py init` (or `create-admin`) first.")
        password = read_password(args, f"New password for {row['email']} (12+ characters)")
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), row["id"]))
        revoke_sessions(conn, user_id=row["id"])
        print(f"Password updated for {row['email']}. Existing sign-ins were ended.")
    finally:
        conn.close()


def cmd_create_admin(args) -> None:
    ensure_env()
    settings, conn = open_db()
    try:
        email = normalise_email(args.email)
        if not valid_email(email):
            sys.exit("Error: that e-mail address does not look right.")
        password = read_password(args, f"Password for {email} (12+ characters)")
        if not create_admin(conn, args.name or "Studio Admin", email, password):
            sys.exit("Error: a user with that e-mail already exists.")
        print(f"Admin account created for {email}.")
    finally:
        conn.close()


def cmd_set_editor_passcode(args) -> None:
    ensure_env()
    settings, conn = open_db()
    try:
        row = conn.execute("SELECT id, name FROM editors WHERE id = ?", (args.editor_id,)).fetchone()
        if row is None:
            ids = ", ".join(r["id"] for r in conn.execute("SELECT id FROM editors ORDER BY sort_order"))
            sys.exit(f"Unknown editor '{args.editor_id}'. Choose one of: {ids}")
        if args.random:
            passcode = random_secret(12)
            shown = True
        else:
            passcode = read_password(args, f"New passcode for {row['name']} (10+ characters)", minimum=10)
            shown = False
        conn.execute("UPDATE editors SET passcode_hash = ? WHERE id = ?", (hash_password(passcode), row["id"]))
        revoke_sessions(conn, editor_id=row["id"])
        print(f"Passcode updated for {row['name']}. Existing sign-ins were ended.")
        if shown:
            print(f"New passcode (shown once): {passcode}")
    finally:
        conn.close()


def cmd_seed_demo(args) -> None:
    ensure_env()
    settings, conn = open_db()
    try:
        seed_editors(conn)
        creds = seed_demo(conn, settings)
        if creds:
            print("Demo clients created (random passwords, shown once):")
            for email, password in creds.items():
                print(f"  {email:<26} {password}")
        else:
            print("Demo data already present.")
    finally:
        conn.close()


def cmd_inquiries(args) -> None:
    settings, conn = open_db()
    try:
        rows = conn.execute("SELECT id,name,email,phone,created_at FROM inquiries ORDER BY id DESC LIMIT ?",
                            (args.limit,)).fetchall()
        if not rows:
            print("No inquiries yet.")
        for r in rows:
            print(f"#{r['id']:<4} {r['created_at']}  {r['name']}  <{r['email']}>  {r['phone']}")
    finally:
        conn.close()


LEGACY_BANK_KEYS = ("PAY_ACCOUNT_NUMBER", "PAY_IFSC", "PAY_BANK_NAME")


def drop_env(keys) -> list:
    """Remove KEY=... lines from .env. Returns the keys that were actually present."""
    if not ENV_PATH.is_file():
        return []
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    gone = [k for k in keys if any(re.match(rf"^\s*{re.escape(k)}\s*=", ln) for ln in lines)]
    if gone:
        kept = [ln for ln in lines if not any(re.match(rf"^\s*{re.escape(k)}\s*=", ln) for k in gone)]
        ENV_PATH.write_text("\n".join(kept) + "\n", encoding="utf-8")
    return gone


def cmd_set_payment(args) -> None:
    """Change what clients see to pay you: your name + UPI ID (saved in .env). Restart the site afterwards."""
    fields = {"PAY_UPI_ID": args.upi, "PAY_ACCOUNT_NAME": args.account_name}
    fields = {k: v for k, v in fields.items() if v is not None}
    env = read_env()
    if not fields:
        print("Current payment settings (from .env):")
        for key in ("PAY_UPI_ID", "PAY_ACCOUNT_NAME"):
            print(f"  {key:<18} {env.get(key) or '(empty)'}")
        load_dotenv(ENV_PATH)
        for gap in Settings.from_env().payment_problems:
            print("  FIX:", gap)
        stale = [k for k in LEGACY_BANK_KEYS if env.get(k)]
        if stale:
            print(f"  note: {', '.join(stale)} are no longer used. Run `set-payment --forget-bank` to delete them.")
        if args.forget_bank:
            print("Removed from .env:", ", ".join(drop_env(LEGACY_BANK_KEYS)) or "(nothing to remove)")
        return
    if "PAY_UPI_ID" in fields and not UPI_RE.fullmatch(fields["PAY_UPI_ID"].strip()):
        sys.exit("Error: that does not look like a UPI ID (expected name@bank).")
    for key, value in fields.items():
        if _CONTROL.search(value) or not value.strip() or len(value) > 120:
            sys.exit(f"Error: {key} is empty, too long or contains characters that are not allowed.")
        set_env(key, value.strip())
    print("Saved to .env:", ", ".join(fields))
    removed = drop_env(LEGACY_BANK_KEYS) if args.forget_bank else []
    if removed:
        print("Removed old bank fields from .env:", ", ".join(removed))
    load_dotenv(ENV_PATH)
    merged = {k: read_env().get(k, "") for k in ("PAY_UPI_ID", "PAY_ACCOUNT_NAME")}
    gaps = Settings.from_env({"APP_ENV": "development", **merged}).payment_problems
    for gap in gaps:
        print("  FIX:", gap)
    print("Restart the site (stop it, then `python manage.py run`) for clients to see the change." if not gaps else
          "Fix the items above, then restart the site.")


def cmd_set_contact(args) -> None:
    """Your personal e-mail / WhatsApp. They are shown only to signed-in clients (or to all with PUBLIC_CONTACT=1)."""
    env = read_env()
    if args.email is None and args.whatsapp is None:
        print("Current contact settings (from .env):")
        for key in ("CONTACT_EMAIL", "CONTACT_WHATSAPP", "PUBLIC_CONTACT"):
            print(f"  {key:<18} {env.get(key) or '(empty)'}")
        print("Shown to signed-in people only, unless PUBLIC_CONTACT=1.")
        return
    if args.email is not None:
        email = normalise_email(args.email)
        if not valid_email(email):
            sys.exit("Error: that e-mail address does not look right.")
        set_env("CONTACT_EMAIL", email)
    if args.whatsapp is not None:
        digits = re.sub(r"\D", "", args.whatsapp)
        if _CONTROL.search(args.whatsapp) or not 10 <= len(digits) <= 15:
            sys.exit("Error: WhatsApp number must include the country code, e.g. +91 98xxxxxxxx.")
        set_env("CONTACT_WHATSAPP", args.whatsapp.strip())
    print("Saved to .env. Restart the site for the change to show.")


def cmd_check(args) -> None:
    load_dotenv(ENV_PATH)
    problems, notes = [], []
    env = {**os.environ}
    settings = None
    try:
        settings = Settings.from_env(env)
    except RuntimeError as exc:
        problems.append(str(exc))
    if settings:
        if not settings.is_production:
            problems.append("APP_ENV is not 'production'. Set APP_ENV=production before going live.")
        if not settings.cookie_secure:
            problems.append("COOKIE_SECURE is off. Serve the site over HTTPS and set COOKIE_SECURE=1.")
        if len(env.get("SECRET_KEY", "")) < 32:
            problems.append("SECRET_KEY is missing or too short. Run `python manage.py init`.")
        for gap in settings.payment_problems:
            problems.append(gap + "  Fix with: python manage.py set-payment --help")
        stale = [k for k in LEGACY_BANK_KEYS if read_env().get(k)]
        if stale:
            notes.append(f"{', '.join(stale)} in .env are no longer used (bank details are never shown). "
                         "Delete them with: python manage.py set-payment --forget-bank")
        if not (settings.contact_email or settings.contact_whatsapp):
            notes.append("No contact details set: signed-in clients see no way to reach you. Run `python manage.py set-contact`.")
        if settings.public_contact:
            notes.append("PUBLIC_CONTACT=1: your e-mail and WhatsApp are visible to every visitor.")
        if settings.public_margins:
            notes.append("PUBLIC_RATE_CARD_SHOWS_MARGINS=1: editor payouts and studio profit are visible to everyone.")
        if settings.db_path.is_file():
            conn = connect(settings.db_path)
            try:
                if not has_admin(conn):
                    problems.append("No admin account. Run `python manage.py init`.")
                if conn.execute("SELECT COUNT(*) FROM editors WHERE passcode_hash IS NULL OR passcode_hash=''").fetchone()[0]:
                    problems.append("Some editors have no passcode. Run `python manage.py set-editor-passcode <id> --random`.")
            finally:
                conn.close()
        else:
            problems.append("No database yet. Run `python manage.py init`.")
        if not settings.trust_proxy:
            notes.append("TRUST_PROXY is off. If a proxy (nginx, Cloudflare...) sits in front, set TRUST_PROXY=1 "
                         "so login lockouts use real visitor addresses.")
    if ENV_PATH.is_file() and (ENV_PATH.stat().st_mode & 0o077):
        problems.append(".env is readable by other users on this machine. Run: chmod 600 .env")
    for note in notes:
        print("note:  ", note)
    for problem in problems:
        print("FIX:   ", problem)
    if not problems:
        print("OK - configuration looks production-ready.")
    sys.exit(1 if problems else 0)


# ------------------------------------------------- editors: hire / rename / remove
# The rules live in app/studio.py (shared with the Admin dashboard); these are thin command wrappers.
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
RATE_PATH = BASE_DIR / "seed" / "rate_card.json"


def _studio(fn, *args, **kwargs):
    """Run a studio function; turn its plain-language errors into a clean command-line error."""
    try:
        return fn(*args, **kwargs)
    except studio.StudioError as exc:
        sys.exit(f"Error: {exc}")


def cmd_list_editors(args) -> None:
    settings, conn = open_db()
    try:
        rows = studio.list_editors_admin(conn)
        for e in rows:
            state = "active " if e["active"] else "REMOVED"
            print(f"{e['id']:<6} {state} {e['name']:<20} {e['roleTitle']:<34} [{e['tag']}]  "
                  f"{e['email']}  open orders: {e['openOrders']}")
        if not rows:
            print("No editors yet. Run `python manage.py init`.")
    finally:
        conn.close()


def _editor_args(args) -> dict:
    data = {k: getattr(args, k, None) for k in
            ("name", "role_title", "tag", "email", "bio", "rating", "speed", "badge", "avatar")}
    data = {k: v for k, v in data.items() if v is not None}
    if getattr(args, "portfolio", None):
        data["portfolio"] = args.portfolio
    return data


def cmd_add_editor(args) -> None:
    settings, conn = open_db()
    try:
        with transaction(conn):
            editor_id, passcode = _studio(studio.create_editor, conn, _editor_args(args))
        row = studio.editor_row(conn, editor_id)
        print(f"Added {row['name']} as {editor_id}. They now appear on the website.")
        print(f"Passcode (shown once - give it to {row['name']}): {passcode}")
        note = studio.tag_note(row["tag"])
        if note:
            print("Note:", note)
    finally:
        conn.close()


def cmd_edit_editor(args) -> None:
    data = _editor_args(args)
    settings, conn = open_db()
    try:
        with transaction(conn):
            row, changed = _studio(studio.update_editor, conn, args.editor_id, data)
        fresh = studio.editor_row(conn, row["id"])
        print(f"Updated {row['id']} ({fresh['name']}): {', '.join(changed)}.")
        if "name" in changed:
            print("The new name shows everywhere straight away; old chat messages keep the name they were written with.")
        if "tag" in changed:
            note = studio.tag_note(fresh["tag"])
            if note:
                print("Note:", note)
    finally:
        conn.close()


def cmd_remove_editor(args) -> None:
    settings, conn = open_db()
    try:
        with transaction(conn):
            row, open_ids = _studio(studio.set_editor_active, conn, args.editor_id, False)
        print(f"{row['name']} is hidden from the website and can no longer sign in. Their order history is kept.")
        if open_ids:
            print(f"Heads-up: {len(open_ids)} unfinished order(s) still point to them ({', '.join(open_ids)}). "
                  "Reassign them in the Admin dashboard so someone is working on them.")
        print(f"Undo with:  python manage.py restore-editor {row['id']}")
    finally:
        conn.close()


def cmd_restore_editor(args) -> None:
    settings, conn = open_db()
    try:
        with transaction(conn):
            row, _ = _studio(studio.set_editor_active, conn, args.editor_id, True)
        print(f"{row['name']} is back on the website. Their old passcode still works; "
              f"reset it with `set-editor-passcode {row['id']} --random` if needed.")
    finally:
        conn.close()


# ------------------------------------------------------- rate card (default prices)
def cmd_show_rates(args) -> None:
    settings, conn = open_db()
    try:
        for r in load_rate_card(conn):
            print(f'{r["id"]:<11} {r["type"]:<26} client ${r["clientPriceDefault"]:<5} editor ${r["editorPayoutDefault"]:<5} '
                  f'range {r["clientPriceRangeUSD"]:<14} turnaround {r["typicalTurnaround"]}')
    finally:
        conn.close()


def cmd_set_rate(args) -> None:
    changes = {"price": args.price, "payout": args.payout, "price_range": args.price_range,
               "payout_range": args.payout_range, "turnaround": args.turnaround, "description": args.description}
    if all(v is None for v in changes.values()):
        sys.exit("Nothing to change. Try: set-rate \"Long video\" --price 180 --payout 70  (see --help)")
    if args.file_only:
        load_dotenv(ENV_PATH)
        settings, conn = Settings.from_env(), None
        rows = json.loads(RATE_PATH.read_text(encoding="utf-8"))
    else:
        settings, conn = open_db()
        rows = load_rate_card(conn)
    try:
        row = _studio(studio.find_rate, rows, args.package)
        changed = _studio(studio.apply_rate_changes, row, changes, settings.usd_to_inr)
        if conn is not None:
            studio.save_rate(conn, row)
        studio.write_rate_file(rows, RATE_PATH)
        print(f'Updated "{row["type"]}": {", ".join(changed)}.')
        print("Saved to seed/rate_card.json" + ("" if args.file_only else " and to the live database (no restart needed)") + ".")
        if args.file_only:
            print("The running site picks this up when its database is next created from scratch "
                  "(for example after a redeploy on a free host).")
        else:
            print("Orders already placed keep their agreed price; only new orders use the new defaults.")
    finally:
        if conn is not None:
            conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Lilizzh Studio admin tool")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="first-time setup")
    p.add_argument("--admin-name")
    p.add_argument("--admin-email")
    p.add_argument("--password-stdin", action="store_true", help="read the admin password from stdin (non-interactive)")
    p.add_argument("--force", action="store_true", help="create the admin even if one exists")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("run", help="start the server")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("set-admin-password", help="change an admin password")
    p.add_argument("--email")
    p.add_argument("--password-stdin", action="store_true")
    p.set_defaults(func=cmd_set_admin_password)

    p = sub.add_parser("create-admin", help="add another admin")
    p.add_argument("--email", required=True)
    p.add_argument("--name")
    p.add_argument("--password-stdin", action="store_true")
    p.set_defaults(func=cmd_create_admin)

    p = sub.add_parser("set-editor-passcode", help="change or reset an editor's passcode")
    p.add_argument("editor_id", help="ed-1, ed-2, ed-3 or ed-4")
    p.add_argument("--random", action="store_true", help="generate a random passcode and print it once")
    p.add_argument("--password-stdin", action="store_true")
    p.set_defaults(func=cmd_set_editor_passcode)

    p = sub.add_parser("seed-demo", help="add demo clients and orders")
    p.set_defaults(func=cmd_seed_demo)

    p = sub.add_parser("inquiries", help="list messages sent through the website's inquiry form")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_inquiries)

    p = sub.add_parser("check", help="audit configuration")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("set-payment", help="set / view how clients pay you (your name + UPI ID)")
    p.add_argument("--upi", help="your UPI ID, e.g. name@bank")
    p.add_argument("--account-name", help="the name clients see when paying")
    p.add_argument("--forget-bank", action="store_true",
                   help="delete old PAY_ACCOUNT_NUMBER / PAY_IFSC / PAY_BANK_NAME lines from .env (no longer used)")
    p.set_defaults(func=cmd_set_payment)

    p = sub.add_parser("set-contact", help="set / view your contact e-mail and WhatsApp (shown to signed-in clients)")
    p.add_argument("--email")
    p.add_argument("--whatsapp", help='with country code, e.g. "+91 98xxxxxxxx"')
    p.set_defaults(func=cmd_set_contact)

    p = sub.add_parser("list-editors", help="show all editors")
    p.set_defaults(func=cmd_list_editors)

    p = sub.add_parser("add-editor", help="hire a new editor (shows on the website immediately)")
    p.add_argument("--name", required=True)
    p.add_argument("--role-title", required=True, help='e.g. "Podcast Editor"')
    p.add_argument("--tag", required=True, help="YouTube, Shorts, Documentary or Ads (matches the filter buttons)")
    p.add_argument("--email", required=True)
    p.add_argument("--bio")
    p.add_argument("--rating", help="shown on the editor card (default: New)")
    p.add_argument("--speed", help="typical turnaround shown on the card (default: < 24h)")
    p.add_argument("--badge")
    p.add_argument("--avatar", help="link to a profile photo (default: a letter placeholder)")
    p.add_argument("--portfolio", action="append", metavar='"TITLE|URL"', help="repeat for several videos")
    p.set_defaults(func=cmd_add_editor)

    p = sub.add_parser("edit-editor", help="change an editor's name, title, tag, bio, photo...")
    p.add_argument("editor_id", help="e.g. ed-1 (see list-editors)")
    p.add_argument("--name")
    p.add_argument("--role-title", dest="role_title")
    p.add_argument("--tag")
    p.add_argument("--email")
    p.add_argument("--bio")
    p.add_argument("--rating")
    p.add_argument("--speed")
    p.add_argument("--badge")
    p.add_argument("--avatar")
    p.add_argument("--portfolio", action="append", metavar='"TITLE|URL"',
                   help="replaces the whole portfolio; repeat for several videos")
    p.set_defaults(func=cmd_edit_editor)

    p = sub.add_parser("remove-editor", help="hide an editor and block their login (history is kept)")
    p.add_argument("editor_id")
    p.set_defaults(func=cmd_remove_editor)

    p = sub.add_parser("restore-editor", help="bring a removed editor back")
    p.add_argument("editor_id")
    p.set_defaults(func=cmd_restore_editor)

    p = sub.add_parser("show-rates", help="show the default package prices")
    p.set_defaults(func=cmd_show_rates)

    p = sub.add_parser("set-rate", help="change a package's default price / payout / ranges / turnaround")
    p.add_argument("package", help='package id or name, e.g. rate-long or "Long video"')
    p.add_argument("--price", type=float, help="default client price in USD")
    p.add_argument("--payout", type=float, help="default editor payout in USD")
    p.add_argument("--price-range", help='shown range for clients, e.g. "120 - 200"')
    p.add_argument("--payout-range", help='shown range for editor payout, e.g. "50 - 80"')
    p.add_argument("--turnaround", help='e.g. "< 36h"')
    p.add_argument("--description")
    p.add_argument("--file-only", action="store_true",
                   help="only edit seed/rate_card.json (use when you can't run commands on the live server)")
    p.set_defaults(func=cmd_set_rate)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
