"""Request bodies. Everything the browser sends is validated here before it touches the database."""
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .security import normalise_email, valid_email

_PHONE_RE = re.compile(r"^[0-9+\-\s().]{7,24}$")
_UTR_RE = re.compile(r"^[A-Za-z0-9\-_/]{6,40}$")


def _check_phone(value: str) -> str:
    value = value.strip()
    if not _PHONE_RE.match(value) or len(re.sub(r"\D", "", value)) < 7:
        raise ValueError("enter a valid phone number")
    return value


def _check_email(value: str) -> str:
    value = normalise_email(value)
    if not valid_email(value):
        raise ValueError("enter a valid email address")
    return value


class Body(BaseModel):
    model_config = {"str_strip_whitespace": True}


class RegisterIn(Body):
    name: str = Field(min_length=1, max_length=80)
    email: str
    phone: str
    password: str = Field(min_length=1, max_length=128)

    _email = field_validator("email")(_check_email)
    _phone = field_validator("phone")(_check_phone)


class LoginIn(Body):
    role: Literal["CLIENT", "EDITOR", "ADMIN"]
    email: Optional[str] = Field(default=None, max_length=254)
    phone: Optional[str] = Field(default=None, max_length=32)
    editorId: Optional[str] = Field(default=None, max_length=40)
    password: str = Field(min_length=1, max_length=128)


class OrderCreateIn(Body):
    editorId: Optional[str] = Field(default=None, max_length=40)
    projectType: str = Field(min_length=1, max_length=80)
    aspectRatio: Literal["16:9 Landscape", "9:16 Vertical", "1:1 Square"] = "16:9 Landscape"
    phone: str
    notes: str = Field(min_length=1, max_length=4000)
    budgetOffer: float = Field(ge=10, le=100000, allow_inf_nan=False)

    _phone = field_validator("phone")(_check_phone)


class NegotiationIn(Body):
    proposedPrice: float = Field(gt=0, le=100000, allow_inf_nan=False)
    note: str = Field(default="", max_length=1000)


class PaymentProofIn(Body):
    utr: str

    @field_validator("utr")
    @classmethod
    def _utr(cls, value: str) -> str:
        value = value.strip().upper()
        if not _UTR_RE.match(value):
            raise ValueError("enter the 6-40 character UTR / transaction reference (letters and digits only)")
        return value


class MessageIn(Body):
    text: str = Field(min_length=1, max_length=2000)
    private: bool = False


class FolderIn(Body):
    name: str = Field(min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if re.search(r"[\x00-\x1f\\/<>]", value):
            raise ValueError("folder names cannot contain slashes, angle brackets or control characters")
        return value


class DraftIn(Body):
    url: str = Field(min_length=1, max_length=2048)


class InquiryIn(Body):
    name: str = Field(min_length=1, max_length=80)
    email: str
    phone: str = Field(default="", max_length=32)

    _email = field_validator("email")(_check_email)


class PortfolioItem(Body):
    title: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=1, max_length=2048)


class EditorCreateIn(Body):
    name: str = Field(min_length=1, max_length=60)
    roleTitle: str = Field(min_length=1, max_length=60)
    tag: str = Field(min_length=1, max_length=30)
    email: str = Field(min_length=3, max_length=254)
    bio: Optional[str] = Field(default=None, max_length=600)
    rating: Optional[str] = Field(default=None, max_length=10)
    speed: Optional[str] = Field(default=None, max_length=20)
    badge: Optional[str] = Field(default=None, max_length=30)
    avatar: Optional[str] = Field(default=None, max_length=2048)
    portfolio: Optional[list[PortfolioItem]] = Field(default=None, max_length=12)


class EditorUpdateIn(Body):
    name: Optional[str] = Field(default=None, max_length=60)
    roleTitle: Optional[str] = Field(default=None, max_length=60)
    tag: Optional[str] = Field(default=None, max_length=30)
    email: Optional[str] = Field(default=None, max_length=254)
    bio: Optional[str] = Field(default=None, max_length=600)
    rating: Optional[str] = Field(default=None, max_length=10)
    speed: Optional[str] = Field(default=None, max_length=20)
    badge: Optional[str] = Field(default=None, max_length=30)
    avatar: Optional[str] = Field(default=None, max_length=2048)
    portfolio: Optional[list[PortfolioItem]] = Field(default=None, max_length=12)


class RateUpdateIn(Body):
    price: Optional[float] = Field(default=None, gt=0, le=100000, allow_inf_nan=False)
    payout: Optional[float] = Field(default=None, ge=0, le=100000, allow_inf_nan=False)
    priceRange: Optional[str] = Field(default=None, max_length=40)
    payoutRange: Optional[str] = Field(default=None, max_length=40)
    turnaround: Optional[str] = Field(default=None, max_length=30)
    description: Optional[str] = Field(default=None, max_length=300)


class UnlockIn(Body):
    unlocked: bool


class PricingIn(Body):
    price: float = Field(gt=0, le=100000, allow_inf_nan=False)
    editorPayout: float = Field(ge=0, le=100000, allow_inf_nan=False)


class DecisionIn(Body):
    decision: Literal["accept", "decline"]


class ReassignIn(Body):
    editorId: str = Field(min_length=1, max_length=40)


class LinksIn(Body):
    draftUrl: Optional[str] = Field(default=None, max_length=2048)
    cleanUrl: Optional[str] = Field(default=None, max_length=2048)
