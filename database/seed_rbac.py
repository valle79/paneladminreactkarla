"""
Siembra (seed) de permisos, roles iniciales y crea el primer SUPER_ADMIN.

El primer SUPER_ADMIN se crea a partir de las variables de entorno del backend:
    ADMIN_EMAIL        (por defecto: admin@iqueño.sac)
    ADMIN_PASSWORD     (obligatorio en producción; por defecto usa AUTH_PASSWORD)
    ADMIN_NAME         (por defecto: Administrador)

Es idempotente: no crea duplicados y jamás sobreescribe la contraseña de un usuario
que ya existe a menos que se ejecute con el flag  --force-reset.

Uso:
    cd backend
    python ../database/seed_rbac.py
    python ../database/seed_rbac.py --force-reset   # restablece clave del admin inicial
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from dotenv import load_dotenv  # noqa: E402

_BACKEND_ENV = Path(__file__).resolve().parent.parent / "backend" / ".env"
if _BACKEND_ENV.exists():
    load_dotenv(_BACKEND_ENV)

import db  # noqa: E402
import password as pw  # noqa: E402
import rbac  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-reset", action="store_true",
                        help="Restablece la contraseña del SUPER_ADMIN inicial aunque ya exista")
    args = parser.parse_args()

    rbac.seed_permissions()
    roles = rbac.seed_roles()
    print("Permisos y roles sembrados.")

    email = (os.getenv("ADMIN_EMAIL", "admin@iqueno.sac") or "").strip().lower()
    name = os.getenv("ADMIN_NAME", "Administrador") or "Administrador"
    pwd = os.getenv("ADMIN_PASSWORD", "") or os.getenv("AUTH_PASSWORD", "iqueño2026")

    if not email:
        print("ADMIN_EMAIL no configurado. No se crea SUPER_ADMIN.")
        return

    user = db.fetch_one("SELECT * FROM users WHERE LOWER(email) = %s", (email,))
    if not user:
        user = db.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (%s,%s,%s) RETURNING *",
            (name, email, pw.hash_password(pwd)),
        )
        print(f"SUPER_ADMIN creado: {email}")
    elif args.force_reset:
        db.execute("UPDATE users SET password_hash = %s WHERE id = %s",
                   (pw.hash_password(pwd), user["id"]), returning=None)
        print(f"Contraseña del SUPER_ADMIN restablecida: {email}")
    else:
        print(f"SUPER_ADMIN ya existe (no se tocó su contraseña): {email}")

    sa = db.fetch_one("SELECT id FROM roles WHERE code = 'SUPER_ADMIN'")
    if sa:
        db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                   (user["id"], sa["id"]), returning=None)
        print("Rol SUPER_ADMIN asignado al usuario inicial.")


if __name__ == "__main__":
    main()
