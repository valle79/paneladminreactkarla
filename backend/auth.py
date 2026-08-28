import os
import base64
import hashlib
import hmac
import json
import time

from fastapi import Depends, HTTPException, Header

import db
import rbac

_ACCESS_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "720"))  # 12 horas


def _secret() -> bytes:
    raw = os.getenv("AUTH_SECRET", "iqueño-default-secret")
    return hashlib.sha256(raw.encode()).digest()


def create_token(payload: dict, expires_in: int | None = None) -> str:
    if expires_in is None:
        expires_in = _ACCESS_MINUTES * 60
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


# ============================================================================
# Dependencies de autorización
# ============================================================================

def _load_user(user_id):
    """Carga el usuario desde la BD y valida que siga activo."""
    if not user_id:
        return None
    row = db.fetch_one("SELECT * FROM users WHERE id = %s AND active", (user_id,))
    return dict(row) if row else None


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    """
    Devuelve el usuario autenticado (desde la BD) con sus roles y permisos.
    Si el usuario fue desactivado, pierde acceso (401).
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="No autenticado")
    payload = verify_token(authorization[7:].strip())
    if "sub" not in payload:
        raise HTTPException(status_code=401, detail="Token no válido")
    user = _load_user(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="Usuario desactivado o no existe")
    user["roles"] = rbac.get_user_roles(user["id"])
    user["permissions"] = sorted(rbac.get_user_permissions(user["id"]))
    return user


def require_auth(authorization: str | None = Header(default=None)) -> dict:
    """
    Middleware legacy: solo valida que la sesión sea válida.
    Mantenido para compatibilidad; las rutas nuevas usan require_permission.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="No autenticado")
    return verify_token(authorization[7:].strip())


def require_permission(permission: str):
    """Dependency factory: 403 si el usuario autenticado no tiene el permiso."""
    def _dp(user: dict = Depends(get_current_user)) -> dict:
        if permission not in user["permissions"]:
            raise HTTPException(status_code=403, detail="No tienes permisos para esta acción")
        return user
    return _dp
