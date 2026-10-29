"""Endpoints anyone can call: site config, the public editor roster and the inquiry form."""
from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.routing import Route

from .auth import client_ip, endpoint, parse_body
from .db import now_iso
from .errors import ApiError
from .schemas import InquiryIn
from .serializers import serialize_editor, serialize_rate_card


@endpoint(public=True)
async def health(request, conn, principal):
    return JSONResponse({"status": "ok"})


@endpoint(public=True)
async def config(request, conn, principal):
    settings = request.app.state.settings
    # Margins / editor payouts are only sent to the admin (or everyone, if you opt in via .env).
    show = settings.public_margins or (principal is not None and principal.role == "ADMIN")
    # The owner's personal e-mail / WhatsApp are only sent to people who are signed in
    # (unless PUBLIC_CONTACT=1). Anonymous visitors use the inquiry form instead.
    contact = None
    if (principal is not None or settings.public_contact) and (settings.contact_email or settings.contact_whatsapp):
        contact = {"email": settings.contact_email, "whatsapp": settings.contact_whatsapp_digits,
                   "whatsappDisplay": settings.contact_whatsapp}
    return JSONResponse({
        "usdToInr": settings.usd_to_inr,
        "rateCard": serialize_rate_card(conn, include_margins=show),
        "contact": contact,
    })


@endpoint(public=True)
async def editors(request, conn, principal):
    rows = conn.execute("SELECT * FROM editors WHERE active = 1 ORDER BY sort_order, id").fetchall()
    return JSONResponse({"editors": [serialize_editor(r) for r in rows]})


@endpoint(public=True)
async def inquiry(request, conn, principal):
    settings = request.app.state.settings
    ip = client_ip(request, settings)
    if not request.app.state.limiter.allow(f"inquiry:{ip}", 5, 3600):
        raise ApiError(429, "Too many inquiries from this connection. Please try again later.")
    data = await parse_body(request, InquiryIn)
    conn.execute(
        "INSERT INTO inquiries(name,email,phone,ip,created_at) VALUES (?,?,?,?,?)",
        (data.name, data.email, data.phone, ip, now_iso()),
    )
    return JSONResponse({"ok": True}, status_code=201)


routes = [
    Route("/api/health", health, methods=["GET"]),
    Route("/api/config", config, methods=["GET"]),
    Route("/api/editors", editors, methods=["GET"]),
    Route("/api/inquiries", inquiry, methods=["POST"]),
]
