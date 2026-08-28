"""
API Backend - Panel Admin Iqueño SAC
FastAPI + PostgreSQL (Neon)

Ejecutar:  uvicorn main:app --reload --port 8000
"""

import os
import uuid
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import consulta_docs
import db
import rbac
import storage
import whatsapp
import admin_users
from auth import create_token, require_auth, get_current_user, require_permission
import password as pw

load_dotenv()

app = FastAPI(title="Iqueño SAC - API Panel Admin", version="1.0.0")

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# CORS por entorno: CORS_ORIGINS (separados por coma). En producción NO debe ser "*".
# Si se omite, se aplican estos orígenes por defecto (panel + web pública).
_default_origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://eliquenoimplementosagricolas.com",
    "https://www.eliquenoimplementosagricolas.com",
    "https://panelaiqueno.netlify.app",
]
_cors_env = os.getenv("CORS_ORIGINS", "").strip()
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()] if _cors_env else _default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(admin_users.router)


@app.on_event("startup")
def _startup_seed():
    """Siembra permisos y roles. No rompe el sistema si faltan tablas (p. ej. en local)."""
    try:
        rbac.seed_permissions()
        rbac.seed_roles()
    except Exception:
        # En un entorno sin las tablas RBAC aún, no bloqueamos el arranque.
        pass


ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".mp4", ".webm", ".mov"}
MAX_SIZE = 60 * 1024 * 1024  # 60 MB


def _conn_or_400(fn):
    """Envuelve llamadas a la BD para traducir errores a HTTP 400 legibles."""
    try:
        return fn()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error de base de datos: {e}")


# ============================================================================
# AUTH
# ============================================================================

class LoginRequest(BaseModel):
    password: str
    email: str | None = None


def _login_by_user(email: str, password: str) -> dict:
    """Autenticación basada en la tabla users (email + password con hash)."""
    row = db.fetch_one("SELECT * FROM users WHERE LOWER(email) = %s", (email.strip().lower(),))
    if not row or not pw.verify_password(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")
    if not row["active"]:
        raise HTTPException(status_code=403, detail="Este usuario está desactivado")
    db.execute("UPDATE users SET last_login_at = now() WHERE id = %s", (row["id"],), returning=None)
    rbac.audit(row["id"], row["email"], "login", "auth", row["id"], {})
    return row


def _ensure_legacy_super_admin() -> dict:
    """
    Migración segura: si el usuario administra con el acceso legacy (solo contraseña),
    aseguramos que exista un SUPER_ADMIN con las credenciales de .env.
    """
    email = os.getenv("ADMIN_EMAIL", "admin@iqueno.sac").strip().lower()
    password = os.getenv("ADMIN_PASSWORD", "") or os.getenv("AUTH_PASSWORD", "iqueño2026")
    row = db.fetch_one("SELECT * FROM users WHERE LOWER(email) = %s", (email,))
    role = db.fetch_one("SELECT id FROM roles WHERE code = 'SUPER_ADMIN'")
    if not row:
        row = db.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (%s,%s,%s) RETURNING *",
            ("Administrador", email, pw.hash_password(password)),
        )
    if role:
        db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                   (row["id"], role["id"]), returning=None)
    return dict(row)


@app.post("/api/auth/login")
def login(req: LoginRequest):
    if req.email and req.email.strip():
        # Login moderno: email + contraseña (usuarios de la tabla `users`)
        user = _login_by_user(req.email, req.password)
    else:
        # Legacy: única contraseña del panel -> migra al SUPER_ADMIN por defecto
        if req.password != os.getenv("AUTH_PASSWORD", "iqueño2026"):
            raise HTTPException(status_code=401, detail="Contraseña incorrecta")
        user = _ensure_legacy_super_admin()
    token = create_token({"sub": user["id"], "role": "user"})
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
        },
    }


@app.get("/api/auth/me")
def auth_me(current: dict = Depends(get_current_user)):
    return {
        "id": current["id"],
        "name": current["name"],
        "email": current["email"],
        "active": current["active"],
        "roles": current["roles"],
        "permissions": current["permissions"],
    }

# ============================================================================
# CONSULTA RENIEC (DNI) / SUNAT (RUC)
# ============================================================================

class DniConsultaRequest(BaseModel):
    dni: str


class RucConsultaRequest(BaseModel):
    ruc: str


@app.post("/api/consultar/dni")
def consultar_dni_endpoint(payload: DniConsultaRequest, _: dict = Depends(require_permission("CONSULTAR_DNI_RUC"))):
    try:
        return consulta_docs.consultar_dni(payload.dni)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=502, detail="Error al conectar con RENIEC")


@app.post("/api/consultar/ruc")
def consultar_ruc_endpoint(payload: RucConsultaRequest, _: dict = Depends(require_permission("CONSULTAR_DNI_RUC"))):
    try:
        return consulta_docs.consultar_ruc(payload.ruc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=502, detail="Error al conectar con SUNAT")


# ============================================================================
# DASHBOARD / STATS
# ============================================================================

@app.get("/api/stats")
def get_stats(_: dict = Depends(require_permission("STATS_VIEW"))):
    def stats():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT
                         (SELECT COUNT(*)::int FROM advisors WHERE NOT deleted) advisors,
                         (SELECT COUNT(*)::int FROM machine_products WHERE NOT deleted) products,
                         (SELECT COUNT(*)::int FROM spare_parts WHERE NOT deleted) spare_parts,
                         (SELECT COUNT(*)::int FROM clients WHERE NOT deleted) clients,
                         (SELECT COUNT(*)::int FROM clients_ruc WHERE NOT deleted) clients_ruc,
                         (SELECT COUNT(*)::int FROM sales WHERE NOT deleted) sales,
                         (SELECT COUNT(*)::int FROM promotions WHERE is_active) promotions,
                         (SELECT COALESCE(SUM(subtotal),0)::float FROM sales WHERE NOT deleted AND payment_status <> 'por_pagar') subtotal,
                         (SELECT COALESCE(SUM(igv),0)::float FROM sales WHERE NOT deleted AND payment_status <> 'por_pagar') igv,
                         (SELECT COALESCE(SUM(total),0)::float FROM sales WHERE NOT deleted AND payment_status <> 'por_pagar') total"""
                )
                row = cur.fetchone()
                cur.execute(
                    """SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') mes,
                              COALESCE(SUM(total),0)::float total
                       FROM sales WHERE NOT deleted
                       GROUP BY 1 ORDER BY 1 DESC LIMIT 6"""
                )
                monthly = [dict(r) for r in cur.fetchall()]
                cur.execute(
                    """SELECT id, invoice_type, invoice_number, total,
                              payment_status, payment_date, created_at
                       FROM sales WHERE NOT deleted ORDER BY created_at DESC LIMIT 5"""
                )
                recent = [dict(r) for r in cur.fetchall()]
        finally:
            db.close_conn(conn)
        return {
            "counts": {
                "advisors": row["advisors"],
                "products": row["products"],
                "spare_parts": row["spare_parts"],
                "clients": row["clients"],
                "clients_ruc": row["clients_ruc"],
                "sales": row["sales"],
                "promotions": row["promotions"],
            },
            "totals": {
                "subtotal": row["subtotal"],
                "igv": row["igv"],
                "total": row["total"],
            },
            "monthly": monthly,
            "recent": recent,
        }
    return _conn_or_400(stats)


# ============================================================================
# HELPERS GENÉRICOS
# ============================================================================

def paginate_query(base_query: str, page: int = 1, limit: int = 50, order_by: str = "id") -> tuple[str, int, int]:
    """
    Genera consulta paginada y calcula offset.
    
    Returns:
        (query_paginada, offset, limit)
    """
    page = max(1, page)
    limit = min(max(1, limit), 100)  # Máximo 100 registros por página
    offset = (page - 1) * limit
    paginated = f"{base_query} ORDER BY {order_by} LIMIT {limit} OFFSET {offset}"
    return paginated, offset, limit


def get_total_count(table: str, where_clause: str = "") -> int:
    """Obtiene el conteo total de registros."""
    wh = f"WHERE {where_clause}" if where_clause else ""
    row = db.fetch_one(f"SELECT COUNT(*)::int as total FROM {table} {wh}")
    return row["total"]


class SoftDeleteMixin:
    table: str
    json_cols: tuple = ()

    def hydrate(self, row: dict | None) -> dict | None:
        if not row:
            return None
        for c in self.json_cols:
            if c in row:
                row[c] = db.from_json(row[c])
        return row

    def list(self, include_deleted=False, page: int = 1, limit: int = 50):
        wh = "" if include_deleted else "WHERE NOT deleted"
        
        # Obtener total
        total = get_total_count(self.table, "" if include_deleted else "NOT deleted")
        
        # Consulta paginada
        page = max(1, page)
        limit = min(max(1, limit), 100)
        offset = (page - 1) * limit
        
        rows = db.fetch_all(
            f"SELECT * FROM {self.table} {wh} ORDER BY id DESC LIMIT {limit} OFFSET {offset}"
        )
        
        items = [self.hydrate(dict(r)) for r in rows]
        
        return {
            "items": items,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "total_pages": (total + limit - 1) // limit  # Ceil division
            }
        }

    def get(self, item_id):
        row = db.fetch_one(f"SELECT * FROM {self.table} WHERE id = %s", (item_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Registro no encontrado")
        return self.hydrate(dict(row))

    def create(self, payload: dict):
        data = {**payload}
        for c in self.json_cols:
            if c in data and data[c] is not None and not isinstance(data[c], str):
                data[c] = db.to_json(data[c])
        cols = [k for k in data.keys()]
        vals = [data[k] for k in cols]
        placeholders = ", ".join(["%s"] * len(vals))
        sql = f"INSERT INTO {self.table} ({', '.join(cols)}) VALUES ({placeholders}) RETURNING *"
        row = db.execute(sql, vals)
        return self.hydrate(dict(row))

    def update(self, item_id, payload: dict):
        self.get(item_id)
        data = {**payload}
        for c in self.json_cols:
            if c in data and data[c] is not None and not isinstance(data[c], str):
                data[c] = db.to_json(data[c])
        if not data:
            return self.get(item_id)
        sets = ", ".join([f"{k} = %s" for k in data.keys()])
        sql = f"UPDATE {self.table} SET {sets} WHERE id = %s RETURNING *"
        row = db.execute(sql, [*data.values(), item_id])
        return self.hydrate(dict(row))

    def soft_delete(self, item_id):
        self.get(item_id)
        db.execute(f"UPDATE {self.table} SET deleted = true WHERE id = %s", (item_id,), returning=None)
        return {"ok": True}

    def restore(self, item_id):
        db.execute(f"UPDATE {self.table} SET deleted = false WHERE id = %s", (item_id,), returning=None)
        return {"ok": True}


# ============================================================================
# ASESORES
# ============================================================================

class AdvisorMixin(SoftDeleteMixin):
    table = "advisors"
    json_cols = ("specialties",)


advisors_crud = AdvisorMixin()


@app.get("/api/advisors")
def list_advisors(include_deleted: bool = False, page: int = 1, limit: int = 50, _: dict = Depends(require_permission("ADVISORS_VIEW"))):
    return _conn_or_400(lambda: advisors_crud.list(include_deleted, page, limit))


@app.post("/api/advisors")
def create_advisor(payload: dict, actor: dict = Depends(require_permission("ADVISORS_CREATE"))):
    item = _conn_or_400(lambda: advisors_crud.create(payload))
    rbac.audit(actor["id"], actor["email"], "create", "advisors", item["id"], {"name": payload.get("name")})
    return item


@app.put("/api/advisors/{item_id}")
def update_advisor(item_id: int, payload: dict, actor: dict = Depends(require_permission("ADVISORS_UPDATE"))):
    item = _conn_or_400(lambda: advisors_crud.update(item_id, payload))
    rbac.audit(actor["id"], actor["email"], "update", "advisors", item_id, {"name": payload.get("name")})
    return item


@app.delete("/api/advisors/{item_id}")
def delete_advisor(item_id: int, actor: dict = Depends(require_permission("ADVISORS_DELETE"))):
    res = _conn_or_400(lambda: advisors_crud.soft_delete(item_id))
    rbac.audit(actor["id"], actor["email"], "delete", "advisors", item_id, {})
    return res


@app.post("/api/advisors/{item_id}/restore")
def restore_advisor(item_id: int, actor: dict = Depends(require_permission("ADVISORS_DELETE"))):
    res = _conn_or_400(lambda: advisors_crud.restore(item_id))
    rbac.audit(actor["id"], actor["email"], "restore", "advisors", item_id, {})
    return res


# ============================================================================
# PRODUCTOS (Galería)
# ============================================================================

class ProductMixin(SoftDeleteMixin):
    table = "machine_products"
    json_cols = ("specifications", "features", "dimensions")


products_crud = ProductMixin()


@app.get("/api/products")
def list_products(include_deleted: bool = False, page: int = 1, limit: int = 50, _: dict = Depends(require_permission("PRODUCTS_VIEW"))):
    return _conn_or_400(lambda: products_crud.list(include_deleted, page, limit))


@app.post("/api/products")
def create_product(payload: dict, actor: dict = Depends(require_permission("PRODUCTS_CREATE"))):
    item = _conn_or_400(lambda: products_crud.create(payload))
    rbac.audit(actor["id"], actor["email"], "create", "products", item["id"], {"name": payload.get("name")})
    return item


@app.put("/api/products/{item_id}")
def update_product(item_id: int, payload: dict, actor: dict = Depends(require_permission("PRODUCTS_UPDATE"))):
    item = _conn_or_400(lambda: products_crud.update(item_id, payload))
    rbac.audit(actor["id"], actor["email"], "update", "products", item_id, {"name": payload.get("name")})
    return item


@app.delete("/api/products/{item_id}")
def delete_product(item_id: int, actor: dict = Depends(require_permission("PRODUCTS_DELETE"))):
    res = _conn_or_400(lambda: products_crud.soft_delete(item_id))
    rbac.audit(actor["id"], actor["email"], "delete", "products", item_id, {})
    return res


@app.post("/api/products/{item_id}/restore")
def restore_product(item_id: int, actor: dict = Depends(require_permission("PRODUCTS_DELETE"))):
    res = _conn_or_400(lambda: products_crud.restore(item_id))
    rbac.audit(actor["id"], actor["email"], "restore", "products", item_id, {})
    return res


# ============================================================================
# REPUESTOS
# ============================================================================

class SparePartMixin(SoftDeleteMixin):
    table = "spare_parts"
    json_cols = ("specifications", "features")


spare_parts_crud = SparePartMixin()


@app.get("/api/spare-parts")
def list_spare_parts(include_deleted: bool = False, page: int = 1, limit: int = 50, _: dict = Depends(require_permission("SPARE_PARTS_VIEW"))):
    return _conn_or_400(lambda: spare_parts_crud.list(include_deleted, page, limit))


@app.post("/api/spare-parts")
def create_spare_part(payload: dict, actor: dict = Depends(require_permission("SPARE_PARTS_CREATE"))):
    item = _conn_or_400(lambda: spare_parts_crud.create(payload))
    rbac.audit(actor["id"], actor["email"], "create", "spare_parts", item["id"], {"name": payload.get("name")})
    return item


@app.put("/api/spare-parts/{item_id}")
def update_spare_part(item_id: int, payload: dict, actor: dict = Depends(require_permission("SPARE_PARTS_UPDATE"))):
    item = _conn_or_400(lambda: spare_parts_crud.update(item_id, payload))
    rbac.audit(actor["id"], actor["email"], "update", "spare_parts", item_id, {"name": payload.get("name")})
    return item


@app.delete("/api/spare-parts/{item_id}")
def delete_spare_part(item_id: int, actor: dict = Depends(require_permission("SPARE_PARTS_DELETE"))):
    res = _conn_or_400(lambda: spare_parts_crud.soft_delete(item_id))
    rbac.audit(actor["id"], actor["email"], "delete", "spare_parts", item_id, {})
    return res


@app.post("/api/spare-parts/{item_id}/restore")
def restore_spare_part(item_id: int, actor: dict = Depends(require_permission("SPARE_PARTS_DELETE"))):
    res = _conn_or_400(lambda: spare_parts_crud.restore(item_id))
    rbac.audit(actor["id"], actor["email"], "restore", "spare_parts", item_id, {})
    return res


# ============================================================================
# API PÚBLICA (web pública iquenosac) — sin autenticación
# Devuelve solo registros activos (no borrados y con status = 'active').
# ============================================================================

_PUBLIC_ALLOWED = {"advisors", "products", "spare-parts"}
# productos y repuestos tienen columnas stock/status y usan deleted para borrado
_PUBLIC_ORDER = {
    "advisors": "id",
    "products": "id",
    "spare-parts": "id",
    "promotions": "display_order ASC NULLS LAST, created_at DESC NULLS LAST",
}


def _public_rows(table: str) -> list:
    if table not in ("advisors", "machine_products", "spare_parts", "promotions"):
        raise HTTPException(status_code=404, detail="Recurso no encontrado")
    order_key = table if table != "machine_products" else "products"
    order_key = order_key if order_key != "spare_parts" else "spare-parts"
    if table == "promotions":
        sql = f"SELECT * FROM {table} WHERE is_active = true AND show_in_web = true ORDER BY {_PUBLIC_ORDER['promotions']}"
    elif table == "advisors":
        sql = f"SELECT * FROM {table} WHERE NOT deleted ORDER BY {_PUBLIC_ORDER['advisors']}"
    else:
        sql = f"SELECT * FROM {table} WHERE NOT deleted AND status = 'active' ORDER BY {_PUBLIC_ORDER[order_key]}"
    rows = db.fetch_all(sql)
    mixin = {"advisors": advisors_crud, "machine_products": products_crud,
             "spare_parts": spare_parts_crud}.get(table)
    return [mixin.hydrate(dict(r)) for r in rows] if mixin else [dict(r) for r in rows]


@app.get("/public/advisors")
def public_advisors():
    return _conn_or_400(lambda: _public_rows("advisors"))


@app.get("/public/products")
def public_products():
    return _conn_or_400(lambda: _public_rows("machine_products"))


@app.get("/public/spare-parts")
def public_spare_parts():
    return _conn_or_400(lambda: _public_rows("spare_parts"))


@app.get("/public/promotions")
def public_promotions():
    return _conn_or_400(lambda: _public_rows("promotions"))


# ============================================================================
# SERVICIOS
# ============================================================================

class ServiceMixin(SoftDeleteMixin):
    table = "services"


services_crud = ServiceMixin()


@app.get("/api/services")
def list_services(include_deleted: bool = False, page: int = 1, limit: int = 50, _: dict = Depends(require_permission("SERVICES_VIEW"))):
    return _conn_or_400(lambda: services_crud.list(include_deleted, page, limit))


@app.post("/api/services")
def create_service(payload: dict, actor: dict = Depends(require_permission("SERVICES_CREATE"))):
    item = _conn_or_400(lambda: services_crud.create(payload))
    rbac.audit(actor["id"], actor["email"], "create", "services", item["id"], {"name": payload.get("name")})
    return item


@app.put("/api/services/{item_id}")
def update_service(item_id: int, payload: dict, actor: dict = Depends(require_permission("SERVICES_UPDATE"))):
    item = _conn_or_400(lambda: services_crud.update(item_id, payload))
    rbac.audit(actor["id"], actor["email"], "update", "services", item_id, {"name": payload.get("name")})
    return item


@app.delete("/api/services/{item_id}")
def delete_service(item_id: int, actor: dict = Depends(require_permission("SERVICES_DELETE"))):
    res = _conn_or_400(lambda: services_crud.soft_delete(item_id))
    rbac.audit(actor["id"], actor["email"], "delete", "services", item_id, {})
    return res


@app.post("/api/services/{item_id}/restore")
def restore_service(item_id: int, actor: dict = Depends(require_permission("SERVICES_DELETE"))):
    res = _conn_or_400(lambda: services_crud.restore(item_id))
    rbac.audit(actor["id"], actor["email"], "restore", "services", item_id, {})
    return res


# ============================================================================
# CLIENTES DNI
# ============================================================================

class ClientMixin(SoftDeleteMixin):
    table = "clients"


clients_crud = ClientMixin()


@app.get("/api/clients")
def list_clients(include_deleted: bool = False, page: int = 1, limit: int = 50, _: dict = Depends(require_permission("CLIENTS_VIEW"))):
    return _conn_or_400(lambda: clients_crud.list(include_deleted, page, limit))


@app.post("/api/clients")
def create_client(payload: dict, actor: dict = Depends(require_permission("CLIENTS_CREATE"))):
    item = _conn_or_400(lambda: clients_crud.create(payload))
    rbac.audit(actor["id"], actor["email"], "create", "clients", item["id"], {"dni": payload.get("dni")})
    return item


@app.put("/api/clients/{item_id}")
def update_client(item_id: int, payload: dict, actor: dict = Depends(require_permission("CLIENTS_UPDATE"))):
    item = _conn_or_400(lambda: clients_crud.update(item_id, payload))
    rbac.audit(actor["id"], actor["email"], "update", "clients", item_id, {"dni": payload.get("dni")})
    return item


@app.delete("/api/clients/{item_id}")
def delete_client(item_id: int, actor: dict = Depends(require_permission("CLIENTS_DELETE"))):
    res = _conn_or_400(lambda: clients_crud.soft_delete(item_id))
    rbac.audit(actor["id"], actor["email"], "delete", "clients", item_id, {})
    return res


@app.post("/api/clients/{item_id}/restore")
def restore_client(item_id: int, actor: dict = Depends(require_permission("CLIENTS_DELETE"))):
    res = _conn_or_400(lambda: clients_crud.restore(item_id))
    rbac.audit(actor["id"], actor["email"], "restore", "clients", item_id, {})
    return res


# ============================================================================
# CLIENTES RUC (Empresas)
# ============================================================================

class ClientRucMixin(SoftDeleteMixin):
    table = "clients_ruc"


clients_ruc_crud = ClientRucMixin()


@app.get("/api/clients-ruc")
def list_clients_ruc(include_deleted: bool = False, page: int = 1, limit: int = 50, _: dict = Depends(require_permission("CLIENTS_VIEW"))):
    return _conn_or_400(lambda: clients_ruc_crud.list(include_deleted, page, limit))


@app.post("/api/clients-ruc")
def create_client_ruc(payload: dict, actor: dict = Depends(require_permission("CLIENTS_CREATE"))):
    item = _conn_or_400(lambda: clients_ruc_crud.create(payload))
    rbac.audit(actor["id"], actor["email"], "create", "clients_ruc", item["id"], {"ruc": payload.get("ruc")})
    return item


@app.put("/api/clients-ruc/{item_id}")
def update_client_ruc(item_id: int, payload: dict, actor: dict = Depends(require_permission("CLIENTS_UPDATE"))):
    item = _conn_or_400(lambda: clients_ruc_crud.update(item_id, payload))
    rbac.audit(actor["id"], actor["email"], "update", "clients_ruc", item_id, {"ruc": payload.get("ruc")})
    return item


@app.delete("/api/clients-ruc/{item_id}")
def delete_client_ruc(item_id: int, actor: dict = Depends(require_permission("CLIENTS_DELETE"))):
    res = _conn_or_400(lambda: clients_ruc_crud.soft_delete(item_id))
    rbac.audit(actor["id"], actor["email"], "delete", "clients_ruc", item_id, {})
    return res


@app.post("/api/clients-ruc/{item_id}/restore")
def restore_client_ruc(item_id: int, actor: dict = Depends(require_permission("CLIENTS_DELETE"))):
    res = _conn_or_400(lambda: clients_ruc_crud.restore(item_id))
    rbac.audit(actor["id"], actor["email"], "restore", "clients_ruc", item_id, {})
    return res


# ============================================================================
# PROMOCIONES (eliminación física)
# ============================================================================

class PromotionMixin(SoftDeleteMixin):
    table = "promotions"
    json_cols = ()

    def create(self, payload: dict):
        data = {**payload}
        next_order = db.fetch_one("SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM promotions")["n"]
        data["display_order"] = next_order
        return super().create(data)

    def list(self, include_deleted=False, page: int = 1, limit: int = 50):
        # Obtener total
        total = get_total_count(self.table, "")
        
        # Paginación
        page = max(1, page)
        limit = min(max(1, limit), 100)
        offset = (page - 1) * limit
        
        rows = db.fetch_all(
            f"SELECT * FROM promotions ORDER BY display_order, created_at DESC LIMIT {limit} OFFSET {offset}"
        )
        
        return {
            "items": [dict(r) for r in rows],
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "total_pages": (total + limit - 1) // limit
            }
        }

    def get(self, item_id):
        row = db.fetch_one("SELECT * FROM promotions WHERE id = %s", (item_id,))
        if not row:
            raise HTTPException(status_code=404, detail="Promoción no encontrada")
        return dict(row)

    def soft_delete(self, item_id):
        self.get(item_id)
        db.execute("DELETE FROM promotions WHERE id = %s", (item_id,), returning=None)
        return {"ok": True}


promotions_crud = PromotionMixin()


@app.get("/api/promotions")
def list_promotions(only_web: bool = False, page: int = 1, limit: int = 50, _: dict = Depends(require_permission("PROMOTIONS_VIEW"))):
    def run():
        if only_web:
            # Sin paginación para web pública
            rows = db.fetch_all(
                "SELECT * FROM promotions WHERE is_active AND show_in_web "
                "ORDER BY display_order, created_at DESC"
            )
            return {"items": [dict(r) for r in rows]}
        return promotions_crud.list(False, page, limit)
    return _conn_or_400(run)


@app.post("/api/promotions")
def create_promotion(payload: dict, actor: dict = Depends(require_permission("PROMOTIONS_CREATE"))):
    item = _conn_or_400(lambda: promotions_crud.create(payload))
    rbac.audit(actor["id"], actor["email"], "create", "promotions", item["id"], {"title": payload.get("title")})
    return item


@app.put("/api/promotions/{item_id}")
def update_promotion(item_id: str, payload: dict, actor: dict = Depends(require_permission("PROMOTIONS_UPDATE"))):
    item = _conn_or_400(lambda: promotions_crud.update(item_id, payload))
    rbac.audit(actor["id"], actor["email"], "update", "promotions", item_id, {"title": payload.get("title")})
    return item


@app.delete("/api/promotions/{item_id}")
def delete_promotion(item_id: str, actor: dict = Depends(require_permission("PROMOTIONS_DELETE"))):
    res = _conn_or_400(lambda: promotions_crud.soft_delete(item_id))
    rbac.audit(actor["id"], actor["email"], "delete", "promotions", item_id, {})
    return res


# ============================================================================
# VENTAS
# ============================================================================

def _next_invoice_number(invoice_type: str) -> int:
    row = db.fetch_one(
        "SELECT COALESCE(MAX(invoice_number), 0) AS max_n FROM sales "
        "WHERE invoice_type = %s AND NOT deleted",
        (invoice_type,),
    )
    return int(row["max_n"]) + 1


def _resolve_item_details_batch(items: list[dict], catalogs: dict) -> None:
    """Enriquece los items con datos del catálogo usando dicts ya cargados."""
    for it in items:
        base = {"name": it.get("manual_name") or "Item"}
        if it.get("manual_name"):
            base["is_manual"] = True
        else:
            table = {
                "machine": "machine_products",
                "repuesto": "spare_parts",
                "service": "services",
            }.get(it.get("item_type"))
            if table and it.get("item_id"):
                row = catalogs.get(table, {}).get(it["item_id"])
                if row:
                    base = dict(row)
                    base["is_manual"] = False
        it["name"] = base.get("name") or it["manual_name"] or "Item"
        it["description"] = base.get("description")
        it["specifications"] = base.get("specifications") or []
        it["features"] = base.get("features") or []
        it["image_url"] = base.get("image_url")
        it["is_manual"] = base.get("is_manual", not it.get("item_id"))

        ov = it.get("overrides")
        if isinstance(ov, dict):
            if ov.get("description") is not None:
                it["description"] = ov["description"]
            if isinstance(ov.get("specifications"), list):
                it["specifications"] = ov["specifications"]
            if isinstance(ov.get("features"), list):
                it["features"] = ov["features"]


def _load_catalog_batch_cur(items: list[dict], cur) -> dict:
    """Igual que _load_catalog_batch pero reutilizando un cursor (una sola conexión)."""
    ids = {"machine_products": set(), "spare_parts": set(), "services": set()}
    for it in items:
        table = {
            "machine": "machine_products",
            "repuesto": "spare_parts",
            "service": "services",
        }.get(it.get("item_type"))
        if table and it.get("item_id"):
            ids[table].add(it["item_id"])
    catalogs = {}
    for table, table_ids in ids.items():
        if not table_ids:
            catalogs[table] = {}
            continue
        cols = "name, description, specifications, features, image_url"
        if table == "services":
            cols = "name"
        cur.execute(
            f"SELECT id, {cols} FROM {table} WHERE id = ANY(%s) AND NOT deleted",
            (list(table_ids),),
        )
        catalogs[table] = {}
        for r in cur.fetchall():
            item = dict(r)
            item["specifications"] = db.from_json(item.get("specifications"))
            item["features"] = db.from_json(item.get("features"))
            catalogs[table][item["id"]] = item
    return catalogs


def _serialize_sales(rows) -> list:
    """Serializa muchas ventas a la vez (volcado por lotes para evitar N+1)."""
    if not rows:
        return []
    sale_ids = [r["id"] for r in rows]

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM sale_items WHERE sale_id = ANY(%s) ORDER BY sale_id, id",
                (sale_ids,),
            )
            items_rows = cur.fetchall()

            items_by_sale = {}
            all_items = []
            for it in items_rows:
                it = dict(it)
                if it.get("overrides"):
                    it["overrides"] = db.from_json(it["overrides"])
                items_by_sale.setdefault(it["sale_id"], []).append(it)
                all_items.append(it)

            catalogs = _load_catalog_batch_cur(all_items, cur)
            _resolve_item_details_batch(all_items, catalogs)

            client_ids = list({r["client_id"] for r in rows if r.get("client_id")})
            advisor_ids = list({r["advisor_id"] for r in rows if r.get("advisor_id")})
            clients_dni = {}
            clients_ruc = {}
            advisors = {}
            if client_ids:
                cur.execute(
                    "SELECT id, names, last_names, dni, phone, deleted FROM clients WHERE id = ANY(%s)",
                    (client_ids,),
                )
                for c in cur.fetchall():
                    clients_dni[c["id"]] = dict(c)
                cur.execute(
                    "SELECT id, razonsocial, ruc, telefonos, deleted FROM clients_ruc WHERE id = ANY(%s)",
                    (client_ids,),
                )
                for c in cur.fetchall():
                    clients_ruc[c["id"]] = dict(c)
            if advisor_ids:
                cur.execute(
                    "SELECT id, name FROM advisors WHERE id = ANY(%s)",
                    (advisor_ids,),
                )
                for a in cur.fetchall():
                    advisors[a["id"]] = dict(a)

        out = []
        for row in rows:
            sale = dict(row)
            sale["items"] = [dict(x) for x in items_by_sale.get(sale["id"], [])]
            if sale.get("client_id"):
                if sale.get("client_type") == "ruc":
                    sale["client"] = clients_ruc.get(sale["client_id"]) or None
                else:
                    sale["client"] = clients_dni.get(sale["client_id"]) or None
            else:
                sale["client"] = None
            sale["advisor"] = advisors.get(sale["advisor_id"]) or None
            sale.pop("share_token", None)
            out.append(sale)
        return out
    finally:
        db.close_conn(conn)


def _serialize_sale(row: dict) -> dict:
    return _serialize_sales([row])[0]


@app.get("/api/sales")
def list_sales(
    include_deleted: bool = False,
    page: int = 1,
    limit: int = 50,
    date_from: str = None,
    date_to: str = None,
    _: dict = Depends(require_permission("SALES_VIEW")),
):
    def valid_date(v: str) -> bool:
        try:
            from datetime import datetime as _dt
            _dt.strptime(v, "%Y-%m-%d")
            return True
        except ValueError:
            return False

    def run():
        conds = [] if include_deleted else ["NOT deleted"]
        params: list = []
        if date_from:
            if not valid_date(date_from):
                raise HTTPException(status_code=400, detail="date_from debe tener formato YYYY-MM-DD")
            conds.append("created_at::date >= %s")
            params.append(date_from)
        if date_to:
            if not valid_date(date_to):
                raise HTTPException(status_code=400, detail="date_to debe tener formato YYYY-MM-DD")
            conds.append("created_at::date <= %s")
            params.append(date_to)

        wh = f"WHERE {' AND '.join(conds)}" if conds else ""

        # Paginación
        page_num = max(1, page)
        page_limit = min(max(1, limit), 100)
        offset = (page_num - 1) * page_limit

        # Conteo + filas en UNA consulta (window function) para evitar un round-trip extra
        rows = db.fetch_all(
            f"SELECT s.*, COUNT(*) OVER() AS _total FROM sales s {wh} ORDER BY created_at DESC, id DESC LIMIT {page_limit} OFFSET {offset}",
            params or None,
        )
        total = rows[0]["_total"] if rows else 0
        for r in rows:
            r.pop("_total", None)

        return {
            "items": _serialize_sales(rows),
            "pagination": {
                "page": page_num,
                "limit": page_limit,
                "total": total,
                "total_pages": (total + page_limit - 1) // page_limit
            }
        }
    return _conn_or_400(run)


@app.get("/api/sales/next-number")
def next_sale_number(invoice_type: str, _: dict = Depends(require_permission("SALES_VIEW"))):
    def run():
        row = db.fetch_one(
            "SELECT COALESCE(MAX(invoice_number), 0) AS max_n FROM sales "
            "WHERE invoice_type = %s AND NOT deleted",
            (invoice_type,),
        )
        return {"next_number": int(row["max_n"]) + 1}
    return _conn_or_400(run)


@app.get("/api/sales/{sale_id}")
def get_sale(sale_id: int, _: dict = Depends(require_permission("SALES_VIEW"))):
    def run():
        row = db.fetch_one("SELECT * FROM sales WHERE id = %s", (sale_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Venta no encontrada")
        return _serialize_sale(dict(row))
    return _conn_or_400(run)


@app.post("/api/sales/{sale_id}/share-token")
def get_share_token(sale_id: int, _: dict = Depends(require_permission("SALES_VIEW"))):
    def run():
        row = db.fetch_one("SELECT share_token FROM sales WHERE id = %s AND NOT deleted", (sale_id,))
        if not row:
            raise HTTPException(status_code=404, detail="Venta no encontrada")
        token = row["share_token"]
        if not token:
            token = uuid.uuid4().hex
            db.execute("UPDATE sales SET share_token = %s WHERE id = %s", (token, sale_id), returning=None)
        return {"share_token": token}
    return _conn_or_400(run)


@app.get("/api/public-doc/{sale_id}/{token}")
def public_doc(sale_id: int, token: str):
    row = db.fetch_one("SELECT * FROM sales WHERE id = %s", (sale_id,))
    if not row or row.get("deleted") or not row.get("share_token"):
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    if row["share_token"] != token:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return _serialize_sale(dict(row))


@app.post("/api/sales")
def create_sale(payload: dict, actor: dict = Depends(require_permission("SALES_CREATE"))):
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COALESCE(MAX(invoice_number), 0) AS max_n FROM sales "
                    "WHERE invoice_type = %s AND NOT deleted",
                    (payload.get("invoice_type"),),
                )
                max_n = cur.fetchone()["max_n"]

                if payload.get("invoice_number") in (None, "", 0):
                    invoice_number = int(max_n) + 1
                else:
                    invoice_number = int(payload["invoice_number"])
                    cur.execute(
                        "SELECT id FROM sales WHERE invoice_type = %s AND invoice_number = %s AND NOT deleted",
                        (payload.get("invoice_type"), invoice_number),
                    )
                    if cur.fetchone():
                        raise HTTPException(
                            status_code=400,
                            detail=f"El número {invoice_number} ya existe para ese tipo de documento",
                        )

                data = {
                    "client_id": payload.get("client_id"),
                    "client_type": payload.get("client_type"),
                    "advisor_id": payload.get("advisor_id"),
                    "with_igv": bool(payload.get("with_igv", False)),
                    "subtotal": payload.get("subtotal", 0),
                    "igv": payload.get("igv", 0),
                    "total": payload.get("total", 0),
                    "invoice_type": payload.get("invoice_type"),
                    "invoice_number": invoice_number,
                    "share_token": uuid.uuid4().hex,
                    "payment_status": payload.get("payment_status", "por_pagar"),
                    "payment_description": payload.get("payment_description"),
                    "payment_date": payload.get("payment_date") or (
                        date.today().isoformat() if payload.get("payment_status") == "pagado" else None
                    ),
                    "amount_paid": payload.get("amount_paid"),
                    "amount_pending": payload.get("amount_pending"),
                    "pending_payment_date": payload.get("pending_payment_date"),
                }
                cols = ", ".join(data.keys())
                ph = ", ".join(["%s"] * len(data))
                cur.execute(
                    f"INSERT INTO sales ({cols}) VALUES ({ph}) RETURNING *",
                    list(data.values()),
                )
                sale_row = dict(cur.fetchone())

                for item in payload.get("items", []):
                    cur.execute(
                        """INSERT INTO sale_items
                           (sale_id, item_type, item_id, manual_name, manual_description,
                            overrides, quantity, unit_price)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            sale_row["id"],
                            item.get("item_type"),
                            item.get("item_id"),
                            item.get("manual_name"),
                            item.get("manual_description"),
                            db.to_json(item.get("overrides")),
                            item.get("quantity", 1),
                            item.get("unit_price", 0),
                        ),
                    )
            conn.commit()
            rbac.audit(actor["id"], actor["email"], "create", "sales", sale_row["id"],
                       {"invoice": f"{sale_row.get('invoice_type')}-{sale_row.get('invoice_number')}",
                        "total": float(sale_row.get("total") or 0)})
            return _serialize_sale(sale_row)
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al guardar la venta: {e}")
        finally:
            db.close_conn(conn)
    return _conn_or_400(run)


@app.put("/api/sales/{sale_id}")
def update_sale(sale_id: int, payload: dict, actor: dict = Depends(require_permission("SALES_UPDATE"))):
    def run():
        existing = db.fetch_one("SELECT * FROM sales WHERE id = %s", (sale_id,))
        if not existing or existing.get("deleted"):
            raise HTTPException(status_code=404, detail="Venta no encontrada")

        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                invoice_number = payload.get("invoice_number") or existing["invoice_number"]
                cur.execute(
                    "SELECT id FROM sales WHERE invoice_type = %s AND invoice_number = %s "
                    "AND NOT deleted AND id <> %s",
                    (payload.get("invoice_type", existing["invoice_type"]), invoice_number, sale_id),
                )
                if cur.fetchone():
                    raise HTTPException(
                        status_code=400,
                        detail=f"El número {invoice_number} ya existe para ese tipo de documento",
                    )

                data = {
                    "client_id": payload.get("client_id"),
                    "client_type": payload.get("client_type"),
                    "advisor_id": payload.get("advisor_id"),
                    "with_igv": bool(payload.get("with_igv", existing["with_igv"])),
                    "subtotal": payload.get("subtotal", existing["subtotal"]),
                    "igv": payload.get("igv", existing["igv"]),
                    "total": payload.get("total", existing["total"]),
                    "invoice_type": payload.get("invoice_type", existing["invoice_type"]),
                    "invoice_number": invoice_number,
                    "payment_status": payload.get("payment_status", existing["payment_status"]),
                    "payment_description": payload.get("payment_description"),
                    "payment_date": payload.get("payment_date"),
                    "amount_paid": payload.get("amount_paid"),
                    "amount_pending": payload.get("amount_pending"),
                    "pending_payment_date": payload.get("pending_payment_date"),
                }
                if not data["payment_date"]:
                    if data["payment_status"] == "pagado":
                        data["payment_date"] = existing.get("payment_date") or date.today().isoformat()
                    else:
                        data["payment_date"] = None
                sets = ", ".join([f"{k} = %s" for k in data.keys()])
                cur.execute(
                    f"UPDATE sales SET {sets} WHERE id = %s RETURNING *",
                    [*data.values(), sale_id],
                )
                sale_row = dict(cur.fetchone())

                cur.execute("DELETE FROM sale_items WHERE sale_id = %s", (sale_id,))
                for item in payload.get("items", []):
                    cur.execute(
                        """INSERT INTO sale_items
                           (sale_id, item_type, item_id, manual_name, manual_description,
                            overrides, quantity, unit_price)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            sale_id,
                            item.get("item_type"),
                            item.get("item_id"),
                            item.get("manual_name"),
                            item.get("manual_description"),
                            db.to_json(item.get("overrides")),
                            item.get("quantity", 1),
                            item.get("unit_price", 0),
                        ),
                    )
            conn.commit()
            rbac.audit(actor["id"], actor["email"], "update", "sales", sale_id,
                       {"invoice": f"{sale_row.get('invoice_type')}-{sale_row.get('invoice_number')}",
                        "total": float(sale_row.get("total") or 0)})
            return _serialize_sale(sale_row)
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al actualizar la venta: {e}")
        finally:
            db.close_conn(conn)
    return _conn_or_400(run)


@app.patch("/api/sales/{sale_id}/payment")
def update_sale_payment(sale_id: int, payload: dict, actor: dict = Depends(require_permission("SALES_UPDATE"))):
    def run():
        existing = db.fetch_one("SELECT * FROM sales WHERE id = %s", (sale_id,))
        if not existing or existing.get("deleted"):
            raise HTTPException(status_code=404, detail="Venta no encontrada")

        status = payload.get("payment_status")
        if status not in ("pagado", "por_pagar", "a_cuenta"):
            raise HTTPException(status_code=400, detail="Estado de pago inválido")
        if status == existing["payment_status"]:
            return _serialize_sale(existing)

        paid_date = payload.get("payment_date")
        if paid_date is not None:
            try:
                from datetime import datetime as _dt
                _dt.strptime(paid_date, "%Y-%m-%d")
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="payment_date debe tener formato YYYY-MM-DD")

        if status == "pagado":
            db.execute(
                "UPDATE sales SET payment_status = 'pagado', amount_paid = %s, "
                "amount_pending = 0, pending_payment_date = NULL, "
                "payment_date = COALESCE(%s, CURRENT_DATE) WHERE id = %s",
                (existing["total"], paid_date, sale_id),
                returning=None,
            )
        else:
            db.execute(
                "UPDATE sales SET payment_status = %s, payment_date = NULL WHERE id = %s",
                (status, sale_id),
                returning=None,
            )
        updated = db.fetch_one("SELECT * FROM sales WHERE id = %s", (sale_id,))
        rbac.audit(actor["id"], actor["email"], "payment_update", "sales", sale_id,
                   {"payment_status": status})
        return _serialize_sale(updated)
    return _conn_or_400(run)


@app.delete("/api/sales/{sale_id}")
def delete_sale(sale_id: int, actor: dict = Depends(require_permission("SALES_DELETE"))):
    res = _conn_or_400(
        lambda: db.execute(
            "UPDATE sales SET deleted = true WHERE id = %s", (sale_id,), returning=None
        )
        and {"ok": True}
    )
    rbac.audit(actor["id"], actor["email"], "delete", "sales", sale_id, {})
    return res


# ============================================================================
# WHATSAPP (PDF/video adjuntos vía Cloud API)
# ============================================================================

class WhatsappSendRequest(BaseModel):
    phone: str
    media_url: str
    filename: str | None = None
    caption: str | None = None


@app.get("/api/whatsapp/config")
def whatsapp_config(_: dict = Depends(require_auth)):
    return {"configured": whatsapp.is_configured()}


@app.post("/api/whatsapp/send-media")
def whatsapp_send_media(req: WhatsappSendRequest, request: Request, _: dict = Depends(require_auth)):
    try:
        url = req.media_url
        if url.startswith("/"):
            url = f"{str(request.base_url).rstrip('/')}{url}"
        result = whatsapp.send_media(req.phone, url, caption=req.caption, filename=req.filename)
        ids = result.get("messages") or []
        return {"ok": True, "message_id": ids[0].get("id") if ids else None}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# UPLOADS (imágenes, PDFs, videos)
# ============================================================================

@app.post("/api/upload")
def upload_file(file: UploadFile = File(...), _: dict = Depends(require_permission("UPLOAD_FILES"))):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Formato de archivo no permitido")
    data = file.file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="El archivo supera el tamaño máximo (60MB)")
    if storage.is_configured():
        url = storage.upload_bytes(data, file.filename or f"file{ext}")
        return {"url": url}
    name = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / name).write_bytes(data)
    return {"url": f"/uploads/{name}"}


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/api/catalogs")
def get_catalogs(_: dict = Depends(require_permission("SALES_VIEW"))):
    """Todos los catálogos del modal de ventas en UNA sola conexión."""
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                res = {}
                cur.execute("SELECT * FROM advisors WHERE NOT deleted ORDER BY name")
                res["advisors"] = [advisors_crud.hydrate(dict(r)) for r in cur.fetchall()]
                cur.execute("SELECT * FROM clients WHERE NOT deleted ORDER BY id")
                res["clients"] = [dict(r) for r in cur.fetchall()]
                cur.execute("SELECT * FROM clients_ruc WHERE NOT deleted ORDER BY id")
                res["ruc"] = [dict(r) for r in cur.fetchall()]
                cur.execute("SELECT * FROM machine_products WHERE NOT deleted ORDER BY name")
                res["machine"] = [products_crud.hydrate(dict(r)) for r in cur.fetchall()]
                cur.execute("SELECT * FROM spare_parts WHERE NOT deleted ORDER BY name")
                res["repuesto"] = [spare_parts_crud.hydrate(dict(r)) for r in cur.fetchall()]
                cur.execute("SELECT * FROM services WHERE NOT deleted ORDER BY name")
                res["service"] = [dict(r) for r in cur.fetchall()]
            return res
        finally:
            db.close_conn(conn)
    return _conn_or_400(run)


@app.get("/api/health")
def health():
    try:
        db.fetch_one("SELECT 1")
        return {"status": "ok", "database": "connected"}
    except Exception:
        raise HTTPException(status_code=503, detail="Base de datos no disponible")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)