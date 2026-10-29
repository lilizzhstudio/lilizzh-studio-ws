"""End-to-end security tests. Run with:  python -m unittest discover -s tests -v

Starts the real server on a random local port with a throw-away database, then talks to it over HTTP
exactly like a browser would (cookies, CSRF header, file uploads). Uses only the standard library.
"""
from __future__ import annotations

import http.client
import json
import os
import secrets
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn  # noqa: E402

from app.config import Settings  # noqa: E402
from app.db import connect, now_iso  # noqa: E402
from app.main import create_app  # noqa: E402
from app.security import hash_password, phone_key  # noqa: E402
from app.seed import create_admin, seed_demo, seed_editors  # noqa: E402

ADMIN_EMAIL = "owner@example.test"
ADMIN_PASSWORD = "Admin-" + secrets.token_urlsafe(12)
UPI = "studio-test@upi"
ACCOUNT = "9990001112"
CONTACT_EMAIL = "owner-private@example.test"
CONTACT_WA = "+91 90000 11122"


class Response:
    def __init__(self, status, headers, body):
        self.status, self.headers, self.body = status, headers, body

    def json(self):
        return json.loads(self.body.decode() or "null")

    @property
    def text(self):
        return self.body.decode("utf-8", "replace")


class Browser:
    """A tiny cookie-keeping HTTP client."""

    def __init__(self, port):
        self.port, self.cookies, self.set_cookie_headers = port, {}, []

    def request(self, method, path, body=None, raw=None, headers=None, csrf=True):
        h = dict(headers or {})
        if csrf:
            h.setdefault("X-Requested-With", "lilizzh-web")
        if self.cookies:
            h["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        data = raw
        if body is not None:
            h["Content-Type"] = "application/json"
            data = json.dumps(body)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        try:
            conn.request(method, path, body=data, headers=h)
            resp = conn.getresponse()
            payload = resp.read()
            headers_out = {}
            for key, value in resp.getheaders():
                if key.lower() == "set-cookie":
                    self.set_cookie_headers.append(value)
                    name, _, rest = value.partition("=")
                    cookie_value = rest.split(";")[0]
                    if cookie_value in ("", '""') or "max-age=0" in value.lower():
                        self.cookies.pop(name, None)
                    else:
                        self.cookies[name] = cookie_value
                headers_out[key.lower()] = value
            return Response(resp.status, headers_out, payload)
        finally:
            conn.close()

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body=body if body is not None else {}, **kw)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServerCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.settings = Settings.from_env({
            "APP_ENV": "development", "SECRET_KEY": secrets.token_urlsafe(48), "DATA_DIR": cls.tmp.name,
            "MAX_UPLOAD_MB": "1", "PAY_UPI_ID": UPI, "PAY_ACCOUNT_NAME": "Test Studio",
            "CONTACT_EMAIL": CONTACT_EMAIL, "CONTACT_WHATSAPP": CONTACT_WA,
            # Old bank settings that must now be ignored completely (never sent to a browser):
            "PAY_ACCOUNT_NUMBER": ACCOUNT, "PAY_IFSC": "TEST0000001", "PAY_BANK_NAME": "Test Bank",
            **getattr(cls, "extra_env", {}),
        })
        app = create_app(cls.settings)
        conn = connect(cls.settings.db_path)
        cls.passcodes = seed_editors(conn)
        create_admin(conn, "Test Owner", ADMIN_EMAIL, ADMIN_PASSWORD)
        cls.demo = seed_demo(conn, cls.settings)  # {email: password}
        conn.close()
        cls.port = free_port()
        cls.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=cls.port, log_level="error"))
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        for _ in range(100):
            if cls.server.started:
                break
            time.sleep(0.05)
        else:
            raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=10)
        cls.tmp.cleanup()

    # --- helpers
    def browser(self):
        return Browser(self.port)

    def login_admin(self):
        b = self.browser()
        r = b.post("/api/auth/login", {"role": "ADMIN", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        self.assertEqual(r.status, 200, r.text)
        return b

    def login_editor(self, editor_id="ed-1"):
        b = self.browser()
        r = b.post("/api/auth/login", {"role": "EDITOR", "editorId": editor_id, "password": self.passcodes[editor_id]})
        self.assertEqual(r.status, 200, r.text)
        return b

    def new_client(self, label="c"):
        """Create a client directly in the database (the public sign-up form is rate limited to
        10 per hour per address, which is covered separately) and sign in through the real login API."""
        email = f"{label}-{secrets.token_hex(4)}@example.test"
        password = "Client-" + secrets.token_urlsafe(10)
        phone = "+91 98" + str(secrets.randbelow(10**8)).zfill(8)
        conn = connect(self.settings.db_path)
        try:
            conn.execute("INSERT INTO users(role,name,email,phone,phone_key,password_hash,created_at) "
                         "VALUES ('CLIENT','Test Client',?,?,?,?,?)",
                         (email, phone, phone_key(phone), hash_password(password), now_iso()))
        finally:
            conn.close()
        b = self.browser()
        r = b.post("/api/auth/login", {"role": "CLIENT", "email": email, "password": password})
        self.assertEqual(r.status, 200, r.text)
        return b, email, password

    def make_order(self, client, editor_id="ed-1", project="Short / Reel", budget=30):
        r = client.post("/api/orders", {"editorId": editor_id, "projectType": project, "aspectRatio": "9:16 Vertical",
                                        "phone": "+91 9000000000", "notes": "cut it tight", "budgetOffer": budget})
        self.assertEqual(r.status, 201, r.text)
        return r.json()["order"]


class TestNothingSecretIsServed(ServerCase):
    def test_pages_and_scripts_contain_no_credentials(self):
        b = self.browser()
        served = {}
        for path in ("/", "/static/app.js", "/static/tailwind-config.js", "/static/index.html"):
            r = b.get(path)
            self.assertEqual(r.status, 200, path)
            served[path] = r.text
        secrets_to_hide = [ADMIN_PASSWORD, *self.passcodes.values(), *self.demo.values(), UPI, ACCOUNT,
                           CONTACT_EMAIL, "9000011122", "TEST0000001",
                           "admin123", "lilizzh@7218", "marcus123", "elena123", "devon123", "aria123",
                           "password123", "firebase", "AIRP0000001", "7020082894@airtel"]
        for path, text in served.items():
            for needle in secrets_to_hide:
                self.assertNotIn(needle.lower(), text.lower(), f"{needle!r} leaked in {path}")

    def test_source_and_private_files_are_not_reachable(self):
        b = self.browser()
        for path in ("/.env", "/manage.py", "/app/config.py", "/data/lilizzh.sqlite3", "/static/../app/config.py",
                     "/static/%2e%2e/app/config.py", "/static/..%2fapp%2fconfig.py", "/static/app.jsx",
                     "/static/lilizzh.sqlite3", "/frontend-src/app.jsx"):
            r = b.get(path)
            self.assertEqual(r.status, 404, f"{path} -> {r.status}")

    def test_database_has_no_plaintext_passwords(self):
        raw = b""
        for p in Path(self.tmp.name).glob("lilizzh.sqlite3*"):
            raw += p.read_bytes()
        for secret in [ADMIN_PASSWORD, *self.passcodes.values(), *self.demo.values()]:
            self.assertNotIn(secret.encode(), raw)
        self.assertIn(b"scrypt$", raw)

    def test_security_headers(self):
        b = self.browser()
        r = b.get("/")
        csp = r.headers["content-security-policy"]
        script_src = [d for d in csp.split(";") if d.strip().startswith("script-src")][0]
        self.assertNotIn("'unsafe-inline'", script_src)
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertEqual(r.headers["x-content-type-options"], "nosniff")
        self.assertEqual(r.headers["x-frame-options"], "DENY")
        api = b.get("/api/auth/me")
        self.assertEqual(api.headers["cache-control"], "no-store")

    def test_public_endpoints_hide_internal_fields(self):
        b = self.browser()
        roster = b.get("/api/editors").json()["editors"]
        self.assertEqual(len(roster), 4)
        for ed in roster:
            self.assertFalse({"email", "passcode_hash", "passcode", "pin"} & set(ed), ed.keys())
        cfg = b.get("/api/config").json()
        for tier in cfg["rateCard"]:
            self.assertNotIn("editorPayoutDefault", tier)
            self.assertNotIn("profitRangeUSD", tier)
        admin_cfg = self.login_admin().get("/api/config").json()
        self.assertIn("profitRangeUSD", admin_cfg["rateCard"][0])


class TestAuthentication(ServerCase):
    def test_wrong_passwords_get_one_generic_message(self):
        b = self.browser()
        messages = set()
        for payload in ({"role": "ADMIN", "email": ADMIN_EMAIL, "password": "wrong-password-1"},
                        {"role": "ADMIN", "email": "nobody@example.test", "password": "wrong-password-1"},
                        {"role": "EDITOR", "editorId": "ed-2", "password": "wrong-passcode-1"},
                        {"role": "EDITOR", "editorId": "ed-99", "password": "wrong-passcode-1"},
                        {"role": "CLIENT", "email": "alex@creator.io", "password": "password123"}):
            r = b.post("/api/auth/login", payload)
            self.assertEqual(r.status, 401, payload)
            messages.add(r.json()["detail"])
        self.assertEqual(len(messages), 1, messages)
        for m in messages:
            self.assertNotIn("hint", m.lower())
            self.assertFalse(any(p in m for p in self.passcodes.values()))

    def test_old_hardcoded_passwords_no_longer_work(self):
        b = self.browser()
        for payload in ({"role": "ADMIN", "email": "lilizzh.studio@gmail.com", "password": "admin123"},
                        {"role": "ADMIN", "email": "admin@lilizzh.studio", "password": "admin123"},
                        {"role": "ADMIN", "email": "lilizzh.studio@gmail.com", "password": "lilizzh@7218"},
                        {"role": "EDITOR", "editorId": "ed-3", "password": "devon123"},
                        {"role": "CLIENT", "email": "alex@creator.io", "password": "password123"}):
            self.assertEqual(b.post("/api/auth/login", payload).status, 401, payload)

    def test_session_cookie_flags_and_logout(self):
        b = self.login_admin()
        cookie = b.set_cookie_headers[-1].lower()
        self.assertIn("httponly", cookie)
        self.assertIn("samesite=lax", cookie)
        self.assertIn("max-age=28800", cookie)  # admin sessions last 8 hours
        me = b.get("/api/auth/me").json()["user"]
        self.assertEqual(me["role"], "ADMIN")
        self.assertEqual(b.post("/api/auth/logout").status, 200)
        self.assertIsNone(b.get("/api/auth/me").json()["user"])
        self.assertEqual(b.get("/api/orders").status, 401)

    def test_forged_or_tampered_cookie_is_rejected(self):
        b = self.browser()
        b.cookies["lz_session"] = secrets.token_urlsafe(32)
        self.assertIsNone(b.get("/api/auth/me").json()["user"])
        self.assertEqual(b.get("/api/orders").status, 401)

    def test_csrf_header_and_origin_are_enforced(self):
        b = self.browser()
        payload = {"role": "ADMIN", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        self.assertEqual(b.post("/api/auth/login", payload, csrf=False).status, 403)
        r = b.post("/api/auth/login", payload, headers={"Origin": "https://evil.example"})
        self.assertEqual(r.status, 403)
        self.assertEqual(b.post("/api/auth/login", payload, headers={"Origin": "null"}).status, 403)
        ok = b.post("/api/auth/login", payload, headers={"Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(ok.status, 200)

    def test_lockout_after_repeated_failures_even_for_correct_passcode(self):
        b = self.browser()
        for _ in range(8):
            self.assertEqual(b.post("/api/auth/login", {"role": "EDITOR", "editorId": "ed-4", "password": "nope-nope-nope"}).status, 401)
        locked = b.post("/api/auth/login", {"role": "EDITOR", "editorId": "ed-4", "password": self.passcodes["ed-4"]})
        self.assertEqual(locked.status, 429)

    def test_registration_rules(self):
        b = self.browser()
        base = {"name": "Tester", "email": f"t-{secrets.token_hex(3)}@example.test", "phone": "+91 9811122233"}
        self.assertEqual(b.post("/api/auth/register", {**base, "password": "short"}).status, 422)
        self.assertEqual(b.post("/api/auth/register", {**base, "password": "password123"}).status, 422)
        self.assertEqual(b.post("/api/auth/register", {**base, "email": "not-an-email", "password": "Str0ng-Pass-77"}).status, 422)
        self.assertEqual(b.post("/api/auth/register", {**base, "password": "Str0ng-Pass-77"}).status, 200)
        again = self.browser().post("/api/auth/register", {**base, "password": "Str0ng-Pass-77"})
        self.assertEqual(again.status, 409)
        self.assertEqual(self.browser().post("/api/auth/login", {"role": "CLIENT", "phone": base["phone"], "password": "Str0ng-Pass-77"}).status, 200)

    def test_injection_attempts_are_just_bad_logins(self):
        b = self.browser()
        for evil in ("' OR 1=1 --", "admin'--", '" OR ""="'):
            r = b.post("/api/auth/login", {"role": "ADMIN", "email": evil, "password": evil})
            self.assertIn(r.status, (401, 422))

    def test_huge_json_body_is_refused(self):
        b = self.browser()
        r = b.request("POST", "/api/auth/login", raw=b"{" + b'"a":"' + b"x" * 2_000_000 + b'"}',
                      headers={"Content-Type": "application/json"})
        self.assertEqual(r.status, 413)


class TestAccessControl(ServerCase):
    def test_anonymous_cannot_use_private_endpoints(self):
        b = self.browser()
        for method, path in (("GET", "/api/orders"), ("GET", "/api/orders/ORD-8821/payment-info"),
                             ("GET", "/api/orders/ORD-8821/files/file-x"), ("POST", "/api/orders/ORD-8821/messages"),
                             ("POST", "/api/admin/orders/ORD-8821/unlock"), ("GET", "/api/admin/inquiries")):
            r = b.request(method, path, body={} if method == "POST" else None)
            self.assertEqual(r.status, 401, f"{method} {path}")

    def test_clients_only_see_their_own_orders(self):
        alex = self.browser()
        self.assertEqual(alex.post("/api/auth/login", {"role": "CLIENT", "email": "alex@creator.io", "password": self.demo["alex@creator.io"]}).status, 200)
        mine = [o["id"] for o in alex.get("/api/orders").json()["orders"]]
        self.assertEqual(mine, ["ORD-8821"])
        stranger, _, _ = self.new_client("stranger")
        self.assertEqual(stranger.get("/api/orders").json()["orders"], [])
        for method, path, body in (("POST", "/api/orders/ORD-8821/messages", {"text": "hi"}),
                                   ("GET", "/api/orders/ORD-8821/payment-info", None),
                                   ("POST", "/api/orders/ORD-8821/negotiation", {"proposedPrice": 1}),
                                   ("POST", "/api/orders/ORD-8821/folders", {"name": "x"}),
                                   ("POST", "/api/orders/ORD-8821/payment-proof", {"utr": "UTR12345678"})):
            self.assertEqual(stranger.request(method, path, body=body).status, 404, path)

    def test_privilege_escalation_is_blocked(self):
        client, _, _ = self.new_client()
        order = self.make_order(client)
        oid = order["id"]
        for path, body in ((f"/api/admin/orders/{oid}/unlock", {"unlocked": True}),
                           (f"/api/admin/orders/{oid}/pricing", {"price": 1, "editorPayout": 0}),
                           (f"/api/admin/orders/{oid}/reassign", {"editorId": "ed-2"}),
                           (f"/api/admin/orders/{oid}/negotiation", {"decision": "accept"})):
            self.assertEqual(client.post(path, body).status, 403, path)
        self.assertEqual(client.request("PUT", f"/api/admin/orders/{oid}/links", body={"cleanUrl": "https://x.test/a.mp4"}).status, 403)
        self.assertEqual(client.request("PUT", f"/api/orders/{oid}/draft", body={"url": "https://x.test/a.mp4"}).status, 403)
        self.assertEqual(client.get("/api/admin/inquiries").status, 403)
        editor = self.login_editor("ed-1")
        self.assertEqual(editor.post(f"/api/admin/orders/{oid}/unlock", {"unlocked": True}).status, 403)
        self.assertEqual(editor.get(f"/api/orders/{oid}/payment-info").status, 403)
        self.assertEqual(editor.post(f"/api/orders/{oid}/negotiation", {"proposedPrice": 5}).status, 403)

    def test_client_cannot_unlock_by_forging_fields(self):
        client, _, _ = self.new_client()
        order = self.make_order(client)
        r = client.post("/api/orders", {"editorId": "ed-1", "projectType": "Short / Reel", "aspectRatio": "9:16 Vertical",
                                        "phone": "+91 9000000000", "notes": "x", "budgetOffer": 30,
                                        "unlocked": True, "price": 1, "editorPayout": 999, "status": "COMPLETED & UNLOCKED",
                                        "cleanUrl": "https://evil.test/x.mp4"})
        forged = r.json()["order"]
        self.assertFalse(forged["unlocked"])
        self.assertEqual(forged["status"], "IN PRODUCTION")
        self.assertNotIn("cleanUrl", forged)
        self.assertNotIn("editorPayout", forged)
        self.assertFalse(order["unlocked"])

    def test_paid_master_url_is_hidden_until_admin_unlocks(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client)["id"]
        admin = self.login_admin()
        self.assertEqual(admin.request("PUT", f"/api/admin/orders/{oid}/links", body={"cleanUrl": "https://cdn.test/master.mp4"}).status, 200)
        locked = client.get("/api/orders").json()["orders"][0]
        self.assertNotIn("cleanUrl", locked)
        self.assertNotIn("master.mp4", client.get("/api/orders").text)
        admin_copy = [o for o in admin.get("/api/orders").json()["orders"] if o["id"] == oid][0]
        self.assertEqual(admin_copy["cleanUrl"], "https://cdn.test/master.mp4")
        editor_view = self.login_editor("ed-1").get("/api/orders").text
        self.assertNotIn("master.mp4", editor_view)
        self.assertEqual(admin.post(f"/api/admin/orders/{oid}/unlock", {"unlocked": True}).status, 200)
        unlocked = client.get("/api/orders").json()["orders"][0]
        self.assertEqual(unlocked["cleanUrl"], "https://cdn.test/master.mp4")
        self.assertTrue(unlocked["unlocked"])

    def test_editor_view_never_includes_money_details(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client)["id"]
        self.assertEqual(client.post(f"/api/orders/{oid}/negotiation", {"proposedPrice": 22, "note": "pls"}).status, 200)
        self.assertEqual(client.post(f"/api/orders/{oid}/payment-proof", {"utr": "UTR9988776655"}).status, 200)
        editor = self.login_editor("ed-1")
        order = [o for o in editor.get("/api/orders").json()["orders"] if o["id"] == oid][0]
        self.assertIsNone(order["negotiation"])
        self.assertIsNone(order["paymentProof"])
        for key in ("editorPayout", "cleanUrl"):
            self.assertNotIn(key, order)
        blob = json.dumps(order["chatMessages"])
        self.assertNotIn("UTR9988776655", blob)
        self.assertNotIn("NEGOTIATION", blob)
        # ...but the client and admin do see them
        self.assertEqual(client.get("/api/orders").json()["orders"][0]["paymentProof"]["utr"], "UTR9988776655")
        admin_order = [o for o in self.login_admin().get("/api/orders").json()["orders"] if o["id"] == oid][0]
        self.assertEqual(admin_order["negotiation"]["status"], "PENDING_ADMIN_REVIEW")

    def test_editors_only_see_assigned_orders(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client, editor_id="ed-2")["id"]
        self.assertNotIn(oid, [o["id"] for o in self.login_editor("ed-1").get("/api/orders").json()["orders"]])
        self.assertIn(oid, [o["id"] for o in self.login_editor("ed-2").get("/api/orders").json()["orders"]])
        self.assertEqual(self.login_editor("ed-1").post(f"/api/orders/{oid}/messages", {"text": "hello"}).status, 404)

    def test_chat_sender_is_decided_by_the_server(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client)["id"]
        r = client.post(f"/api/orders/{oid}/messages", {"text": "I am the admin", "sender": "system"})
        msgs = r.json()["order"]["chatMessages"]
        self.assertEqual(msgs[-1]["sender"], "client")
        r = self.login_editor("ed-1").post(f"/api/orders/{oid}/messages", {"text": "hi", "sender": "system"})
        self.assertEqual(r.json()["order"]["chatMessages"][-1]["sender"], "editor")

    def test_payment_details_only_for_the_owner(self):
        client, _, _ = self.new_client()
        order = self.make_order(client, budget=40)
        info = client.get(f"/api/orders/{order['id']}/payment-info").json()
        self.assertEqual(info["upiId"], UPI)
        self.assertEqual(set(info), {"amountUSD", "amountINR", "accountName", "upiId", "upiUri", "qrUrl"})
        self.assertEqual(info["amountINR"], 40 * 86)
        self.assertIn(f"am={40 * 86}.00", info["upiUri"])
        other, _, _ = self.new_client("other")
        self.assertEqual(other.get(f"/api/orders/{order['id']}/payment-info").status, 404)
        self.assertEqual(self.browser().get(f"/api/orders/{order['id']}/payment-info").status, 401)

    def test_payment_reference_cannot_be_reused_across_orders(self):
        a, _, _ = self.new_client("a")
        b, _, _ = self.new_client("b")
        oa, ob = self.make_order(a)["id"], self.make_order(b)["id"]
        self.assertEqual(a.post(f"/api/orders/{oa}/payment-proof", {"utr": "UTR5550001112"}).status, 200)
        self.assertEqual(b.post(f"/api/orders/{ob}/payment-proof", {"utr": "UTR5550001112"}).status, 409)
        self.assertEqual(a.post(f"/api/orders/{oa}/payment-proof", {"utr": "bad utr!"}).status, 422)

    def test_input_validation_on_orders_and_links(self):
        client, _, _ = self.new_client()
        base = {"editorId": "ed-1", "projectType": "Short / Reel", "aspectRatio": "9:16 Vertical",
                "phone": "+91 9000000000", "notes": "x", "budgetOffer": 30}
        for bad in ({"budgetOffer": -5}, {"budgetOffer": 1e12}, {"budgetOffer": "NaN"}, {"projectType": "Free Stuff"},
                    {"editorId": "ed-99"}, {"aspectRatio": "4:3"}, {"phone": "abc"}, {"notes": ""}):
            self.assertIn(client.post("/api/orders", {**base, **bad}).status, (422,), bad)
        oid = self.make_order(client)["id"]
        editor = self.login_editor("ed-1")
        for bad_url in ("javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://x.test/a.mp4", "not a url", "https://a.test/ x"):
            self.assertEqual(editor.request("PUT", f"/api/orders/{oid}/draft", body={"url": bad_url}).status, 422, bad_url)
        self.assertEqual(editor.request("PUT", f"/api/orders/{oid}/draft", body={"url": "https://cdn.test/d.mp4"}).status, 200)

    def test_messages_are_rate_limited(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client)["id"]
        codes = [client.post(f"/api/orders/{oid}/messages", {"text": f"m{i}"}).status for i in range(45)]
        self.assertIn(429, codes)

    def test_admin_negotiation_and_reassignment_flow(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client, project="Long video", budget=160)["id"]
        self.assertEqual(client.post(f"/api/orders/{oid}/negotiation", {"proposedPrice": 140, "note": "deal?"}).status, 200)
        admin = self.login_admin()
        r = admin.post(f"/api/admin/orders/{oid}/negotiation", {"decision": "accept"}).json()["order"]
        self.assertEqual(r["price"], 140)
        self.assertEqual(r["editorPayout"], 65)
        self.assertEqual(admin.post(f"/api/admin/orders/{oid}/negotiation", {"decision": "accept"}).status, 409)
        r = admin.post(f"/api/admin/orders/{oid}/reassign", {"editorId": "ed-3"}).json()["order"]
        self.assertEqual(r["editor"], "Devon Sterling")
        self.assertIn(oid, [o["id"] for o in self.login_editor("ed-3").get("/api/orders").json()["orders"]])
        self.assertNotIn(oid, [o["id"] for o in self.login_editor("ed-1").get("/api/orders").json()["orders"]])


class TestFileVault(ServerCase):
    def upload(self, client, oid, name, data, folder="Raw Footage"):
        from urllib.parse import urlencode
        q = urlencode({"name": name, "folder": folder})
        return client.request("POST", f"/api/orders/{oid}/files?{q}", raw=data, headers={"Content-Type": "application/octet-stream"})

    def test_dangerous_file_types_are_refused(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client)["id"]
        for name in ("page.html", "evil.svg", "run.exe", "x.js", "shell.php", "noext", "a.mp4.html", ".htaccess", "x.HTM"):
            self.assertEqual(self.upload(client, oid, name, b"<script>alert(1)</script>").status, 415, name)

    def test_upload_download_range_and_delete(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client)["id"]
        payload = os.urandom(200_000)
        r = self.upload(client, oid, "../../etc/clip one.mp4", payload)
        self.assertEqual(r.status, 201, r.text)
        files = r.json()["order"]["uploadedFiles"]
        self.assertEqual(len(files), 1)
        f = files[0]
        self.assertEqual(f["name"], "clip one.mp4")  # path parts are stripped
        stored = list((Path(self.tmp.name) / "uploads" / oid).iterdir())
        self.assertEqual(len(stored), 1)
        self.assertNotIn("clip", stored[0].name)  # random on-disk name
        dl = client.get(f["url"])
        self.assertEqual(dl.status, 200)
        self.assertEqual(dl.body, payload)
        self.assertIn("attachment", dl.headers["content-disposition"])
        inline = client.get(f["url"] + "?inline=1")
        self.assertIn("inline", inline.headers["content-disposition"])
        rng = client.get(f["url"] + "?inline=1", headers={"Range": "bytes=10-19"})
        self.assertEqual(rng.status, 206)
        self.assertEqual(rng.body, payload[10:20])
        # visible to the assigned editor, hidden from everyone else
        self.assertEqual(self.login_editor("ed-1").get(f["url"]).status, 200)
        self.assertEqual(self.login_editor("ed-2").get(f["url"]).status, 404)
        self.assertEqual(self.new_client("snoop")[0].get(f["url"]).status, 404)
        self.assertEqual(self.browser().get(f["url"]).status, 401)
        # an editor may not delete client files; the owner can
        self.assertEqual(self.login_editor("ed-1").request("DELETE", f["url"]).status, 403)
        self.assertEqual(client.request("DELETE", f["url"]).status, 200)
        self.assertEqual(client.get(f["url"]).status, 404)
        self.assertEqual(list((Path(self.tmp.name) / "uploads" / oid).iterdir()), [])

    def test_oversized_upload_is_rejected_and_cleaned_up(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client)["id"]
        r = self.upload(client, oid, "big.mp4", os.urandom(1_300_000))  # limit is 1 MB in this test server
        self.assertEqual(r.status, 413)
        folder = Path(self.tmp.name) / "uploads" / oid
        self.assertEqual(list(folder.iterdir()) if folder.exists() else [], [])
        self.assertEqual(self.upload(client, oid, "empty.mp4", b"").status, 422)

    def test_folders(self):
        client, _, _ = self.new_client()
        oid = self.make_order(client)["id"]
        self.assertEqual(client.post(f"/api/orders/{oid}/folders", {"name": "Client Notes"}).status, 201)
        self.assertEqual(client.post(f"/api/orders/{oid}/folders", {"name": "Client Notes"}).status, 409)
        self.assertEqual(client.post(f"/api/orders/{oid}/folders", {"name": "../evil"}).status, 422)
        self.assertEqual(self.upload(client, oid, "n.txt", b"hello", folder="Nope").status, 422)
        up = self.upload(client, oid, "n.txt", b"hello", folder="Client Notes")
        self.assertEqual(up.json()["order"]["uploadedFiles"][0]["folder"], "Client Notes")
        r = client.request("DELETE", f"/api/orders/{oid}/folders?name=Client%20Notes").json()["order"]
        self.assertEqual(r["uploadedFiles"][0]["folder"], "Raw Footage")
        self.assertEqual(client.request("DELETE", f"/api/orders/{oid}/folders?name=Raw%20Footage").status, 409)


class TestV3Features(ServerCase):
    def test_qr_endpoint_owner_only(self):
        owner, _, _ = self.new_client("qr")
        other, _, _ = self.new_client("qr2")
        oid = self.make_order(owner)["id"]
        r = owner.get(f"/api/orders/{oid}/upi-qr.svg")
        self.assertEqual(r.status, 200)
        self.assertIn("svg", r.headers.get("Content-Type", r.headers.get("content-type", "")))
        self.assertEqual(other.get(f"/api/orders/{oid}/upi-qr.svg").status, 404)
        self.assertEqual(self.browser().get(f"/api/orders/{oid}/upi-qr.svg").status, 401)

    def test_private_messages_never_reach_editors(self):
        client, _, _ = self.new_client("pm")
        oid = self.make_order(client)["id"]
        self.assertEqual(client.post(f"/api/orders/{oid}/messages", {"text": "PRIVATE-NOTE", "private": True}).status, 201)
        self.assertEqual(client.post(f"/api/orders/{oid}/messages", {"text": "PUBLIC-NOTE"}).status, 201)
        ed = self.login_editor("ed-1")
        body = ed.get("/api/orders").text
        self.assertIn("PUBLIC-NOTE", body)
        self.assertNotIn("PRIVATE-NOTE", body)
        self.assertEqual(ed.post(f"/api/orders/{oid}/messages", {"text": "x", "private": True}).status, 403)
        mine = client.get("/api/orders").text
        self.assertIn("PRIVATE-NOTE", mine)
        self.assertIn("PRIVATE-NOTE", self.login_admin().get("/api/orders").text)

    def test_contact_is_for_signed_in_people_only(self):
        self.assertIsNone(self.browser().get("/api/config").json().get("contact"))
        client, _, _ = self.new_client("ct")
        contact = client.get("/api/config").json()["contact"]
        self.assertEqual(contact["email"], CONTACT_EMAIL)

    def test_admin_can_manage_editors(self):
        admin = self.login_admin()
        r = admin.post("/api/admin/editors", {"name": "Zed Test", "roleTitle": "Colorist", "tag": "Short / Reel",
                                              "email": "zed@example.test"})
        self.assertEqual(r.status, 201, r.text)
        eid, code = r.json()["editor"]["id"], r.json()["passcode"]
        self.assertEqual(self.browser().post("/api/auth/login", {"role": "EDITOR", "editorId": eid, "password": code}).status, 200)
        self.assertEqual(admin.request("PUT", f"/api/admin/editors/{eid}", {"name": "Zed Renamed"}).json()["editor"]["name"], "Zed Renamed")
        self.assertEqual(admin.post(f"/api/admin/editors/{eid}/remove").status, 200)
        self.assertEqual(self.browser().post("/api/auth/login", {"role": "EDITOR", "editorId": eid, "password": code}).status, 401)
        self.assertEqual(admin.post(f"/api/admin/editors/{eid}/restore").status, 200)
        new = admin.post(f"/api/admin/editors/{eid}/passcode").json()["passcode"]
        self.assertNotEqual(new, code)
        client, _, _ = self.new_client("na")
        self.assertEqual(client.post("/api/admin/editors", {"name": "x", "roleTitle": "x", "tag": "x", "email": "x@y.z"}).status, 403)
        self.assertEqual(self.login_editor("ed-1").get("/api/admin/editors").status, 403)


if __name__ == "__main__":
    unittest.main(verbosity=2)
