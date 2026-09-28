"""
Módulo Resumen Tributario — El Iqueño SAC
=========================================
Capa HTTP del módulo tributario. NO implementa reglas: toda la lógica vive en
`tributario.py`, que es la fuente única de verdad compartida con el dashboard,
las ventas y las compras.

Expone:
  * GET  /api/resumen-tributario   → IGV del período + pago a cuenta + IR anual.
  * CRUD /api/gastos-deducibles    → registro explícito de gastos deducibles.
  * CRUD /api/pagos-cuenta-ir      → pagos a cuenta del IR (único por período).
  * GET/PUT /api/uit               → valor de la UIT por año.
  * CRUD /api/ir-tramos            → tabla de tramos del IR anual por régimen.
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Query

import db
import rbac
import tributario as trib
from auth import require_permission

router = APIRouter(prefix="/api", tags=["tributario"])

MESES = trib.MESES
FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ===========================================================================
# Utilidades de validación
# ===========================================================================

def _fecha(valor, campo, por_defecto=None):
    """Valida una fecha YYYY-MM-DD. Devuelve `date`."""
    if valor in (None, ""):
        return por_defecto
    texto = str(valor).strip()
    if not FECHA_RE.match(texto):
        raise HTTPException(status_code=400, detail=f"{campo} debe tener formato YYYY-MM-DD")
    try:
        return date.fromisoformat(texto)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{campo} no es una fecha válida")


def _dec(valor, campo, default="0", minimo=None, positivo=False):
    """Convierte a Decimal validando el rango."""
    if valor in (None, ""):
        valor = default
    try:
        n = trib.dec(valor)
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"{campo} debe ser numérico")
    if positivo and n <= 0:
        raise HTTPException(status_code=400, detail=f"{campo} debe ser mayor que cero")
    if minimo is not None and n < minimo:
        raise HTTPException(status_code=400, detail=f"{campo} no puede ser menor que {minimo}")
    return n


def _texto(valor, campo, requerido=True, maxlen=300):
    t = str(valor or "").strip()
    if requerido and not t:
        raise HTTPException(status_code=400, detail=f"{campo} es obligatorio")
    if len(t) > maxlen:
        raise HTTPException(status_code=400, detail=f"{campo} excede {maxlen} caracteres")
    return t or None


def _guard(fn):
    try:
        return fn()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error de base de datos: {e}")


def _auditar(actor, accion, recurso, rid, detalle=None):
    rbac.audit(actor["id"], actor["email"], accion, recurso, rid, detalle or {})


# ===========================================================================
# Resumen tributario
# ===========================================================================

@router.get("/resumen-tributario")
def resumen_tributario(
    anio: int = Query(..., ge=2000, le=2200, description="Año del resumen (YYYY)"),
    mes: int = Query(None, ge=1, le=12,
                     description="Mes (1-12). Si se omite, resumen anual."),
    _: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_VIEW")),
):
    return trib.resumen(anio, mes)


@router.get("/tributario/config")
def tributario_config(_: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_VIEW"))):
    """Configuración tributaria efectiva (para mostrar y auditar reglas)."""
    return {
        "config": {
            "igv_rate": float(trib.igv_rate()),
            "igv_name": trib.config()["igv_name"],
            "base_currency": trib.config()["base_currency"],
            "ir_regime": trib.config()["ir_regime"],
            "ir_rate": float(trib.config()["ir_rate"]),
            "ventas_igv_tipos": list(trib.VENTAS_IGV_TIPOS),
            "compras_igv_tipos": list(trib.COMPRAS_IGV_TIPOS),
            "purchase_credit_states": list(trib.config()["purchase_credit_states"]),
            "gastos_categorias": list(trib.GASTO_CATEGORIAS),
        },
        "estados_fiscales": list(trib.ESTADOS_FISCALES),
        "regimenes": list(trib.REGIMENES),
    }


# ===========================================================================
# Gastos deducibles
# ===========================================================================
# No se derivan de las compras: el contador declara cada gasto con su
# naturaleza (categoría), importe y sustento. Derivarlos automáticamente
# de `purchases` haría deducible mercadería no vendida, existencias y
# gastos no admitidos, y el resultado sería incorrecto.

_CAMPOS_GASTO = (
    "anio, mes, fecha_gasto, categoria, descripcion, proveedor, "
    "documento_tipo, documento_numero, moneda, tipo_cambio, monto, monto_pen, "
    "estado, observaciones"
)


def _validar_gasto(payload, actual=None):
    """Valida y normaliza el payload de un gasto deducible."""
    actual = actual or {}
    fecha = _fecha(payload.get("fecha_gasto"), "fecha_gasto",
                   actual.get("fecha_gasto") or date.today())
    categoria = _texto(payload.get("categoria"), "categoria", maxlen=40).upper()
    if categoria not in trib.GASTO_CATEGORIAS:
        raise HTTPException(
            status_code=400,
            detail="categoria inválida. Opciones: " + ", ".join(trib.GASTO_CATEGORIAS))

    estado = str(payload.get("estado") or actual.get("estado") or "VALIDO").strip().upper()
    if estado not in ("BORRADOR", "VALIDO", "ANULADO"):
        raise HTTPException(status_code=400, detail="estado inválido (BORRADOR, VALIDO o ANULADO)")

    moneda = str(payload.get("moneda") or actual.get("moneda") or "PEN").strip().upper()
    if moneda not in ("PEN", "USD", "EUR"):
        raise HTTPException(status_code=400, detail="moneda inválida (PEN, USD o EUR)")

    tc = _dec(payload.get("tipo_cambio", actual.get("tipo_cambio")), "tipo_cambio", "1")
    if tc <= 0:
        raise HTTPException(status_code=400, detail="tipo_cambio debe ser mayor que cero")

    monto = _dec(payload.get("monto", actual.get("monto")), "monto", positivo=True)
    monto_pen = trib.r2(monto * tc)

    return {
        # anio/mes SIEMPRE se derivan de la fecha: no pueden contradecirse.
        "anio": fecha.year,
        "mes": fecha.month,
        "fecha_gasto": fecha.isoformat(),
        "categoria": categoria,
        "descripcion": _texto(payload.get("descripcion"), "descripcion"),
        "proveedor": _texto(payload.get("proveedor"), "proveedor", requerido=False),
        "documento_tipo": _texto(payload.get("documento_tipo"), "documento_tipo",
                                 requerido=False, maxlen=40),
        "documento_numero": _texto(payload.get("documento_numero"), "documento_numero",
                                   requerido=False, maxlen=60),
        "moneda": moneda,
        "tipo_cambio": tc,
        "monto": trib.r2(monto),
        "monto_pen": monto_pen,
        "estado": estado,
        "observaciones": _texto(payload.get("observaciones"), "observaciones",
                                requerido=False, maxlen=2000) or None,
    }


@router.get("/gastos-deducibles")
def listar_gastos(
    anio: int = Query(None, ge=2000, le=2200),
    mes: int = Query(None, ge=1, le=12),
    categoria: str = Query(None),
    estado: str = Query(None),
    page: int = 1,
    limit: int = Query(50, ge=1, le=200),
    _: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_VIEW")),
):
    def run():
        conds = ["NOT deleted"]
        params = []
        if anio:
            conds.append("anio = %s")
            params.append(anio)
        if mes:
            conds.append("mes = %s")
            params.append(mes)
        if categoria:
            conds.append("categoria = %s")
            params.append(str(categoria).upper())
        if estado:
            conds.append("estado = %s")
            params.append(str(estado).upper())
        wh = "WHERE " + " AND ".join(conds)

        # Ojo: no reasignar `page`/`limit` aquí; Python los trataría como
        # locales de run() y saltaría UnboundLocalError al leerse a sí mismos.
        pagina = max(1, page)
        limite = max(1, limit)
        total_row = db.fetch_one(f"SELECT COUNT(*)::int n FROM gastos_deducibles {wh}", params)
        total = total_row["n"] if total_row else 0
        rows = db.fetch_all(
            f"""SELECT * FROM gastos_deducibles {wh}
                ORDER BY fecha_gasto DESC, id DESC
                LIMIT {limite} OFFSET {(pagina - 1) * limite}""",
            params,
        )
        resumen_row = db.fetch_one(
            f"""SELECT COALESCE(SUM(monto_pen), 0) total, COUNT(*)::int n
                  FROM gastos_deducibles {wh} AND estado = 'VALIDO'""",
            params,
        )
        return {
            "items": [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(r).items()}
                      for r in rows],
            "total_valido": trib.f2(resumen_row["total"]) if resumen_row else 0.0,
            "count_valido": resumen_row["n"] if resumen_row else 0,
            "pagination": {"page": page, "limit": limit, "total": total,
                           "total_pages": (total + limit - 1) // limit},
        }
    return _guard(run)


@router.post("/gastos-deducibles")
def crear_gasto(payload: dict, actor: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_EDIT"))):
    def run():
        d = _validar_gasto(payload)
        cols = ", ".join(d.keys())
        ph = ", ".join(["%s"] * len(d))
        row = db.execute(
            f"INSERT INTO gastos_deducibles ({cols}, created_by) VALUES ({ph}, %s) RETURNING *",
            [*d.values(), actor["id"]],
        )
        _auditar(actor, "create", "gastos_deducibles", row["id"],
                 {"monto_pen": float(row["monto_pen"]), "categoria": row["categoria"]})
        return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(row).items()}
    return _guard(run)


@router.put("/gastos-deducibles/{gasto_id}")
def actualizar_gasto(gasto_id: int, payload: dict,
                     actor: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_EDIT"))):
    def run():
        actual = db.fetch_one("SELECT * FROM gastos_deducibles WHERE id = %s AND NOT deleted",
                              (gasto_id,))
        if not actual:
            raise HTTPException(status_code=404, detail="Gasto deducible no encontrado")
        d = _validar_gasto(payload, dict(actual))
        sets = ", ".join(f"{k} = %s" for k in d)
        row = db.execute(
            f"UPDATE gastos_deducibles SET {sets} WHERE id = %s RETURNING *",
            [*d.values(), gasto_id],
        )
        _auditar(actor, "update", "gastos_deducibles", gasto_id,
                 {"monto_pen": float(row["monto_pen"]), "categoria": row["categoria"]})
        return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(row).items()}
    return _guard(run)


@router.delete("/gastos-deducibles/{gasto_id}")
def eliminar_gasto(gasto_id: int, actor: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_EDIT"))):
    res = _guard(lambda: db.execute(
        "UPDATE gastos_deducibles SET deleted = true WHERE id = %s AND NOT deleted RETURNING id",
        (gasto_id,),
    ))
    if not res:
        raise HTTPException(status_code=404, detail="Gasto deducible no encontrado")
    _auditar(actor, "delete", "gastos_deducibles", gasto_id, {})
    return {"ok": True}


# ===========================================================================
# Pagos a cuenta del IR
# ===========================================================================

@router.get("/pagos-cuenta-ir")
def listar_pagos(
    anio: int = Query(..., ge=2000, le=2200),
    _: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_VIEW")),
):
    """Pagos a cuenta del año con el cálculo oficial vs. el registrado."""
    def run():
        cfg = trib.config()
        tasa = cfg["ir_rate"]
        ventas = trib.ventas_igv_mensual(anio)
        registrados = {
            int(r["mes"]): r for r in db.fetch_all(
                """SELECT * FROM pagos_cuenta_ir
                    WHERE NOT deleted AND anio = %s ORDER BY mes""", (anio,))
        }
        items = []
        total_pagado = Decimal("0.00")
        for m in range(1, 13):
            v = ventas.get(m, trib._vacio())
            oficial = trib.r2(v["base"] * tasa)
            reg = registrados.get(m)
            items.append({
                "mes": m,
                "mes_nombre": MESES[m - 1],
                "ingresos_netos": trib.f2(v["base"]),
                "tasa": float(tasa),
                "monto_calculado": trib.f2(oficial),
                "registrado": bool(reg),
                "pago_cuenta_id": reg["id"] if reg else None,
                "monto_calculado_reg": trib.f2(reg["monto_calculado"]) if reg else None,
                "monto_pagado": trib.f2(reg["monto_pagado"]) if reg else 0.0,
                "tasa_reg": float(reg["tasa"]) if reg else None,
                "estado": reg["estado"] if reg else "PENDIENTE",
                "fecha_pago": reg["fecha_pago"].isoformat() if reg and reg["fecha_pago"] else None,
                "numero_operacion": reg["numero_operacion"] if reg else None,
                "entidad": reg["entidad"] if reg else None,
                "observaciones": reg["observaciones"] if reg else None,
                "diferencia": trib.f2(oficial - (trib.r2(reg["monto_pagado"]) if reg else Decimal("0.00"))),
            })
            if reg and reg["estado"] == "PAGADO":
                total_pagado = trib.r2(total_pagado + trib.dec(reg["monto_pagado"]))
        return {"anio": int(anio), "tasa": float(tasa), "items": items,
                "total_pagado": trib.f2(total_pagado)}
    return _guard(run)


@router.post("/pagos-cuenta-ir")
def crear_pago(payload: dict, actor: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_EDIT"))):
    def run():
        anio = int(payload.get("anio") or date.today().year)
        if not 2000 <= anio <= 2200:
            raise HTTPException(status_code=400, detail="anio inválido")
        mes = int(payload.get("mes") or 0)
        if not 1 <= mes <= 12:
            raise HTTPException(status_code=400, detail="mes debe estar entre 1 y 12")

        existente = db.fetch_one(
            "SELECT id FROM pagos_cuenta_ir WHERE NOT deleted AND anio = %s AND mes = %s",
            (anio, mes))
        if existente:
            raise HTTPException(
                status_code=400,
                detail=f"Ya existe un pago a cuenta registrado para {MESES[mes - 1]} {anio}. "
                       f"Actualízalo con PUT /api/pagos-cuenta-ir/{existente['id']}.")

        cfg = trib.config()
        tasa = _dec(payload.get("tasa", cfg["ir_rate"]), "tasa", minimo=0)
        if tasa > 1:
            raise HTTPException(status_code=400, detail="tasa no puede ser mayor que 1")

        if payload.get("ingresos_netos") in (None, ""):
            ventas = trib.ventas_igv_mensual(anio, mes).get(mes, trib._vacio())
            ingresos = ventas["base"]
        else:
            ingresos = _dec(payload.get("ingresos_netos"), "ingresos_netos", minimo=0)

        calculado = _dec(payload.get("monto_calculado"), "monto_calculado",
                         trib.r2(ingresos * tasa), minimo=0)
        pagado = _dec(payload.get("monto_pagado", 0), "monto_pagado", "0", minimo=0)
        estado = str(payload.get("estado") or ("PAGADO" if pagado > 0 else "PENDIENTE")).strip().upper()
        if estado not in ("PENDIENTE", "PAGADO", "ANULADO"):
            raise HTTPException(status_code=400, detail="estado inválido (PENDIENTE, PAGADO o ANULADO)")
        fecha_pago = _fecha(payload.get("fecha_pago"), "fecha_pago")
        if estado == "PAGADO" and not fecha_pago:
            raise HTTPException(status_code=400, detail="Un pago a cuenta PAGADO requiere fecha_pago")

        d = {
            "anio": anio, "mes": mes, "ingresos_netos": ingresos, "tasa": trib.r4(tasa),
            "monto_calculado": calculado, "monto_pagado": pagado,
            "fecha_pago": fecha_pago, "numero_operacion": _texto(
                payload.get("numero_operacion"), "numero_operacion", requerido=False, maxlen=100),
            "entidad": _texto(payload.get("entidad"), "entidad", requerido=False, maxlen=120),
            "estado": estado,
            "observaciones": _texto(payload.get("observaciones"), "observaciones",
                                    requerido=False, maxlen=2000),
        }
        cols = ", ".join(d.keys())
        ph = ", ".join(["%s"] * len(d))
        row = db.execute(
            f"INSERT INTO pagos_cuenta_ir ({cols}, created_by) VALUES ({ph}, %s) RETURNING *",
            [*d.values(), actor["id"]])
        _auditar(actor, "create", "pagos_cuenta_ir", row["id"],
                 {"anio": anio, "mes": mes, "monto_pagado": float(pagado)})
        return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(row).items()}
    return _guard(run)


@router.put("/pagos-cuenta-ir/{pago_id}")
def actualizar_pago(pago_id: int, payload: dict,
                    actor: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_EDIT"))):
    def run():
        actual = db.fetch_one("SELECT * FROM pagos_cuenta_ir WHERE id = %s AND NOT deleted",
                              (pago_id,))
        if not actual:
            raise HTTPException(status_code=404, detail="Pago a cuenta no encontrado")
        a = dict(actual)
        cfg = trib.config()
        tasa = _dec(payload.get("tasa", a["tasa"]), "tasa", minimo=0)
        if tasa > 1:
            raise HTTPException(status_code=400, detail="tasa no puede ser mayor que 1")
        if payload.get("ingresos_netos") in (None, ""):
            ingresos = a["ingresos_netos"]
        else:
            ingresos = _dec(payload.get("ingresos_netos"), "ingresos_netos", minimo=0)
        calculado = _dec(payload.get("monto_calculado"), "monto_calculado",
                         trib.r2(ingresos * tasa), minimo=0)
        pagado = _dec(payload.get("monto_pagado", a["monto_pagado"]), "monto_pagado", "0", minimo=0)
        estado = str(payload.get("estado", a["estado"]) or "PENDIENTE").strip().upper()
        if estado not in ("PENDIENTE", "PAGADO", "ANULADO"):
            raise HTTPException(status_code=400, detail="estado inválido (PENDIENTE, PAGADO o ANULADO)")
        fecha_pago = _fecha(payload.get("fecha_pago", a["fecha_pago"]), "fecha_pago")
        if estado == "PAGADO" and not fecha_pago:
            raise HTTPException(status_code=400, detail="Un pago a cuenta PAGADO requiere fecha_pago")

        d = {
            "ingresos_netos": ingresos, "tasa": trib.r4(tasa),
            "monto_calculado": calculado, "monto_pagado": pagado,
            "fecha_pago": fecha_pago,
            "numero_operacion": _texto(payload.get("numero_operacion", a["numero_operacion"]),
                                       "numero_operacion", requerido=False, maxlen=100),
            "entidad": _texto(payload.get("entidad", a["entidad"]), "entidad",
                              requerido=False, maxlen=120),
            "estado": estado,
            "observaciones": _texto(payload.get("observaciones", a["observaciones"]),
                                    "observaciones", requerido=False, maxlen=2000),
        }
        sets = ", ".join(f"{k} = %s" for k in d)
        row = db.execute(f"UPDATE pagos_cuenta_ir SET {sets} WHERE id = %s RETURNING *",
                         [*d.values(), pago_id])
        _auditar(actor, "update", "pagos_cuenta_ir", pago_id, {"monto_pagado": float(pagado)})
        return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(row).items()}
    return _guard(run)


@router.delete("/pagos-cuenta-ir/{pago_id}")
def eliminar_pago(pago_id: int, actor: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_EDIT"))):
    res = _guard(lambda: db.execute(
        "UPDATE pagos_cuenta_ir SET deleted = true WHERE id = %s AND NOT deleted RETURNING id",
        (pago_id,)))
    if not res:
        raise HTTPException(status_code=404, detail="Pago a cuenta no encontrado")
    _auditar(actor, "delete", "pagos_cuenta_ir", pago_id, {})
    return {"ok": True}


# ===========================================================================
# UIT
# ===========================================================================

@router.get("/uit")
def listar_uit(_: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_VIEW"))):
    rows = db.fetch_all("SELECT * FROM uit_config ORDER BY anio DESC")
    return {
        "items": [{k: (float(v) if isinstance(v, Decimal) else v)
                   for k, v in dict(r).items()} for r in rows],
        "actual": trib.f2(trib.uit(date.today().year)),
    }


@router.put("/uit/{anio}")
def guardar_uit(anio: int, payload: dict,
                actor: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_EDIT"))):
    if not 2000 <= anio <= 2200:
        raise HTTPException(status_code=400, detail="anio inválido")
    valor = _dec(payload.get("valor_uit"), "valor_uit", positivo=True)
    descripcion = _texto(payload.get("descripcion"), "descripcion", requerido=False, maxlen=500)
    row = db.execute(
        """INSERT INTO uit_config (anio, valor_uit, descripcion)
           VALUES (%s, %s, %s)
           ON CONFLICT (anio) DO UPDATE
               SET valor_uit = EXCLUDED.valor_uit,
                   descripcion = COALESCE(EXCLUDED.descripcion, uit_config.descripcion)
           RETURNING *""",
        (anio, valor, descripcion))
    _auditar(actor, "update", "uit_config", anio, {"valor_uit": float(valor)})
    return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(row).items()}


# ===========================================================================
# Tramos del IR anual
# ===========================================================================

@router.get("/ir-tramos")
def listar_tramos(regimen: str = Query(None),
                  _: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_VIEW"))):
    if regimen:
        rows = db.fetch_all(
            "SELECT * FROM ir_tramos WHERE regimen = %s ORDER BY desde_uit",
            (str(regimen).upper(),))
    else:
        rows = db.fetch_all("SELECT * FROM ir_tramos ORDER BY regimen, desde_uit")
    return {"items": [{k: (float(v) if isinstance(v, Decimal) else v)
                       for k, v in dict(r).items()} for r in rows]}


@router.post("/ir-tramos")
def crear_tramo(payload: dict, actor: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_EDIT"))):
    regimen = str(payload.get("regimen") or "").strip().upper()
    if regimen not in trib.REGIMENES:
        raise HTTPException(status_code=400,
                            detail="regimen inválido. Opciones: " + ", ".join(trib.REGIMENES))
    desde = _dec(payload.get("desde_uit"), "desde_uit", minimo=0)
    hasta_raw = payload.get("hasta_uit")
    hasta = None if hasta_raw in (None, "") else _dec(hasta_raw, "hasta_uit", minimo=0)
    if hasta is not None and hasta <= desde:
        raise HTTPException(status_code=400, detail="hasta_uit debe ser mayor que desde_uit")
    tasa = _dec(payload.get("tasa"), "tasa", minimo=0)
    if tasa > 1:
        raise HTTPException(status_code=400, detail="tasa debe estar entre 0 y 1")

    # Un mismo regimen no puede tener dos tramos que empiecen en la misma UIT
    # (uq_tramo). Se comprueba antes de insertar para devolver 400 y no un 500.
    if db.fetch_one("SELECT id FROM ir_tramos WHERE regimen = %s AND desde_uit = %s",
                    (regimen, desde)):
        raise HTTPException(
            status_code=400,
            detail=f"Ya existe un tramo de {regimen} que comienza en {desde} UIT. "
                   f"Edita o elimina el existente.")

    row = db.execute(
        """INSERT INTO ir_tramos (regimen, desde_uit, hasta_uit, tasa, descripcion)
           VALUES (%s,%s,%s,%s,%s) RETURNING *""",
        (regimen, desde, hasta, tasa,
         _texto(payload.get("descripcion"), "descripcion", requerido=False, maxlen=500)))
    _auditar(actor, "create", "ir_tramos", row["id"], {"regimen": regimen, "tasa": float(tasa)})
    return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(row).items()}


@router.delete("/ir-tramos/{tramo_id}")
def eliminar_tramo(tramo_id: int, actor: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_EDIT"))):
    res = _guard(lambda: db.execute(
        "DELETE FROM ir_tramos WHERE id = %s RETURNING id", (tramo_id,)))
    if not res:
        raise HTTPException(status_code=404, detail="Tramo no encontrado")
    _auditar(actor, "delete", "ir_tramos", tramo_id, {})
    return {"ok": True}
