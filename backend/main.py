"""
API Backend - Panel Admin Iqueño SAC
FastAPI + PostgreSQL (Neon)

Ejecutar:  uvicorn main:app --reload --port 8000
"""

import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
from auth import create_token, require_auth

load_dotenv()

app = FastAPI(title="Iqueño SAC - API Panel Admin", version="1.0.0")

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

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


@app.post("/api/auth/login")
def login(req: LoginRequest):
    if req.password != os.getenv("AUTH_PASSWORD", "iqueño2026"):
        raise HTTPException(status_code=401, detail="Contraseña incorrecta")
    token = create_token({"role": "admin"})
    return {"token": token, "user": {"name": "Administrador", "email": "admin@iqueño.sac"}}

# ============================================================================
# DASHBOARD / STATS
# ============================================================================

@app.get("/api/stats")
def get_stats(_: dict = Depends(require_auth)):
    def stats():
        return {
            "counts": {
                "advisors": db.fetch_one("SELECT COUNT(*)::int c FROM advisors WHERE NOT deleted")["c"],
                "products": db.fetch_one("SELECT COUNT(*)::int c FROM machine_products WHERE NOT deleted")["c"],
                "spare_parts": db.fetch_one("SELECT COUNT(*)::int c FROM spare_parts WHERE NOT deleted")["c"],
                "clients": db.fetch_one("SELECT COUNT(*)::int c FROM clients WHERE NOT deleted")["c"],
                "clients_ruc": db.fetch_one("SELECT COUNT(*)::int c FROM clients_ruc WHERE NOT deleted")["c"],
                "sales": db.fetch_one("SELECT COUNT(*)::int c FROM sales WHERE NOT deleted")["c"],
                "promotions": db.fetch_one("SELECT COUNT(*)::int c FROM promotions WHERE is_active")["c"],
            },
            "totals": db.fetch_one(
                """SELECT
                     COALESCE(SUM(subtotal),0)::float subtotal,
                     COALESCE(SUM(igv),0)::float igv,
                     COALESCE(SUM(total),0)::float total
                   FROM sales WHERE NOT deleted AND payment_status <> 'por_pagar'"""
            ),
            "monthly": db.fetch_all(
                """SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') mes,
                          COALESCE(SUM(total),0)::float total
                   FROM sales WHERE NOT deleted
                   GROUP BY 1 ORDER BY 1 DESC LIMIT 6"""
            ),
            "recent": db.fetch_all(
                """SELECT id, invoice_type, invoice_number, total,
                          payment_status, created_at
                   FROM sales WHERE NOT deleted ORDER BY created_at DESC LIMIT 5"""
            ),
        }
    return _conn_or_400(stats)


# ============================================================================
# HELPERS GENÉRICOS
# ============================================================================

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

    def list(self, include_deleted=False):
        wh = "" if include_deleted else "WHERE NOT deleted"
        rows = db.fetch_all(f"SELECT * FROM {self.table} {wh} ORDER BY id")
        return [self.hydrate(dict(r)) for r in rows]

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
def list_advisors(include_deleted: bool = False, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: advisors_crud.list(include_deleted))


@app.post("/api/advisors")
def create_advisor(payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: advisors_crud.create(payload))


@app.put("/api/advisors/{item_id}")
def update_advisor(item_id: int, payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: advisors_crud.update(item_id, payload))


@app.delete("/api/advisors/{item_id}")
def delete_advisor(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: advisors_crud.soft_delete(item_id))


@app.post("/api/advisors/{item_id}/restore")
def restore_advisor(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: advisors_crud.restore(item_id))


# ============================================================================
# PRODUCTOS (Galería)
# ============================================================================

class ProductMixin(SoftDeleteMixin):
    table = "machine_products"
    json_cols = ("specifications", "features", "dimensions")


products_crud = ProductMixin()


@app.get("/api/products")
def list_products(include_deleted: bool = False, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: products_crud.list(include_deleted))


@app.post("/api/products")
def create_product(payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: products_crud.create(payload))


@app.put("/api/products/{item_id}")
def update_product(item_id: int, payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: products_crud.update(item_id, payload))


@app.delete("/api/products/{item_id}")
def delete_product(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: products_crud.soft_delete(item_id))


@app.post("/api/products/{item_id}/restore")
def restore_product(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: products_crud.restore(item_id))


# ============================================================================
# REPUESTOS
# ============================================================================

class SparePartMixin(SoftDeleteMixin):
    table = "spare_parts"
    json_cols = ("specifications", "features")


spare_parts_crud = SparePartMixin()


@app.get("/api/spare-parts")
def list_spare_parts(include_deleted: bool = False, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: spare_parts_crud.list(include_deleted))


@app.post("/api/spare-parts")
def create_spare_part(payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: spare_parts_crud.create(payload))


@app.put("/api/spare-parts/{item_id}")
def update_spare_part(item_id: int, payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: spare_parts_crud.update(item_id, payload))


@app.delete("/api/spare-parts/{item_id}")
def delete_spare_part(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: spare_parts_crud.soft_delete(item_id))


@app.post("/api/spare-parts/{item_id}/restore")
def restore_spare_part(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: spare_parts_crud.restore(item_id))


# ============================================================================
# SERVICIOS
# ============================================================================

class ServiceMixin(SoftDeleteMixin):
    table = "services"


services_crud = ServiceMixin()


@app.get("/api/services")
def list_services(include_deleted: bool = False, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: services_crud.list(include_deleted))


@app.post("/api/services")
def create_service(payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: services_crud.create(payload))


@app.put("/api/services/{item_id}")
def update_service(item_id: int, payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: services_crud.update(item_id, payload))


@app.delete("/api/services/{item_id}")
def delete_service(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: services_crud.soft_delete(item_id))


@app.post("/api/services/{item_id}/restore")
def restore_service(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: services_crud.restore(item_id))


# ============================================================================
# CLIENTES DNI
# ============================================================================

class ClientMixin(SoftDeleteMixin):
    table = "clients"


clients_crud = ClientMixin()


@app.get("/api/clients")
def list_clients(include_deleted: bool = False, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_crud.list(include_deleted))


@app.post("/api/clients")
def create_client(payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_crud.create(payload))


@app.put("/api/clients/{item_id}")
def update_client(item_id: int, payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_crud.update(item_id, payload))


@app.delete("/api/clients/{item_id}")
def delete_client(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_crud.soft_delete(item_id))


@app.post("/api/clients/{item_id}/restore")
def restore_client(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_crud.restore(item_id))


# ============================================================================
# CLIENTES RUC (Empresas)
# ============================================================================

class ClientRucMixin(SoftDeleteMixin):
    table = "clients_ruc"


clients_ruc_crud = ClientRucMixin()


@app.get("/api/clients-ruc")
def list_clients_ruc(include_deleted: bool = False, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_ruc_crud.list(include_deleted))


@app.post("/api/clients-ruc")
def create_client_ruc(payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_ruc_crud.create(payload))


@app.put("/api/clients-ruc/{item_id}")
def update_client_ruc(item_id: int, payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_ruc_crud.update(item_id, payload))


@app.delete("/api/clients-ruc/{item_id}")
def delete_client_ruc(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_ruc_crud.soft_delete(item_id))


@app.post("/api/clients-ruc/{item_id}/restore")
def restore_client_ruc(item_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: clients_ruc_crud.restore(item_id))


# ============================================================================
# PROMOCIONES (eliminación física)
# ============================================================================

class PromotionMixin(SoftDeleteMixin):
    table = "promotions"
    json_cols = ()

    def list(self, include_deleted=False):
        rows = db.fetch_all(
            "SELECT * FROM promotions ORDER BY display_order, created_at DESC"
        )
        return [dict(r) for r in rows]

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
def list_promotions(only_web: bool = False, _: dict = Depends(require_auth)):
    def run():
        if only_web:
            rows = db.fetch_all(
                "SELECT * FROM promotions WHERE is_active AND show_in_web "
                "ORDER BY display_order, created_at DESC"
            )
            return [dict(r) for r in rows]
        return promotions_crud.list()
    return _conn_or_400(run)


@app.post("/api/promotions")
def create_promotion(payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: promotions_crud.create(payload))


@app.put("/api/promotions/{item_id}")
def update_promotion(item_id: str, payload: dict, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: promotions_crud.update(item_id, payload))


@app.delete("/api/promotions/{item_id}")
def delete_promotion(item_id: str, _: dict = Depends(require_auth)):
    return _conn_or_400(lambda: promotions_crud.soft_delete(item_id))


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


def _resolve_item_details(item: dict) -> dict:
    """Enriquece el item con nombre, descripción, especificaciones e imagen del catálogo."""
    base = {"name": item.get("manual_name") or "Item"}
    if item.get("manual_name"):
        base["is_manual"] = True
        return base
    table = {
        "machine": "machine_products",
        "repuesto": "spare_parts",
        "service": "services",
    }.get(item.get("item_type"))
    if table and item.get("item_id"):
        cols = "name, description, specifications, features, image_url"
        if table == "services":
            cols = "name, image_url"
        row = db.fetch_one(f"SELECT {cols} FROM {table} WHERE id = %s", (item["item_id"],))
        if row:
            r = dict(row)
            r["specifications"] = db.from_json(r.get("specifications"))
            r["features"] = db.from_json(r.get("features"))
            return r
    return base


def _serialize_sale(row: dict) -> dict:
    items = db.fetch_all(
        "SELECT * FROM sale_items WHERE sale_id = %s ORDER BY id", (row["id"],)
    )
    sale = dict(row)
    sale["items"] = []
    for i in items:
        it = dict(i)
        details = _resolve_item_details(it)
        it["name"] = details.get("name") or it["manual_name"] or "Item"
        it["description"] = details.get("description")
        it["specifications"] = details.get("specifications") or []
        it["features"] = details.get("features") or []
        it["image_url"] = details.get("image_url")
        it["is_manual"] = details.get("is_manual", not it.get("item_id"))
        sale["items"].append(it)

    if sale.get("client_id"):
        try:
            if sale.get("client_type") == "ruc":
                c = db.fetch_one(
                    "SELECT id, razonsocial, ruc, deleted FROM clients_ruc WHERE id = %s",
                    (sale["client_id"],),
                )
                sale["client"] = dict(c) if c else None
            else:
                c = db.fetch_one(
                    "SELECT id, names, last_names, dni, deleted FROM clients WHERE id = %s",
                    (sale["client_id"],),
                )
                sale["client"] = dict(c) if c else None
        except Exception:
            sale["client"] = None
    else:
        sale["client"] = None

    if sale.get("advisor_id"):
        a = db.fetch_one(
            "SELECT id, name FROM advisors WHERE id = %s", (sale["advisor_id"],)
        )
        sale["advisor"] = dict(a) if a else None
    else:
        sale["advisor"] = None
    return sale


@app.get("/api/sales")
def list_sales(include_deleted: bool = False, _: dict = Depends(require_auth)):
    def run():
        wh = "" if include_deleted else "WHERE NOT deleted"
        rows = db.fetch_all(f"SELECT * FROM sales {wh} ORDER BY created_at DESC, id DESC")
        return [_serialize_sale(dict(r)) for r in rows]
    return _conn_or_400(run)


@app.get("/api/sales/{sale_id}")
def get_sale(sale_id: int, _: dict = Depends(require_auth)):
    def run():
        row = db.fetch_one("SELECT * FROM sales WHERE id = %s", (sale_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Venta no encontrada")
        return _serialize_sale(dict(row))
    return _conn_or_400(run)


@app.post("/api/sales")
def create_sale(payload: dict, _: dict = Depends(require_auth)):
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
                    "payment_status": payload.get("payment_status", "por_pagar"),
                    "payment_description": payload.get("payment_description"),
                    "payment_date": payload.get("payment_date"),
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
                            quantity, unit_price)
                           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                        (
                            sale_row["id"],
                            item.get("item_type"),
                            item.get("item_id"),
                            item.get("manual_name"),
                            item.get("manual_description"),
                            item.get("quantity", 1),
                            item.get("unit_price", 0),
                        ),
                    )
            conn.commit()
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
def update_sale(sale_id: int, payload: dict, _: dict = Depends(require_auth)):
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
                            quantity, unit_price)
                           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                        (
                            sale_id,
                            item.get("item_type"),
                            item.get("item_id"),
                            item.get("manual_name"),
                            item.get("manual_description"),
                            item.get("quantity", 1),
                            item.get("unit_price", 0),
                        ),
                    )
            conn.commit()
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


@app.delete("/api/sales/{sale_id}")
def delete_sale(sale_id: int, _: dict = Depends(require_auth)):
    return _conn_or_400(
        lambda: db.execute(
            "UPDATE sales SET deleted = true WHERE id = %s", (sale_id,), returning=None
        )
        and {"ok": True}
    )


# ============================================================================
# UPLOADS (imágenes, PDFs, videos)
# ============================================================================

@app.post("/api/upload")
def upload_file(file: UploadFile = File(...), _: dict = Depends(require_auth)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Formato de archivo no permitido")
    data = file.file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="El archivo supera el tamaño máximo (60MB)")
    name = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / name).write_bytes(data)
    return {"url": f"/uploads/{name}"}


# ============================================================================
# HEALTH CHECK
# ============================================================================

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