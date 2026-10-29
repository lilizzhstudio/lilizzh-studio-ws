"""Tests for the editor / pricing commands in manage.py. Run:  python -m unittest discover -s tests -v

Each test uses a throw-away database and a temporary rate-card file, so real data is never touched.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import manage  # noqa: E402
from app.db import connect, init_db, load_rate_card  # noqa: E402
from app.security import verify_password  # noqa: E402
from app.seed import seed_editors, seed_rate_card  # noqa: E402
from app.serializers import serialize_editor  # noqa: E402


class ManageCommandTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.rates_file = self.tmp / "rate_card.json"
        shutil.copy(ROOT / "seed" / "rate_card.json", self.rates_file)
        patches = [
            mock.patch.dict(os.environ, {"DATA_DIR": str(self.tmp / "data"), "APP_ENV": "development"}),
            mock.patch.object(manage, "RATE_PATH", self.rates_file),
            mock.patch.object(manage, "ENV_PATH", self.tmp / "no.env"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(shutil.rmtree, self.tmp, True)
        settings, conn = manage.open_db()
        seed_rate_card(conn, ROOT / "seed" / "rate_card.json")
        seed_editors(conn)
        conn.close()
        self.db_path = settings.db_path

    # -------------------------------------------------------------- helpers
    def run_cmd(self, *argv):
        out = io.StringIO()
        code = 0
        with mock.patch.object(sys, "argv", ["manage.py", *argv]), contextlib.redirect_stdout(out):
            try:
                manage.main()
            except SystemExit as exc:
                code = exc.code if isinstance(exc.code, int) else 1
                if isinstance(exc.code, str):
                    out.write(exc.code)
        return code, out.getvalue()

    def db(self):
        return connect(self.db_path)

    def editor(self, eid):
        conn = self.db()
        try:
            return conn.execute("SELECT * FROM editors WHERE id = ?", (eid,)).fetchone()
        finally:
            conn.close()

    ADD = ["add-editor", "--name", "Jo Lee", "--role-title", "Podcast Editor", "--tag", "YouTube",
           "--email", "jo@lilizzh.studio"]

    # --------------------------------------------------------------- editors
    def test_add_editor_creates_profile_and_one_time_passcode(self):
        code, out = self.run_cmd(*self.ADD, "--portfolio", "Reel|https://cdn.test/a.mp4")
        self.assertEqual(code, 0, out)
        passcode = re.search(r"Passcode .*: (\S+)", out).group(1)
        row = self.editor("ed-5")
        self.assertEqual(row["name"], "Jo Lee")
        self.assertTrue(row["active"])
        self.assertTrue(verify_password(passcode, row["passcode_hash"]))
        self.assertNotIn(passcode, row["passcode_hash"])
        public = serialize_editor(row)
        self.assertEqual(public["portfolioVideos"], [{"title": "Reel", "url": "https://cdn.test/a.mp4"}])
        self.assertTrue(public["avatar"].startswith("data:image/svg+xml"))
        self.assertNotIn("passcode", json.dumps(public).lower())
        self.assertNotIn("jo@lilizzh.studio", json.dumps(public))

    def test_add_editor_rejects_duplicates_and_unsafe_input(self):
        self.assertEqual(self.run_cmd(*self.ADD)[0], 0)
        self.assertNotEqual(self.run_cmd(*self.ADD)[0], 0)                                   # same e-mail
        bad_avatar = self.run_cmd(*[a if a != "jo@lilizzh.studio" else "x@lilizzh.studio" for a in self.ADD],
                                  "--avatar", "javascript:alert(1)")
        self.assertNotEqual(bad_avatar[0], 0)
        self.assertNotEqual(self.run_cmd(*self.ADD[:-1], "not-an-email")[0], 0)
        self.assertNotEqual(self.run_cmd(*self.ADD, "--portfolio", "no-separator")[0], 0)
        self.assertIsNone(self.editor("ed-6"))

    def test_unknown_tag_gets_a_helpful_note(self):
        argv = [a if a != "YouTube" else "Podcasts" for a in self.ADD]
        code, out = self.run_cmd(*argv)
        self.assertEqual(code, 0)
        self.assertIn("only show under 'All'", out)

    def test_edit_editor_renames_and_validates(self):
        code, out = self.run_cmd("edit-editor", "ed-1", "--name", "Marcus V. Vance", "--speed", "< 10h")
        self.assertEqual(code, 0, out)
        row = self.editor("ed-1")
        self.assertEqual((row["name"], row["speed"]), ("Marcus V. Vance", "< 10h"))
        self.assertNotEqual(self.run_cmd("edit-editor", "ed-1")[0], 0)                      # nothing to change
        self.assertNotEqual(self.run_cmd("edit-editor", "ed-99", "--name", "X")[0], 0)      # unknown id
        self.assertNotEqual(self.run_cmd("edit-editor", "ed-1", "--email", "elena@lilizzh.studio")[0], 0)
        self.assertEqual(self.editor("ed-1")["name"], "Marcus V. Vance")

    def test_remove_and_restore_editor(self):
        conn = self.db()
        conn.execute("INSERT INTO sessions(token_hash,role,user_id,editor_id,created_at,expires_at) "
                     "VALUES ('t','EDITOR',NULL,'ed-2','2026-01-01','2099-01-01')")
        conn.close()
        code, out = self.run_cmd("remove-editor", "ed-2")
        self.assertEqual(code, 0, out)
        self.assertFalse(self.editor("ed-2")["active"])
        conn = self.db()
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions WHERE editor_id='ed-2'").fetchone()[0], 0)
        conn.close()
        self.assertNotEqual(self.run_cmd("remove-editor", "ed-2")[0], 0)                    # already removed
        self.assertEqual(self.run_cmd("restore-editor", "ed-2")[0], 0)
        self.assertTrue(self.editor("ed-2")["active"])

    def test_cannot_remove_last_active_editor(self):
        for eid in ("ed-1", "ed-2", "ed-3"):
            self.assertEqual(self.run_cmd("remove-editor", eid)[0], 0)
        code, out = self.run_cmd("remove-editor", "ed-4")
        self.assertNotEqual(code, 0)
        self.assertIn("last active editor", out)
        self.assertTrue(self.editor("ed-4")["active"])

    def test_list_editors_runs(self):
        code, out = self.run_cmd("list-editors")
        self.assertEqual(code, 0)
        self.assertIn("Marcus Vance", out)
        self.assertNotIn("scrypt", out)

    # ----------------------------------------------------------------- rates
    def rate(self, rid):
        conn = self.db()
        try:
            return next(r for r in load_rate_card(conn) if r["id"] == rid)
        finally:
            conn.close()

    def test_set_rate_updates_database_and_file(self):
        code, out = self.run_cmd("set-rate", "Long video", "--price", "180", "--payout", "70")
        self.assertEqual(code, 0, out)
        row = self.rate("rate-long")
        self.assertEqual((row["clientPriceDefault"], row["editorPayoutDefault"]), (180, 70))
        saved = {r["id"]: r for r in json.loads(self.rates_file.read_text(encoding="utf-8"))}
        self.assertEqual(saved["rate-long"]["clientPriceDefault"], 180)
        self.assertEqual(saved["rate-short"]["clientPriceDefault"], 30)                     # others untouched
        self.assertEqual(len(saved), 3)

    def test_set_rate_ranges_derive_inr_and_profit(self):
        code, out = self.run_cmd("set-rate", "rate-short", "--price-range", "30 - 40", "--turnaround", "< 12h")
        self.assertEqual(code, 0, out)
        row = self.rate("rate-short")
        self.assertEqual(row["clientPriceRangeUSD"], "$30 - $40")
        self.assertEqual(row["clientPriceRangeINR"], "₹2,600 - ₹3,400")
        self.assertEqual(row["profitRangeUSD"], "$20 - $25")                                # 30-10 .. 40-15
        self.assertEqual(row["typicalTurnaround"], "< 12h")

    def test_set_rate_rejects_bad_values(self):
        for argv in (["set-rate", "Long video", "--price", "50", "--payout", "60"],         # payout > price
                     ["set-rate", "Long video", "--price", "0"],
                     ["set-rate", "Nope", "--price", "10"],
                     ["set-rate", "Long video", "--price-range", "200 - 100"],
                     ["set-rate", "Long video"]):
            self.assertNotEqual(self.run_cmd(*argv)[0], 0, argv)
        self.assertEqual(self.rate("rate-long")["clientPriceDefault"], 160)

    def test_set_rate_file_only_leaves_database_alone(self):
        code, out = self.run_cmd("set-rate", "rate-batch", "--price", "300", "--file-only")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.rate("rate-batch")["clientPriceDefault"], 275)
        saved = {r["id"]: r for r in json.loads(self.rates_file.read_text(encoding="utf-8"))}
        self.assertEqual(saved["rate-batch"]["clientPriceDefault"], 300)

    def test_show_rates_runs(self):
        code, out = self.run_cmd("show-rates")
        self.assertEqual(code, 0)
        self.assertIn("Long video", out)


if __name__ == "__main__":
    unittest.main()
