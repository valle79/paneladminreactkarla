"""
Gestión de usuarios, roles y permisos (RBAC) para el panel admin.
Requiere permisos específicos (USERS_*, ROLES_*, PERMISSIONS_*).
"""

from fastapi import APIRouter, Depends, HTTPException

import db
import rbac
import password as pw
from auth import get_current_user

router = APIRouter(prefix="/api/admin", tags=["admin-rbac"])


def rbac_perm(perm: str):
    from auth import require_permission
    return require_permission(perm)


def _serialize_user(row) -> dict:
    u = dict(row)
    u.pop("password_hash", None)
    return u


# ============================================================================
# USUARIOS
# ============================================================================

def _list_users_impl(q="", active=None, page=1, limit=20):
    conds = []
    params = []
    if q:
        conds.append("(LOWER(name) LIKE %s OR LOWER(email) LIKE %s)")
        like = f"%{q.lower()}%"
        params += [like, like]
    if active is not None:
        conds.append("active = %s")
        params.append(active.lower() == "true")
    wh = ("WHERE " + " AND ".join(conds)) if conds else ""
    total = db.fetch_one(f"SELECT COUNT(*)::int as n FROM users {wh}", params or None)["n"]
    page = max(1, page)
    limit = min(max(1, limit), 100)
    off = (page - 1) * limit
    rows = db.fetch_all(
        f"SELECT id, name, email, active, created_at, last_login_at, updated_at "
        f"FROM users {wh} ORDER BY id DESC LIMIT {limit} OFFSET {off}",
        params or None,
    )
    items = []
    for r in rows:
        item = _serialize_user(r)
        item["roles"] = rbac.get_user_roles(item["id"])
        items.append(item)
    return {
        "items": items,
        "pagination": {
            "page": page, "limit": limit, "total": total,
            "total_pages": (total + limit - 1) // limit,
        },
    }


@router.get("/users")
def list_users_route(
    q: str = "",
    active: str | None = None,
    page: int = 1,
    limit: int = 20,
    _: dict = Depends(rbac_perm("USERS_VIEW")),
):
    return _list_users_impl(q, active, page, limit)


@router.post("/users")
def create_user(
    payload: dict,
    actor: dict = Depends(rbac_perm("USERS_CREATE")),
):
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    role_ids = payload.get("role_ids") or []

    if not name or not email or not password:
        raise HTTPException(status_code=400, detail="Nombre, email y contraseña son obligatorios")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
    existing = db.fetch_one("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un usuario con ese email")

    row = db.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (%s,%s,%s) RETURNING *",
        (name, email, pw.hash_password(password)),
    )
    user_id = row["id"]
    for rid in role_ids:
        db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                   (user_id, rid), returning=None)
    rbac.audit(actor["id"], actor["email"], "user.create", "users", user_id,
               {"name": name, "email": email, "roles": role_ids})
    item = _serialize_user(db.fetch_one("SELECT * FROM users WHERE id = %s", (user_id,)))
    item["roles"] = rbac.get_user_roles(user_id)
    return item


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    payload: dict,
    actor: dict = Depends(rbac_perm("USERS_UPDATE")),
):
    row = db.fetch_one("SELECT * FROM users WHERE id = %s", (user_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    data = {}
    if "name" in payload and payload["name"] is not None:
        data["name"] = payload["name"].strip()
    if "email" in payload and payload["email"] is not None:
        new_email = payload["email"].strip().lower()
        dup = db.fetch_one("SELECT id FROM users WHERE LOWER(email)=%s AND id<>%s",
                           (new_email, user_id))
        if dup:
            raise HTTPException(status_code=400, detail="Ya existe un usuario con ese email")
        data["email"] = new_email
    if "active" in payload and payload["active"] is not None:
        data["active"] = bool(payload["active"])

    # Protección: no desactivar el último SUPER_ADMIN activo
    if "active" in data and data["active"] is False:
        _guard_last_super_admin(user_id)

    if data:
        sets = ", ".join([f"{k} = %s" for k in data])
        db.execute(f"UPDATE users SET {sets} WHERE id=%s RETURNING *",
                   [*data.values(), user_id], returning="id")

    # Roles
    if "role_ids" in payload and payload["role_ids"] is not None:
        _ensure_actor_can_assign(actor, payload["role_ids"])
        # Protección: impedir quitar el último SUPER_ADMIN
        _guard_last_super_admin_roles(user_id, [int(x) for x in payload["role_ids"]])
        if actor["id"] == user_id:
            # El usuario no debe poder autodescender de SUPER_ADMIN dejando el sistema sin superadmin
            pass
        # Reemplazar roles
        db.execute("DELETE FROM user_roles WHERE user_id = %s", (user_id,), returning=None)
        for rid in payload["role_ids"]:
            db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                       (user_id, int(rid)), returning=None)
        _audit_roles(actor, user_id, payload["role_ids"])

    rbac.audit(actor["id"], actor["email"], "user.update", "users", user_id, dict(data))
    item = _serialize_user(db.fetch_one("SELECT * FROM users WHERE id = %s", (user_id,)))
    item["roles"] = rbac.get_user_roles(user_id)
    return item


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: dict,
    actor: dict = Depends(rbac_perm("USERS_UPDATE")),
):
    row = db.fetch_one("SELECT id FROM users WHERE id = %s", (user_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    password = payload.get("password") or ""
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
    db.execute("UPDATE users SET password_hash = %s WHERE id=%s",
               (pw.hash_password(password), user_id), returning=None)
    rbac.audit(actor["id"], actor["email"], "user.reset_password", "users", user_id, {})
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    actor: dict = Depends(rbac_perm("USERS_DELETE")),
):
    row = db.fetch_one("SELECT * FROM users WHERE id = %s", (user_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    _guard_last_super_admin(user_id)
    db.execute("UPDATE users SET active = false WHERE id = %s", (user_id,), returning=None)
    rbac.audit(actor["id"], actor["email"], "user.delete", "users", user_id, {"email": row["email"]})
    return {"ok": True}


# ============================================================================
# ROLES
# ============================================================================

@router.get("/roles")
def list_roles(_: dict = Depends(rbac_perm("ROLES_VIEW"))):
    roles = db.fetch_all(
        "SELECT r.*, "
        "(SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS user_count "
        "FROM roles r ORDER BY r.id"
    )
    out = []
    perms = {p["id"]: p for p in db.fetch_all("SELECT id, code, module, description FROM permissions")}
    for r in roles:
        role = dict(r)
        role_perms = db.fetch_all(
            "SELECT permission_id FROM role_permissions WHERE role_id = %s", (role["id"],))
        role["permission_codes"] = [perms[p["permission_id"]]["code"]
                                    for p in role_perms if p["permission_id"] in perms]
        out.append(role)
    return out


@router.post("/roles")
def create_role(
    payload: dict,
    actor: dict = Depends(rbac_perm("ROLES_CREATE")),
):
    name = (payload.get("name") or "").strip()
    code = (payload.get("code") or "").strip().upper().replace(" ", "_")
    if not name or not code:
        raise HTTPException(status_code=400, detail="Nombre y código son obligatorios")
    if db.fetch_one("SELECT id FROM roles WHERE code = %s", (code,)):
        raise HTTPException(status_code=400, detail="Ya existe un rol con ese código")
    row = db.execute("INSERT INTO roles (name, code, description) VALUES (%s,%s,%s) RETURNING *",
                     (name, code, payload.get("description")), )
    # permisos opcionales al crear
    if payload.get("permission_codes"):
        _set_role_permissions(row["id"], payload["permission_codes"])
    rbac.audit(actor["id"], actor["email"], "role.create", "roles", row["id"], {"code": code, "name": name})
    return dict(row)


@router.put("/roles/{role_id}")
def update_role(
    role_id: int,
    payload: dict,
    actor: dict = Depends(rbac_perm("ROLES_UPDATE")),
):
    row = db.fetch_one("SELECT * FROM roles WHERE id = %s", (role_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Rol no encontrado")

    new_code = (payload.get("code") or row["code"]).strip().upper().replace(" ", "_")
    # Protección: no cambiar el código de roles críticos a algo no-SUPER_ADMIN ni editar is_system
    if row["is_system"] and new_code != row["code"]:
        raise HTTPException(status_code=400, detail="No se puede cambiar el código de un rol del sistema")

    data = {"name": payload.get("name", row["name"]), "code": new_code,
            "description": payload.get("description", row["description"])}
    sets = ", ".join([f"{k} = %s" for k in data])
    db.execute(f"UPDATE roles SET {sets} WHERE id=%s", [*data.values(), role_id], returning="id")

    if payload.get("permission_codes") is not None:
        _set_role_permissions(role_id, payload["permission_codes"])
        # Si se editan permisos de un rol, invalidamos sesiones al exigir renovación de token (se hace al re-login)
        rbac.audit(actor["id"], actor["email"], "role.set_permissions", "roles", role_id,
                   {"permissions": payload["permission_codes"]})

    rbac.audit(actor["id"], actor["email"], "role.update", "roles", role_id, dict(data))
    return db.fetch_one("SELECT * FROM roles WHERE id = %s", (role_id,))


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    actor: dict = Depends(rbac_perm("ROLES_DELETE")),
):
    row = db.fetch_one("SELECT * FROM roles WHERE id = %s", (role_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    if row["is_system"]:
        raise HTTPException(status_code=400, detail="No se puede eliminar un rol del sistema")
    db.execute("DELETE FROM roles WHERE id = %s", (role_id,), returning=None)
    rbac.audit(actor["id"], actor["email"], "role.delete", "roles", role_id, {"code": row["code"]})
    return {"ok": True}


@router.get("/permissions")
def list_permissions(_: dict = Depends(rbac_perm("PERMISSIONS_VIEW"))):
    rows = db.fetch_all("SELECT * FROM permissions ORDER BY module, id")
    return [dict(r) for r in rows]


# ============================================================================
# Helpers
# ============================================================================

def _set_role_permissions(role_id: int, codes: list):
    pmap = {p["code"]: p["id"] for p in db.fetch_all("SELECT id, code FROM permissions")}
    ids = [pmap[c] for c in codes if c in pmap]
    db.execute("DELETE FROM role_permissions WHERE role_id = %s", (role_id,), returning=None)
    for pid in ids:
        db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                   (role_id, pid), returning=None)


def _super_admin_role_ids() -> list:
    rows = db.fetch_all("SELECT id FROM roles WHERE code = 'SUPER_ADMIN'")
    return [r["id"] for r in rows]


def _count_active_super_admins(exclude_user_id=None) -> int:
    sa_ids = _super_admin_role_ids()
    if not sa_ids:
        return 0
    rows = db.fetch_all(
        """SELECT DISTINCT ur.user_id FROM user_roles ur
           JOIN users u ON u.id = ur.user_id AND u.active
           WHERE ur.role_id = ANY(%s)""",
        (sa_ids,),
    )
    ids = {r["user_id"] for r in rows}
    if exclude_user_id:
        ids.discard(exclude_user_id)
    return len(ids)


def _guard_last_super_admin(user_id: int):
    """Impide desactivar/eliminar al último SUPER_ADMIN activo."""
    if _count_active_super_admins() <= 1 and user_id in _super_admin_user_ids():
        raise HTTPException(status_code=400, detail="No se puede quitar al último SUPER_ADMIN activo")


def _super_admin_user_ids() -> set:
    sa_ids = _super_admin_role_ids()
    if not sa_ids:
        return set()
    rows = db.fetch_all("SELECT DISTINCT user_id FROM user_roles WHERE role_id = ANY(%s)", (sa_ids,))
    return {r["user_id"] for r in rows}


def _guard_last_super_admin_roles(user_id: int, new_role_ids: list):
    """Impide quitar SUPER_ADMIN al último SUPER_ADMIN activo."""
    sa_ids = _super_admin_role_ids()
    user_is_sa = bool(sa_ids and (set(new_role_ids) & set(sa_ids)))
    if not user_is_sa and user_id in _super_admin_user_ids():
        if _count_active_super_admins() <= 1:
            raise HTTPException(status_code=400,
                                detail="No se puede quitar el rol SUPER_ADMIN al último SUPER_ADMIN activo")


def _ensure_actor_can_assign(actor: dict, role_ids: list):
    """Solo un SUPER_ADMIN (o quien tenga PERMISSIONS_MANAGE) puede asignar roles críticos."""
    # actor ya tiene USERS_UPDATE; adicionalmente exigimos capacidad crítica para asignar SUPER_ADMIN
    if any(_is_critical_role_id(int(r)) for r in role_ids):
        if "PERMISSIONS_MANAGE" not in actor["permissions"] and not _actor_is_super(actor):
            raise HTTPException(status_code=403, detail="No tienes permisos para asignar ese rol")


def _is_critical_role_id(role_id: int) -> bool:
    r = db.fetch_one("SELECT code, is_system FROM roles WHERE id = %s", (role_id,))
    return bool(r and (r["code"] == "SUPER_ADMIN" or r["is_system"]))


def _actor_is_super(actor: dict) -> bool:
    return any(r.get("code") == "SUPER_ADMIN" for r in actor["roles"])


def _audit_roles(actor, user_id, role_ids):
    roles = db.fetch_all("SELECT id, name, code FROM roles WHERE id = ANY(%s)", (role_ids,))
    rbac.audit(actor["id"], actor["email"], "user.set_roles", "users", user_id,
               {"roles": [{"id": r["id"], "code": r["code"]} for r in roles]})
