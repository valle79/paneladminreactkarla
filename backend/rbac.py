"""
RBAC helper: catálogo de permisos/roles, siembra (seed) y consulta de permisos.

Se apoya en db.py (psycopg2, SQL crudo) tal como el resto del backend.
No guarda contraseñas en texto plano: el hash se genera en auth/password.py.
"""

import time

import db

# Caché en memoria de permisos/roles por usuario (TTL corto; se invalida sola).
_PERM_CACHE: dict = {}
_PERM_TTL = 30.0

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

    ("PIEZAS_VIEW", "piezas", "Ver piezas"),
    ("PIEZAS_CREATE", "piezas", "Crear piezas"),
    ("PIEZAS_UPDATE", "piezas", "Editar piezas"),
    ("PIEZAS_DELETE", "piezas", "Eliminar piezas"),

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

    ("SUPPLIERS_VIEW", "suppliers", "Ver proveedores"),
    ("SUPPLIERS_CREATE", "suppliers", "Crear proveedores"),
    ("SUPPLIERS_UPDATE", "suppliers", "Editar proveedores"),
    ("SUPPLIERS_DELETE", "suppliers", "Eliminar proveedores"),

    ("PURCHASES_VIEW", "purchases", "Ver compras"),
    ("PURCHASES_CREATE", "purchases", "Crear compras"),
    ("PURCHASES_UPDATE", "purchases", "Editar compras"),
    ("PURCHASES_DELETE", "purchases", "Anular/cancelar compras"),

    ("PURCHASE_ORDERS_VIEW", "purchase_orders", "Ver órdenes de compra"),
    ("PURCHASE_ORDERS_CREATE", "purchase_orders", "Crear órdenes de compra"),
    ("PURCHASE_ORDERS_UPDATE", "purchase_orders", "Editar órdenes de compra"),
    ("PURCHASE_ORDERS_DELETE", "purchase_orders", "Eliminar órdenes de compra"),

    ("PURCHASE_RECEIPTS_VIEW", "purchase_receipts", "Ver recepciones"),
    ("PURCHASE_RECEIPTS_CREATE", "purchase_receipts", "Crear recepciones"),
    ("PURCHASE_RECEIPTS_UPDATE", "purchase_receipts", "Editar recepciones"),
    ("PURCHASE_RECEIPTS_DELETE", "purchase_receipts", "Anular recepciones"),

    ("SUPPLIER_PAYMENTS_VIEW", "supplier_payments", "Ver pagos a proveedores"),
    ("SUPPLIER_PAYMENTS_CREATE", "supplier_payments", "Registrar pagos a proveedores"),
    ("SUPPLIER_PAYMENTS_UPDATE", "supplier_payments", "Editar/anular pagos a proveedores"),
    ("SUPPLIER_PAYMENTS_DELETE", "supplier_payments", "Anular pagos a proveedores"),

    ("IMPORTS_VIEW", "imports", "Ver importaciones"),
    ("IMPORTS_CREATE", "imports", "Crear importaciones"),
    ("IMPORTS_UPDATE", "imports", "Editar importaciones"),
    ("IMPORTS_DELETE", "imports", "Eliminar importaciones"),

    ("IMPORT_COSTS_VIEW", "import_costs", "Ver costos de importación"),
    ("IMPORT_COSTS_CREATE", "import_costs", "Registrar costos de importación"),
    ("IMPORT_COSTS_UPDATE", "import_costs", "Editar costos de importación"),
    ("IMPORT_COSTS_DELETE", "import_costs", "Eliminar costos de importación"),

    ("ACCOUNTS_PAYABLE_VIEW", "accounts_payable", "Ver cuentas por pagar"),
    ("PURCHASE_REPORTS_VIEW", "reports", "Ver reportes de compras"),
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
            + _crud("PRODUCTS") + _crud("SPARE_PARTS") + _crud("PIEZAS") + _crud("PROMOTIONS")
            + _crud("ADVISORS") + _crud("SERVICES") + _crud("CLIENTS") + _crud("SALES")
            + _crud("SUPPLIERS") + _crud("PURCHASES") + _crud("PURCHASE_ORDERS")
            + _crud("PURCHASE_RECEIPTS") + _crud("SUPPLIER_PAYMENTS")
            + _crud("IMPORTS") + _crud("IMPORT_COSTS") + ["ACCOUNTS_PAYABLE_VIEW", "PURCHASE_REPORTS_VIEW"]
        ),
    },
    "COMPRAS": {
        "name": "Compras",
        "description": "Área de compras: proveedores, compras nacionales e internacionales, órdenes, recepciones, importaciones y pagos.",
        "is_system": True,
        "permissions": (
            ["DASHBOARD_VIEW", "STATS_VIEW", "UPLOAD_FILES", "SETTINGS_VIEW"]
            + ["PRODUCTS_VIEW", "SPARE_PARTS_VIEW", "SERVICES_VIEW", "CLIENTS_VIEW"]
            + ["PIEZAS_VIEW", "PIEZAS_CREATE", "PIEZAS_UPDATE"]
            + _crud("SUPPLIERS") + _crud("PURCHASES") + _crud("PURCHASE_ORDERS")
            + _crud("PURCHASE_RECEIPTS") + _crud("SUPPLIER_PAYMENTS")
            + _crud("IMPORTS") + _crud("IMPORT_COSTS")
            + ["ACCOUNTS_PAYABLE_VIEW", "PURCHASE_REPORTS_VIEW"]
        ),
    },
    "ALMACEN": {
        "name": "Almacén",
        "description": "Gestiona recepción de mercadería e ingreso a inventario.",
        "is_system": True,
        "permissions": (
            ["DASHBOARD_VIEW", "STATS_VIEW", "UPLOAD_FILES"]
            + ["PRODUCTS_VIEW", "SPARE_PARTS_VIEW"]
            + ["SUPPLIERS_VIEW", "PURCHASES_VIEW", "PURCHASE_ORDERS_VIEW"]
            + ["PURCHASE_RECEIPTS_VIEW", "PURCHASE_RECEIPTS_CREATE", "PURCHASE_RECEIPTS_UPDATE"]
            + ["IMPORTS_VIEW", "SUPPLIER_PAYMENTS_VIEW", "ACCOUNTS_PAYABLE_VIEW"]
        ),
    },
    "CONTABILIDAD": {
        "name": "Contabilidad",
        "description": "Control financiero: cuentas por pagar, pagos y reportes de compras.",
        "is_system": True,
        "permissions": (
            ["DASHBOARD_VIEW", "STATS_VIEW", "SETTINGS_VIEW"]
            + ["SUPPLIERS_VIEW", "PURCHASES_VIEW", "PURCHASE_ORDERS_VIEW", "PURCHASE_RECEIPTS_VIEW"]
            + ["SUPPLIER_PAYMENTS_VIEW", "SUPPLIER_PAYMENTS_CREATE", "SUPPLIER_PAYMENTS_UPDATE"]
            + ["IMPORTS_VIEW", "IMPORT_COSTS_VIEW"]
            + ["ACCOUNTS_PAYABLE_VIEW", "PURCHASE_REPORTS_VIEW"]
        ),
    },
    "GERENCIA": {
        "name": "Gerencia",
        "description": "Visión ejecutiva del módulo de compras (solo lectura).",
        "is_system": True,
        "permissions": (
            ["DASHBOARD_VIEW", "STATS_VIEW", "SETTINGS_VIEW"]
            + ["SUPPLIERS_VIEW", "PURCHASES_VIEW", "PURCHASE_ORDERS_VIEW", "PURCHASE_RECEIPTS_VIEW"]
            + ["SUPPLIER_PAYMENTS_VIEW", "IMPORTS_VIEW", "IMPORT_COSTS_VIEW"]
            + ["ACCOUNTS_PAYABLE_VIEW", "PURCHASE_REPORTS_VIEW", "PRODUCTS_VIEW", "SPARE_PARTS_VIEW"]
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
    now = time.monotonic()
    hit = _PERM_CACHE.get(user_id)
    if hit and now - hit[0] < _PERM_TTL and hit[1] is not None:
        return hit[1]
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
    perms = {r["code"] for r in rows}
    if hit:
        hit[1] = perms
    else:
        _PERM_CACHE[user_id] = [now, perms, None]
    return perms


def invalidate_permissions(user_id: int = None):
    """Invalida la caché de un usuario (o de todos) tras cambios de roles/permisos."""
    if user_id is None:
        _PERM_CACHE.clear()
    else:
        _PERM_CACHE.pop(user_id, None)


def get_user_roles(user_id: int) -> list:
    now = time.monotonic()
    hit = _PERM_CACHE.get(user_id)
    if hit and now - hit[0] < _PERM_TTL and hit[2] is not None:
        return hit[2]
    rows = db.fetch_all(
        """SELECT r.id, r.name, r.code, r.description, r.is_system
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = %s ORDER BY r.id""",
        (user_id,),
    )
    roles = [dict(r) for r in rows]
    if hit:
        hit[2] = roles
    else:
        _PERM_CACHE[user_id] = [now, None, roles]
    return roles


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
