"""The UPI QR is drawn locally; verify it really scans (needs OpenCV, skipped otherwise)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.qr import make_matrix, make_svg  # noqa: E402

try:
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover
    cv2 = None


class TestQr(unittest.TestCase):
    def test_svg_shape(self):
        svg = make_svg("upi://pay?pa=a@upi")
        self.assertTrue(svg.startswith("<svg"))
        self.assertNotIn("<script", svg)

    def test_too_long_is_refused(self):
        with self.assertRaises(Exception):
            make_matrix("x" * 500)

    @unittest.skipIf(cv2 is None, "OpenCV not installed")
    def test_scans_back(self):
        det = cv2.QRCodeDetectorAruco()
        for text in ("upi://pay?pa=studio%40upi&pn=Test%20Studio&am=13760.00&cu=INR&tn=ORD-1234",
                     "upi://pay?pa=a@b&pn=X"):
            m = make_matrix(text)
            n, scale, quiet = len(m), 8, 4
            img = np.full(((n + 2 * quiet) * scale,) * 2, 255, np.uint8)
            for y, row in enumerate(m):
                for x, v in enumerate(row):
                    if v:
                        img[(y + quiet) * scale:(y + quiet + 1) * scale, (x + quiet) * scale:(x + quiet + 1) * scale] = 0
            self.assertEqual(det.detectAndDecode(img)[0], text)


if __name__ == "__main__":
    unittest.main()
