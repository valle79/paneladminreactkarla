"""
Pruebas de RBAC (autorización real en el backend) contra una BD real.

Ejecuta:
    cd backend
    .venv\\Scripts\\python.exe test_rbac.py

Requisitos:
    - Esquema RBAC aplicado (database/apply_rbac.py)
    - Permisos y roles sembrados (database/seed_rbac.py)
    - Usuario SUPER_ADMIN existente (admin@iqueno.sac)

IMPORTANTE: crea usuarios de prueba y los elimina al final. No borra data productiva.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import db  # noqa: E402

client = TestClient(main.app)

PASSED = []
FAILED = []


def check(label, cond, extra=""):
    if cond:
        PASSED.append(label)
        print(f"  [OK] {label}")
    else:
        FAILED.append((label, extra))
        print(f"  [FAIL] {label} {extra}")


def login(email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    return r


def main_test():
    # ---- 1. Login como SUPER_ADMIN (mail + pass) ----
    import os
    admin_pwd = os.getenv("ADMIN_PASSWORD") or os.getenv("AUTH_PASSWORD", "iqueño2026")
    r = login("admin@iqueno.sac", admin_pwd)
    check("SUPER_ADMIN login", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    if r.status_code != 200:
        print("No se pudo iniciar sesión como SUPER_ADMIN. Abortando.\n")
        print("Si es la primera vez, ejecuta:  python ../database/seed_rbac.py --force-reset")
        return
    token = r.json()["token"]
    h = {"Authorization": f"Bearer {token}"}

    # ---- 2. /api/auth/me ----
    me = client.get("/api/auth/me", headers=h)
    check("/api/auth/me 200", me.status_code == 200)
    if me.status_code == 200:
        body = me.json()
        check("/api/auth/me trae roles", isinstance(body.get("roles"), list) and len(body["roles"]) > 0)
        all_perms = body["permissions"]
        check("SUPER_ADMIN tiene PRODUCTS_VIEW",
              "PRODUCTS_VIEW" in all_perms and "PERMISSIONS_MANAGE" in all_perms)

    # ---- 3. Crear usuarios de prueba ----
    created = []
    def make_user(name, email, role_code):
        roles_resp = client.get("/api/admin/roles", headers=h)
        role = next((x for x in roles_resp.json() if x["code"] == role_code), None)
        if not role:
            print(f"   [SKIP] rol {role_code} no encontrado")
            return None
        r = client.post("/api/admin/users", headers=h, json={
            "name": name, "email": email, "password": "Prueba123!",
            "role_ids": [role["id"]],
        })
        if r.status_code == 200:
            created.append(r.json()["id"])
        return r

    # EDITOR_WEB
    ed = make_user("Editor Test", "editor_test@iqueno.sac", "EDITOR_WEB")
    check("crear EDITOR_WEB", ed is not None and ed.status_code == 200, f"status={ed and ed.status_code}")

    # CONSULTA
    co = make_user("Consulta Test", "consulta_test@iqueno.sac", "CONSULTA")
    check("crear CONSULTA", co is not None and co.status_code == 200, f"status={co and co.status_code}")

    # ============ EDITOR_WEB: debe poder administrar web, pero NO clientes/ventas/usuarios ============
    if ed and ed.status_code == 200:
        edt = login("editor_test@iqueno.sac", "Prueba123!")
        check("EDITOR_WEB login", edt.status_code == 200, edt.text[:200])
        eh = {"Authorization": f"Bearer {edt.json()['token']}"} if edt.status_code == 200 else {}

        # PRODUCTS (web): permiso completo
        check("EDITOR GET /api/products 200", client.get("/api/products", headers=eh).status_code == 200)
        prod_r = client.post("/api/products", headers=eh, json={"name": "Test RBAC prod"})
        check("EDITOR POST /api/products 200", prod_r.status_code == 200,
              f"status={prod_r.status_code} {prod_r.text[:120]}")
        if prod_r.status_code == 200:
            client.delete(f"/api/products/{prod_r.json()['id']}", headers=eh)

        # CLIENTES: debe recibir 403
        check("EDITOR GET /api/clients 403",
              client.get("/api/clients", headers=eh).status_code == 403)
        check("EDITOR GET /api/sales 403",
              client.get("/api/sales", headers=eh).status_code == 403)
        check("EDITOR GET /api/admin/users 403",
              client.get("/api/admin/users", headers=eh).status_code == 403)
        check("EDITOR GET /api/admin/roles 403",
              client.get("/api/admin/roles", headers=eh).status_code == 403)

    # ============ CONSULTA: solo lectura ============
    if co and co.status_code == 200:
        ct = login("consulta_test@iqueno.sac", "Prueba123!")
        check("CONSULTA login", ct.status_code == 200, ct.text[:200])
        ch = {"Authorization": f"Bearer {ct.json()['token']}"} if ct.status_code == 200 else {}

        check("CONSULTA GET /api/products 200", client.get("/api/products", headers=ch).status_code == 200)
        check("CONSULTA POST /api/products 403",
              client.post("/api/products", headers=ch, json={"name": "nope"}).status_code == 403)
        check("CONSULTA DELETE /api/products/999999 403",
              client.delete("/api/products/999999", headers=ch).status_code == 403)
        check("CONSULTA GET /api/clients 403",
              client.get("/api/clients", headers=ch).status_code == 403)
        check("CONSULTA GET /api/admin/users 403",
              client.get("/api/admin/users", headers=ch).status_code == 403)

    # ---- 4. SUPER_ADMIN acceso total (GET /api/admin/users) ----
    check("SUPER_ADMIN GET /api/admin/users 200",
          client.get("/api/admin/users", headers=h).status_code == 200)
    check("SUPER_ADMIN GET /api/admin/roles 200",
          client.get("/api/admin/roles", headers=h).status_code == 200)

    # ---- 5. Sin token: 401/403 ----
    check("sin token GET /api/products 401/403",
          client.get("/api/products").status_code in (401, 403))
    check("sin token GET /api/admin/users 401/403",
          client.get("/api/admin/users").status_code in (401, 403))

    # ---- 6. Limpieza de usuarios de prueba (borrado real, no soft-delete) ----
    for uid in created:
        client.delete(f"/api/admin/users/{uid}", headers=h)
        db.execute("DELETE FROM user_roles WHERE user_id = %s", (uid,), returning=None)
        db.execute("DELETE FROM users WHERE id = %s", (uid,), returning=None)

    print("\n==============================")
    print(f"RESULTADO: {len(PASSED)} OK, {len(FAILED)} FALLOS")
    for label, extra in FAILED:
        print(f"  - fallo: {label} {extra}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main_test()
