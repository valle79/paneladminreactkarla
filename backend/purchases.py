"""
Módulo de Compras — El Iqueño SAC
Proveedores, compras nacionales e internacionales, órdenes de compra,
recepciones (con ingreso a inventario), pagos a proveedores, importaciones,
costos de importación con distribución y cuentas por pagar.

Sigue los patrones del backend existente: SQL crudo vía db.py, verificaciones
de permisos con require_permission y auditoría con rbac.audit.
Los importes monetarios se manejan con Decimal/NUMERIC (nunca float).
"""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import time
import threading

from fastapi import APIRouter, Depends, HTTPException

import db
import rbac
from auth import require_permission

router = APIRouter(prefix="/api", tags=["compras"])

# Caché corta del catálogo del formulario de compras (TTL bajo: se refresca solo).
_CATALOG_CACHE = {}
_CATALOG_TTL = 45.0
_CATALOG_LOCK = threading.Lock()

# ============================================================================
# CONSTANTES
# ============================================================================

TIPO_COMPRA = ("NACIONAL", "INTERNACIONAL")
ESTADO_COMPRA = ("BORRADOR", "ORDENADA", "CONFIRMADA", "EN_TRANSITO",
                 "RECIBIDA_PARCIAL", "RECIBIDA_COMPLETA", "CANCELADA")
ESTADO_PAGO = ("PENDIENTE", "PAGADA_PARCIAL", "PAGADA", "VENCIDA", "ANULADA")
ESTADO_ORDEN = ("BORRADOR", "ENVIADA", "ACEPTADA", "RECHAZADA", "RECIBIDA", "CANCELADA")
ESTADO_LOGISTICO = ("COTIZACIÓN", "ORDENADA", "PRODUCCIÓN", "LISTA_PARA_EMBARQUE",
                    "EMBARCADA", "EN_TRANSITO", "ARRIBADA", "ADUANAS", "LIBERADA",
                    "RECIBIDA", "CANCELADA")

MEDIOS_PAGO = ("TRANSFERENCIA", "DEPOSITO", "EFECTIVO", "TARJETA", "OTRO",
               "TRANSFERENCIA INTERNACIONAL", "SWIFT", "PAYPAL")

COSTO_TYPES = ("FLETE INTERNACIONAL", "SEGURO", "ARANCEL", "ADUANAS",
               "AGENTE DE ADUANAS", "ALMACENAJE", "TRANSPORTE TERRESTRE",
               "GASTOS PORTUARIOS", "DESCARGA", "MANIPULEO",
               "COMISIONES BANCARIAS", "INSPECCION", "OTROS")

DOC_TIPOS = ("FACTURA", "BOLETA", "NOTA DE CREDITO", "NOTA DE DEBITO",
             "GUIA DE REMISION", "ORDEN DE COMPRA", "COTIZACION PROVEEDOR",
             "FACTURA COMERCIAL", "PROFORMA INVOICE", "PACKING LIST",
             "BILL OF LADING", "AIR WAYBILL", "DECLARACION ADUANERA",
             "CERTIFICADO DE ORIGEN", "COMPROBANTE DE PAGO",
             "DOCUMENTO DE SEGURO", "DOCUMENTO DE TRANSPORTE", "OTRO")

INCOTERMS = ("EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP")

MONEDAS = ("PEN", "USD", "EUR", "CNY")

DESTINO_COMPRA = ("PARA_CLIENTE", "STOCK", "MANTENIMIENTO",
                  "PRODUCCION_INTERNA", "USO_INTERNO", "OTRO")
CLIENTE_TIPOS = ("RUC", "DNI")
TRABAJO_TIPOS = ("PRODUCTO", "SERVICIO", "MANUAL")
TIPO_COMPROBANTE = ("FACTURA", "BOLETA", "RECIBO", "NOTA_DE_VENTA", "OTRO")

TRANSICIONES_EVENTO = {
    "BORRADOR": "COMPRA_CREADA",
    "ORDENADA": "ORDEN_ENVIADA",
    "CONFIRMADA": "COMPRA_CONFIRMADA",
    "EN_TRANSITO": "IMPORTACION_EN_TRANSITO",
    "RECIBIDA_PARCIAL": "MERCADERIA_RECIBIDA",
    "RECIBIDA_COMPLETA": "MERCADERIA_RECIBIDA",
    "CANCELADA": "COMPRA_CANCELADA",
}


def _dec(v, default=0):
    if default is None:
        try:
            return Decimal(str(v))
        except (TypeError, ValueError, ArithmeticError):
            return None
    try:
        return Decimal(str(v))
    except (TypeError, ValueError, ArithmeticError):
        return Decimal(str(default))


def _r2(v):
    return _dec(v).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _r4(v):
    return _dec(v).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _str_upper(v):
    return str(v or "").strip().upper()


def _dec_int(v):
    if v in (None, ""):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _validate_comprobante(payload):
    tipo = _str_upper(payload.get("tipo_comprobante")) or "FACTURA"
    if tipo not in TIPO_COMPROBANTE:
        raise HTTPException(status_code=400, detail="tipo_comprobante inválido")
    serie = str(payload.get("serie_comprobante") or "").strip() or None
    numero = str(payload.get("numero_comprobante") or "").strip() or None
    return tipo, serie, numero


def _guard(fn):
    try:
        return fn()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error de base de datos: {e}")


def _audit(actor, action, resource, resource_id, details=None):
    rbac.audit(actor["id"], actor["email"], action, resource, resource_id, details or {})


def _history(conn, cur, purchase_id, evento, previo, nuevo, descripcion, actor, estado_logistico=False):
    cur.execute(
        """INSERT INTO purchase_status_history
           (purchase_id, evento, estado_previo, estado_nuevo, descripcion, user_id, user_email)
           VALUES (%s,%s,%s,%s,%s,%s,%s)""",
        (purchase_id, evento, previo, nuevo, descripcion, actor["id"], actor["email"]),
    )
    # También dejamos una entrada en la auditoría global (no puede romper la operación)
    rbac.audit(actor["id"], actor["email"], evento, "purchases", purchase_id,
               {"estado_previo": previo, "estado_nuevo": nuevo})


# ============================================================================
# CONFIGURACIÓN TRIBUTARIA (centralizada en settings)
# ============================================================================

_SETTINGS_WHITELIST = {"igv_rate", "igv_name", "base_currency", "purchase_prefix"}


def _get_setting(key, default):
    row = db.fetch_one("SELECT value FROM settings WHERE key = %s", (key,))
    if not row:
        return default
    return row["value"]


def _parse_setting(key, value, default):
    if value is None:
        return default
    try:
        if key in ("igv_rate",):
            return float(value)
        if key in ("igv_enabled", "purchase_require_order"):
            return str(value).lower() in ("1", "true", "yes", "si")
    except (TypeError, ValueError):
        pass
    return value


def _settings_dict():
    rows = db.fetch_all("SELECT key, value FROM settings")
    out = {
        "igv_rate": 0.18,
        "igv_name": "IGV",
        "base_currency": "PEN",
        "purchase_prefix": "CP",
    }
    for r in rows:
        if r["key"] in out:
            out[r["key"]] = _parse_setting(r["key"], r["value"], out[r["key"]])
    return out


def _igv_rate():
    return float(_get_setting("igv_rate", "0.18")) or 0.18


# ============================================================================
# HELPERS DE CÓDIGOS
# ============================================================================

def _next_codigo(conn_or_cur, prefix, table, col):
    """Genera el siguiente código correlativo: {prefix}-XXXXX (por MAX de la columna)."""
    cur = conn_or_cur
    cur.execute(f"SELECT COALESCE(MAX(NULLIF({col}, '')), '') AS last_code FROM {table}")
    row = cur.fetchone()
    last = row["last_code"] if row else ""
    n = 0
    try:
        n = int(str(last).split("-")[-1])
    except (ValueError, TypeError):
        n = 0
    return f"{prefix}-{n + 1:05d}"


def _generate_purchase_code(cur):
    prefix = str(_get_setting("purchase_prefix", "CP")).strip() or "CP"
    return _next_codigo(cur, prefix, "purchases", "codigo_compra")


def _generate_order_code(cur):
    return _next_codigo(cur, "OC", "purchase_orders", "codigo_orden")


def _generate_receipt_code(cur):
    return _next_codigo(cur, "REC", "purchase_receipts", "codigo_recepcion")


# ============================================================================
# VALIDACIONES
# ============================================================================

def _valid_incoterm(v):
    return v is None or _str_upper(v) in INCOTERMS


def _require(value, msg):
    if value in (None, "", []):
        raise HTTPException(status_code=400, detail=msg)
    return value


def _validate_purchase_payload(payload):
    tipo = _str_upper(payload.get("tipo_compra"))
    if tipo not in TIPO_COMPRA:
        raise HTTPException(status_code=400, detail="tipo_compra debe ser NACIONAL o INTERNACIONAL")
    moneda = _str_upper(payload.get("moneda")) or "PEN"
    if moneda not in MONEDAS:
        raise HTTPException(status_code=400, detail="Moneda no soportada (PEN, USD, EUR, CNY)")
    tc = _dec(payload.get("tipo_cambio"), 1)
    if tc <= 0:
        raise HTTPException(status_code=400, detail="tipo_cambio debe ser mayor a 0")
    proveedor_id = payload.get("proveedor_id")
    if not proveedor_id:
        raise HTTPException(status_code=400, detail="proveedor_id es obligatorio")
    items = payload.get("items") or []
    if not items:
        raise HTTPException(status_code=400, detail="La compra debe tener al menos un item")
    return tipo, moneda, tc, proveedor_id, items


def _validate_item_raw(it):
    cantidad = _dec(it.get("cantidad"))
    precio = _dec(it.get("precio_unitario"))
    if cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")
    if precio < 0:
        raise HTTPException(status_code=400, detail="El precio unitario no puede ser negativo")
    if it.get("product_id") and it.get("spare_part_id"):
        raise HTTPException(status_code=400, detail="No se puede usar producto y repuesto a la vez")
    return cantidad, precio


# ============================================================================
# SERIALIZACIÓN DE COMPRAS
# ============================================================================

def _resolve_items(cur, items):
    """Adjunta nombre de producto/repuesto, cliente y producto/trabajo a los items."""
    if not items:
        return items
    p_ids = {i["product_id"] for i in items if i.get("product_id")}
    s_ids = {i["spare_part_id"] for i in items if i.get("spare_part_id")}
    pz_ids = {i["pieza_id"] for i in items if i.get("pieza_id")}
    ruc_ids = {i["cliente_id"] for i in items if i.get("cliente_tipo") == "RUC" and i.get("cliente_id")}
    dni_ids = {i["cliente_id"] for i in items if i.get("cliente_tipo") == "DNI" and i.get("cliente_id")}
    prod_work_ids = {i["trabajo_id"] for i in items if i.get("trabajo_tipo") == "PRODUCTO" and i.get("trabajo_id")}
    serv_work_ids = {i["trabajo_id"] for i in items if i.get("trabajo_tipo") == "SERVICIO" and i.get("trabajo_id")}
    products, spares = {}, {}
    clientes_ruc, clientes_dni = {}, {}
    trabajos_prod, trabajos_serv = {}, {}
    piezas = {}
    if p_ids:
        cur.execute(
            "SELECT id, name, price, stock FROM machine_products WHERE id = ANY(%s)",
            (list(p_ids),),
        )
        products = {r["id"]: dict(r) for r in cur.fetchall()}
    if s_ids:
        cur.execute(
            "SELECT id, name, price, stock FROM spare_parts WHERE id = ANY(%s)",
            (list(s_ids),),
        )
        spares = {r["id"]: dict(r) for r in cur.fetchall()}
    if ruc_ids:
        cur.execute("SELECT id, razonsocial, ruc FROM clients_ruc WHERE id = ANY(%s)", (list(ruc_ids),))
        clientes_ruc = {r["id"]: dict(r) for r in cur.fetchall()}
    if dni_ids:
        cur.execute(
            "SELECT id, names, last_names, dni FROM clients WHERE id = ANY(%s)",
            (list(dni_ids),),
        )
        clientes_dni = {r["id"]: dict(r) for r in cur.fetchall()}
    if prod_work_ids:
        cur.execute("SELECT id, name FROM machine_products WHERE id = ANY(%s)", (list(prod_work_ids),))
        trabajos_prod = {r["id"]: dict(r) for r in cur.fetchall()}
    if serv_work_ids:
        cur.execute("SELECT id, name FROM services WHERE id = ANY(%s)", (list(serv_work_ids),))
        trabajos_serv = {r["id"]: dict(r) for r in cur.fetchall()}
    if pz_ids:
        cur.execute("SELECT id, name, precio, stock FROM piezas WHERE id = ANY(%s)", (list(pz_ids),))
        piezas = {r["id"]: dict(r) for r in cur.fetchall()}
    for it in items:
        it = dict(it)
        if it.get("product_id") and it["product_id"] in products:
            it["product_name"] = products[it["product_id"]]["name"]
            it["product_stock"] = products[it["product_id"]]["stock"]
        elif it.get("spare_part_id") and it["spare_part_id"] in spares:
            it["spare_part_name"] = spares[it["spare_part_id"]]["name"]
            it["spare_part_stock"] = spares[it["spare_part_id"]]["stock"]
        elif it.get("pieza_id") and it["pieza_id"] in piezas:
            it["pieza_name"] = piezas[it["pieza_id"]]["name"]
            it["pieza_stock"] = piezas[it["pieza_id"]]["stock"]
        if it.get("cliente_id"):
            if it.get("cliente_tipo") == "RUC" and it["cliente_id"] in clientes_ruc:
                c = clientes_ruc[it["cliente_id"]]
                it["cliente_nombre"] = c["razonsocial"]
                it["cliente_doc"] = c["ruc"]
            elif it.get("cliente_tipo") == "DNI" and it["cliente_id"] in clientes_dni:
                c = clientes_dni[it["cliente_id"]]
                it["cliente_nombre"] = " ".join(x for x in (c["names"], c["last_names"]) if x)
                it["cliente_doc"] = c["dni"]
        if it.get("trabajo_tipo") == "PRODUCTO" and it["trabajo_id"] in trabajos_prod:
            it["trabajo_name"] = trabajos_prod[it["trabajo_id"]]["name"]
        elif it.get("trabajo_tipo") == "SERVICIO" and it["trabajo_id"] in trabajos_serv:
            it["trabajo_name"] = trabajos_serv[it["trabajo_id"]]["name"]
        yield it


def _load_purchase_children(conn, purchase_id, actor=None):
    out = {}
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM purchase_items WHERE purchase_id = %s ORDER BY id", (purchase_id,))
        items = list(_resolve_items(cur, cur.fetchall()))
        out["items"] = items

        cur.execute("SELECT * FROM purchase_imports WHERE purchase_id = %s", (purchase_id,))
        row = cur.fetchone()
        out["import"] = dict(row) if row else None

        cur.execute(
            "SELECT * FROM import_costs WHERE purchase_id = %s AND NOT deleted ORDER BY id",
            (purchase_id,),
        )
        costs = [dict(r) for r in cur.fetchall()]
        cost_ids = [c["id"] for c in costs]
        allocs = {}
        if cost_ids:
            cur.execute(
                "SELECT cost_id, purchase_item_id, monto_asignado "
                "FROM import_cost_allocations WHERE cost_id = ANY(%s)",
                (cost_ids,),
            )
            for a in cur.fetchall():
                allocs.setdefault(a["cost_id"], []).append(dict(a))
        for c in costs:
            c["allocations"] = allocs.get(c["id"], [])
        out["costs"] = costs
        out["costs_total"] = round(sum(_dec(c["monto_equivalente"]) for c in costs), 2)

        cur.execute(
            "SELECT * FROM purchase_documents WHERE purchase_id = %s AND NOT deleted ORDER BY id",
            (purchase_id,),
        )
        out["documents"] = [dict(r) for r in cur.fetchall()]

        cur.execute(
            "SELECT * FROM supplier_payments WHERE purchase_id = %s ORDER BY id",
            (purchase_id,),
        )
        out["payments"] = [dict(r) for r in cur.fetchall()]

        cur.execute(
            "SELECT * FROM purchase_status_history WHERE purchase_id = %s ORDER BY id",
            (purchase_id,),
        )
        out["history"] = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """SELECT r.id, r.codigo_recepcion, r.fecha_recepcion, r.estado, r.observaciones, r.created_at
               FROM purchase_receipts r
               WHERE r.purchase_id = %s AND NOT r.deleted ORDER BY r.id""",
            (purchase_id,),
        )
        receipts = [dict(r) for r in cur.fetchall()]
        r_ids = [r["id"] for r in receipts]
        if r_ids:
            cur.execute(
                "SELECT * FROM purchase_receipt_items WHERE receipt_id = ANY(%s) ORDER BY id",
                (r_ids,),
            )
            items_by_r = {}
            for ri in cur.fetchall():
                items_by_r.setdefault(ri["receipt_id"], []).append(dict(ri))
            for r in receipts:
                r["items"] = items_by_r.get(r["id"], [])
        out["receipts"] = receipts
    return out


def _serialize_purchase(conn, row, actor=None):
    """Enriquece una fila de purchase con proveedor, pagos, y detalle completo."""
    p = dict(row)
    supplier = db.fetch_one(
        "SELECT id, razon_social, nombre_comercial, tipo_proveedor, tipo_documento, "
        "numero_documento, pais, moneda_principal FROM suppliers WHERE id = %s",
        (p["proveedor_id"],),
    )
    p["supplier"] = dict(supplier) if supplier else None

    if p.get("cliente_tipo") and p.get("cliente_id"):
        if p["cliente_tipo"] == "RUC":
            c = db.fetch_one("SELECT razonsocial FROM clients_ruc WHERE id = %s", (p["cliente_id"],))
            p["cliente_compra"] = c["razonsocial"] if c else None
        elif p["cliente_tipo"] == "DNI":
            c = db.fetch_one("SELECT names, last_names FROM clients WHERE id = %s", (p["cliente_id"],))
            p["cliente_compra"] = " ".join(x for x in (c["names"], c["last_names"]) if x) if c else None

    tc = _dec(p["tipo_cambio"], 1)
    paid_rows = db.fetch_all(
        "SELECT monto, tipo_cambio FROM supplier_payments "
        "WHERE purchase_id = %s AND NOT anulado",
        (p["id"],),
    )
    paid = sum(_dec(r["monto"]) * (_dec(r["tipo_cambio"], 1) / tc) for r in paid_rows)
    p["total_pagado"] = round(paid, 2)
    p["saldo"] = round(_dec(p["total"]) - _dec(p["total_pagado"]), 2)

    children = _load_purchase_children(conn, p["id"])
    p.update(children)
    p["items_count"] = len(children["items"])

    # Resumen de recepción
    pendiente = {}
    for it in children["items"]:
        pendiente[it["id"]] = _dec(it["cantidad"])
    for r in children["receipts"]:
        for ri in r["items"]:
            if ri.get("purchase_item_id") in pendiente:
                pendiente[ri["purchase_item_id"]] -= _dec(ri["cantidad_recibida"])
    p["reception_pending"] = {str(k): float(v) for k, v in pendiente.items()}
    return p


# ============================================================================
# PROVEEDORES
# ============================================================================

def _validate_supplier(payload):
    razon = (payload.get("razon_social") or "").strip()
    if not razon:
        raise HTTPException(status_code=400, detail="La razón social es obligatoria")
    tipo = _str_upper(payload.get("tipo_proveedor")) or "NACIONAL"
    if tipo not in ("NACIONAL", "EXTRANJERO"):
        raise HTTPException(status_code=400, detail="tipo_proveedor inválido")
    return razon, tipo


@router.get("/units")
def list_units(_: dict = Depends(require_permission("PURCHASES_VIEW"))):
    def run():
        rows = db.fetch_all("SELECT code, name FROM units WHERE active ORDER BY code")
        return [dict(r) for r in rows]

    return _guard(run)


@router.get("/suppliers")
def list_suppliers(
    include_deleted: bool = False,
    page: int = 1,
    limit: int = 50,
    q: str = "",
    tipo: str = "",
    pais: str = "",
    _: dict = Depends(require_permission("SUPPLIERS_VIEW")),
):
    def run():
        nonlocal page, limit
        conds = [] if include_deleted else ["NOT deleted"]
        params = []
        if q:
            conds.append(
                "(razon_social ILIKE %s OR nombre_comercial ILIKE %s OR numero_documento ILIKE %s "
                "OR email ILIKE %s OR contacto ILIKE %s)"
            )
            like = f"%{q}%"
            params += [like] * 5
        if tipo:
            conds.append("tipo_proveedor = %s")
            params.append(_str_upper(tipo))
        if pais:
            conds.append("pais ILIKE %s")
            params.append(f"%{pais}%")
        wh = "WHERE " + " AND ".join(conds) if conds else ""
        total_row = db.fetch_one(f"SELECT COUNT(*)::int AS total FROM suppliers {wh}", params or None)
        total = total_row["total"] if total_row else 0
        page = max(1, page)
        limit = min(max(1, limit), 100)
        off = (page - 1) * limit
        rows = db.fetch_all(
            f"SELECT * FROM suppliers {wh} ORDER BY id DESC LIMIT {limit} OFFSET {off}",
            params or None,
        )
        n_purchases = {}
        ids = [r["id"] for r in rows]
        if ids:
            pr = db.fetch_all(
                "SELECT proveedor_id, COUNT(*)::int AS n FROM purchases "
                "WHERE NOT deleted AND proveedor_id = ANY(%s) GROUP BY proveedor_id",
                (ids,),
            )
            n_purchases = {r["proveedor_id"]: r["n"] for r in pr}
        items = []
        for r in rows:
            item = dict(r)
            item["purchases_count"] = n_purchases.get(item["id"], 0)
            items.append(item)
        return {
            "items": items,
            "pagination": {"page": page, "limit": limit, "total": total,
                           "total_pages": (total + limit - 1) // limit},
        }
    return _guard(run)


@router.get("/suppliers/catalogo")
def suppliers_catalogo(_: dict = Depends(require_permission("SUPPLIERS_VIEW"))):
    def run():
        rows = db.fetch_all(
            "SELECT id, razon_social, nombre_comercial, tipo_proveedor, tipo_documento, "
            "numero_documento, pais, moneda_principal FROM suppliers "
            "WHERE NOT deleted ORDER BY razon_social"
        )
        return [dict(r) for r in rows]
    return _guard(run)


@router.get("/catalogo-compras")
def catalogo_compras(_: dict = Depends(require_permission("PURCHASES_VIEW"))):
    """Todos los catálogos del formulario de compras en una sola petición (cacheado)."""
    def _suppliers():
        return [dict(r) for r in db.fetch_all(
            "SELECT id, razon_social, nombre_comercial, tipo_proveedor, tipo_documento, "
            "numero_documento, pais, moneda_principal FROM suppliers "
            "WHERE NOT deleted ORDER BY razon_social")]

    def _products():
        return [dict(r) for r in db.fetch_all(
            "SELECT id, name, price FROM machine_products WHERE NOT deleted AND status = 'active' ORDER BY name")]

    def _spare_parts():
        return [dict(r) for r in db.fetch_all(
            "SELECT id, name, price FROM spare_parts WHERE NOT deleted AND status = 'active' ORDER BY name")]

    def _piezas():
        return [dict(r) for r in db.fetch_all(
            "SELECT id, codigo, name, descripcion, precio, unidad, stock FROM piezas WHERE NOT deleted ORDER BY name")]

    def _services():
        return [dict(r) for r in db.fetch_all(
            "SELECT id, name, price, image_url FROM services WHERE NOT deleted ORDER BY name")]

    def _clients():
        return [dict(r) for r in db.fetch_all(
            "SELECT id, names, last_names, dni FROM clients WHERE NOT deleted ORDER BY names")]

    def _clients_ruc():
        return [dict(r) for r in db.fetch_all(
            "SELECT id, razonsocial, ruc FROM clients_ruc WHERE NOT deleted ORDER BY razonsocial")]

    def _units():
        return [dict(r) for r in db.fetch_all(
            "SELECT code, name FROM units WHERE active ORDER BY code")]

    def run():
        now = time.monotonic()
        cached = _CATALOG_CACHE.get("all")
        if cached and now - cached[0] < _CATALOG_TTL:
            return cached[1]
        with _CATALOG_LOCK:
            cached = _CATALOG_CACHE.get("all")
            if cached and now - cached[0] < _CATALOG_TTL:
                return cached[1]
            data = {
                "suppliers": _suppliers(),
                "products": _products(),
                "spare_parts": _spare_parts(),
                "piezas": _piezas(),
                "services": _services(),
                "clients": _clients(),
                "clients_ruc": _clients_ruc(),
                "units": _units(),
            }
            _CATALOG_CACHE["all"] = (time.monotonic(), data)
            return data

    return _guard(run)


@router.get("/suppliers/{supplier_id}")
def get_supplier(supplier_id: int, _: dict = Depends(require_permission("SUPPLIERS_VIEW"))):
    def run():
        row = db.fetch_one("SELECT * FROM suppliers WHERE id = %s", (supplier_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Proveedor no encontrado")
        item = dict(row)
        pr = db.fetch_all(
            "SELECT id, codigo_compra, tipo_compra, moneda, total, estado, estado_pago, fecha_compra "
            "FROM purchases WHERE proveedor_id = %s AND NOT deleted ORDER BY id DESC LIMIT 20",
            (supplier_id,),
        )
        item["recent_purchases"] = [dict(r) for r in pr]
        return item
    return _guard(run)


@router.post("/suppliers")
def create_supplier(payload: dict, actor: dict = Depends(require_permission("SUPPLIERS_CREATE"))):
    def run():
        razon, tipo = _validate_supplier(payload)
        numero_doc = (payload.get("numero_documento") or "").strip()
        if tipo == "NACIONAL" and not numero_doc:
            raise HTTPException(status_code=400, detail="El número de documento es obligatorio")
        data = {
            "tipo_proveedor": tipo,
            "tipo_documento": _str_upper(payload.get("tipo_documento")) or ("RUC" if tipo == "NACIONAL" else "TAX ID"),
            "numero_documento": numero_doc or None,
            "razon_social": razon,
            "nombre_comercial": (payload.get("nombre_comercial") or "").strip() or None,
            "pais": (payload.get("pais") or "").strip() or ("Perú" if tipo == "NACIONAL" else None),
            "direccion": (payload.get("direccion") or "").strip() or None,
            "ciudad": (payload.get("ciudad") or "").strip() or None,
            "departamento": (payload.get("departamento") or "").strip() or None,
            "telefono": (payload.get("telefono") or "").strip() or None,
            "email": (payload.get("email") or "").strip() or None,
            "contacto": (payload.get("contacto") or "").strip() or None,
            "moneda_principal": (payload.get("moneda_principal") or "PEN").upper(),
            "condiciones_pago": (payload.get("condiciones_pago") or "").strip() or None,
            "banco": (payload.get("banco") or "").strip() or None,
            "numero_cuenta": (payload.get("numero_cuenta") or "").strip() or None,
            "swift": (payload.get("swift") or "").strip() or None,
            "estado": _str_upper(payload.get("estado")) or "ACTIVO",
            "observaciones": (payload.get("observaciones") or "").strip() or None,
            "created_by": actor["id"],
        }
        if data["estado"] not in ("ACTIVO", "INACTIVO"):
            data["estado"] = "ACTIVO"
        row = db.execute(
            "INSERT INTO suppliers "
            "(tipo_proveedor, tipo_documento, numero_documento, razon_social, nombre_comercial, pais, "
            "direccion, ciudad, departamento, telefono, email, contacto, moneda_principal, "
            "condiciones_pago, banco, numero_cuenta, swift, estado, observaciones, created_by) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
            [data[k] for k in data],
        )
        item = dict(row)
        _audit(actor, "supplier.create", "suppliers", item["id"], {"razon_social": razon})
        return item
    return _guard(run)


@router.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, payload: dict, actor: dict = Depends(require_permission("SUPPLIERS_UPDATE"))):
    def run():
        existing = db.fetch_one("SELECT * FROM suppliers WHERE id = %s", (supplier_id,))
        if not existing or existing.get("deleted"):
            raise HTTPException(status_code=404, detail="Proveedor no encontrado")
        razon, tipo = _validate_supplier({**existing, **payload})
        allowed = ("tipo_proveedor", "tipo_documento", "numero_documento", "razon_social",
                   "nombre_comercial", "pais", "direccion", "ciudad", "departamento", "telefono",
                   "email", "contacto", "moneda_principal", "condiciones_pago", "banco",
                   "numero_cuenta", "swift", "estado", "observaciones")
        data = {}
        for k in allowed:
            if k in payload and payload[k] is not None:
                data[k] = payload[k]
        data["razon_social"] = razon
        data["tipo_proveedor"] = tipo
        if "estado" in data:
            data["estado"] = _str_upper(data["estado"])
            if data["estado"] not in ("ACTIVO", "INACTIVO"):
                data.pop("estado")
        if not data:
            return dict(existing)
        sets = ", ".join([f"{k} = %s" for k in data])
        row = db.execute(f"UPDATE suppliers SET {sets} WHERE id = %s RETURNING *",
                         [*data.values(), supplier_id])
        _audit(actor, "supplier.update", "suppliers", supplier_id, {"razon_social": razon})
        return dict(row)
    return _guard(run)


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, actor: dict = Depends(require_permission("SUPPLIERS_DELETE"))):
    def run():
        row = db.fetch_one("SELECT * FROM suppliers WHERE id = %s", (supplier_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Proveedor no encontrado")
        has_purchases = db.fetch_one(
            "SELECT id FROM purchases WHERE proveedor_id = %s AND NOT deleted LIMIT 1", (supplier_id,))
        if has_purchases:
            raise HTTPException(
                status_code=400,
                detail="El proveedor tiene compras registradas. En su lugar puedes marcarlo como INACTIVO.",
            )
        db.execute("UPDATE suppliers SET deleted = true WHERE id = %s", (supplier_id,), returning=None)
        _audit(actor, "supplier.delete", "suppliers", supplier_id, {})
        return {"ok": True}
    return _guard(run)


# ============================================================================
# COMPRAS
# ============================================================================

def _apply_item_taxes(items, con_igv, tasa_impuesto):
    """Calcula subtotal/impuesto/total por item (Decimal) y valida destino/cliente."""
    valid_units = None
    out = []
    for it in items:
        cantidad, precio = _validate_item_raw(it)
        descuento = _dec(it.get("descuento"), 0)
        if descuento < 0:
            descuento = Decimal("0")
        bruto = (precio * cantidad).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        subtotal = (bruto - descuento).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if subtotal < 0:
            subtotal = Decimal("0.00")
        tasa = _dec(it.get("tasa_impuesto"), None)
        if tasa is None:
            tasa = _dec(tasa_impuesto, 0) if con_igv else Decimal("0")
        impuesto = (subtotal * _r4(tasa)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total = (subtotal + impuesto).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        unidad = (it.get("unidad") or "UND").strip().upper() or "UND"
        if valid_units is None:
            valid_units = {r["code"] for r in db.fetch_all("SELECT code FROM units WHERE active")}
        if valid_units and unidad not in valid_units:
            raise HTTPException(status_code=400, detail=f"La unidad '{unidad}' no está en el catálogo de unidades")
        else:
            unidad = unidad if valid_units else unidad

        destino = _str_upper(it.get("destino") or "OTRO")
        if destino not in DESTINO_COMPRA:
            raise HTTPException(status_code=400, detail=f"Destino inválido: {destino}")
        cliente_tipo = _str_upper(it.get("cliente_tipo")) if it.get("cliente_tipo") not in (None, "") else None
        cliente_id = _dec_int(it.get("cliente_id"))
        if destino == "PARA_CLIENTE":
            if not cliente_id:
                raise HTTPException(status_code=400, detail="Para un ítem con destino PARA_CLIENTE el cliente es obligatorio")
            if cliente_tipo not in CLIENTE_TIPOS:
                raise HTTPException(status_code=400, detail="cliente_tipo debe ser RUC o DNI")
        trabajo_tipo = _str_upper(it.get("trabajo_tipo")) if it.get("trabajo_tipo") not in (None, "") else None
        trabajo_id = _dec_int(it.get("trabajo_id"))
        trabajo_desc = (it.get("trabajo_desc") or "").strip() or None
        if trabajo_tipo in ("PRODUCTO", "SERVICIO"):
            if not trabajo_id:
                raise HTTPException(status_code=400, detail="Para producto/servicio, trabajo_id es obligatorio")
            trabajo_desc = None
        elif trabajo_tipo == "MANUAL":
            if not trabajo_desc:
                raise HTTPException(status_code=400, detail="Para un trabajo manual, trabajo_desc es obligatorio")
        elif trabajo_tipo:
            raise HTTPException(status_code=400, detail="trabajo_tipo inválido (PRODUCTO, SERVICIO o MANUAL)")
        utilizacion = (it.get("utilizacion") or "").strip() or None

        item = {
            "product_id": it.get("product_id") or None,
            "spare_part_id": it.get("spare_part_id") or None,
            "pieza_id": it.get("pieza_id") or None,
            "descripcion": (it.get("descripcion") or "").strip() or None,
            "codigo": (it.get("codigo") or "").strip() or None,
            "cantidad": cantidad,
            "unidad": unidad,
            "precio_unitario": _r4(precio),
            "descuento": _r2(descuento),
            "subtotal": subtotal,
            "impuesto": impuesto,
            "total": total,
            "costo_original": _r4(precio),
            "peso_kg": _dec(it.get("peso_kg"), None) if it.get("peso_kg") not in (None, "") else None,
            "volumen_m3": _dec(it.get("volumen_m3"), None) if it.get("volumen_m3") not in (None, "") else None,
            "destino": destino,
            "cliente_tipo": cliente_tipo,
            "cliente_id": cliente_id,
            "trabajo_tipo": trabajo_tipo,
            "trabajo_id": trabajo_id,
            "trabajo_desc": trabajo_desc,
            "utilizacion": utilizacion,
        }
        out.append(item)
    return out


def _insert_purchase_items(cur, purchase_id, computed):
    for item in computed:
        cur.execute(
            """INSERT INTO purchase_items
               (purchase_id, product_id, spare_part_id, pieza_id, descripcion, codigo, cantidad, unidad,
                precio_unitario, descuento, subtotal, impuesto, total, costo_original, peso_kg, volumen_m3,
                destino, cliente_tipo, cliente_id, trabajo_tipo, trabajo_id, trabajo_desc, utilizacion)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (purchase_id, item["product_id"], item["spare_part_id"], item["pieza_id"], item["descripcion"],
             item["codigo"], item["cantidad"], item["unidad"], item["precio_unitario"],
             item["descuento"], item["subtotal"], item["impuesto"], item["total"],
             item["costo_original"], item["peso_kg"], item["volumen_m3"],
             item["destino"], item["cliente_tipo"], item["cliente_id"], item["trabajo_tipo"],
             item["trabajo_id"], item["trabajo_desc"], item["utilizacion"]),
        )


def _recalc_import_costs(conn, cur, purchase_id):
    """Recalcula asignaciones, costo por item y totales de compra según costos."""
    if cur is None:
        with conn.cursor() as own_cur:
            _recalc_import_costs(conn, own_cur, purchase_id)
        return
    cur.execute("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
    purchase = dict(cur.fetchone())
    tc = _dec(purchase["tipo_cambio"], 1)

    cur.execute("SELECT * FROM import_costs WHERE purchase_id = %s AND NOT deleted ORDER BY id", (purchase_id,))
    costs = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT id, total FROM purchase_items WHERE purchase_id = %s ORDER BY id", (purchase_id,))
    item_rows = [dict(r) for r in cur.fetchall()]
    item_ids = [r["id"] for r in item_rows]

    total_costs = sum(_dec(c["monto_equivalente"]) for c in costs)

    # Limpieza y regeneración de asignaciones automáticas
    if costs:
        for c in costs:
            if c["distribuir"] and c["metodo_distribucion"] != "MANUAL":
                cur.execute("DELETE FROM import_cost_allocations WHERE cost_id = %s", (c["id"],))
                monto = _dec(c["monto_equivalente"])
                if monto <= 0 or not item_rows:
                    continue
                method = c["metodo_distribucion"]
                weights = {}
                for r in item_rows:
                    if method == "POR_CANTIDAD":
                        cur.execute("SELECT cantidad AS w FROM purchase_items WHERE id = %s", (r["id"],))
                        w = _dec(cur.fetchone()["w"])
                    elif method == "POR_PESO":
                        cur.execute("SELECT peso_kg AS w FROM purchase_items WHERE id = %s", (r["id"],))
                        w = _dec(cur.fetchone()["w"])
                    elif method == "POR_VOLUMEN":
                        cur.execute("SELECT volumen_m3 AS w FROM purchase_items WHERE id = %s", (r["id"],))
                        w = _dec(cur.fetchone()["w"])
                    else:  # POR_VALOR
                        w = _dec(r["total"])
                    if w and w > 0:
                        weights[r["id"]] = w
                total_w = sum(weights.values())
                if not weights or total_w <= 0:
                    continue
                allocated = Decimal("0")
                items_list = list(weights.items())
                for i, (iid, w) in enumerate(items_list):
                    if i == len(items_list) - 1:
                        amt = (monto - allocated).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                        amt = max(amt, Decimal("0"))
                    else:
                        amt = (monto * w / total_w).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    allocated += amt
                    if amt > 0:
                        cur.execute(
                            "INSERT INTO import_cost_allocations (cost_id, purchase_item_id, monto_asignado) "
                            "VALUES (%s,%s,%s)",
                            (c["id"], iid, amt),
                        )

    # Monto asignado y costo real por item
    asignado = {iid: Decimal("0") for iid in item_ids}
    if item_ids:
        cur.execute(
            "SELECT purchase_item_id, COALESCE(SUM(monto_asignado),0) AS m "
            "FROM import_cost_allocations WHERE purchase_item_id = ANY(%s) GROUP BY purchase_item_id",
            (item_ids,),
        )
        for r in cur.fetchall():
            asignado[r["purchase_item_id"]] = _dec(r["m"])
    for r in item_rows:
        a = asignado.get(r["id"], Decimal("0"))
        cur.execute(
            "UPDATE purchase_items SET costo_adicional_asignado = %s, costo_real = %s WHERE id = %s",
            (_r2(a), _r2(_dec(r["total"]) + a), r["id"]),
        )

    subtotal = sum(_dec(r["total"]) for r in item_rows)
    sub_raw = _dec(purchase["subtotal"])
    imp_raw = _dec(purchase["impuestos"])
    total = (sub_raw + imp_raw + total_costs).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    equivalente = (total * tc).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    cur.execute(
        "UPDATE purchases SET costos_adicionales = %s, total = %s, total_equivalente = %s WHERE id = %s",
        (_r2(total_costs), total, equivalente, purchase_id),
    )


def _create_purchase_impl(conn, payload, actor):
    tipo, moneda, tc, proveedor_id, items = _validate_purchase_payload(payload)
    con_igv = bool(payload.get("con_igv", tipo == "NACIONAL"))
    tasa_impuesto = payload.get("tasa_impuesto")
    if tasa_impuesto in (None, ""):
        tasa_impuesto = _igv_rate() if con_igv else 0

    with conn.cursor() as cur:
        codigo = _generate_purchase_code(cur)
        comprobante = _validate_comprobante(payload)
        cliente_tipo = _str_upper(payload.get("cliente_tipo")) if payload.get("cliente_tipo") not in (None, "") else None
        cliente_id = _dec_int(payload.get("cliente_id"))
        if cliente_id and cliente_tipo not in ("RUC", "DNI"):
            raise HTTPException(status_code=400, detail="cliente_tipo debe ser RUC o DNI cuando vinculaste un cliente")
        cur.execute(
            """INSERT INTO purchases
               (codigo_compra, tipo_compra, proveedor_id, fecha_compra, moneda, tipo_cambio,
                fecha_tipo_cambio, tipo_item, condiciones_pago, fecha_vencimiento, estado,
                estado_pago, observaciones, tipo_comprobante, serie_comprobante,
                numero_comprobante, cliente_tipo, cliente_id, created_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (codigo, tipo, proveedor_id, payload.get("fecha_compra") or date.today().isoformat(),
             moneda, tc, payload.get("fecha_tipo_cambio"),
             _str_upper(payload.get("tipo_item")) or None,
             payload.get("condiciones_pago") or None,
             payload.get("fecha_vencimiento") or None,
             _str_upper(payload.get("estado")) or "BORRADOR",
             "PENDIENTE", payload.get("observaciones") or None,
             comprobante[0], comprobante[1], comprobante[2], cliente_tipo, cliente_id, actor["id"]),
        )
        purchase = dict(cur.fetchone())
        purchase_id = purchase["id"]

        estado = _str_upper(payload.get("estado")) or "BORRADOR"
        if estado not in ESTADO_COMPRA:
            estado = "BORRADOR"
        cur.execute("UPDATE purchases SET estado = %s, subtotal = %s, impuestos = %s, total = %s "
                    "WHERE id = %s", (estado, 0, 0, 0, purchase_id))

        computed = _apply_item_taxes(items, con_igv, tasa_impuesto)
        _insert_purchase_items(cur, purchase_id, computed)

        subtotal = sum(i["subtotal"] for i in computed)
        impuestos = sum(i["impuesto"] for i in computed)
        costos = Decimal("0")
        total = (subtotal + impuestos + costos).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        equivalente = (total * tc).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        cur.execute(
            "UPDATE purchases SET subtotal = %s, impuestos = %s, costos_adicionales = %s, "
            "total = %s, total_equivalente = %s WHERE id = %s",
            (_r2(subtotal), _r2(impuestos), _r2(costos), total, equivalente, purchase_id),
        )

        # Vincular orden de compra si se indicó
        order_id = payload.get("purchase_order_id")
        if order_id:
            cur.execute("UPDATE purchases SET purchase_order_id = %s WHERE id = %s", (order_id, purchase_id))

        _history(conn, cur, purchase_id, TRANSICIONES_EVENTO.get(estado, "COMPRA_CREADA"),
                 None, estado, payload.get("observaciones") or "Compra creada", actor)

        cur.execute("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
        purchase = dict(cur.fetchone())
        return purchase, computed, con_igv, tasa_impuesto


@router.get("/purchases")
def list_purchases(
    page: int = 1,
    limit: int = 50,
    q: str = "",
    tipo: str = "",
    estado: str = "",
    estado_pago: str = "",
    moneda: str = "",
    proveedor_id: int = None,
    pais: str = "",
    date_from: str = None,
    date_to: str = None,
    producto: int = None,
    repuesto: int = None,
    destino: str = "",
    cliente_id: int = None,
    _: dict = Depends(require_permission("PURCHASES_VIEW")),
):
    def run():
        nonlocal page, limit
        conds = ["NOT p.deleted"]
        params = []
        if tipo:
            conds.append("p.tipo_compra = %s")
            params.append(_str_upper(tipo))
        if estado:
            conds.append("p.estado = %s")
            params.append(_str_upper(estado))
        if estado_pago:
            conds.append("p.estado_pago = %s")
            params.append(_str_upper(estado_pago))
        if moneda:
            conds.append("p.moneda = %s")
            params.append(_str_upper(moneda))
        if proveedor_id:
            conds.append("p.proveedor_id = %s")
            params.append(proveedor_id)
        if pais:
            conds.append("s.pais ILIKE %s")
            params.append(f"%{pais}%")
        if date_from:
            conds.append("p.fecha_compra >= %s")
            params.append(date_from)
        if date_to:
            conds.append("p.fecha_compra <= %s")
            params.append(date_to)
        if q:
            conds.append(
                "(p.codigo_compra ILIKE %s OR s.razon_social ILIKE %s OR s.numero_documento ILIKE %s "
                "OR EXISTS (SELECT 1 FROM purchase_items pi2 WHERE pi2.purchase_id = p.id "
                "AND (pi2.codigo ILIKE %s OR pi2.descripcion ILIKE %s)))"
            )
            like = f"%{q}%"
            params += [like] * 5
        if producto:
            conds.append("EXISTS (SELECT 1 FROM purchase_items pi3 WHERE pi3.purchase_id = p.id AND pi3.product_id = %s)")
            params.append(producto)
        if repuesto:
            conds.append("EXISTS (SELECT 1 FROM purchase_items pi4 WHERE pi4.purchase_id = p.id AND pi4.spare_part_id = %s)")
            params.append(repuesto)
        if destino:
            conds.append("EXISTS (SELECT 1 FROM purchase_items dpi WHERE dpi.purchase_id = p.id AND dpi.destino = %s)")
            params.append(_str_upper(destino))
        if cliente_id:
            conds.append("(p.cliente_id = %s OR EXISTS (SELECT 1 FROM purchase_items dpi2 WHERE dpi2.purchase_id = p.id AND dpi2.cliente_id = %s))")
            params += [cliente_id, cliente_id]

        wh = "WHERE " + " AND ".join(conds) if conds else ""
        total_row = db.fetch_one(
            f"SELECT COUNT(*)::int AS total FROM purchases p JOIN suppliers s ON s.id = p.proveedor_id {wh}",
            params or None,
        )
        total = total_row["total"] if total_row else 0
        page = max(1, page)
        limit = min(max(1, limit), 100)
        off = (page - 1) * limit

        rows = db.fetch_all(
            f"""SELECT p.*, s.razon_social AS supplier_name, s.tipo_documento AS supplier_tipo_doc,
                       s.numero_documento AS supplier_doc, s.pais AS supplier_pais,
                       COALESCE(ccr.razonsocial, cc.names || COALESCE(' ' || cc.last_names, '')) AS compra_cliente
                FROM purchases p
                JOIN suppliers s ON s.id = p.proveedor_id
                LEFT JOIN clients_ruc ccr ON p.cliente_tipo = 'RUC' AND p.cliente_id IS NOT NULL AND ccr.id = p.cliente_id
                LEFT JOIN clients cc ON p.cliente_tipo = 'DNI' AND p.cliente_id IS NOT NULL AND cc.id = p.cliente_id
                {wh}
                ORDER BY p.fecha_compra DESC, p.id DESC
                LIMIT {limit} OFFSET {off}""",
            params or None,
        )
        ids = [r["id"] for r in rows]
        paid_map = {}
        if ids:
            paid = db.fetch_all(
                """SELECT purchase_id,
                          COALESCE(SUM(monto * (tipo_cambio / (SELECT tipo_cambio FROM purchases x WHERE x.id = sp.purchase_id))), 0)::float AS paid
                   FROM supplier_payments sp
                   WHERE purchase_id = ANY(%s) AND NOT anulado
                   GROUP BY purchase_id""",
                (ids,),
            )
            paid_map = {r["purchase_id"]: r["paid"] for r in paid}
        meta = {}
        if ids:
            mrows = db.fetch_all(
                """SELECT pi.purchase_id,
                          pi.destino,
                          COALESCE(cr.razonsocial, c.names || COALESCE(' ' || c.last_names, '')) AS cliente
                   FROM purchase_items pi
                   LEFT JOIN clients_ruc cr ON pi.cliente_tipo = 'RUC' AND cr.id = pi.cliente_id
                   LEFT JOIN clients c ON pi.cliente_tipo = 'DNI' AND c.id = pi.cliente_id
                   WHERE pi.purchase_id = ANY(%s)""",
                (ids,),
            )
            for r in mrows:
                m = meta.setdefault(r["purchase_id"], {"destinos": set(), "clientes": set()})
                if r["destino"]:
                    m["destinos"].add(r["destino"])
                if r["cliente"]:
                    m["clientes"].add(r["cliente"])
        items = []
        for r in rows:
            it = dict(r)
            it["supplier"] = {
                "id": r["proveedor_id"],
                "razon_social": r["supplier_name"],
                "tipo_documento": r["supplier_tipo_doc"],
                "numero_documento": r["supplier_doc"],
                "pais": r["supplier_pais"],
            }
            paid = _dec(paid_map.get(it["id"], 0))
            it["total_pagado"] = float(paid)
            it["saldo"] = float(_dec(it["total"]) - paid)
            m = meta.get(it["id"], {"destinos": set(), "clientes": set()})
            it["destinos"] = sorted(m["destinos"])
            names = []
            if it.get("compra_cliente"):
                names.append(it["compra_cliente"])
            names.extend(sorted(m["clientes"]))
            _seen = set()
            it["clientes"] = []
            for n in names:
                if n and n not in _seen:
                    _seen.add(n)
                    it["clientes"].append(n)
            items.append(it)
        return {
            "items": items,
            "pagination": {"page": page, "limit": limit, "total": total,
                           "total_pages": (total + limit - 1) // limit},
        }
    return _guard(run)


@router.get("/purchases/stats")
def purchases_stats(_: dict = Depends(require_permission("PURCHASES_VIEW"))):
    def run():
        base_currency = str(_get_setting("base_currency", "PEN"))
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                # Compras del mes (mes en curso)
                cur.execute(
                    """SELECT COALESCE(SUM(total_equivalente),0)::float AS v
                       FROM purchases WHERE NOT deleted AND estado NOT IN ('BORRADOR','CANCELADA')
                       AND date_trunc('month', fecha_compra) = date_trunc('month', CURRENT_DATE)"""
                )
                mes_total = cur.fetchone()["v"]
                cur.execute(
                    """SELECT COUNT(*)::int AS n FROM purchases WHERE NOT deleted AND estado NOT IN ('BORRADOR','CANCELADA')
                       AND date_trunc('month', fecha_compra) = date_trunc('month', CURRENT_DATE)"""
                )
                mes_count = cur.fetchone()["n"]
                cur.execute(
                    """SELECT COALESCE(SUM(total_equivalente),0)::float AS v FROM purchases
                       WHERE NOT deleted AND tipo_compra = 'NACIONAL' AND estado NOT IN ('BORRADOR','CANCELADA')"""
                )
                total_nacional = cur.fetchone()["v"]
                cur.execute(
                    """SELECT COALESCE(SUM(total_equivalente),0)::float AS v FROM purchases
                       WHERE NOT deleted AND tipo_compra = 'INTERNACIONAL' AND estado NOT IN ('BORRADOR','CANCELADA')"""
                )
                total_internacional = cur.fetchone()["v"]
                # En moneda original para internacional (USD etc.)
                cur.execute(
                    """SELECT COALESCE(SUM(total),0)::float AS origen,
                              COALESCE(SUM(total_equivalente),0)::float AS equivalente
                       FROM purchases WHERE NOT deleted AND tipo_compra = 'INTERNACIONAL'
                       AND estado NOT IN ('BORRADOR','CANCELADA')"""
                )
                r_int = cur.fetchone()
                # Cuentas por pagar (saldo en moneda base equivalente)
                cur.execute(
                    """SELECT COALESCE(SUM(v.saldo * v.tipo_cambio),0)::float AS saldo,
                              COUNT(*)::int AS n
                       FROM v_accounts_payable v
                       WHERE NOT v.deleted AND v.estado NOT IN ('BORRADOR','CANCELADA') AND v.saldo > 0"""
                )
                ap = cur.fetchone()
                cur.execute(
                    """SELECT COUNT(*)::int AS n FROM purchases WHERE NOT deleted AND estado = 'EN_TRANSITO'"""
                )
                en_transito = cur.fetchone()["n"]
                cur.execute(
                    """SELECT COUNT(*)::int AS n FROM purchases WHERE NOT deleted
                       AND estado IN ('BORRADOR','ORDENADA','CONFIRMADA')"""
                )
                pend_recepcion = cur.fetchone()["n"]
                cur.execute(
                    """SELECT COUNT(*)::int AS n FROM purchases WHERE NOT deleted
                       AND tipo_compra = 'INTERNACIONAL'
                       AND EXISTS (SELECT 1 FROM purchase_imports pi WHERE pi.purchase_id = purchases.id
                                   AND pi.estado_logistico IN ('EMBARCADA','EN_TRANSITO','ARRIBADA','ADUANAS'))"""
                )
                transp = cur.fetchone()["n"]
                cur.execute(
                    """SELECT COALESCE(SUM(total_equivalente),0)::float AS equivalente,
                              COALESCE(SUM(total),0)::float AS origen,
                              COUNT(*)::int AS n
                       FROM purchases WHERE NOT deleted AND tipo_compra = 'INTERNACIONAL'
                       AND date_trunc('month', fecha_compra) = date_trunc('month', CURRENT_DATE)
                       AND estado NOT IN ('BORRADOR','CANCELADA')"""
                )
                imp_row = cur.fetchone()
                imp_mes_valor = imp_row["equivalente"]
                imp_mes_origen = imp_row["origen"]
                imp_mes_n = imp_row["n"]
                # Pagos del mes
                cur.execute(
                    """SELECT COALESCE(SUM(monto * tipo_cambio),0)::float AS v FROM supplier_payments
                       WHERE NOT anulado AND date_trunc('month', fecha_pago) = date_trunc('month', CURRENT_DATE)"""
                )
                pagos_mes = cur.fetchone()["v"]
        finally:
            db.close_conn(conn)
        return {
            "base_currency": base_currency,
            "mes": {"total_equivalente": mes_total, "count": mes_count},
            "nacional_total_equivalente": total_nacional,
            "internacional_total": r_int["origen"],
            "internacional_total_equivalente": r_int["equivalente"],
            "cuentas_por_pagar": {"saldo_equivalente": ap["saldo"], "count": ap["n"]},
            "en_transito_count": en_transito,
            "pendientes_recepcion": pend_recepcion,
            "internacional_en_logistica": transp,
            "importaciones_mes": {"total_equivalente": imp_mes_valor, "total_origen": imp_mes_origen,
                                  "count": imp_mes_n},
            "pagos_mes_equivalente": pagos_mes,
        }
    return _guard(run)


@router.get("/purchases/dashboard")
def purchases_dashboard(_: dict = Depends(require_permission("PURCHASES_VIEW"))):
    return purchases_stats(_)


@router.get("/purchases/report")
def purchases_report(
    fecha_inicio: str = None,
    fecha_fin: str = None,
    proveedor_id: int = None,
    tipo_compra: str = "",
    moneda: str = "",
    pais: str = "",
    estado_pago: str = "",
    producto: int = None,
    repuesto: int = None,
    _: dict = Depends(require_permission("PURCHASE_REPORTS_VIEW")),
):
    def run():
        conds = ["NOT p.deleted", "p.estado NOT IN ('BORRADOR','CANCELADA')"]
        params = []
        if fecha_inicio:
            conds.append("p.fecha_compra >= %s")
            params.append(fecha_inicio)
        if fecha_fin:
            conds.append("p.fecha_compra <= %s")
            params.append(fecha_fin)
        if proveedor_id:
            conds.append("p.proveedor_id = %s")
            params.append(proveedor_id)
        if tipo_compra:
            conds.append("p.tipo_compra = %s")
            params.append(_str_upper(tipo_compra))
        if moneda:
            conds.append("p.moneda = %s")
            params.append(_str_upper(moneda))
        if pais:
            conds.append("s.pais ILIKE %s")
            params.append(f"%{pais}%")
        if estado_pago:
            conds.append("p.estado_pago = %s")
            params.append(_str_upper(estado_pago))
        if producto:
            conds.append("EXISTS (SELECT 1 FROM purchase_items x1 WHERE x1.purchase_id=p.id AND x1.product_id=%s)")
            params.append(producto)
        if repuesto:
            conds.append("EXISTS (SELECT 1 FROM purchase_items x2 WHERE x2.purchase_id=p.id AND x2.spare_part_id=%s)")
            params.append(repuesto)
        wh = "WHERE " + " AND ".join(conds) if conds else ""
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"""SELECT p.*, s.razon_social, s.tipo_documento, s.numero_documento, s.pais,
                               COUNT(pi.id)::int AS n_items,
                               COALESCE(SUM(pay.monto * (pay.tipo_cambio / NULLIF(p.tipo_cambio,0))),0)::float AS pagado
                        FROM purchases p
                        JOIN suppliers s ON s.id = p.proveedor_id
                        LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
                        LEFT JOIN supplier_payments pay ON pay.purchase_id = p.id AND NOT pay.anulado
                        {wh}
                        GROUP BY p.id, s.razon_social, s.tipo_documento, s.numero_documento, s.pais
                        ORDER BY p.fecha_compra"""
                )
                rows = cur.fetchall()
        finally:
            db.close_conn(conn)
        items = []
        for r in rows:
            it = dict(r)
            it["saldo"] = float(_dec(it["total"]) - _dec(it["pagado"]))
            items.append(it)
        total_eq = sum(_dec(i["total_equivalente"]) for i in items)
        return {
            "items": items,
            "totales": {
                "n": len(items),
                "total_equivalente": float(total_eq),
                "pais": sorted({i["pais"] for i in items}),
                "monedas": sorted({i["moneda"] for i in items}),
            },
        }
    return _guard(run)


@router.post("/purchases")
def create_purchase(payload: dict, actor: dict = Depends(require_permission("PURCHASES_CREATE"))):
    def run():
        conn = db.get_conn()
        try:
            purchase, computed, con_igv, tasa = _create_purchase_impl(conn, payload, actor)
            _recalc_import_costs(conn, None, purchase["id"])
            conn.commit()
            _audit(actor, "purchase.create", "purchases", purchase["id"],
                   {"codigo": purchase["codigo_compra"], "total": float(purchase["total"])})
            return _serialize_purchase(conn, purchase, actor)
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al guardar la compra: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.get("/purchases/{purchase_id}")
def get_purchase(purchase_id: int, _: dict = Depends(require_permission("PURCHASES_VIEW"))):
    def run():
        row = db.fetch_one("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Compra no encontrada")
        conn = db.get_conn()
        try:
            return _serialize_purchase(conn, dict(row))
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.put("/purchases/{purchase_id}")
def update_purchase(purchase_id: int, payload: dict, actor: dict = Depends(require_permission("PURCHASES_UPDATE"))):
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
                existing = dict(cur.fetchone())
                if not existing or existing.get("deleted"):
                    raise HTTPException(status_code=404, detail="Compra no encontrada")

                has_receipts = None
                cur.execute(
                    "SELECT id FROM purchase_receipts WHERE purchase_id = %s AND NOT deleted LIMIT 1",
                    (purchase_id,),
                )
                if cur.fetchone():
                    has_receipts = True
                has_payments = None
                cur.execute(
                    "SELECT id FROM supplier_payments WHERE purchase_id = %s AND anulado = false LIMIT 1",
                    (purchase_id,),
                )
                has_payments = cur.fetchone()

                header = {}
                for k in ("tipo_compra", "proveedor_id", "fecha_compra", "moneda", "tipo_cambio",
                  "fecha_tipo_cambio", "condiciones_pago", "fecha_vencimiento",
                  "observaciones", "tipo_item", "estado", "estado_pago",
                  "tipo_comprobante", "serie_comprobante", "numero_comprobante",
                  "cliente_tipo", "cliente_id"):
                    if k in payload and payload[k] is not None:
                        header[k] = payload[k]
                if "tipo_comprobante" in header:
                    tc_doc, serie, numero = _validate_comprobante(header)
                    header["tipo_comprobante"] = tc_doc
                    header["serie_comprobante"] = serie
                    header["numero_comprobante"] = numero
                if "cliente_tipo" in payload or "cliente_id" in payload:
                    ct = _str_upper(payload.get("cliente_tipo")) if payload.get("cliente_tipo") not in (None, "") else None
                    ci = _dec_int(payload.get("cliente_id"))
                    if ci and ct not in ("RUC", "DNI"):
                        raise HTTPException(status_code=400, detail="cliente_tipo debe ser RUC o DNI cuando vinculaste un cliente")
                    if ct and not ci:
                        ct = None
                    header["cliente_tipo"] = ct
                    header["cliente_id"] = ci
                if "tipo_compra" in header:
                    header["tipo_compra"] = _str_upper(header["tipo_compra"])
                    if header["tipo_compra"] not in TIPO_COMPRA:
                        header.pop("tipo_compra")
                if "moneda" in header:
                    header["moneda"] = _str_upper(header["moneda"])
                if "tipo_cambio" in header:
                    tc = _dec(header["tipo_cambio"])
                    if tc <= 0:
                        raise HTTPException(status_code=400, detail="tipo_cambio debe ser mayor a 0")
                    header["tipo_cambio"] = tc
                if "estado" in header:
                    est = _str_upper(header["estado"])
                    if est in ESTADO_COMPRA and est != existing["estado"]:
                        prev = existing["estado"]
                        _history(conn, cur, purchase_id, TRANSICIONES_EVENTO.get(est, "COMPRA_MODIFICADA"),
                                 prev, est, "Estado de compra actualizado", actor)
                    header["estado"] = est if est in ESTADO_COMPRA else existing["estado"]
                if "estado_pago" in header:
                    ep = _str_upper(header["estado_pago"])
                    header["estado_pago"] = ep if ep in ESTADO_PAGO else existing["estado_pago"]

                if header:
                    sets = ", ".join([f"{k} = %s" for k in header])
                    cur.execute(f"UPDATE purchases SET {sets} WHERE id = %s RETURNING *",
                                [*header.values(), purchase_id])

                # Items: solo si no hay recepciones ni pagos
                if payload.get("items") is not None:
                    if has_receipts or has_payments:
                        raise HTTPException(
                            status_code=400,
                            detail="La compra ya tiene recepciones o pagos; no se pueden modificar sus items.",
                        )
                    cur.execute("UPDATE import_costs SET purchase_item_id = NULL WHERE purchase_id = %s",
                                (purchase_id,))
                    cur.execute("DELETE FROM purchase_items WHERE purchase_id = %s", (purchase_id,))
                    con_igv = bool(payload.get("con_igv", existing["tipo_compra"] == "NACIONAL"))
                    tasa = payload.get("tasa_impuesto")
                    if tasa in (None, ""):
                        tasa = _igv_rate() if con_igv else 0
                    computed = _apply_item_taxes(payload["items"], con_igv, tasa)
                    _insert_purchase_items(cur, purchase_id, computed)
                    subtotal = sum(i["subtotal"] for i in computed)
                    impuestos = sum(i["impuesto"] for i in computed)
                    cur.execute(
                        "UPDATE purchases SET subtotal = %s, impuestos = %s WHERE id = %s",
                        (_r2(subtotal), _r2(impuestos), purchase_id),
                    )
                    _recalc_import_costs(conn, cur, purchase_id)
                    _history(conn, cur, purchase_id, "COMPRA_MODIFICADA", existing["estado"],
                             existing["estado"], "Items de la compra actualizados", actor)

                cur.execute("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
                purchase = dict(cur.fetchone())
            conn.commit()
            _audit(actor, "purchase.update", "purchases", purchase_id, {})
            return _serialize_purchase(conn, purchase, actor)
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al actualizar la compra: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.post("/purchases/{purchase_id}/cancel")
def cancel_purchase(purchase_id: int, payload: dict, actor: dict = Depends(require_permission("PURCHASES_DELETE"))):
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
                existing = dict(cur.fetchone())
                if not existing or existing.get("deleted"):
                    raise HTTPException(status_code=404, detail="Compra no encontrada")
                if existing["estado"] == "CANCELADA":
                    raise HTTPException(status_code=400, detail="La compra ya está cancelada")
                paid = db.fetch_one(
                    "SELECT COALESCE(SUM(monto),0)::float AS m FROM supplier_payments "
                    "WHERE purchase_id = %s AND NOT anulado", (purchase_id,))
                if _dec(paid["m"]) > 0:
                    raise HTTPException(
                        status_code=400,
                        detail="La compra tiene pagos registrados. Anula primero los pagos antes de cancelar.",
                    )
                motivo = (payload.get("motivo") or "").strip() or "Cancelación sin motivo"
                prev = existing["estado"]
                cur.execute("UPDATE purchases SET estado = 'CANCELADA' WHERE id = %s", (purchase_id,))
                _history(conn, cur, purchase_id, "COMPRA_CANCELADA", prev, "CANCELADA", motivo, actor)
            conn.commit()
            _audit(actor, "purchase.cancel", "purchases", purchase_id, {"motivo": motivo})
            return {"ok": True}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al cancelar la compra: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.delete("/purchases/{purchase_id}")
def delete_purchase(purchase_id: int, actor: dict = Depends(require_permission("PURCHASES_DELETE"))):
    def run():
        row = db.fetch_one("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Compra no encontrada")
        paid = db.fetch_one(
            "SELECT COALESCE(SUM(monto),0)::float AS m FROM supplier_payments "
            "WHERE purchase_id = %s AND NOT anulado", (purchase_id,))
        receipts = db.fetch_one(
            "SELECT id FROM purchase_receipts WHERE purchase_id = %s AND NOT deleted LIMIT 1",
            (purchase_id,))
        if _dec(paid["m"]) > 0 or receipts:
            raise HTTPException(
                status_code=400,
                detail="La compra tiene pagos o recepciones. Usa 'Cancelar compra' para no perder el historial.",
            )
        db.execute("UPDATE purchases SET deleted = true WHERE id = %s", (purchase_id,), returning=None)
        _audit(actor, "purchase.delete", "purchases", purchase_id, {})
        return {"ok": True}
    return _guard(run)


# ============================================================================
# ÓRDENES DE COMPRA
# ============================================================================

def _serialize_order(conn, row):
    o = dict(row)
    sup = db.fetch_one(
        "SELECT id, razon_social, nombre_comercial, tipo_documento, numero_documento, pais, "
        "moneda_principal, condiciones_pago FROM suppliers WHERE id = %s", (o["proveedor_id"],))
    o["supplier"] = dict(sup) if sup else None
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM purchase_order_items WHERE order_id = %s ORDER BY id", (o["id"],))
        o["items"] = list(_resolve_items(cur, cur.fetchall()))
        cur.execute(
            "SELECT codigo_compra, id FROM purchases WHERE purchase_order_id = %s AND NOT deleted",
            (o["id"],),
        )
        o["linked_purchase"] = [dict(r) for r in cur.fetchall()]
    return o


@router.get("/purchase-orders")
def list_purchase_orders(
    page: int = 1,
    limit: int = 50,
    q: str = "",
    estado: str = "",
    proveedor_id: int = None,
    _: dict = Depends(require_permission("PURCHASE_ORDERS_VIEW")),
):
    def run():
        nonlocal page, limit
        conds = ["NOT o.deleted"]
        params = []
        if q:
            conds.append("(o.codigo_orden ILIKE %s OR s.razon_social ILIKE %s)")
            like = f"%{q}%"
            params += [like, like]
        if estado:
            conds.append("o.estado = %s")
            params.append(_str_upper(estado))
        if proveedor_id:
            conds.append("o.proveedor_id = %s")
            params.append(proveedor_id)
        wh = "WHERE " + " AND ".join(conds) if conds else ""
        total_row = db.fetch_one(
            f"SELECT COUNT(*)::int AS total FROM purchase_orders o JOIN suppliers s ON s.id=o.proveedor_id {wh}",
            params or None,
        )
        total = total_row["total"] if total_row else 0
        page = max(1, page)
        limit = min(max(1, limit), 100)
        off = (page - 1) * limit
        rows = db.fetch_all(
            f"""SELECT o.*, s.razon_social AS supplier_name, s.tipo_documento AS supplier_tipo_doc,
                       s.numero_documento AS supplier_doc, s.pais AS supplier_pais
                FROM purchase_orders o JOIN suppliers s ON s.id = o.proveedor_id
                {wh} ORDER BY o.fecha_orden DESC, o.id DESC LIMIT {limit} OFFSET {off}""",
            params or None,
        )
        items = []
        for r in rows:
            it = dict(r)
            it["supplier"] = {"id": r["proveedor_id"], "razon_social": r["supplier_name"],
                              "tipo_documento": r["supplier_tipo_doc"], "numero_documento": r["supplier_doc"],
                              "pais": r["supplier_pais"]}
            items.append(it)
        return {"items": items,
                "pagination": {"page": page, "limit": limit, "total": total,
                               "total_pages": (total + limit - 1) // limit}}
    return _guard(run)


@router.get("/purchase-orders/{order_id}")
def get_purchase_order(order_id: int, _: dict = Depends(require_permission("PURCHASE_ORDERS_VIEW"))):
    def run():
        row = db.fetch_one("SELECT * FROM purchase_orders WHERE id = %s", (order_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Orden de compra no encontrada")
        conn = db.get_conn()
        try:
            return _serialize_order(conn, dict(row))
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.post("/purchase-orders")
def create_purchase_order(payload: dict, actor: dict = Depends(require_permission("PURCHASE_ORDERS_CREATE"))):
    def run():
        proveedor_id = _require(payload.get("proveedor_id"), "proveedor_id es obligatorio")
        items = payload.get("items") or []
        if not items:
            raise HTTPException(status_code=400, detail="La orden debe tener al menos un item")
        tipo = _str_upper(payload.get("tipo_compra")) or "NACIONAL"
        if tipo not in TIPO_COMPRA:
            tipo = "NACIONAL"
        moneda = _str_upper(payload.get("moneda")) or "PEN"
        tc = _dec(payload.get("tipo_cambio"), 1)
        if tc <= 0:
            raise HTTPException(status_code=400, detail="tipo_cambio debe ser mayor a 0")
        con_igv = bool(payload.get("con_igv", tipo == "NACIONAL"))
        tasa = payload.get("tasa_impuesto")
        if tasa in (None, ""):
            tasa = _igv_rate() if con_igv else 0

        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                codigo = _generate_order_code(cur)
                cur.execute(
                    """INSERT INTO purchase_orders
                       (codigo_orden, proveedor_id, tipo_compra, fecha_orden, moneda, tipo_cambio,
                        condiciones_pago, fecha_estimada_entrega, estado, observaciones, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (codigo, proveedor_id, tipo, payload.get("fecha_orden") or date.today().isoformat(),
                     moneda, tc, payload.get("condiciones_pago") or None,
                     payload.get("fecha_estimada_entrega") or None,
                     _str_upper(payload.get("estado")) or "BORRADOR",
                     payload.get("observaciones") or None, actor["id"]),
                )
                order = dict(cur.fetchone())
                computed = _apply_item_taxes(items, con_igv, tasa)
                for it in computed:
                    cur.execute(
                        """INSERT INTO purchase_order_items
                           (order_id, product_id, spare_part_id, descripcion, codigo, cantidad, unidad,
                            precio_unitario, descuento, subtotal, impuesto, total)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (order["id"], it["product_id"], it["spare_part_id"], it["descripcion"],
                         it["codigo"], it["cantidad"], it["unidad"], it["precio_unitario"],
                         it["descuento"], it["subtotal"], it["impuesto"], it["total"]),
                    )
                subtotal = sum(i["subtotal"] for i in computed)
                impuestos = sum(i["impuesto"] for i in computed)
                total = (subtotal + impuestos).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                cur.execute("UPDATE purchase_orders SET subtotal = %s, impuestos = %s, total = %s WHERE id = %s",
                            (_r2(subtotal), _r2(impuestos), total, order["id"]))
                cur.execute("SELECT * FROM purchase_orders WHERE id = %s", (order["id"],))
                order = dict(cur.fetchone())
            conn.commit()
            _audit(actor, "order.create", "purchase_orders", order["id"], {"codigo": order["codigo_orden"]})
            return _serialize_order(conn, order, )
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al guardar la orden: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.put("/purchase-orders/{order_id}")
def update_purchase_order(order_id: int, payload: dict, actor: dict = Depends(require_permission("PURCHASE_ORDERS_UPDATE"))):
    def run():
        existing = db.fetch_one("SELECT * FROM purchase_orders WHERE id = %s", (order_id,))
        if not existing or existing.get("deleted"):
            raise HTTPException(status_code=404, detail="Orden de compra no encontrada")
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                header = {}
                for k in ("proveedor_id", "tipo_compra", "fecha_orden", "moneda", "tipo_cambio",
                          "condiciones_pago", "fecha_estimada_entrega", "estado", "observaciones"):
                    if k in payload and payload[k] is not None:
                        header[k] = payload[k]
                if "tipo_compra" in header:
                    header["tipo_compra"] = _str_upper(header["tipo_compra"])
                    if header["tipo_compra"] not in TIPO_COMPRA:
                        header.pop("tipo_compra")
                if "estado" in header:
                    est = _str_upper(header["estado"])
                    if est not in ESTADO_ORDEN:
                        header.pop("estado")
                    else:
                        header["estado"] = est
                if header:
                    sets = ", ".join([f"{k} = %s" for k in header])
                    cur.execute(f"UPDATE purchase_orders SET {sets} WHERE id = %s RETURNING *",
                                [*header.values(), order_id])
                if payload.get("items") is not None:
                    linked = cur.execute(
                        "SELECT id FROM purchases WHERE purchase_order_id = %s AND NOT deleted", (order_id,))
                    linked_purchases = cur.fetchall()
                    cur.execute("DELETE FROM purchase_order_items WHERE order_id = %s", (order_id,))
                    con_igv = bool(payload.get("con_igv", existing["tipo_compra"] == "NACIONAL"))
                    tasa = payload.get("tasa_impuesto")
                    if tasa in (None, ""):
                        tasa = _igv_rate() if con_igv else 0
                    computed = _apply_item_taxes(payload["items"], con_igv, tasa)
                    for it in computed:
                        cur.execute(
                            """INSERT INTO purchase_order_items
                               (order_id, product_id, spare_part_id, descripcion, codigo, cantidad, unidad,
                                precio_unitario, descuento, subtotal, impuesto, total)
                               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                            (order_id, it["product_id"], it["spare_part_id"], it["descripcion"],
                             it["codigo"], it["cantidad"], it["unidad"], it["precio_unitario"],
                             it["descuento"], it["subtotal"], it["impuesto"], it["total"]),
                        )
                    subtotal = sum(i["subtotal"] for i in computed)
                    impuestos = sum(i["impuesto"] for i in computed)
                    total = (subtotal + impuestos).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    cur.execute(
                        "UPDATE purchase_orders SET subtotal = %s, impuestos = %s, total = %s WHERE id = %s",
                        (_r2(subtotal), _r2(impuestos), total, order_id),
                    )
                    if linked_purchases:
                        # Recalcular compras vinculadas
                        for lp in linked_purchases:
                            _recalc_import_costs(conn, None, lp["id"])
                cur.execute("SELECT * FROM purchase_orders WHERE id = %s", (order_id,))
                order = dict(cur.fetchone())
            conn.commit()
            _audit(actor, "order.update", "purchase_orders", order_id, {})
            return _serialize_order(conn, order)
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al actualizar la orden: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


_ORDER_TRANSITIONS = {
    "BORRADOR": ("ENVIADA", "CANCELADA"),
    "ENVIADA": ("ACEPTADA", "RECHAZADA", "CANCELADA"),
    "ACEPTADA": ("RECIBIDA", "CANCELADA"),
    "RECHAZADA": ("CANCELADA",),
    "RECIBIDA": (),
    "CANCELADA": (),
}


@router.put("/purchase-orders/{order_id}/status")
def set_purchase_order_status(order_id: int, payload: dict, actor: dict = Depends(require_permission("PURCHASE_ORDERS_UPDATE"))):
    def run():
        row = db.fetch_one("SELECT * FROM purchase_orders WHERE id = %s", (order_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Orden de compra no encontrada")
        nuevo = _str_upper(payload.get("estado"))
        if nuevo not in ESTADO_ORDEN:
            raise HTTPException(status_code=400, detail="Estado de orden inválido")
        if nuevo == row["estado"]:
            return dict(row)
        allowed = _ORDER_TRANSITIONS.get(row["estado"], ())
        if nuevo not in allowed:
            raise HTTPException(status_code=400,
                                detail=f"Transición no permitida: {row['estado']} → {nuevo}")
        db.execute("UPDATE purchase_orders SET estado = %s WHERE id = %s RETURNING *",
                   (nuevo, order_id))
        rbac.audit(actor["id"], actor["email"], "order.status", "purchase_orders", order_id,
                   {"de": row["estado"], "a": nuevo})
        return {"ok": True}
    return _guard(run)


@router.post("/purchase-orders/{order_id}/to-purchase")
def order_to_purchase(order_id: int, actor: dict = Depends(require_permission("PURCHASES_CREATE"))):
    """Convierte una orden aceptada en una compra vinculada (copia items)."""
    def run():
        row = db.fetch_one("SELECT * FROM purchase_orders WHERE id = %s", (order_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Orden de compra no encontrada")
        if row["estado"] not in ("ACEPTADA", "ENVIADA", "BORRADOR"):
            raise HTTPException(status_code=400,
                                detail="Solo se puede convertir a compra una orden ENVIADA o ACEPTADA")
        linked = db.fetch_one("SELECT id FROM purchases WHERE purchase_order_id = %s AND NOT deleted", (order_id,))
        if linked:
            raise HTTPException(status_code=400,
                                detail=f"Ya existe la compra {linked['id']} vinculada a esta orden")
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchase_order_items WHERE order_id = %s ORDER BY id", (order_id,))
                o_items = [dict(r) for r in cur.fetchall()]
                payload = {
                    "tipo_compra": row["tipo_compra"],
                    "proveedor_id": row["proveedor_id"],
                    "fecha_compra": date.today().isoformat(),
                    "moneda": row["moneda"],
                    "tipo_cambio": float(row["tipo_cambio"]),
                    "condiciones_pago": row["condiciones_pago"],
                    "purchase_order_id": order_id,
                    "estado": "ORDENADA",
                    "observaciones": f"Generada desde la orden {row['codigo_orden']}",
                    "items": [
                        {
                            "product_id": it["product_id"],
                            "spare_part_id": it["spare_part_id"],
                            "descripcion": it["descripcion"],
                            "codigo": it["codigo"],
                            "cantidad": float(it["cantidad"]),
                            "unidad": it["unidad"],
                            "precio_unitario": float(it["precio_unitario"]),
                            "descuento": float(it["descuento"]),
                            "tasa_impuesto": float(it["impuesto"] / it["subtotal"]) if it["subtotal"] else 0,
                        }
                        for it in o_items
                    ],
                }
            purchase, computed, con_igv, tasa = _create_purchase_impl(conn, payload, actor)
            _recalc_import_costs(conn, None, purchase["id"])
            with conn.cursor() as cur:
                cur.execute("UPDATE purchase_orders SET estado = 'ENVIADA' WHERE id = %s", (order_id,))
            conn.commit()
            _audit(actor, "order.to_purchase", "purchases", purchase["id"],
                   {"order": order_id, "codigo": purchase["codigo_compra"]})
            return _serialize_purchase(conn, purchase, actor)
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al convertir la orden: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.delete("/purchase-orders/{order_id}")
def delete_purchase_order(order_id: int, actor: dict = Depends(require_permission("PURCHASE_ORDERS_DELETE"))):
    def run():
        row = db.fetch_one("SELECT * FROM purchase_orders WHERE id = %s", (order_id,))
        if not row or row.get("deleted"):
            raise HTTPException(status_code=404, detail="Orden no encontrada")
        linked = db.fetch_one("SELECT id FROM purchases WHERE purchase_order_id = %s AND NOT deleted", (order_id,))
        if linked:
            raise HTTPException(status_code=400, detail="La orden tiene una compra vinculada; no se puede eliminar")
        db.execute("UPDATE purchase_orders SET deleted = true WHERE id = %s", (order_id,), returning=None)
        _audit(actor, "order.delete", "purchase_orders", order_id, {})
        return {"ok": True}
    return _guard(run)


# ============================================================================
# RECEPCIONES DE MERCADERÍA
# ============================================================================

def _recompute_purchase_after_receipts(cur, purchase_id, actor, motivo="Recepción registrada"):
    """Actualiza el estado de la compra según la suma recibida."""
    cur.execute("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
    purchase = dict(cur.fetchone())
    if not purchase or purchase.get("deleted") or purchase["estado"] == "CANCELADA":
        return
    cur.execute(
        """SELECT pi.id, pi.cantidad, pi.product_id, pi.spare_part_id,
                  COALESCE(rcv.total_recibido,0) AS recibido
           FROM purchase_items pi
           LEFT JOIN (
               SELECT pri.purchase_item_id, COALESCE(SUM(pri.cantidad_recibida),0) AS total_recibido
               FROM purchase_receipt_items pri
               JOIN purchase_receipts r ON r.id = pri.receipt_id AND NOT r.deleted
               WHERE pri.purchase_item_id IS NOT NULL
               GROUP BY pri.purchase_item_id
           ) rcv ON rcv.purchase_item_id = pi.id
           WHERE pi.purchase_id = %s""",
        (purchase_id,),
    )
    item_rows = [dict(r) for r in cur.fetchall()]
    if not item_rows:
        return
    all_complete = True
    any_received = False
    for r in item_rows:
        received = _dec(r["recibido"])
        if received > 0:
            any_received = True
        if received < _dec(r["cantidad"]):
            all_complete = False
    if not any_received:
        nuevo = "ORDENADA"
    elif all_complete:
        nuevo = "RECIBIDA_COMPLETA"
    else:
        nuevo = "RECIBIDA_PARCIAL"

    prev = purchase["estado"]
    if prev in ("BORRADOR", "ORDENADA", "CONFIRMADA", "EN_TRANSITO", "RECIBIDA_PARCIAL", "RECIBIDA_COMPLETA"):
        if nuevo != prev:
            cur.execute(
                "INSERT INTO purchase_status_history (purchase_id, evento, estado_previo, estado_nuevo, "
                "descripcion, user_id, user_email) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (purchase_id, "MERCADERIA_RECIBIDA", prev, nuevo, motivo, actor["id"], actor["email"]),
            )
            cur.execute("UPDATE purchases SET estado = %s WHERE id = %s", (nuevo, purchase_id))

            # Si la compra completa y está vinculada a una orden -> marcar la orden RECIBIDA
            if nuevo == "RECIBIDA_COMPLETA":
                cur.execute("SELECT purchase_order_id FROM purchases WHERE id = %s", (purchase_id,))
                po = cur.fetchone()
                if po and po["purchase_order_id"]:
                    cur.execute("UPDATE purchase_orders SET estado = 'RECIBIDA' WHERE id = %s",
                                (po["purchase_order_id"],))


def _stock_movement(cur, conn, item_type, item_id, cantidad, purchase_id, receipt_id, actor, previo):
    """Inserta un movimiento de inventario y devuelve el nuevo stock."""
    new_stock = previo + cantidad
    cur.execute(
        """INSERT INTO inventory_movements
           (item_type, item_id, tipo_movimiento, cantidad, stock_previo, stock_nuevo,
            referencia_tipo, referencia_id, user_id, user_email, observaciones)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (item_type, item_id, "INVENTARIO_ENTRADA", cantidad, previo, new_stock,
         "purchase_receipt", receipt_id, actor["id"], actor["email"],
         f"Recepción de compra #{receipt_id}"),
    )
    return new_stock


@router.post("/purchase-receipts")
def create_purchase_receipt(payload: dict, actor: dict = Depends(require_permission("PURCHASE_RECEIPTS_CREATE"))):
    def run():
        purchase_id = _require(payload.get("purchase_id"), "purchase_id es obligatorio")
        items = payload.get("items") or []
        if not items:
            raise HTTPException(status_code=400, detail="La recepción debe tener al menos un item")
        confirm_dif = bool(payload.get("confirm_difference"))

        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
                purchase = dict(cur.fetchone())
                if not purchase or purchase.get("deleted"):
                    raise HTTPException(status_code=404, detail="Compra no encontrada")
                if purchase["estado"] in ("BORRADOR", "CANCELADA"):
                    raise HTTPException(
                        status_code=400,
                        detail=f"No se puede recibir una compra en estado {purchase['estado']}",
                    )
                cur.execute(
                    "SELECT * FROM purchase_items WHERE purchase_id = %s ORDER BY id", (purchase_id,))
                purchase_items = [dict(r) for r in cur.fetchall()]
                pi_by_id = {str(pi["id"]): pi for pi in purchase_items}
                pend = {}
                for pi in purchase_items:
                    pend[str(pi["id"])] = _dec(pi["cantidad"])
                # Cantidad ya recibida en recepciones no anuladas
                cur.execute(
                    """SELECT pri.purchase_item_id, COALESCE(SUM(pri.cantidad_recibida),0) AS rec
                       FROM purchase_receipt_items pri
                       JOIN purchase_receipts r ON r.id = pri.receipt_id AND NOT r.deleted
                       WHERE pri.purchase_item_id = ANY(%s)
                       GROUP BY pri.purchase_item_id""",
                    ([pi["id"] for pi in purchase_items],),
                )
                for r in cur.fetchall():
                    pend[str(r["purchase_item_id"])] -= _dec(r["rec"])

                codigo = _generate_receipt_code(cur)
                cur.execute(
                    """INSERT INTO purchase_receipts
                       (codigo_recepcion, purchase_id, purchase_order, proveedor_id, fecha_recepcion,
                        estado, observaciones, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (codigo, purchase_id, payload.get("purchase_order_id"),
                     purchase["proveedor_id"], payload.get("fecha_recepcion") or date.today().isoformat(),
                     "RECIBIDA", payload.get("observaciones") or None, actor["id"]),
                )
                receipt = dict(cur.fetchone())

                diffs = []
                for it in items:
                    pi_id = it.get("purchase_item_id")
                    pi = pi_by_id.get(str(pi_id))
                    if not pi:
                        raise HTTPException(status_code=400,
                                            detail=f"Item de compra inválido: {pi_id} (posible recepción duplicada)")
                    qty = _dec(it.get("cantidad_recibida"), 0)
                    danada = _dec(it.get("cantidad_danada"), 0)
                    faltante = _dec(it.get("cantidad_faltante"), 0)
                    if qty <= 0:
                        raise HTTPException(status_code=400, detail="La cantidad recibida debe ser mayor a 0")
                    if danada < 0 or faltante < 0 or qty < 0:
                        raise HTTPException(status_code=400, detail="Las cantidades no pueden ser negativas")
                    pendiente = pend.get(str(pi_id), Decimal("0"))
                    if qty > pendiente and not confirm_dif:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Recepción mayor al pendiente ({float(pendiente)}). "
                                   f"Recibe solo lo pendiente o usa 'confirmar diferencia'.",
                        )
                    if qty > pendiente:
                        diffs.append({"purchase_item_id": pi_id, "pendiente": float(pendiente),
                                      "recibido": float(qty)})
                    cur.execute(
                        """INSERT INTO purchase_receipt_items
                           (receipt_id, purchase_item_id, product_id, spare_part_id, descripcion,
                            cantidad_solicitada, cantidad_recibida, cantidad_danada, cantidad_faltante,
                            observaciones)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (receipt["id"], pi_id, pi["product_id"], pi["spare_part_id"], pi["descripcion"],
                         pend.get(str(pi_id), pi["cantidad"]), qty, danada, faltante,
                         it.get("observaciones") or None),
                    )
                    # Ingreso a inventario (BIENES con catálogo)
                    if qty > 0 and pi["product_id"]:
                        cur.execute("SELECT stock FROM machine_products WHERE id = %s", (pi["product_id"],))
                        r0 = cur.fetchone()
                        previo = _dec(r0["stock"]) if r0 else Decimal("0")
                        nuevo = _stock_movement(cur, conn, "product", pi["product_id"], qty,
                                                purchase_id, receipt["id"], actor, previo)
                        cur.execute("UPDATE machine_products SET stock = %s WHERE id = %s",
                                    (nuevo, pi["product_id"]))
                    elif qty > 0 and pi["spare_part_id"]:
                        cur.execute("SELECT stock FROM spare_parts WHERE id = %s", (pi["spare_part_id"],))
                        r0 = cur.fetchone()
                        previo = _dec(r0["stock"]) if r0 else Decimal("0")
                        nuevo = _stock_movement(cur, conn, "spare_part", pi["spare_part_id"], qty,
                                                purchase_id, receipt["id"], actor, previo)
                        cur.execute("UPDATE spare_parts SET stock = %s WHERE id = %s",
                                    (nuevo, pi["spare_part_id"]))

                _recompute_purchase_after_receipts(cur, purchase_id, actor)

                cur.execute("SELECT * FROM purchase_receipts WHERE id = %s", (receipt["id"],))
                receipt = dict(cur.fetchone())
            conn.commit()
            _audit(actor, "receipt.create", "purchase_receipts", receipt["id"],
                   {"purchase": purchase_id, "codigo": receipt["codigo_recepcion"]})
            return {"receipt": receipt, "differences": diffs}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al registrar la recepción: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.get("/purchase-receipts")
def list_purchase_receipts(
    page: int = 1,
    limit: int = 50,
    q: str = "",
    purchase_id: int = None,
    _: dict = Depends(require_permission("PURCHASE_RECEIPTS_VIEW")),
):
    def run():
        nonlocal page, limit
        conds = ["NOT r.deleted"]
        params = []
        if q:
            conds.append("(r.codigo_recepcion ILIKE %s OR s.razon_social ILIKE %s OR p.codigo_compra ILIKE %s)")
            like = f"%{q}%"
            params += [like] * 3
        if purchase_id:
            conds.append("r.purchase_id = %s")
            params.append(purchase_id)
        wh = "WHERE " + " AND ".join(conds) if conds else ""
        total_row = db.fetch_one(
            f"""SELECT COUNT(*)::int AS total FROM purchase_receipts r
                JOIN purchases p ON p.id = r.purchase_id
                JOIN suppliers s ON s.id = r.proveedor_id {wh}""",
            params or None,
        )
        total = total_row["total"] if total_row else 0
        page = max(1, page)
        limit = min(max(1, limit), 100)
        off = (page - 1) * limit
        rows = db.fetch_all(
            f"""SELECT r.*, p.codigo_compra, p.moneda, p.tipo_compra AS ptype,
                       s.razon_social AS supplier_name, p.total
                FROM purchase_receipts r
                JOIN purchases p ON p.id = r.purchase_id
                JOIN suppliers s ON s.id = r.proveedor_id
                {wh} ORDER BY r.fecha_recepcion DESC, r.id DESC LIMIT {limit} OFFSET {off}""",
            params or None,
        )
        items = []
        for r in rows:
            items.append(dict(r))
        return {"items": items,
                "pagination": {"page": page, "limit": limit, "total": total,
                               "total_pages": (total + limit - 1) // limit}}
    return _guard(run)


@router.get("/purchase-receipts/{receipt_id}")
def get_purchase_receipt(receipt_id: int, _: dict = Depends(require_permission("PURCHASE_RECEIPTS_VIEW"))):
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchase_receipts WHERE id = %s", (receipt_id,))
                receipt = dict(cur.fetchone())
                if not receipt or receipt.get("deleted"):
                    raise HTTPException(status_code=404, detail="Recepción no encontrada")
                cur.execute("SELECT * FROM purchase_receipt_items WHERE receipt_id = %s ORDER BY id",
                            (receipt_id,))
                items = list(_resolve_items(cur, cur.fetchall()))
            receipt["items"] = items
            return receipt
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.delete("/purchase-receipts/{receipt_id}")
def delete_purchase_receipt(receipt_id: int, payload: dict, actor: dict = Depends(require_permission("PURCHASE_RECEIPTS_DELETE"))):
    def run():
        conn = db.get_conn()
        motivo = (payload or {}).get("motivo") or "Recepción anulada"
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchase_receipts WHERE id = %s", (receipt_id,))
                receipt = dict(cur.fetchone())
                if not receipt or receipt.get("deleted"):
                    raise HTTPException(status_code=404, detail="Recepción no encontrada")
                cur.execute("SELECT * FROM purchase_receipt_items WHERE receipt_id = %s ORDER BY id",
                            (receipt_id,))
                r_items = [dict(r) for r in cur.fetchall()]
                # Revertir stock
                for ri in r_items:
                    qty = _dec(ri["cantidad_recibida"])
                    if qty <= 0:
                        continue
                    if ri["product_id"]:
                        cur.execute("SELECT stock FROM machine_products WHERE id = %s", (ri["product_id"],))
                        r0 = cur.fetchone()
                        previo = _dec(r0["stock"]) if r0 else Decimal("0")
                        nuevo = previo - qty
                        cur.execute(
                            """INSERT INTO inventory_movements
                               (item_type, item_id, tipo_movimiento, cantidad, stock_previo, stock_nuevo,
                                referencia_tipo, referencia_id, user_id, user_email, observaciones)
                               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                            ("product", ri["product_id"], "AJUSTE", -qty, previo, nuevo,
                             "purchase_receipt", receipt_id, actor["id"], actor["email"], motivo),
                        )
                        cur.execute("UPDATE machine_products SET stock = %s WHERE id = %s",
                                    (nuevo, ri["product_id"]))
                    elif ri["spare_part_id"]:
                        cur.execute("SELECT stock FROM spare_parts WHERE id = %s", (ri["spare_part_id"],))
                        r0 = cur.fetchone()
                        previo = _dec(r0["stock"]) if r0 else Decimal("0")
                        nuevo = previo - qty
                        cur.execute(
                            """INSERT INTO inventory_movements
                               (item_type, item_id, tipo_movimiento, cantidad, stock_previo, stock_nuevo,
                                referencia_tipo, referencia_id, user_id, user_email, observaciones)
                               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                            ("spare_part", ri["spare_part_id"], "AJUSTE", -qty, previo, nuevo,
                             "purchase_receipt", receipt_id, actor["id"], actor["email"], motivo),
                        )
                        cur.execute("UPDATE spare_parts SET stock = %s WHERE id = %s",
                                    (nuevo, ri["spare_part_id"]))
                cur.execute("UPDATE purchase_receipts SET deleted = true, estado = 'ANULADA' WHERE id = %s",
                            (receipt_id,))
                _recompute_purchase_after_receipts(cur, receipt["purchase_id"], actor,
                                                   motivo="Recepción anulada")
            conn.commit()
            _audit(actor, "receipt.delete", "purchase_receipts", receipt_id, {"motivo": motivo})
            return {"ok": True}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al anular la recepción: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


# ============================================================================
# PAGOS A PROVEEDORES
# ============================================================================

def _recompute_payment_status(conn, cur, purchase_id):
    """Recalcula estado_pago según la suma de pagos no anulados."""
    cur.execute("SELECT tipo_cambio, total FROM purchases WHERE id = %s", (purchase_id,))
    purchase = dict(cur.fetchone())
    if not purchase:
        return None
    tc = _dec(purchase["tipo_cambio"], 1)
    cur.execute(
        "SELECT monto, tipo_cambio FROM supplier_payments WHERE purchase_id = %s AND NOT anulado",
        (purchase_id,),
    )
    paid = sum(_dec(r["monto"]) * (_dec(r["tipo_cambio"], 1) / tc) for r in cur.fetchall())
    total = _dec(purchase["total"])
    estado = "PENDIENTE"
    if paid >= total and total > 0:
        estado = "PAGADA"
    elif paid > 0:
        estado = "PAGADA_PARCIAL"
    cur.execute("UPDATE purchases SET estado_pago = %s WHERE id = %s", (estado, purchase_id))
    return estado


@router.get("/supplier-payments")
def list_supplier_payments(
    page: int = 1,
    limit: int = 50,
    q: str = "",
    purchase_id: int = None,
    _: dict = Depends(require_permission("SUPPLIER_PAYMENTS_VIEW")),
):
    def run():
        nonlocal page, limit
        conds = ["sp.anulado = false"]
        params = []
        if q:
            conds.append("(s.razon_social ILIKE %s OR sp.numero_operacion ILIKE %s OR p.codigo_compra ILIKE %s)")
            like = f"%{q}%"
            params += [like] * 3
        if purchase_id:
            conds.append("sp.purchase_id = %s")
            params.append(purchase_id)
        wh = "WHERE " + " AND ".join(conds) if conds else ""
        total_row = db.fetch_one(
            f"""SELECT COUNT(*)::int AS total FROM supplier_payments sp
                JOIN purchases p ON p.id = sp.purchase_id
                JOIN suppliers s ON s.id = sp.supplier_id {wh}""",
            params or None,
        )
        total = total_row["total"] if total_row else 0
        page = max(1, page)
        limit = min(max(1, limit), 100)
        off = (page - 1) * limit
        rows = db.fetch_all(
            f"""SELECT sp.*, s.razon_social AS supplier_name, p.codigo_compra, p.total AS purchase_total,
                       p.tipo_cambio AS purchase_tc
                FROM supplier_payments sp
                JOIN purchases p ON p.id = sp.purchase_id
                JOIN suppliers s ON s.id = sp.supplier_id
                {wh} ORDER BY sp.fecha_pago DESC, sp.id DESC LIMIT {limit} OFFSET {off}""",
            params or None,
        )
        items = [dict(r) for r in rows]
        return {"items": items,
                "pagination": {"page": page, "limit": limit, "total": total,
                               "total_pages": (total + limit - 1) // limit}}
    return _guard(run)


@router.post("/supplier-payments")
def create_supplier_payment(payload: dict, actor: dict = Depends(require_permission("SUPPLIER_PAYMENTS_CREATE"))):
    def run():
        purchase_id = _require(payload.get("purchase_id"), "purchase_id es obligatorio")
        monto = _dec(payload.get("monto"))
        if monto <= 0:
            raise HTTPException(status_code=400, detail="El monto del pago debe ser mayor a 0")
        medio = _str_upper(payload.get("medio_pago"))
        if not medio:
            raise HTTPException(status_code=400, detail="El medio de pago es obligatorio")
        tc = _dec(payload.get("tipo_cambio"), 1)
        if tc <= 0:
            raise HTTPException(status_code=400, detail="tipo_cambio debe ser mayor a 0")
        moneda = _str_upper(payload.get("moneda")) or "PEN"
        if moneda not in MONEDAS:
            raise HTTPException(status_code=400, detail="Moneda no válida")

        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchases WHERE id = %s", (purchase_id,))
                purchase = dict(cur.fetchone())
                if not purchase or purchase.get("deleted"):
                    raise HTTPException(status_code=404, detail="Compra no encontrada")
                if purchase["estado"] == "CANCELADA":
                    raise HTTPException(status_code=400, detail="No se pueden registrar pagos en compras canceladas")
                cur.execute(
                    "SELECT monto, tipo_cambio FROM supplier_payments "
                    "WHERE purchase_id = %s AND NOT anulado", (purchase_id,))
                tc_compra = _dec(purchase["tipo_cambio"], 1)
                paid = sum(_dec(r["monto"]) * (_dec(r["tipo_cambio"], 1) / tc_compra) for r in cur.fetchall())
                saldo = _dec(purchase["total"]) - paid
                if monto > saldo and not payload.get("allow_overpayment"):
                    raise HTTPException(status_code=400,
                                        detail=f"El pago ({float(monto)}) supera el saldo ({float(saldo)}). "
                                               "Usa 'permitir sobrepago' solo para anticipos.")
                cur.execute(
                    """INSERT INTO supplier_payments
                       (purchase_id, supplier_id, fecha_pago, moneda, monto, tipo_cambio,
                        medio_pago, numero_operacion, banco, observaciones, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (purchase_id, purchase["proveedor_id"],
                     payload.get("fecha_pago") or date.today().isoformat(),
                     moneda, monto, tc, medio, payload.get("numero_operacion") or None,
                     payload.get("banco") or None, payload.get("observaciones") or None, actor["id"]),
                )
                payment = dict(cur.fetchone())
                estado = _recompute_payment_status(conn, cur, purchase_id)
                cur.execute(
                    "INSERT INTO purchase_status_history (purchase_id, evento, estado_previo, estado_nuevo, "
                    "descripcion, user_id, user_email) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (purchase_id, "PAGO_REGISTRADO", purchase["estado_pago"], estado,
                     f"Pago {payment['id']} por {monto} ({moneda})", actor["id"], actor["email"]),
                )
            conn.commit()
            _audit(actor, "payment.create", "supplier_payments", payment["id"],
                   {"purchase": purchase_id, "monto": float(monto)})
            payment["purchase_estado_pago"] = estado
            return payment
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al registrar el pago: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.put("/supplier-payments/{payment_id}/cancel")
def cancel_supplier_payment(payment_id: int, payload: dict, actor: dict = Depends(require_permission("SUPPLIER_PAYMENTS_UPDATE"))):
    """Anula un pago (no lo borra físicamente)."""
    def run():
        motivo = (payload.get("motivo") or "").strip()
        if not motivo:
            raise HTTPException(status_code=400, detail="El motivo de anulación es obligatorio")
        row = db.fetch_one("SELECT * FROM supplier_payments WHERE id = %s", (payment_id,))
        if not row:
            raise HTTPException(status_code=404, detail="Pago no encontrado")
        if row["anulado"]:
            raise HTTPException(status_code=400, detail="El pago ya está anulado")
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE supplier_payments SET anulado = true, motivo_anulacion = %s, "
                    "fecha_anulacion = now() WHERE id = %s RETURNING *", (motivo, payment_id))
                payment = dict(cur.fetchone())
                estado = _recompute_payment_status(conn, cur, payment["purchase_id"])
                cur.execute(
                    "INSERT INTO purchase_status_history (purchase_id, evento, estado_previo, estado_nuevo, "
                    "descripcion, user_id, user_email) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (payment["purchase_id"], "PAGO_ANULADO", payment["monto"], estado,
                     f"Anulación del pago {payment_id}: {motivo}", actor["id"], actor["email"]),
                )
            conn.commit()
            _audit(actor, "payment.cancel", "supplier_payments", payment_id, {"motivo": motivo})
            return {"ok": True}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al anular el pago: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


# ============================================================================
# IMPORTACIONES
# ============================================================================

@router.get("/purchase-imports/{purchase_id}")
def get_purchase_import(purchase_id: int, _: dict = Depends(require_permission("IMPORTS_VIEW"))):
    def run():
        row = db.fetch_one("SELECT * FROM purchase_imports WHERE purchase_id = %s", (purchase_id,))
        if not row:
            raise HTTPException(status_code=404, detail="No hay importación registrada para esta compra")
        return dict(row)
    return _guard(run)


@router.post("/purchases/{purchase_id}/import")
def save_purchase_import(purchase_id: int, payload: dict, actor: dict = Depends(require_permission("IMPORTS_CREATE"))):
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchases WHERE id = %s AND NOT deleted", (purchase_id,))
                purchase = dict(cur.fetchone())
                if not purchase:
                    raise HTTPException(status_code=404, detail="Compra no encontrada")
                if purchase["tipo_compra"] != "INTERNACIONAL":
                    raise HTTPException(status_code=400,
                                        detail="La importación solo aplica a compras internacionales")
                fields = ("pais_origen", "proveedor_extranjero", "puerto_origen", "puerto_destino",
                          "medio_transporte", "incoterm", "numero_orden_compra", "numero_proforma",
                          "numero_factura_comercial", "fecha_embarque", "fecha_estimada_arribo",
                          "fecha_arribo", "numero_conocimiento_embarque", "agente_aduanas",
                          "numero_declaracion_aduanera", "observaciones")
                data = {}
                for f in fields:
                    if f in payload and payload[f] is not None:
                        data[f] = payload[f]
                if "incoterm" in data and not _valid_incoterm(data.get("incoterm")):
                    raise HTTPException(status_code=400,
                                        detail="Incoterm inválido. Válidos: " + ", ".join(INCOTERMS))
                if "estado_logistico" in payload:
                    est = payload["estado_logistico"].strip().upper()
                    if est in ESTADO_LOGISTICO:
                        data["estado_logistico"] = est
                if data.get("fecha_embarque") and not str(data["fecha_embarque"]):
                    data.pop("fecha_embarque")
                if data.get("fecha_estimada_arribo") and not str(data["fecha_estimada_arribo"]):
                    data.pop("fecha_estimada_arribo")
                if data.get("fecha_arribo") and not str(data["fecha_arribo"]):
                    data.pop("fecha_arribo")

                cur.execute("SELECT id FROM purchase_imports WHERE purchase_id = %s", (purchase_id,))
                existing = cur.fetchone()
                if existing:
                    cols = [k for k in data]
                    if cols:
                        sets = ", ".join([f"{k} = %s" for k in cols])
                        cur.execute(f"UPDATE purchase_imports SET {sets} WHERE purchase_id = %s RETURNING *",
                                    [*data.values(), purchase_id])
                    else:
                        cur.execute("SELECT * FROM purchase_imports WHERE purchase_id = %s", (purchase_id,))
                    row = cur.fetchone()
                else:
                    if not data.get("pais_origen"):
                        data["pais_origen"] = purchase["moneda"]
                    cols = ["purchase_id"] + [k for k in data]
                    vals = [purchase_id] + [data[k] for k in data]
                    cur.execute(
                        f"INSERT INTO purchase_imports ({', '.join(cols)}) VALUES ({', '.join(['%s']*len(vals))}) "
                        "RETURNING *",
                        vals,
                    )
                    row = cur.fetchone()
                imp = dict(row)
                if imp["estado_logistico"] == "EN_TRANSITO" and purchase["estado"] in ("CONFIRMADA", "ORDENADA"):
                    _history(conn, cur, purchase_id, "IMPORTACION_EN_TRANSITO",
                             purchase["estado"], "EN_TRANSITO", "Mercadería en tránsito", actor)
                    cur.execute("UPDATE purchases SET estado = 'EN_TRANSITO' WHERE id = %s", (purchase_id,))
                elif imp["estado_logistico"] == "LIBERADA" and purchase["estado"] == "EN_TRANSITO":
                    _history(conn, cur, purchase_id, "IMPORTACION_ACTUALIZADA",
                             "EN_TRANSITO", "CONFIRMADA", "Mercadería liberada en aduanas", actor)
                    cur.execute("UPDATE purchases SET estado = 'CONFIRMADA' WHERE id = %s", (purchase_id,))
            conn.commit()
            _audit(actor, "import.upsert", "purchase_imports", purchase_id, {"estado_logistico": imp["estado_logistico"]})
            return imp
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al guardar la importación: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


# ============================================================================
# COSTOS DE IMPORTACIÓN + DISTRIBUCIÓN
# ============================================================================

def _normalize_cost_type(v):
    t = _str_upper(v)
    for ct in COSTO_TYPES:
        if t == ct or t.replace(" ", "_") == ct.replace(" ", "_"):
            return ct
    return t or "OTROS"


@router.post("/purchases/{purchase_id}/import-costs")
def create_import_cost(purchase_id: int, payload: dict, actor: dict = Depends(require_permission("IMPORT_COSTS_CREATE"))):
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchases WHERE id = %s AND NOT deleted", (purchase_id,))
                purchase = dict(cur.fetchone())
                if not purchase:
                    raise HTTPException(status_code=404, detail="Compra no encontrada")
                monto = _dec(payload.get("monto"), None)
                if monto is None or monto < 0:
                    raise HTTPException(status_code=400, detail="El monto del costo es obligatorio y >= 0")
                moneda = _str_upper(payload.get("moneda")) or purchase["moneda"]
                if moneda not in MONEDAS:
                    moneda = purchase["moneda"]
                tc = _dec(payload.get("tipo_cambio"), None)
                if tc is None or tc <= 0:
                    tc = purchase["tipo_cambio"]
                monto_eq = (monto * tc).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                method = _str_upper(payload.get("metodo_distribucion")) or "POR_VALOR"
                if method not in ("POR_VALOR", "POR_CANTIDAD", "POR_PESO", "POR_VOLUMEN", "MANUAL"):
                    method = "POR_VALOR"
                cur.execute(
                    """INSERT INTO import_costs
                       (purchase_id, purchase_item_id, cost_type, concepto, monto, moneda, tipo_cambio,
                        monto_equivalente, metodo_distribucion, distribuir, observaciones, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (purchase_id, payload.get("purchase_item_id") or None,
                     _normalize_cost_type(payload.get("cost_type")), payload.get("concepto") or None,
                     monto, moneda, tc, monto_eq, method,
                     bool(payload.get("distribuir", True)),
                     payload.get("observaciones") or None, actor["id"]),
                )
                cost = dict(cur.fetchone())
                if method == "MANUAL" and payload.get("allocations"):
                    for a in payload["allocations"]:
                        cur.execute(
                            "INSERT INTO import_cost_allocations (cost_id, purchase_item_id, monto_asignado) "
                            "VALUES (%s,%s,%s)",
                            (cost["id"], a.get("purchase_item_id"), _dec(a.get("monto"))),
                        )
                _recalc_import_costs(conn, cur, purchase_id)
                cur.execute("SELECT * FROM import_costs WHERE id = %s", (cost["id"],))
                cost = dict(cur.fetchone())
                _history(conn, cur, purchase_id, "COSTO_AGREGADO", None, "BORRADOR",
                         f"Costo {cost['cost_type']} por {float(cost['monto'])} ({cost['moneda']})", actor)
            conn.commit()
            _audit(actor, "import_cost.create", "import_costs", cost["id"],
                   {"purchase": purchase_id, "monto": float(cost["monto"])})
            return cost
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al registrar el costo: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.put("/import-costs/{cost_id}")
def update_import_cost(cost_id: int, payload: dict, actor: dict = Depends(require_permission("IMPORT_COSTS_UPDATE"))):
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM import_costs WHERE id = %s", (cost_id,))
                existing = dict(cur.fetchone())
                if not existing or existing.get("deleted"):
                    raise HTTPException(status_code=404, detail="Costo de importación no encontrado")
                purchase_id = existing["purchase_id"]

                fields = ("purchase_item_id", "cost_type", "concepto", "distribuir", "observaciones")
                data = {}
                for f in fields:
                    if f in payload and payload[f] is not None:
                        data[f] = payload[f]
                if "cost_type" in data:
                    data["cost_type"] = _normalize_cost_type(data["cost_type"])
                if "monto" in payload:
                    monto = _dec(payload["monto"])
                    if monto < 0:
                        raise HTTPException(status_code=400, detail="El monto no puede ser negativo")
                    moneda = _str_upper(payload.get("moneda")) or existing["moneda"]
                    tc = _dec(payload.get("tipo_cambio"), existing["tipo_cambio"])
                    if tc <= 0:
                        tc = existing["tipo_cambio"]
                    data["monto"] = monto
                    data["moneda"] = moneda
                    data["tipo_cambio"] = tc
                    data["monto_equivalente"] = (monto * tc).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if "metodo_distribucion" in payload:
                    method = _str_upper(payload["metodo_distribucion"])
                    if method in ("POR_VALOR", "POR_CANTIDAD", "POR_PESO", "POR_VOLUMEN", "MANUAL"):
                        data["metodo_distribucion"] = method

                cur.execute(
                    "DELETE FROM import_cost_allocations WHERE cost_id = %s", (cost_id,))
                if data:
                    sets = ", ".join([f"{k} = %s" for k in data])
                    cur.execute(f"UPDATE import_costs SET {sets} WHERE id = %s RETURNING *",
                                [*data.values(), cost_id])
                if (data.get("metodo_distribucion") or existing["metodo_distribucion"]) == "MANUAL" \
                        and payload.get("allocations"):
                    for a in payload["allocations"]:
                        cur.execute(
                            "INSERT INTO import_cost_allocations (cost_id, purchase_item_id, monto_asignado) "
                            "VALUES (%s,%s,%s)",
                            (cost_id, a.get("purchase_item_id"), _dec(a.get("monto"))),
                        )
                _recalc_import_costs(conn, cur, purchase_id)
                cur.execute("SELECT * FROM import_costs WHERE id = %s", (cost_id,))
                cost = dict(cur.fetchone())
                _history(conn, cur, purchase_id, "COSTO_MODIFICADO", None, None,
                         f"Costo {cost['cost_type']} modificado", actor)
            conn.commit()
            _audit(actor, "import_cost.update", "import_costs", cost_id, {})
            return cost
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al actualizar el costo: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.delete("/import-costs/{cost_id}")
def delete_import_cost(cost_id: int, actor: dict = Depends(require_permission("IMPORT_COSTS_DELETE"))):
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM import_costs WHERE id = %s", (cost_id,))
                existing = dict(cur.fetchone())
                if not existing or existing.get("deleted"):
                    raise HTTPException(status_code=404, detail="Costo de importación no encontrado")
                purchase_id = existing["purchase_id"]
                cur.execute("DELETE FROM import_cost_allocations WHERE cost_id = %s", (cost_id,))
                cur.execute("UPDATE import_costs SET deleted = true WHERE id = %s", (cost_id,))
                _recalc_import_costs(conn, cur, purchase_id)
                _history(conn, cur, purchase_id, "COSTO_ELIMINADO", None, None,
                         f"Se eliminó el costo {existing['cost_type']}", actor)
            conn.commit()
            _audit(actor, "import_cost.delete", "import_costs", cost_id, {})
            return {"ok": True}
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al eliminar el costo: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


# ============================================================================
# DOCUMENTOS DE COMPRA
# ============================================================================

@router.get("/purchases/{purchase_id}/documents")
def list_purchase_documents(purchase_id: int, _: dict = Depends(require_permission("PURCHASES_VIEW"))):
    def run():
        rows = db.fetch_all(
            "SELECT * FROM purchase_documents WHERE purchase_id = %s AND NOT deleted ORDER BY id",
            (purchase_id,),
        )
        return [dict(r) for r in rows]
    return _guard(run)


@router.post("/purchases/{purchase_id}/documents")
def create_purchase_document(purchase_id: int, payload: dict, actor: dict = Depends(require_permission("PURCHASES_VIEW"))):
    def run():
        conn = db.get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM purchases WHERE id = %s AND NOT deleted", (purchase_id,))
                purchase = dict(cur.fetchone())
                if not purchase:
                    raise HTTPException(status_code=404, detail="Compra no encontrada")
                doc_tipo = _str_upper(payload.get("documento_tipo"))
                if not doc_tipo:
                    raise HTTPException(status_code=400, detail="documento_tipo es obligatorio")
                serie = (payload.get("serie") or "").strip()
                numero = (payload.get("numero") or "").strip()
                if doc_tipo in ("FACTURA", "BOLETA") and (not serie or not numero):
                    raise HTTPException(status_code=400,
                                        detail="Serie y número son obligatorios para factura/boleta")
                numero_completo = f"{serie}-{numero}".strip("-") if serie or numero else None
                cur.execute(
                    "SELECT pd.id, p.codigo_compra FROM purchase_documents pd "
                    "JOIN purchases p ON p.id = pd.purchase_id "
                    "WHERE pd.supplier_id = %s AND pd.documento_tipo = %s AND pd.serie = %s "
                    "AND pd.numero = %s AND NOT pd.deleted",
                    (purchase["proveedor_id"], doc_tipo, serie or None, numero or None),
                )
                dup = cur.fetchone()
                if dup:
                    raise HTTPException(
                        status_code=400,
                        detail=f"El documento {doc_tipo} {numero_completo} ya está registrado "
                               f"en la compra {dup['codigo_compra']} del mismo proveedor.",
                    )
                cur.execute(
                    """INSERT INTO purchase_documents
                       (purchase_id, supplier_id, documento_tipo, serie, numero, numero_completo,
                        fecha_emision, fecha_vencimiento, archivo_url, nombre_archivo, observaciones, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (purchase_id, purchase["proveedor_id"], doc_tipo, serie or None, numero or None,
                     numero_completo, payload.get("fecha_emision") or None,
                     payload.get("fecha_vencimiento") or None, payload.get("archivo_url") or None,
                     payload.get("nombre_archivo") or None, payload.get("observaciones") or None,
                     actor["id"]),
                )
                doc = dict(cur.fetchone())
                _history(conn, cur, purchase_id, "DOCUMENTO_AGREGADO", None, None,
                         f"Documento {doc_tipo} {numero_completo or ''}", actor)
            conn.commit()
            _audit(actor, "purchase_document.create", "purchase_documents", doc["id"],
                   {"purchase": purchase_id, "documento": f"{doc_tipo} {numero_completo or ''}"})
            return doc
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Error al registrar el documento: {e}")
        finally:
            db.close_conn(conn)
    return _guard(run)


@router.delete("/purchases/{purchase_id}/documents/{doc_id}")
def delete_purchase_document(purchase_id: int, doc_id: int, actor: dict = Depends(require_permission("PURCHASES_VIEW"))):
    def run():
        row = db.fetch_one(
            "SELECT * FROM purchase_documents WHERE purchase_id = %s AND id = %s AND NOT deleted",
            (purchase_id, doc_id),
        )
        if not row:
            raise HTTPException(status_code=404, detail="Documento no encontrado")
        db.execute("UPDATE purchase_documents SET deleted = true WHERE id = %s", (doc_id,), returning=None)
        _audit(actor, "purchase_document.delete", "purchase_documents", doc_id, {})
        return {"ok": True}
    return _guard(run)


# ============================================================================
# CUENTAS POR PAGAR
# ============================================================================

@router.get("/accounts-payable")
def accounts_payable(
    page: int = 1,
    limit: int = 50,
    q: str = "",
    estado: str = "",
    moneda: str = "",
    proveedor_id: int = None,
    _: dict = Depends(require_permission("ACCOUNTS_PAYABLE_VIEW")),
):
    def run():
        nonlocal page, limit
        today = date.today().isoformat()
        conds = ["NOT v.deleted", "v.estado NOT IN ('BORRADOR','CANCELADA')", "v.saldo > 0"]
        params = []
        if q:
            conds.append("(s.razon_social ILIKE %s OR v.codigo_compra ILIKE %s OR s.numero_documento ILIKE %s)")
            like = f"%{q}%"
            params += [like] * 3
        if moneda:
            conds.append("v.moneda = %s")
            params.append(_str_upper(moneda))
        if proveedor_id:
            conds.append("v.proveedor_id = %s")
            params.append(proveedor_id)
        if estado:
            est = _str_upper(estado)
            if est == "VENCIDA":
                conds.append("v.fecha_vencimiento IS NOT NULL AND v.fecha_vencimiento < %s")
                params.append(today)
            elif est == "POR_VENCER":
                conds.append("v.fecha_vencimiento IS NOT NULL AND v.fecha_vencimiento >= %s")
                params.append(today)
            elif est == "PENDIENTE":
                conds.append("v.estado_pago IN ('PENDIENTE','PAGADA_PARCIAL')")
            elif est == "PAGADA":
                conds.append("v.estado_pago = 'PAGADA' AND v.saldo <= 0")
        wh = "WHERE " + " AND ".join(conds) if conds else ""

        base = "v_accounts_payable v JOIN suppliers s ON s.id = v.proveedor_id"
        total_row = db.fetch_one(f"SELECT COUNT(*)::int AS total FROM {base} {wh}", params or None)
        total = total_row["total"] if total_row else 0
        page = max(1, page)
        limit = min(max(1, limit), 100)
        off = (page - 1) * limit

        rows = db.fetch_all(
            f"""SELECT v.*, s.razon_social AS supplier_name, s.tipo_documento AS supplier_tipo_doc,
                       s.numero_documento AS supplier_doc, s.pais AS supplier_pais
                FROM {base} {wh}
                ORDER BY COALESCE(v.fecha_vencimiento, v.fecha_compra), v.purchase_id DESC
                LIMIT {limit} OFFSET {off}""",
            params or None,
        )
        items = []
        sums_total = {"saldo_eq": Decimal("0"), "total_eq": Decimal("0")}
        for r in rows:
            it = dict(r)
            saldo = _dec(it["saldo"])
            # Estado por vencer/vencida
            display_estado = it["estado_pago"]
            if saldo <= 0:
                display_estado = "PAGADA"
            elif it.get("fecha_vencimiento") and str(it["fecha_vencimiento"]) < today:
                display_estado = "VENCIDA"
            elif it.get("fecha_vencimiento"):
                display_estado = "POR_VENCER" if it["estado_pago"] == "PENDIENTE" else it["estado_pago"]
            it["display_estado"] = display_estado
            it["saldo_equivalente"] = float(saldo * _dec(it["tipo_cambio"], 1))
            it["total_equivalente"] = float(_dec(it["total_equivalente"]))
            it["supplier"] = {"id": it["proveedor_id"], "razon_social": it["supplier_name"],
                              "tipo_documento": it["supplier_tipo_doc"], "numero_documento": it["supplier_doc"],
                              "pais": it["supplier_pais"]}
            sums_total["saldo_eq"] += saldo * _dec(it["tipo_cambio"], 1)
            sums_total["total_eq"] += _dec(it["total_equivalente"])
            items.append(it)
        return {
            "items": items,
            "pagination": {"page": page, "limit": limit, "total": total,
                           "total_pages": (total + limit - 1) // limit},
            "summaries": {"saldo_equivalente": float(sums_total["saldo_eq"]),
                          "total_equivalente": float(sums_total["total_eq"])},
        }
    return _guard(run)


# ============================================================================
# CONFIGURACIÓN (settings)
# ============================================================================

@router.get("/settings")
def get_settings(_: dict = Depends(require_permission("SETTINGS_VIEW"))):
    return _guard(lambda: _settings_dict())


@router.put("/settings")
def update_settings(payload: dict, actor: dict = Depends(require_permission("SETTINGS_MANAGE"))):
    def run():
        if not payload:
            raise HTTPException(status_code=400, detail="Enviar al menos una configuración")
        for key, value in payload.items():
            if key not in _SETTINGS_WHITELIST:
                raise HTTPException(status_code=400, detail=f"Configuración no permitida: {key}")
            db.execute(
                "INSERT INTO settings (key, value) VALUES (%s,%s) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
                (key, str(value)),
                returning=None,
            )
        _audit(actor, "settings.update", "settings", None, {"keys": list(payload.keys())})
        return _settings_dict()
    return _guard(run)


# ============================================================================
# HISTORIAL / INVENTARIO COMPLEMENTARIO
# ============================================================================

@router.get("/inventory-movements")
def inventory_movements(
    page: int = 1,
    limit: int = 50,
    item_type: str = "",
    item_id: int = None,
    _: dict = Depends(require_permission("PRODUCTS_VIEW")),
):
    def run():
        nonlocal page, limit
        conds = []
        params = []
        if item_type:
            conds.append("item_type = %s")
            params.append(item_type)
        if item_id:
            conds.append("item_id = %s")
            params.append(item_id)
        wh = "WHERE " + " AND ".join(conds) if conds else ""
        total_row = db.fetch_one(f"SELECT COUNT(*)::int AS total FROM inventory_movements {wh}", params or None)
        total = total_row["total"] if total_row else 0
        page = max(1, page)
        limit = min(max(1, limit), 100)
        off = (page - 1) * limit
        rows = db.fetch_all(
            f"SELECT * FROM inventory_movements {wh} ORDER BY fecha DESC, id DESC LIMIT {limit} OFFSET {off}",
            params or None,
        )
        return {"items": [dict(r) for r in rows],
                "pagination": {"page": page, "limit": limit, "total": total,
                               "total_pages": (total + limit - 1) // limit}}
    return _guard(run)