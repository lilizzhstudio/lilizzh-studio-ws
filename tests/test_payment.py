"""Payment rules: clients pay by UPI only. Bank account numbers / IFSC are never needed and never shown."""
from __future__ import annotations

import contextlib
import io
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import manage  # noqa: E402
from app.config import Settings  # noqa: E402
from app.routes_orders import build_payment_payload  # noqa: E402


def settings(**env):
    return Settings.from_env({"APP_ENV": "development", **{k.upper(): v for k, v in env.items()}})


class PaymentRules(unittest.TestCase):
    def test_upi_and_name_are_all_that_is_needed(self):
        s = settings(pay_upi_id="studio@upi", pay_account_name="Test Studio")
        self.assertTrue(s.payment_configured)
        self.assertEqual(s.payment_problems, [])
        p = build_payment_payload(s, "ORD-1234", 160)
        self.assertEqual(set(p), {"amountUSD", "amountINR", "accountName", "upiId", "upiUri", "qrUrl"})
        self.assertIn("pa=studio%40upi", p["upiUri"])
        self.assertEqual(p["amountINR"], 160 * 86)

    def test_old_bank_settings_are_ignored_completely(self):
        s = settings(pay_upi_id="studio@upi", pay_account_name="Test Studio",
                     pay_account_number="9990001112", pay_ifsc="AIRP0000001", pay_bank_name="Some Bank")
        text = str(build_payment_payload(s, "ORD-1234", 160)).lower()
        for needle in ("9990001112", "airp0000001", "some bank", "ifsc", "accountnumber", "bankname"):
            self.assertNotIn(needle, text)
        self.assertFalse(hasattr(s, "pay_ifsc") or hasattr(s, "pay_account_number"))

    def test_problems_are_reported_in_plain_language(self):
        self.assertFalse(settings().payment_configured)
        self.assertTrue(any("PAY_UPI_ID is empty" in x for x in settings(pay_account_name="X").payment_problems))
        self.assertTrue(any("PAY_ACCOUNT_NAME" in x for x in settings(pay_upi_id="a@upi").payment_problems))
        bad = settings(pay_upi_id="not-a-upi", pay_account_name="X")
        self.assertFalse(bad.payment_configured)
        self.assertTrue(any("does not look like a UPI ID" in x for x in bad.payment_problems))


class SettingsCommands(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.env_file = self.tmp / ".env"
        for p in (mock.patch.object(manage, "ENV_PATH", self.env_file),
                  mock.patch.dict(os.environ, {"APP_ENV": "development"})):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_cmd(self, *argv):
        out, code = io.StringIO(), 0
        with mock.patch.object(sys, "argv", ["manage.py", *argv]), contextlib.redirect_stdout(out):
            try:
                manage.main()
            except SystemExit as exc:
                code = exc.code if isinstance(exc.code, int) else 1
                if isinstance(exc.code, str):
                    out.write(exc.code)
        return code, out.getvalue()

    def test_set_payment_saves_upi_and_name_privately(self):
        code, out = self.run_cmd("set-payment", "--upi", "studio@upi", "--account-name", "Test Studio")
        self.assertEqual(code, 0, out)
        self.assertNotIn("FIX", out)
        text = self.env_file.read_text()
        self.assertIn("PAY_UPI_ID=studio@upi", text)
        self.assertIn("PAY_ACCOUNT_NAME=Test Studio", text)
        self.assertEqual(oct(self.env_file.stat().st_mode & 0o777), "0o600")

    def test_set_payment_rejects_bad_upi_and_leaves_file_alone(self):
        self.run_cmd("set-payment", "--upi", "studio@upi", "--account-name", "Test Studio")
        code, out = self.run_cmd("set-payment", "--upi", "not a upi")
        self.assertNotEqual(code, 0)
        self.assertIn("PAY_UPI_ID=studio@upi", self.env_file.read_text())

    def test_set_payment_without_options_shows_values_and_flags_gaps(self):
        self.run_cmd("set-payment", "--upi", "studio@upi")
        code, out = self.run_cmd("set-payment")
        self.assertEqual(code, 0)
        self.assertIn("studio@upi", out)
        self.assertIn("PAY_ACCOUNT_NAME", out)                                           # still missing -> FIX line

    def test_forget_bank_removes_old_lines_and_keeps_the_rest(self):
        self.env_file.write_text("SECRET_KEY=abc\nPAY_UPI_ID=studio@upi\nPAY_ACCOUNT_NAME=T\n"
                                 "PAY_ACCOUNT_NUMBER=111\nPAY_IFSC=AIRP0000001\nPAY_BANK_NAME=B\n")
        code, out = self.run_cmd("set-payment", "--forget-bank")
        self.assertEqual(code, 0, out)
        text = self.env_file.read_text()
        for gone in ("PAY_ACCOUNT_NUMBER", "PAY_IFSC", "PAY_BANK_NAME"):
            self.assertNotIn(gone, text)
        for kept in ("SECRET_KEY=abc", "PAY_UPI_ID=studio@upi", "PAY_ACCOUNT_NAME=T"):
            self.assertIn(kept, text)

    def test_set_contact_validates_and_saves(self):
        self.assertNotEqual(self.run_cmd("set-contact", "--email", "nope")[0], 0)
        self.assertNotEqual(self.run_cmd("set-contact", "--whatsapp", "12345")[0], 0)
        code, out = self.run_cmd("set-contact", "--email", "Me@Example.com", "--whatsapp", "+91 98765 43210")
        self.assertEqual(code, 0, out)
        text = self.env_file.read_text()
        self.assertIn("CONTACT_EMAIL=me@example.com", text)
        self.assertIn("CONTACT_WHATSAPP=+91 98765 43210", text)
        code, out = self.run_cmd("set-contact")
        self.assertIn("signed-in people only", out)


if __name__ == "__main__":
    unittest.main()
