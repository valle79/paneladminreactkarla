"""Envío de PDF/video adjuntos por WhatsApp Cloud API (Meta).

Configuración (variables de entorno en backend/.env):
  WHATSAPP_TOKEN          -> System User access token de largo plazo (developers.facebook.com)
  WHATSAPP_PHONE_ID       -> Phone Number ID del número de la empresa
  WHATSAPP_API_VERSION    -> opcional, ej. v23.0 (por defecto v23.0)

El cliente solo ve el archivo adjunto + el mensaje (caption); el enlace usado
para que Meta descargue el archivo no se muestra al destinatario.
Importante: el enlace del archivo debe ser HTTPS y accesible públicamente
(Cloudinary sirve); y el cliente debe haberle escrito al número en las últimas
24 h para poder recibir mensajes con adjuntos.
"""

import os
import re

import httpx

GRAPH_URL = "https://graph.facebook.com"
DEFAULT_VERSION = "v23.0"

DOCUMENT_EXT = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv", ".avi"}


def is_configured() -> bool:
    return bool(os.getenv("WHATSAPP_TOKEN") and os.getenv("WHATSAPP_PHONE_ID"))


def normalize_phone(phone: str) -> str:
    """Limpia el teléfono y antepone el código de Perú (51) si viene sin él."""
    d = re.sub(r"\D", "", phone or "")
    if len(d) == 9:
        d = f"51{d}"
    return d


def media_type(url: str) -> str:
    ext = os.path.splitext(url.split("?")[0])[1].lower()
    return "video" if ext in VIDEO_EXT else "document"


def send_media(phone: str, media_url: str, caption: str = None, filename: str = None) -> dict:
    """Envía un PDF/video adjunto con su mensaje al teléfono indicado."""
    if not is_configured():
        raise ValueError(
            "WhatsApp no está configurado. Define WHATSAPP_TOKEN y WHATSAPP_PHONE_ID "
            "en el backend/.env con los datos de la Meta Cloud API."
        )

    phone = normalize_phone(phone)
    if not phone:
        raise ValueError("Teléfono inválido")

    media_url = (media_url or "").strip()
    if not media_url.startswith("https://"):
        raise ValueError("El archivo debe estar en una URL HTTPS pública para que WhatsApp la descargue")

    mtype = media_type(media_url)
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": phone,
        "type": mtype,
    }
    if mtype == "document":
        doc = {"link": media_url}
        if filename:
            doc["filename"] = filename
        if caption:
            doc["caption"] = caption
        payload["document"] = doc
    else:
        video = {"link": media_url}
        if caption:
            video["caption"] = caption
        payload["video"] = video

    version = os.getenv("WHATSAPP_API_VERSION", DEFAULT_VERSION)
    url = f"{GRAPH_URL}/{version}/{os.getenv('WHATSAPP_PHONE_ID')}/messages"
    headers = {"Authorization": f"Bearer {os.getenv('WHATSAPP_TOKEN')}"}

    r = httpx.post(url, json=payload, headers=headers, timeout=60)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code >= 400 or body.get("error"):
        err = body.get("error", {})
        detail = err.get("error_user_msg") or err.get("message") or f"HTTP {r.status_code}"
        raise ValueError(f"WhatsApp rechazó el envío: {detail}")
    return body