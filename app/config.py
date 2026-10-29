"""Application settings, read from environment variables (and an optional .env file).

Nothing secret is hard-coded here. Payment details, the session secret and the
admin bootstrap credentials all come from the environment.
"""
from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional

BASE_DIR = Path(__file__).resolve().parent.parent
UPI_RE = re.compile(r"[A-Za-z0-9._\-]{2,64}@[A-Za-z][A-Za-z0-9.\-]{1,40}")


def load_dotenv(path: Path) -> None:
    """Tiny .env loader (KEY=VALUE per line). Real environment variables win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _bool(value: Optional[str], default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _num(value: Optional[str], default: float) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_env: str
    secret_key: str
    data_dir: Path
    max_upload_mb: int
    session_hours: int
    admin_session_hours: int
    usd_to_inr: float
    public_margins: bool
    cookie_secure: bool
    trust_proxy: bool
    allowed_origins: tuple
    csp_report_only: bool
    tz_offset_minutes: int
    pay_upi_id: str
    pay_account_name: str
    contact_email: str
    contact_whatsapp: str
    public_contact: bool
    bootstrap_admin_email: str
    bootstrap_admin_password: str
    bootstrap_admin_name: str

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "lilizzh.sqlite3"

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def upi_valid(self) -> bool:
        return bool(UPI_RE.fullmatch(self.pay_upi_id))

    @property
    def payment_configured(self) -> bool:
        """Clients pay by UPI only (QR code + UPI ID). Bank account numbers / IFSC are never shown."""
        return bool(self.upi_valid and self.pay_account_name)

    @property
    def payment_problems(self) -> list:
        """Plain-language list of gaps in the payment settings (empty = all good)."""
        problems = []
        if not self.pay_account_name:
            problems.append("PAY_ACCOUNT_NAME (the name clients see when paying) is empty.")
        if not self.pay_upi_id:
            problems.append("PAY_UPI_ID is empty: clients have no way to pay.")
        elif not self.upi_valid:
            problems.append(f"PAY_UPI_ID '{self.pay_upi_id}' does not look like a UPI ID (expected name@bank).")
        return problems

    @property
    def contact_whatsapp_digits(self) -> str:
        return re.sub(r"\D", "", self.contact_whatsapp)

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Settings":
        e = os.environ if env is None else env
        app_env = (e.get("APP_ENV") or "development").strip().lower()
        secret = (e.get("SECRET_KEY") or "").strip()
        if app_env == "production" and len(secret) < 32:
            raise RuntimeError(
                "SECRET_KEY must be set to a random string of at least 32 characters when "
                "APP_ENV=production. Run `python manage.py init` to generate one."
            )
        if not secret:
            # Development convenience only: sessions reset whenever the server restarts.
            secret = secrets.token_urlsafe(48)
        data_dir = Path(e.get("DATA_DIR") or (BASE_DIR / "data")).expanduser()
        origins = tuple(
            o.strip().lower() for o in (e.get("ALLOWED_ORIGINS") or "").split(",") if o.strip()
        )
        return cls(
            app_env=app_env,
            secret_key=secret,
            data_dir=data_dir,
            max_upload_mb=int(_num(e.get("MAX_UPLOAD_MB"), 1024)),
            session_hours=int(_num(e.get("SESSION_HOURS"), 24 * 7)),
            admin_session_hours=int(_num(e.get("ADMIN_SESSION_HOURS"), 8)),
            usd_to_inr=_num(e.get("USD_TO_INR"), 86.0),
            public_margins=_bool(e.get("PUBLIC_RATE_CARD_SHOWS_MARGINS"), False),
            cookie_secure=_bool(e.get("COOKIE_SECURE"), app_env == "production"),
            trust_proxy=_bool(e.get("TRUST_PROXY"), False),
            allowed_origins=origins,
            csp_report_only=_bool(e.get("CSP_REPORT_ONLY"), False),
            tz_offset_minutes=int(_num(e.get("TZ_OFFSET_MINUTES"), 330)),
            pay_upi_id=(e.get("PAY_UPI_ID") or "").strip(),
            pay_account_name=(e.get("PAY_ACCOUNT_NAME") or "").strip(),
            contact_email=(e.get("CONTACT_EMAIL") or "").strip(),
            contact_whatsapp=(e.get("CONTACT_WHATSAPP") or "").strip(),
            public_contact=_bool(e.get("PUBLIC_CONTACT"), False),
            bootstrap_admin_email=(e.get("ADMIN_EMAIL") or "").strip(),
            bootstrap_admin_password=e.get("ADMIN_PASSWORD") or "",
            bootstrap_admin_name=(e.get("ADMIN_NAME") or "Studio Admin").strip(),
        )


def load_settings() -> Settings:
    load_dotenv(BASE_DIR / ".env")
    return Settings.from_env()
