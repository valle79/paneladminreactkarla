"""Almacenamiento de archivos: Cloudinary en producción, disco local en desarrollo.

Configuración (variables de entorno):
  CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

Si faltan las variables, el sistema usa la carpeta local `uploads/`
como respaldo (ideal para desarrollo local).
"""

import os

import cloudinary
import cloudinary.uploader

FOLDER = "iqueno"


def is_configured() -> bool:
    return bool(
        os.getenv("CLOUDINARY_CLOUD_NAME")
        and os.getenv("CLOUDINARY_API_KEY")
        and os.getenv("CLOUDINARY_API_SECRET")
    )


def _configure() -> None:
    cloudinary.config(
        cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
        api_key=os.getenv("CLOUDINARY_API_KEY"),
        api_secret=os.getenv("CLOUDINARY_API_SECRET"),
        secure=True,
    )


def upload_bytes(data: bytes, filename: str) -> str:
    """Sube un archivo a Cloudinary y devuelve su URL pública."""
    _configure()
    result = cloudinary.uploader.upload(
        data,
        resource_type="auto",
        folder=FOLDER,
        public_id=None,
        overwrite=True,
    )
    return result["secure_url"]