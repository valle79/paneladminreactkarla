"""
RBAC helper: catálogo de permisos/roles, siembra (seed) y consulta de permisos.

Se apoya en db.py (psycopg2, SQL crudo) tal como el resto del backend.
No guarda contraseñas en texto plano: el hash se genera en auth/password.py.
"""

import db

# ============================================================================
# Catálogo de permisos del sistema
# Formato: (code, module, descripción)
# ============================================================================
PERMISSIONS = [
    ("DASHBOARD_VIEW", "dashboard", "Ver el dashboard"),
    ("STATS_VIEW", "dashboard", "Ver estadísticas e indicadores"),
    ("UPLOAD_FILES", "sistema", "Subir archivos (imágenes/PDF/video)"),
    ("CONSULTAR_DNI_RUC", "sistema", "Consultar DNI (RENIEC) y RUC (SUNAT)"),

    ("PRODUCTS_VIEW", "products", "Ver productos"),
    ("PRODUCTS_CREATE", "products", "Crear productos"),
    ("PRODUCTS_UPDATE", "products", "Editar productos"),
    ("PRODUCTS_DELETE", "products", "Eliminar productos"),

    ("SPARE_PARTS_VIEW", "spare_parts", "Ver repuestos"),
    ("SPARE_PARTS_CREATE", "spare_parts", "Crear repuestos"),
    ("SPARE_PARTS_UPDATE", "spare_parts", "Editar repuestos"),
    ("SPARE_PARTS_DELETE", "spare_parts", "Eliminar repuestos"),

    ("PROMOTIONS_VIEW", "promotions", "Ver promociones"),
    ("PROMOTIONS_CREATE", "promotions", "Crear promociones"),
    ("PROMOTIONS_UPDATE", "promotions", "Editar promociones"),
    ("PROMOTIONS_DELETE", "promotions", "Eliminar promociones"),

    ("ADVISORS_VIEW", "advisors", "Ver asesores"),
    ("ADVISORS_CREATE", "advisors", "Crear asesores"),
    ("ADVISORS_UPDATE", "advisors", "Editar asesores"),
    ("ADVISORS_DELETE", "advisors", "Eliminar asesores"),

    ("SERVICES_VIEW", "services", "Ver servicios"),
    ("SERVICES_CREATE", "services", "Crear servicios"),
    ("SERVICES_UPDATE", "services", "Editar servicios"),
    ("SERVICES_DELETE", "services", "Eliminar servicios"),

    ("CLIENTS_VIEW", "clients", "Ver clientes"),
    ("CLIENTS_CREATE", "clients", "Crear clientes"),
    ("CLIENTS_UPDATE", "clients", "Editar clientes"),
    ("CLIENTS_DELETE", "clients", "Eliminar clientes"),

    ("SALES_VIEW", "sales", "Ver ventas"),
    ("SALES_CREATE", "sales", "Crear ventas"),
    ("SALES_UPDATE", "sales", "Editar ventas"),
    ("SALES_DELETE", "sales", "Anular/eliminar ventas"),

    ("USERS_VIEW", "users", "Ver usuarios"),
    ("USERS_CREATE", "users", "Crear usuarios"),
    ("USERS_UPDATE", "users", "Editar usuarios"),
    ("USERS_DELETE", "users", "Eliminar/desactivar usuarios"),

    ("ROLES_VIEW", "roles", "Ver roles"),
    ("ROLES_CREATE", "roles", "Crear roles"),
    ("ROLES_UPDATE", "roles", "Editar roles"),
    ("ROLES_DELETE", "roles", "Eliminar roles"),

    ("PERMISSIONS_VIEW", "permissions", "Ver permisos"),
    ("PERMISSIONS_MANAGE", "permissions", "Gestionar asignación de permisos"),

    ("SETTINGS_VIEW", "settings", "Ver configuración"),
    ("SETTINGS_MANAGE", "settings", "Gestionar configuración"),
]

# Permisos de escritura (para protecciones especiales de SUPER_ADMIN)
CRITICAL_PERMISSIONS = {"USERS_*", "ROLES_*", "PERMISSIONS_*", "SETTINGS_*", "PERMISSIONS_MANAGE", "SETTINGS_MANAGE"}

# ============================================================================
# Roles iniciales:  code -> nombre + lista de permisos
# ============================================================================
def _all_codes():
    return [p[0] for p in PERMISSIONS]


def _crud(module, view_only=False):
    codes = [f"{module}_VIEW"]
    if not view_only:
        codes += [f"{module}_CREATE", f"{module}_UPDATE", f"{module}_DELETE"]
    return codes


ROLES = {
    "SUPER_ADMIN": {
        "name": "Super Administrador",
        "description": "Acceso total al sistema y gestión de usuarios/roles/permisos.",
        "is_system": True,
        "permissions": _all_codes(),
    },
    "ADMIN": {
        "name": "Administrador",
        "description": "Administra el contenido operativo (productos, clientes, ventas, etc.) sin acceso a permisos críticos.",
        "is_system": True,
        "permissions": (
            ["DASHBOARD_VIEW", "STATS_VIEW", "UPLOAD_FILES", "CONSULTAR_DNI_RUC"]
            + _crud("PRODUCTS") + _crud("SPARE_PARTS") + _crud("PROMOTIONS")
            + _crud("ADVISORS") + _crud("SERVICES") + _crud("CLIENTS") + _crud("SALES")
        ),
    },
    "EDITOR_WEB": {
        "name": "Editor Web",
        "description": "Administra únicamente el contenido que se muestra en la página web pública.",
        "is_system": True,
        "permissions": (
            ["DASHBOARD_VIEW", "STATS_VIEW", "UPLOAD_FILES"]
            + _crud("PRODUCTS") + _crud("SPARE_PARTS") + _crud("PROMOTIONS")
            + _crud("ADVISORS") + _crud("SERVICES")
        ),
    },
    "VENTAS": {
        "name": "Ventas",
        "description": "Área comercial: gestiona clientes y ventas, y consulta el catálogo.",
        "is_system": True,
        "permissions": (
            ["DASHBOARD_VIEW", "STATS_VIEW", "UPLOAD_FILES", "CONSULTAR_DNI_RUC"]
            + _crud("CLIENTS") + _crud("SALES")
            + ["PRODUCTS_VIEW", "SPARE_PARTS_VIEW", "PROMOTIONS_VIEW", "ADVISORS_VIEW", "SERVICES_VIEW"]
        ),
    },
    "CONSULTA": {
        "name": "Consulta",
        "description": "Acceso de solo lectura al catálogo.",
        "is_system": True,
        "permissions": (
            ["DASHBOARD_VIEW", "STATS_VIEW"]
            + ["PRODUCTS_VIEW", "SPARE_PARTS_VIEW", "PROMOTIONS_VIEW", "ADVISORS_VIEW", "SERVICES_VIEW"]
        ),
    },
}

# ============================================================================
# Siembra de permisos / roles (idempotente)
# ============================================================================
def seed_permissions():
    """Inserta los permisos del catálogo si no existen. Devuelve {code: id}."""
    existing = {r["code"]: r["id"] for r in db.fetch_all("SELECT id, code FROM permissions")}
    for code, module, desc in PERMISSIONS:
        if code in existing:
            continue
        row = db.execute(
            "INSERT INTO permissions (code, module, description) VALUES (%s,%s,%s) RETURNING id",
            (code, module, desc),
        )
        existing[code] = row["id"]
    return existing


def seed_roles():
    """Siembra los roles iniciales y asigna sus permisos. Devuelve {code: role_id}."""
    perms = seed_permissions()
    roles = {}
    for code, meta in ROLES.items():
        row = db.fetch_one("SELECT id FROM roles WHERE code = %s", (code,))
        if not row:
            row = db.execute(
                "INSERT INTO roles (name, code, description, is_system) VALUES (%s,%s,%s,%s) RETURNING id",
                (meta["name"], code, meta["description"], meta["is_system"]),
            )
        role_id = row["id"]
        roles[code] = role_id
        # sincronizar permisos
        want = {perms[p] for p in meta["permissions"] if p in perms}
        have = {r["permission_id"] for r in
                db.fetch_all("SELECT permission_id FROM role_permissions WHERE role_id = %s", (role_id,))}
        to_add = want - have
        for pid in to_add:
            db.execute(
                "INSERT INTO role_permissions (role_id, permission_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                (role_id, pid),
                returning=None,
            )
    return roles


# ============================================================================
# Consulta de permisos / roles de un usuario (vía la BD, no el frontend)
# ============================================================================
def get_user_permissions(user_id: int) -> set:
    """Devuelve el conjunto de permisos efectivos del usuario (uniendo sus roles)."""
    rows = db.fetch_all(
        """SELECT DISTINCT p.code
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id AND r.active
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id
           WHERE u.id = %s AND u.active""",
        (user_id,),
    )
    return {r["code"] for r in rows}


def get_user_roles(user_id: int) -> list:
    rows = db.fetch_all(
        """SELECT r.id, r.name, r.code, r.description, r.is_system
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = %s ORDER BY r.id""",
        (user_id,),
    )
    return [dict(r) for r in rows]


def user_has_permission(user_id: int, perm: str) -> bool:
    return perm in get_user_permissions(user_id)


# ============================================================================
# Auditoría
# ============================================================================
def audit(user_id, user_email, action, resource=None, resource_id=None, details=None):
    try:
        db.execute(
            """INSERT INTO audit_logs (user_id, user_email, action, resource, resource_id, details)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (user_id, user_email, action, resource, resource_id,
             db.to_json(details) if details is not None else None),
            returning=None,
        )
    except Exception:
        # La auditoría nunca debe romper la operación principal.
        pass
