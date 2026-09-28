"""
Módulo Resumen Tributario — El Iqueño SAC
Resumen de IGV por pagar y pago a cuenta del Impuesto a la Renta a partir de
los datos REALES del sistema (ventas de la tabla `sales` y compras de la tabla
`purchases`). No duplica información: lee únicamente los registros ya existentes.

Reglas tributarias aplicadas:
- IGV ventas (débito fiscal): FACTURAS + BOLETAS de `sales` (no anuladas/anuladas=deleted).
- IGV compras (crédito fiscal): solo comprobantes FACTURA de `purchases`
  (estado distinto de BORRADOR/CANCELADA, no eliminadas). Las compras en moneda
  extranjera se convierten a soles con el ratio total_equivalente/total.
- IGV por pagar = IGV ventas − IGV compras (si es negativo → saldo a favor).
- Pago a cuenta IR (RMT u otro régimen) = Ingresos netos × tasa configurable.
  Ingresos netos = Σ subtotal ventas (FACTURA + BOLETA). No es (ventas − compras).
- Total referencial del período = IGV por pagar + pago a cuenta IR.

Los importes se manejan con Decimal/NUMERIC (nunca float) y se exponen redondeados.
"""

from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, Query

import db
from auth import require_permission

router = APIRouter(prefix="/api", tags=["tributario"])

D2 = Decimal("0.01")

# Comprobantes que generan IGV en ventas (se comparan en mayúsculas).
VENTAS_IGV_TIPOS = ("FACTURA", "BOLETA")
# Comprobantes de compra que dan crédito fiscal.
COMPRAS_IGV_TIPOS = ("FACTURA",)
# Estados de compra que se excluyen del crédito fiscal.
ESTADOS_EXCLUIDOS = ("BORRADOR", "CANCELADA")


def _get_setting(key, default):
    row = db.fetch_one("SELECT value FROM settings WHERE key = %s", (key,))
    if not row:
        return default
    return row["value"]


def _dec(value):
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _r2(value):
    """Redondea a 2 decimales (banquero: ROUND_HALF_UP)."""
    return _dec(value).quantize(D2, rounding=ROUND_HALF_UP)


def _f2(value):
    """Decimal redondeado a 2 decimales convertido a float para JSON."""
    return float(_r2(value))


def _trib_config():
    """Devuelve la configuración tributaria con Decimal (para cómputos)

    Tanto `igv_rate` como `ir_rate` se mantienen como Decimal internamente.
    La serialización a float se hace al exponer `config` en la respuesta.
    """
    igv_rate = _get_setting("igv_rate", "0.18")
    ir_regime = _get_setting("ir_regime", "RMT")
    ir_rate = _get_setting("ir_rate", "0.01")
    try:
        igv_rate = _dec(igv_rate)
    except Exception:
        igv_rate = Decimal("0.18")
    try:
        ir_rate = _dec(ir_rate)
    except Exception:
        ir_rate = Decimal("0.01")
    return {
        "igv_rate": igv_rate,
        "ir_regime": str(ir_regime or "RMT"),
        "ir_rate": ir_rate,
    }


def _ventas_mensuales(anio: int) -> list:
    """Agrupa ventas FACTURA+BOLETA por mes (YYYY-MM) en el año dado."""
    return db.fetch_all(
        """SELECT to_char(created_at, 'YYYY-MM') AS mes,
                  COALESCE(SUM(subtotal), 0) AS base,
                  COALESCE(SUM(igv), 0) AS igv,
                  COALESCE(SUM(total), 0) AS total,
                  COUNT(*)::int AS n
           FROM sales
           WHERE NOT deleted
             AND UPPER(COALESCE(invoice_type, '')) IN %(tipos)s
             AND to_char(created_at, 'YYYY') = %(anio)s
           GROUP BY mes""",
        {"tipos": tuple(VENTAS_IGV_TIPOS), "anio": str(anio)},
    )


def _compras_mensuales(anio: int) -> list:
    """Agrupa compras FACTURA (crédito fiscal) por mes en el año dado.

    Las compras en moneda extranjera se convierten a soles usando el ratio
    total_equivalente/total (columna ya existente, no se recalcula NADA).
    """
    return db.fetch_all(
        """SELECT to_char(fecha_compra, 'YYYY-MM') AS mes,
                  COALESCE(SUM(subtotal * CASE WHEN moneda = 'PEN' THEN 1
                                               ELSE total_equivalente / NULLIF(total, 0)
                                          END), 0) AS base,
                  COALESCE(SUM(impuestos * CASE WHEN moneda = 'PEN' THEN 1
                                               ELSE total_equivalente / NULLIF(total, 0)
                                          END), 0) AS igv,
                  COALESCE(SUM(total_equivalente), 0) AS total,
                  COUNT(*)::int AS n
           FROM purchases
           WHERE NOT deleted
             AND estado NOT IN %(excl)s
             AND UPPER(COALESCE(tipo_comprobante, '')) IN %(tipos)s
             AND to_char(fecha_compra, 'YYYY') = %(anio)s
           GROUP BY mes""",
        {"excl": tuple(ESTADOS_EXCLUIDOS), "tipos": tuple(COMPRAS_IGV_TIPOS), "anio": str(anio)},
    )


@router.get("/resumen-tributario")
def resumen_tributario(
    anio: int = Query(..., ge=2000, le=2200, description="Año del resumen (YYYY)"),
    mes: int = Query(None, ge=1, le=12, description="Mes (1-12). Si se omite, resumen anual ('Todos los meses')."),
    _: dict = Depends(require_permission("RESUMEN_TRIBUTARIO_VIEW")),
):
    config = _trib_config()
    ventas_m = {row["mes"]: row for row in _ventas_mensuales(anio)}
    compras_m = {row["mes"]: row for row in _compras_mensuales(anio)}

    # ---- Serie mensual (12 meses) para gráfico y tabla anual ----------------
    meses = []
    for m in range(1, 13):
        key = f"{anio:04d}-{m:02d}"
        v = ventas_m.get(key)
        c = compras_m.get(key)
        v_base, v_igv, v_total, v_n = (
            (_dec(v["base"]), _dec(v["igv"]), _dec(v["total"]), int(v["n"])) if v else (Decimal("0"), Decimal("0"), Decimal("0"), 0)
        )
        c_base, c_igv, c_total, c_n = (
            (_dec(c["base"]), _dec(c["igv"]), _dec(c["total"]), int(c["n"])) if c else (Decimal("0"), Decimal("0"), Decimal("0"), 0)
        )
        igv_por_pagar = max(Decimal("0"), v_igv - c_igv)
        saldo_a_favor = max(Decimal("0"), c_igv - v_igv)
        ir = _r2(v_base * config["ir_rate"]) if v_base else Decimal("0")
        meses.append({
            "mes": key,
            "ventas_base": _f2(v_base),
            "ventas_igv": _f2(v_igv),
            "ventas_total": _f2(v_total),
            "ventas_count": v_n,
            "compras_base": _f2(c_base),
            "compras_igv": _f2(c_igv),
            "compras_total": _f2(c_total),
            "compras_count": c_n,
            "igv_por_pagar": _f2(igv_por_pagar),
            "saldo_a_favor": _f2(saldo_a_favor),
            "ir_pago_cuenta": _f2(ir),
            "total_referencial": _f2(igv_por_pagar + ir),
        })

    # ---- Período a resumir ---------------------------------------------------
    if mes is not None:
        periodo_mes = [m for m in meses if m["mes"] == f"{anio:04d}-{mes:02d}"]
        periodo_mes = periodo_mes[0] if periodo_mes else None
    else:
        periodo_mes = None

    if periodo_mes is not None:
        # Resumen de UN mes: del registro mensual.
        resumen = {
            "etiqueta": periodo_mes["mes"],
            "anio": anio,
            "mes": mes,
            "ventas_base": periodo_mes["ventas_base"],
            "ventas_igv": periodo_mes["ventas_igv"],
            "ventas_total": periodo_mes["ventas_total"],
            "ventas_count": periodo_mes["ventas_count"],
            "compras_base": periodo_mes["compras_base"],
            "compras_igv": periodo_mes["compras_igv"],
            "compras_total": periodo_mes["compras_total"],
            "compras_count": periodo_mes["compras_count"],
            "igv_por_pagar": periodo_mes["igv_por_pagar"],
            "saldo_a_favor": periodo_mes["saldo_a_favor"],
            "ir_pago_cuenta": periodo_mes["ir_pago_cuenta"],
            "total_referencial": periodo_mes["total_referencial"],
        }
    else:
        # Resumen anual (suma de los 12 meses).
        v_base = sum(_dec(x["ventas_base"]) for x in meses)
        v_igv = sum(_dec(x["ventas_igv"]) for x in meses)
        v_total = sum(_dec(x["ventas_total"]) for x in meses)
        v_n = sum(x["ventas_count"] for x in meses)
        c_base = sum(_dec(x["compras_base"]) for x in meses)
        c_igv = sum(_dec(x["compras_igv"]) for x in meses)
        c_total = sum(_dec(x["compras_total"]) for x in meses)
        c_n = sum(x["compras_count"] for x in meses)
        igv_por_pagar = max(Decimal("0"), v_igv - c_igv)
        saldo_a_favor = max(Decimal("0"), c_igv - v_igv)
        ir = _r2(v_base * config["ir_rate"]) if v_base else Decimal("0")
        resumen = {
            "etiqueta": f"{anio}",
            "anio": anio,
            "mes": None,
            "ventas_base": _f2(v_base),
            "ventas_igv": _f2(v_igv),
            "ventas_total": _f2(v_total),
            "ventas_count": v_n,
            "compras_base": _f2(c_base),
            "compras_igv": _f2(c_igv),
            "compras_total": _f2(c_total),
            "compras_count": c_n,
            "igv_por_pagar": _f2(igv_por_pagar),
            "saldo_a_favor": _f2(saldo_a_favor),
            "ir_pago_cuenta": _f2(ir),
            "total_referencial": _f2(igv_por_pagar + ir),
        }

    # ---- Detalle explicativo (para el módulo) --------------------------------
    detalle_igv = {
        "igv_ventas": resumen["ventas_igv"],
        "igv_compras": resumen["compras_igv"],
        "igv_por_pagar": resumen["igv_por_pagar"],
        "saldo_a_favor": resumen["saldo_a_favor"],
    }
    detalle_ir = {
        "ingresos_netos": resumen["ventas_base"],
        "tasa": float(config["ir_rate"]),
        "regimen": config["ir_regime"],
        "pago_cuenta": resumen["ir_pago_cuenta"],
    }

    return {
        "config": {
            "igv_rate": float(config["igv_rate"]),
            "ir_regime": config["ir_regime"],
            "ir_rate": float(config["ir_rate"]),
        },
        "resumen": resumen,
        "detalle_igv": detalle_igv,
        "detalle_ir": detalle_ir,
        "annual": meses,
        "hay_ventas": resumen["ventas_count"] > 0,
        "hay_compras": resumen["compras_count"] > 0,
    }