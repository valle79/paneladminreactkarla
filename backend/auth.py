import os
import base64
import hashlib
import hmac
import json
import time

from fastapi import Depends, HTTPException, Header


def _secret() -> bytes:
    raw = os.getenv("AUTH_SECRET", "iqueño-default-secret")
    return hashlib.sha256(raw.encode()).digest()


def create_token(payload: dict, expires_in: int = 24 * 3600) -> str:
    body = {**payload, "exp": int(time.time()) + expires_in}
    raw = json.dumps(body, separators=(",", ":")).encode()
    b64 = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    sig = hmac.new(_secret(), b64.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{b64}.{sig_b64}"


def verify_token(token: str) -> dict:
    try:
        b64, sig_b64 = token.split(".")
        raw = base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4))
        expected = hmac.new(_secret(), b64.encode(), hashlib.sha256).digest()
        provided = base64.urlsafe_b64decode(sig_b64 + "=" * (-len(sig_b64) % 4))
        if not hmac.compare_digest(expected, provided):
            raise ValueError("bad signature")
        payload = json.loads(raw)
        if payload.get("exp", 0) < int(time.time()):
            raise ValueError("expired")
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")


def require_auth(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="No autenticado")
    return verify_token(authorization[7:].strip())