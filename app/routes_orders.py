"""Orders, chat, folders, file vault and payment endpoints (clients, editors and admin)."""
from __future__ import annotations

import mimetypes
import re
import secrets
import sqlite3
import uuid
from pathlib import Path
from urllib.parse import quote, urlencode

from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route

from .qr import make_svg
from .auth import Principal, clean_http_url, endpoint, parse_body
from .db import (clock_label, date_label, dumps, load_rate_card, loads, now_iso, stamp_label,
                 transaction)
from .errors import ApiError
from .schemas import (DraftIn, FolderIn, MessageIn, NegotiationIn, OrderCreateIn, PaymentProofIn)
from .serializers import human_size, inr, num, orders_for, serialize_order

ORDER_ID_RE = re.compile(r"^ORD-\d{4,8}$")
DEFAULT_FOLDERS = ["Raw Footage", "Audio & Music", "Graphics & B-Roll", "Color LUTs"]
MAX_FILES_PER_ORDER = 300
PLACEHOLDER_VIDEO = ("https://assets.mixkit.co/videos/preview/"
                     "mixkit-digital-animation-of-screens-and-code-31969-large.mp4")

# Only these types can be uploaded. Anything executable / scriptable (html, svg, js, exe...) is refused.
ALLOWED_EXT = {
    ".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm", ".mxf", ".mts", ".prores",
    ".wav", ".mp3", ".aac", ".m4a", ".flac", ".aif", ".aiff", ".ogg",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".psd", ".ai", ".eps",
    ".cube", ".3dl", ".lut", ".look", ".drx", ".srt", ".vtt", ".txt", ".pdf", ".zip",
}
INLINE_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mp3", ".wav", ".aac", ".m4a", ".ogg",
              ".png", ".jpg", ".jpeg", ".webp", ".gif"}


# ----------------------------------------------------------------- helpers
def _order_id(request) -> str:
    oid = request.path_params["order_id"]
    if not ORDER_ID_RE.match(oid):
        raise ApiError(404, "Order not found.")
    return oid


def get_order(conn: sqlite3.Connection, principal: Principal, order_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    allowed = row is not None and (
        principal.role == "ADMIN"
        or (principal.role == "CLIENT" and row["client_user_id"] == principal.user_id)
        or (principal.role == "EDITOR" and row["editor_id"] == principal.editor_id)
    )
    if not allowed:
        raise ApiError(404, "Order not found.")  # 404 (not 403) so order IDs can't be probed
    return row


def add_message(conn, settings, order_id, sender, text, visibility="all"):
    conn.execute(
        "INSERT INTO messages(order_id,sender,text,time_label,visibility,created_at) VALUES (?,?,?,?,?,?)",
        (order_id, sender, text, clock_label(settings.tz_offset_minutes), visibility, now_iso()),
    )


def touch(conn, order_id):
    conn.execute("UPDATE orders SET updated_at = ? WHERE id = ?", (now_iso(), order_id))


def order_json(conn, settings, principal, order_id, status=200):
    row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    return JSONResponse({"order": serialize_order(conn, settings, row, principal.role)}, status_code=status)


def _clean_filename(raw: str) -> str:
    name = re.split(r"[\\/]", raw or "")[-1]
    name = re.sub(r"[\x00-\x1f<>:\"|?*]", "", name).strip(" .")
    return name[:120]


# --------------------------------------------------------------- order CRUD
@endpoint("CLIENT", "EDITOR", "ADMIN")
async def list_orders(request, conn, principal):
    settings = request.app.state.settings
    rows = orders_for(conn, principal)
    return JSONResponse({"orders": [serialize_order(conn, settings, r, principal.role) for r in rows]})


@endpoint("CLIENT")
async def create_order(request, conn, principal):
    settings = request.app.state.settings
    if not request.app.state.limiter.allow(f"order:{principal.user_id}", 20, 3600):
        raise ApiError(429, "You are creating orders too quickly. Please try again later.")
    data = await parse_body(request, OrderCreateIn)

    rate = next((r for r in load_rate_card(conn) if r["type"] == data.projectType), None)
    if rate is None:
        raise ApiError(422, "Unknown project type.")
    if data.editorId:
        editor = conn.execute("SELECT * FROM editors WHERE id = ? AND active = 1", (data.editorId,)).fetchone()
        if editor is None:
            raise ApiError(422, "That editor is not available.")
    else:
        editor = conn.execute("SELECT * FROM editors WHERE active = 1 ORDER BY sort_order, id LIMIT 1").fetchone()
        if editor is None:
            raise ApiError(503, "No editors are available right now.")

    price = round(float(data.budgetOffer), 2)
    payout = float(rate["editorPayoutDefault"])
    tz = settings.tz_offset_minutes
    demo_video = PLACEHOLDER_VIDEO  # same stock clip the original page showed until the first draft is published

    with transaction(conn):
        for _ in range(30):
            order_id = f"ORD-{secrets.randbelow(90000) + 10000}"
            if not conn.execute("SELECT 1 FROM orders WHERE id = ?", (order_id,)).fetchone():
                break
        else:
            raise ApiError(500, "Could not allocate an order number. Please try again.")
        conn.execute(
            "INSERT INTO orders(id,client_user_id,client_name,client_email,phone,project_type,aspect_ratio,"
            "editor_id,status,price,editor_payout,negotiation_json,order_date,unlocked,payment_json,"
            "draft_url,clean_url,folders_json,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,0,NULL,?,?,?,?,?)",
            (order_id, principal.user_id, principal.name, principal.email, data.phone, data.projectType,
             data.aspectRatio, editor["id"], "IN PRODUCTION", price, payout, date_label(tz),
             demo_video, demo_video, dumps(DEFAULT_FOLDERS), now_iso(), now_iso()),
        )
        add_message(conn, settings, order_id, "system",
                    f"Project initialized under [{data.projectType}] tier at ${num(price)} USD "
                    f"(₹{inr(settings, price)} INR). Assigned to {editor['name']}.")
        add_message(conn, settings, order_id, "client", f"Project Directives: {data.notes}")
    return order_json(conn, settings, principal, order_id, 201)


@endpoint("CLIENT", "EDITOR", "ADMIN")
async def post_message(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    if not request.app.state.limiter.allow(f"msg:{principal.role}:{principal.user_id or principal.editor_id}", 40, 60):
        raise ApiError(429, "You are sending messages too quickly.")
    data = await parse_body(request, MessageIn)
    # The server decides who is "speaking" – the browser cannot pose as another role.
    if principal.role == "CLIENT":
        sender, text = "client", data.text
    elif principal.role == "EDITOR":
        sender, text = "editor", f"[{principal.name}]: {data.text}"
    else:
        sender, text = "system", f"[Studio Admin - {principal.name}]: {data.text}"
    # A private message is a one-to-one chat between the client and the studio owner: editors never see it.
    if data.private and principal.role == "EDITOR":
        raise ApiError(403, "Editors cannot send private messages.")
    add_message(conn, settings, order["id"], sender, text, "private" if data.private else "all")
    touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"], 201)


@endpoint("CLIENT")
async def post_negotiation(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    if order["unlocked"]:
        raise ApiError(409, "This project is already paid and unlocked.")
    data = await parse_body(request, NegotiationIn)
    price = round(float(data.proposedPrice), 2)
    note = data.note or "Client requested pricing adjustment."
    with transaction(conn):
        conn.execute("UPDATE orders SET negotiation_json = ? WHERE id = ?", (dumps({
            "proposedPrice": num(price), "clientNote": note,
            "requestedAt": clock_label(settings.tz_offset_minutes), "status": "PENDING_ADMIN_REVIEW"}), order["id"]))
        add_message(conn, settings, order["id"], "client",
                    f"[PRICE NEGOTIATION PROPOSAL]: Proposed new budget of ${num(price)} USD "
                    f"(₹{inr(settings, price)} INR). Note: \"{data.note or 'None'}\"", "private")
        add_message(conn, settings, order["id"], "system",
                    f"Price negotiation offer of ${num(price)} dispatched to Studio Admin for review.", "private")
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"])


# ---------------------------------------------------------------- payments
@endpoint("CLIENT")
async def payment_info(request, conn, principal):
    """Bank/UPI details are only given to the signed-in client who owns an unpaid order."""
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    if order["unlocked"]:
        raise ApiError(409, "This project is already paid and unlocked.")
    if not settings.payment_configured:
        raise ApiError(503, "Payment details are not configured yet. Please contact the studio on WhatsApp.")
    return JSONResponse(build_payment_payload(settings, order["id"], order["price"]))


def upi_uri(settings, order_id: str, price_usd: float) -> str:
    return "upi://pay?" + urlencode({
        "pa": settings.pay_upi_id, "pn": settings.pay_account_name,
        "am": f"{inr(settings, price_usd):.2f}", "cu": "INR", "tn": f"Lilizzh {order_id}",
    }, quote_via=quote)


def build_payment_payload(settings, order_id: str, price_usd: float) -> dict:
    """The ONLY payment details a client ever receives: who to pay, how much, and a UPI link / QR code.
    Bank account numbers, IFSC codes and bank names are never sent to the browser."""
    return {
        "amountUSD": num(price_usd), "amountINR": inr(settings, price_usd),
        "accountName": settings.pay_account_name, "upiId": settings.pay_upi_id,
        "upiUri": upi_uri(settings, order_id, price_usd),
        "qrUrl": f"/api/orders/{order_id}/upi-qr.svg",
    }


@endpoint("CLIENT")
async def payment_qr(request, conn, principal):
    """The UPI QR code, drawn here on the server (the UPI ID and amount never go to an outside QR service)."""
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    if order["unlocked"]:
        raise ApiError(409, "This project is already paid and unlocked.")
    if not settings.payment_configured:
        raise ApiError(503, "Payment details are not configured yet.")
    svg = make_svg(upi_uri(settings, order["id"], order["price"]))
    return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@endpoint("CLIENT")
async def post_payment_proof(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    if order["unlocked"]:
        raise ApiError(409, "This project is already paid and unlocked.")
    if not request.app.state.limiter.allow(f"utr:{principal.user_id}", 10, 3600):
        raise ApiError(429, "Too many payment submissions. Please try again later.")
    data = await parse_body(request, PaymentProofIn)
    reused = conn.execute(
        "SELECT id FROM orders WHERE id != ? AND json_extract(payment_json, '$.utr') = ?",
        (order["id"], data.utr)).fetchone()
    if reused:
        raise ApiError(409, "That transaction reference has already been submitted for another order.")
    method = "UPI"
    with transaction(conn):
        conn.execute("UPDATE orders SET payment_json = ?, status = 'AWAITING PAYMENT VERIFICATION' WHERE id = ?",
                     (dumps({"utr": data.utr, "status": "PENDING_APPROVAL", "method": method,
                             "timestamp": stamp_label(settings.tz_offset_minutes)}), order["id"]))
        add_message(conn, settings, order["id"], "client",
                    f"Submitted Payment Reference / UTR: {data.utr}. Awaiting studio verification.", "private")
        add_message(conn, settings, order["id"], "system",
                    f"Payment reference {data.utr} dispatched to the studio admin for verification.", "private")
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"])


# ------------------------------------------------------------------ editor
@endpoint("EDITOR")
async def put_draft(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    data = await parse_body(request, DraftIn)
    url = clean_http_url(data.url)
    with transaction(conn):
        conn.execute("UPDATE orders SET draft_url = ?, status = 'DRAFT REVIEW READY' WHERE id = ?", (url, order["id"]))
        add_message(conn, settings, order["id"], "editor",
                    f"[{principal.name} - Editor]: Uploaded a new draft version for your review.")
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"])


# ----------------------------------------------------------------- folders
@endpoint("CLIENT")
async def create_folder(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    data = await parse_body(request, FolderIn)
    folders = loads(order["folders_json"], ["Raw Footage"])
    if data.name in folders:
        raise ApiError(409, "A folder with this name already exists.")
    if len(folders) >= 40:
        raise ApiError(422, "You have reached the folder limit for this project.")
    conn.execute("UPDATE orders SET folders_json = ? WHERE id = ?", (dumps(folders + [data.name]), order["id"]))
    touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"], 201)


@endpoint("CLIENT")
async def delete_folder(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    name = request.query_params.get("name", "")
    if name == "Raw Footage":
        raise ApiError(409, 'The default "Raw Footage" directory cannot be deleted.')
    folders = loads(order["folders_json"], ["Raw Footage"])
    if name not in folders:
        raise ApiError(404, "Folder not found.")
    with transaction(conn):
        conn.execute("UPDATE orders SET folders_json = ? WHERE id = ?",
                     (dumps([f for f in folders if f != name]), order["id"]))
        conn.execute("UPDATE files SET folder = 'Raw Footage' WHERE order_id = ? AND folder = ?", (order["id"], name))
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"])


# ------------------------------------------------------------------- files
@endpoint("CLIENT")
async def upload_file(request, conn, principal):
    """Raw-body upload: POST /api/orders/ORD-1234/files?folder=Raw%20Footage&name=clip.mp4"""
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    folder = request.query_params.get("folder", "Raw Footage")
    if folder not in loads(order["folders_json"], ["Raw Footage"]):
        raise ApiError(422, "That folder does not exist.")
    name = _clean_filename(request.query_params.get("name", ""))
    ext = Path(name).suffix.lower()
    if not name or ext not in ALLOWED_EXT:
        raise ApiError(415, "That file type is not allowed. Upload video, audio, image, LUT, subtitle, PDF or ZIP files.")
    if conn.execute("SELECT COUNT(*) FROM files WHERE order_id = ?", (order["id"],)).fetchone()[0] >= MAX_FILES_PER_ORDER:
        raise ApiError(422, "This project has reached its file limit.")

    limit = settings.max_upload_mb * 1024 * 1024
    stored = uuid.uuid4().hex
    folder_path = settings.upload_dir / order["id"]
    folder_path.mkdir(parents=True, exist_ok=True)
    path = folder_path / stored
    size = 0
    try:
        with open(path, "wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise ApiError(413, f"File is larger than the {settings.max_upload_mb} MB limit.")
                await run_in_threadpool(fh.write, chunk)
        if size == 0:
            raise ApiError(422, "The uploaded file is empty.")
    except BaseException:
        path.unlink(missing_ok=True)
        raise

    file_id = "file-" + uuid.uuid4().hex[:12]
    label = clock_label(settings.tz_offset_minutes)
    with transaction(conn):
        conn.execute(
            "INSERT INTO files(id,order_id,name,size_bytes,folder,time_label,stored_name,created_at) VALUES (?,?,?,?,?,?,?,?)",
            (file_id, order["id"], name, size, folder, label, stored, now_iso()))
        add_message(conn, settings, order["id"], "client",
                    f"Uploaded asset to [{folder}]: {name} ({human_size(size)})")
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"], 201)


def _file_row(conn, order_id, file_id) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM files WHERE id = ? AND order_id = ?", (file_id, order_id)).fetchone()
    if row is None:
        raise ApiError(404, "File not found.")
    return row


@endpoint("CLIENT", "EDITOR", "ADMIN")
async def download_file(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    row = _file_row(conn, order["id"], request.path_params["file_id"])
    path = settings.upload_dir / order["id"] / row["stored_name"]
    if not path.is_file():
        raise ApiError(404, "File not found.")
    ext = Path(row["name"]).suffix.lower()
    inline = request.query_params.get("inline") == "1" and ext in INLINE_EXT
    media_type = mimetypes.guess_type(row["name"])[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=row["name"],
                        content_disposition_type="inline" if inline else "attachment")


@endpoint("CLIENT")
async def delete_file(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    row = _file_row(conn, order["id"], request.path_params["file_id"])
    with transaction(conn):
        conn.execute("DELETE FROM files WHERE id = ?", (row["id"],))
        touch(conn, order["id"])
    (settings.upload_dir / order["id"] / row["stored_name"]).unlink(missing_ok=True)
    return order_json(conn, settings, principal, order["id"])


routes = [
    Route("/api/orders", list_orders, methods=["GET"]),
    Route("/api/orders", create_order, methods=["POST"]),
    Route("/api/orders/{order_id}/messages", post_message, methods=["POST"]),
    Route("/api/orders/{order_id}/negotiation", post_negotiation, methods=["POST"]),
    Route("/api/orders/{order_id}/payment-info", payment_info, methods=["GET"]),
    Route("/api/orders/{order_id}/upi-qr.svg", payment_qr, methods=["GET"]),
    Route("/api/orders/{order_id}/payment-proof", post_payment_proof, methods=["POST"]),
    Route("/api/orders/{order_id}/draft", put_draft, methods=["PUT"]),
    Route("/api/orders/{order_id}/folders", create_folder, methods=["POST"]),
    Route("/api/orders/{order_id}/folders", delete_folder, methods=["DELETE"]),
    Route("/api/orders/{order_id}/files", upload_file, methods=["POST"]),
    Route("/api/orders/{order_id}/files/{file_id}", download_file, methods=["GET"]),
    Route("/api/orders/{order_id}/files/{file_id}", delete_file, methods=["DELETE"]),
]
