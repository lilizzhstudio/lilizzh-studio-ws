"""Studio-admin only: unlock masters, set prices, answer negotiations, reassign editors, publish links."""
from __future__ import annotations

import re

from starlette.responses import JSONResponse
from starlette.routing import Route

from . import studio
from .auth import clean_http_url, endpoint, parse_body
from .config import BASE_DIR
from .db import dumps, load_rate_card, loads, transaction
from .errors import ApiError
from .routes_orders import _order_id, add_message, get_order, order_json, touch
from .schemas import (DecisionIn, EditorCreateIn, EditorUpdateIn, LinksIn, PricingIn, RateUpdateIn,
                      ReassignIn, UnlockIn)
from .serializers import inr, num

RATE_FILE = BASE_DIR / "seed" / "rate_card.json"
_EDITOR_ID = re.compile(r"^ed-\d{1,6}$")


@endpoint("ADMIN")
async def unlock(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    data = await parse_body(request, UnlockIn)
    with transaction(conn):
        conn.execute("UPDATE orders SET unlocked = ?, status = ? WHERE id = ?", (
            1 if data.unlocked else 0,
            "COMPLETED & UNLOCKED" if data.unlocked else "IN PRODUCTION", order["id"]))
        if data.unlocked and order["payment_json"]:
            proof = loads(order["payment_json"], {})
            proof["status"] = "APPROVED"
            conn.execute("UPDATE orders SET payment_json = ? WHERE id = ?", (dumps(proof), order["id"]))
        add_message(conn, settings, order["id"], "system",
                    "Studio Staff verified payment reference! Watermark removed and 4K clean master unlocked."
                    if data.unlocked else "Project master reset to draft preview mode by staff.")
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"])


@endpoint("ADMIN")
async def set_pricing(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    data = await parse_body(request, PricingIn)
    price, payout = round(data.price, 2), round(data.editorPayout, 2)
    negotiation = loads(order["negotiation_json"])
    if negotiation:
        negotiation["status"] = "ADMIN_APPROVED"
    with transaction(conn):
        conn.execute("UPDATE orders SET price = ?, editor_payout = ?, negotiation_json = ? WHERE id = ?",
                     (price, payout, dumps(negotiation) if negotiation else None, order["id"]))
        add_message(conn, settings, order["id"], "system",
                    f"Studio Admin updated pricing: Final Client Fee set to ${num(price)} USD "
                    f"(₹{inr(settings, price)} INR). Editor Payout set to ${num(payout)} USD.", "private")
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"])


@endpoint("ADMIN")
async def decide_negotiation(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    data = await parse_body(request, DecisionIn)
    negotiation = loads(order["negotiation_json"])
    if not negotiation or negotiation.get("status") != "PENDING_ADMIN_REVIEW":
        raise ApiError(409, "There is no pending price offer on this order.")
    with transaction(conn):
        if data.decision == "accept":
            price = float(negotiation["proposedPrice"])
            rate = next((r for r in load_rate_card(conn) if r["type"] == order["project_type"]), None)
            payout = float(rate["editorPayoutDefault"]) if rate else round(price * 0.45, 2)
            negotiation["status"] = "ACCEPTED_BY_ADMIN"
            conn.execute("UPDATE orders SET price = ?, editor_payout = ?, negotiation_json = ? WHERE id = ?",
                         (price, payout, dumps(negotiation), order["id"]))
            add_message(conn, settings, order["id"], "system",
                        f"Studio Admin ACCEPTED your price negotiation offer! Price adjusted to "
                        f"${num(price)} USD (₹{inr(settings, price)} INR).", "private")
        else:
            negotiation["status"] = "DECLINED_BY_ADMIN"
            conn.execute("UPDATE orders SET negotiation_json = ? WHERE id = ?", (dumps(negotiation), order["id"]))
            add_message(conn, settings, order["id"], "system",
                        f"Studio Admin reviewed your price counter-offer. The standard rate of "
                        f"${num(order['price'])} USD remains active. You can discuss details in project chat.", "private")
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"])


@endpoint("ADMIN")
async def reassign(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    data = await parse_body(request, ReassignIn)
    editor = conn.execute("SELECT * FROM editors WHERE id = ? AND active = 1", (data.editorId,)).fetchone()
    if editor is None:
        raise ApiError(422, "That editor is not available.")
    with transaction(conn):
        conn.execute("UPDATE orders SET editor_id = ? WHERE id = ?", (editor["id"], order["id"]))
        add_message(conn, settings, order["id"], "system",
                    f"Project reassigned by Studio Admin to editor: {editor['name']}")
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"])


@endpoint("ADMIN")
async def set_links(request, conn, principal):
    settings = request.app.state.settings
    order = get_order(conn, principal, _order_id(request))
    data = await parse_body(request, LinksIn)
    draft = clean_http_url(data.draftUrl) if data.draftUrl else order["draft_url"]
    clean = clean_http_url(data.cleanUrl) if data.cleanUrl else order["clean_url"]
    with transaction(conn):
        conn.execute("UPDATE orders SET draft_url = ?, clean_url = ? WHERE id = ?", (draft, clean, order["id"]))
        add_message(conn, settings, order["id"], "system", "New 4K Video Render exports published by studio staff.")
        touch(conn, order["id"])
    return order_json(conn, settings, principal, order["id"])


@endpoint("ADMIN")
async def list_inquiries(request, conn, principal):
    rows = conn.execute("SELECT id,name,email,phone,created_at FROM inquiries ORDER BY id DESC LIMIT 500").fetchall()
    return JSONResponse({"inquiries": [dict(r) for r in rows]})


# ------------------------------------------------------- editors (hire / rename / remove)
def _editor_id(request) -> str:
    eid = request.path_params["editor_id"]
    if not _EDITOR_ID.match(eid):
        raise ApiError(404, "Editor not found.")
    return eid


def _payload(model) -> dict:
    """Pydantic model -> plain dict using the studio service's field names (only fields that were sent)."""
    data = model.model_dump(exclude_unset=True)
    if "roleTitle" in data:
        data["role_title"] = data.pop("roleTitle")
    return data


def _studio_call(fn, *args):
    try:
        return fn(*args)
    except studio.StudioError as exc:
        raise ApiError(422, str(exc))


@endpoint("ADMIN")
async def editors_list(request, conn, principal):
    return JSONResponse({"editors": studio.list_editors_admin(conn)})


@endpoint("ADMIN")
async def editor_create(request, conn, principal):
    data = await parse_body(request, EditorCreateIn)
    with transaction(conn):
        editor_id, passcode = _studio_call(studio.create_editor, conn, _payload(data))
    row = studio.editor_row(conn, editor_id)
    return JSONResponse({"editor": studio.admin_editor_view(row, 0), "passcode": passcode,
                         "note": studio.tag_note(row["tag"])}, status_code=201)


@endpoint("ADMIN")
async def editor_update(request, conn, principal):
    eid = _editor_id(request)
    data = await parse_body(request, EditorUpdateIn)
    with transaction(conn):
        _studio_call(studio.update_editor, conn, eid, _payload(data))
    row = studio.editor_row(conn, eid)
    return JSONResponse({"editor": studio.admin_editor_view(row, len(studio.open_order_ids(conn, eid))),
                         "note": studio.tag_note(row["tag"])})


@endpoint("ADMIN")
async def editor_remove(request, conn, principal):
    eid = _editor_id(request)
    with transaction(conn):
        _, open_ids = _studio_call(studio.set_editor_active, conn, eid, False)
    row = studio.editor_row(conn, eid)
    return JSONResponse({"editor": studio.admin_editor_view(row, len(open_ids)), "openOrders": open_ids})


@endpoint("ADMIN")
async def editor_restore(request, conn, principal):
    eid = _editor_id(request)
    with transaction(conn):
        _studio_call(studio.set_editor_active, conn, eid, True)
    row = studio.editor_row(conn, eid)
    return JSONResponse({"editor": studio.admin_editor_view(row, len(studio.open_order_ids(conn, eid)))})


@endpoint("ADMIN")
async def editor_passcode(request, conn, principal):
    eid = _editor_id(request)
    with transaction(conn):
        row, passcode = _studio_call(studio.reset_passcode, conn, eid)
    return JSONResponse({"editor": studio.admin_editor_view(row, len(studio.open_order_ids(conn, eid))),
                         "passcode": passcode})


# ------------------------------------------------------------- default prices (rate card)
@endpoint("ADMIN")
async def rate_update(request, conn, principal):
    settings = request.app.state.settings
    data = await parse_body(request, RateUpdateIn)
    sent = data.model_dump(exclude_unset=True)
    changes = {"price": sent.get("price"), "payout": sent.get("payout"), "price_range": sent.get("priceRange"),
               "payout_range": sent.get("payoutRange"), "turnaround": sent.get("turnaround"),
               "description": sent.get("description")}
    with transaction(conn):
        rows = load_rate_card(conn)
        row = _studio_call(studio.find_rate, rows, request.path_params["rate_id"])
        _studio_call(studio.apply_rate_changes, row, changes, settings.usd_to_inr)
        studio.save_rate(conn, row)
    studio.write_rate_file(rows, RATE_FILE)
    return JSONResponse({"rateCard": rows})


routes = [
    Route("/api/admin/editors", editors_list, methods=["GET"]),
    Route("/api/admin/editors", editor_create, methods=["POST"]),
    Route("/api/admin/editors/{editor_id}", editor_update, methods=["PUT"]),
    Route("/api/admin/editors/{editor_id}/remove", editor_remove, methods=["POST"]),
    Route("/api/admin/editors/{editor_id}/restore", editor_restore, methods=["POST"]),
    Route("/api/admin/editors/{editor_id}/passcode", editor_passcode, methods=["POST"]),
    Route("/api/admin/rates/{rate_id}", rate_update, methods=["PUT"]),
    Route("/api/admin/orders/{order_id}/unlock", unlock, methods=["POST"]),
    Route("/api/admin/orders/{order_id}/pricing", set_pricing, methods=["POST"]),
    Route("/api/admin/orders/{order_id}/negotiation", decide_negotiation, methods=["POST"]),
    Route("/api/admin/orders/{order_id}/reassign", reassign, methods=["POST"]),
    Route("/api/admin/orders/{order_id}/links", set_links, methods=["PUT"]),
    Route("/api/admin/inquiries", list_inquiries, methods=["GET"]),
]
