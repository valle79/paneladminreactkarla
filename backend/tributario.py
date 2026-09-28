"""
Módulo Tributario — El Iqueño SAC
=================================
FUENTE ÚNICA DE VERDAD del cálculo tributario del sistema.

Todos los endpoints (resumen tributario, dashboard, ventas, compras) consumen
este módulo. No existe una segunda implementación del IGV ni del IR: si una
regla cambia, se cambia aquí y en todas partes queda corregida.

Reglas implementadas
--------------------
IGV (Impuesto General a las Ventas, Ley 29623)
  * Débito fiscal (ventas): FACTURA + BOLETA. Se excluyen proformas y
    cotizaciones (no son comprobantes fiscales), los registros con
    `estado_fiscal <> 'VALIDO'` (anulados/observados) y los eliminados.
  * Crédito fiscal (compras): FACTURA, RECIBO DE LUZ, RECIBO DE AGUA y
    RECIBO DE GAS. Solo genera crédito fiscal la compra en estado de
    recepción (configurable: setting `purchase_credit_states`).
  * Período: las ventas se agrupan por `fecha_emision` del comprobante
    (NO por la fecha de creación del registro) y las compras por
    `fecha_compra`. Es lo que exige la declaración jurada.
  * IGV por pagar = IGV ventas − IGV compras. Si es negativo, saldo a favor.

IR (Impuesto a la Renta, tercera categoría)
  * Pago a cuenta mensual = ingresos netos × tasa (`ir_rate`, 1% en RMT).
    Ingresos netos = Σ base imponible de FACTURA + BOLETA del período
    (es decir, las ventas SIN IGV). No es "ventas − compras".
  * Pago a cuenta acumulado: registro persistente en `pagos_cuenta_ir`,
    único por período. El resumen nunca lo inventa.
  * Declaración anual:
        renta neta = ingresos netos del año − gastos deducibles del año
        impuesto  = suma progresiva de los tramos configurados en `ir_tramos`
                    (expresados en UIT, valor de UIT en `uit_config`)
        saldo     = impuesto anual − pagos a cuenta efectivamente pagados
  * Los gastos deducibles NO se derivan de las compras: viven en
    `gastos_deducibles` y cada gasto se registra con su naturaleza
    (categoría), importe y sustento. Una compra de mercadería no es
    automáticamente un gasto deducible: eso lo declara el contador.

Aritmética
----------
Todos los importes se manejan con `Decimal` y columna NUMERIC (nunca float).
Se redondea a 2 decimales con ROUND_HALF_UP en cada documento y recién
después se suman los importes ya redondeados (así coincide con SUNAT).
"""

from decimal import Decimal, ROUND_HALF_UP

import db

D2 = Decimal("0.01")
D4 = Decimal("0.0001")
MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio",
         "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre")

# ---------------------------------------------------------------------------
# Catálogos fiscales (constantes de dominio, no configurables por el usuario)
# ---------------------------------------------------------------------------

# Comprobantes de VENTA que son comprobantes fiscales y por tanto generan IGV.
VENTAS_IGV_TIPOS = ("FACTURA", "BOLETA")

# Comprobantes de COMPRA que dan crédito fiscal (Art. 5° y 6° del Reglamento
# de la Ley del IGV). Excluidos a propósito: boleta, ticket, nota de venta
# y nota de crédito — no acreditan el pago del impuesto.
COMPRAS_IGV_TIPOS = ("FACTURA", "RECIBO DE LUZ", "RECIBO DE AGUA", "RECIBO DE GAS")


def norm_tipo_comprobante(valor):
    """Compara tipos de comprobante sin que importen mayúsculas ni '_' vs ' '.

    La aplicación guardaba 'NOTA_DE_VENTA' mientras el CHECK de la
    base de datos usaba 'NOTA DE VENTA'. Normalizar aquí evita que el mismo
    comprobante sea rechazado por una capa y aceptado por otra.
    """
    if valor is None:
        return None
    v = str(valor).strip().upper().replace("_", " ")
    while "  " in v:
        v = v.replace("  ", " ")
    return v


# Estados de compra que SÍ generan crédito fiscal por defecto.
# ORDENADA, CONFIRMADA y EN_TRANSITO quedan fuera: en esos estados la
# mercadería todavía no ha ingresado al almacén, no hay entrega ni
# almacenamiento, y por tanto no hay gasto válido para la entidad.
ESTADOS_COMPRA_CREDITO = ("RECIBIDA_COMPLETA", "RECIBIDA_PARCIAL")

# Un comprobante de venta solo se contabiliza si su estado fiscal es válido.
ESTADO_FISCAL_CONTABILIZABLE = "VALIDO"
ESTADOS_FISCALES = ("VALIDO", "ANULADO", "OBSERVADO")

# Regímenes soportados para la declaración anual.
REGIMENES = ("GENERAL", "RMT", "NRUS")

# Categorías de gasto deducible admitidas.
GASTO_CATEGORIAS = (
    "COMPRA_MERCADERIA", "SERVICIOS", "ALQUILER", "TRANSPORTE",
    "SERVICIOS_PROFESIONALES", "GASTOS_BANCARIOS", "OTROS_GASTOS",
)

DEFAULT_IGV_RATE = Decimal("0.18")
DEFAULT_IR_RATE = Decimal("0.01")
DEFAULT_UIT = Decimal("5500.00")


# ---------------------------------------------------------------------------
# Utilidades numéricas
# ---------------------------------------------------------------------------

def dec(value, default="0"):
    """Convierte a Decimal sin perder precisión (nunca pasa por float)."""
    if value is None or value == "":
        value = default
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def r2(value):
    """Redondea a 2 decimales con ROUND_HALF_UP (regla de SUNAT)."""
    return dec(value).quantize(D2, rounding=ROUND_HALF_UP)


def r4(value):
    return dec(value).quantize(D4, rounding=ROUND_HALF_UP)


def f2(value):
    """Decimal redondeado a 2 decimales expuesto como float para JSON."""
    return float(r2(value))


# ---------------------------------------------------------------------------
# Configuración tributaria
# ---------------------------------------------------------------------------

_CLAVES_DEC = ("igv_rate", "ir_rate", "ir_annual_tramo_uit",
               "ir_annual_rate_1", "ir_annual_rate_2")


def config():
    """Configuración tributaria completa, con Decimals (no floats)."""
    filas = db.fetch_all("SELECT key, value FROM settings")
    raw = {r["key"]: r["value"] for r in filas}

    def _num(clave, default):
        try:
            v = dec(raw.get(clave), default)
        except Exception:
            return dec(default)
        return v if v >= 0 else dec(default)

    regimen = str(raw.get("ir_regime") or "RMT").strip().upper() or "RMT"
    if regimen not in REGIMENES:
        regimen = "RMT"

    estados = str(raw.get("purchase_credit_states") or "").strip()
    if not estados:
        estados = ",".join(ESTADOS_COMPRA_CREDITO)
    estados = tuple(e.strip().upper() for e in estados.split(",") if e.strip())
    if not estados:
        estados = ESTADOS_COMPRA_CREDITO

    return {
        "igv_rate": _num("igv_rate", DEFAULT_IGV_RATE),
        "igv_name": str(raw.get("igv_name") or "IGV"),
        "base_currency": str(raw.get("base_currency") or "PEN"),
        "ir_regime": regimen,
        "ir_rate": _num("ir_rate", DEFAULT_IR_RATE),
        "ir_annual_tramo_uit": _num("ir_annual_tramo_uit", "15"),
        "ir_annual_rate_1": _num("ir_annual_rate_1", "0.10"),
        "ir_annual_rate_2": _num("ir_annual_rate_2", "0.295"),
        "purchase_credit_states": estados,
        "ventas_igv_tipos": VENTAS_IGV_TIPOS,
        "compras_igv_tipos": COMPRAS_IGV_TIPOS,
    }


def igv_rate():
    """Tasa de IGV efectiva, compartida por ventas, compras y reportes."""
    return config()["igv_rate"]


# ---------------------------------------------------------------------------
# Cálculo de importes de venta (autoritativo del servidor)
# ---------------------------------------------------------------------------

def calcular_ventas(items, with_igv, discount_amount, rate=None):
    """Calcula la base imponible, el IGV y el total de una venta.

    Convención del sistema: el PRECIO UNITARIO se ingresa con IGV incluido
    (el precio de venta al público). El descuento se aplica sobre ese bruto.

        bruto  = Σ cantidad × precio_unitario          (con IGV)
        base_b = bruto − descuento
        base   = con IGV ? base_b / (1 + tasa) : base_b
        igv    = con IGV ? base_b − base : 0
        total  = base + igv                             (= base_b)

    Invariante garantizada: `total == base + igv` para todo documento,
    incluso con descuento. Ése era el error que rompía la contabilidad.

    Devuelve `(subtotal, igv, total, bruto, descuento)` en Decimal.
    """
    tasa = dec(rate if rate is not None else igv_rate())
    if tasa <= 0:
        tasa = DEFAULT_IGV_RATE if with_igv else Decimal("0")

    bruto = Decimal("0")
    for it in items or []:
        cantidad = dec(it.get("quantity", it.get("cantidad", 1)), "1")
        precio = dec(it.get("unit_price", it.get("precio_unitario", 0)))
        bruto += r2(cantidad * precio)
    bruto = r2(bruto)

    descuento = r2(dec(discount_amount))
    if descuento < 0:
        descuento = Decimal("0.00")
    if descuento > bruto:
        descuento = bruto

    base_b = r2(bruto - descuento)
    if with_igv:
        base = r2(base_b / (Decimal("1") + tasa))
        igv = r2(base_b - base)
    else:
        base = base_b
        igv = Decimal("0.00")

    total = r2(base + igv)
    return base, igv, total, bruto, descuento


# ---------------------------------------------------------------------------
# Cálculo de importes de compra (autoritativo del servidor)
# ---------------------------------------------------------------------------

def calcular_items_compra(items, con_igv, tasa):
    """Calcula subtotal / impuesto / total por ítem de compra.

    Convención de compras: el PRECIO UNITARIO se ingresa con IGV incluido.
        bruto    = cantidad × precio_unitario
        neto     = bruto − descuento
        base     = con IGV ? neto / (1 + tasa) : neto
        impuesto = con IGV ? neto − base : 0
        total    = base + impuesto                      (= neto)

    El descuento reduce la BASE IMPONIBLE y el impuesto se recalcula sobre
    ella. Antes el descuento se restaba de la base pero el IGV se cobraba
    sobre el bruto, y `total ≠ base + impuesto`.
    """
    tasa = dec(tasa)
    out = []
    for it in items or []:
        cantidad = dec(it.get("quantity", it.get("cantidad", 1)), "1")
        precio = dec(it.get("unit_price", it.get("precio_unitario", 0)))
        bruto = r2(cantidad * precio)

        descuento = r2(dec(it.get("descuento", 0)))
        if descuento < 0:
            descuento = Decimal("0.00")
        if descuento > bruto:
            descuento = bruto

        neto = r2(bruto - descuento)
        if con_igv:
            base = r2(neto / (Decimal("1") + tasa)) if tasa else neto
            impuesto = r2(neto - base) if tasa else Decimal("0.00")
        else:
            base = neto
            impuesto = Decimal("0.00")

        out.append({
            "subtotal": base,
            "impuesto": impuesto,
            "total": r2(base + impuesto),
        })
    return out


# ---------------------------------------------------------------------------
# Agregados desde la base de datos
# ---------------------------------------------------------------------------

def _rango(anio, mes):
    """Devuelve (desde, hasta_excluyente) como fechas ISO del período."""
    if mes:
        desde = f"{int(anio):04d}-{int(mes):02d}-01"
        nxt = int(anio) + (1 if int(mes) == 12 else 0)
        m0 = 1 if int(mes) == 12 else int(mes) + 1
        hasta = f"{nxt:04d}-{m0:02d}-01"
    else:
        desde = f"{int(anio):04d}-01-01"
        hasta = f"{int(anio) + 1:04d}-01-01"
    return desde, hasta


def _vacio():
    return {"base": Decimal("0.00"), "igv": Decimal("0.00"),
            "total": Decimal("0.00"), "count": 0}


def _norm(fila):
    if not fila:
        return _vacio()
    return {
        "base": r2(fila["base"]),
        "igv": r2(fila["igv"]),
        "total": r2(fila["total"]),
        "count": int(fila["n"] or 0),
    }


_SQL_VENTAS = """
    SELECT EXTRACT(MONTH FROM fecha_emision)::int AS mes,
           COALESCE(SUM(subtotal), 0)  AS base,
           COALESCE(SUM(igv), 0)       AS igv,
           COALESCE(SUM(total), 0)     AS total,
           COUNT(*)::int               AS n
      FROM sales
     WHERE NOT deleted
       AND estado_fiscal = %(estado)s
        AND UPPER(TRIM(REPLACE(COALESCE(invoice_type, ''), '_', ' '))) = ANY(%(tipos)s)
       AND fecha_emision >= %(desde)s::date
       AND fecha_emision <  %(hasta)s::date
     GROUP BY 1
"""

_SQL_COMPRAS = """
    SELECT EXTRACT(MONTH FROM fecha_compra)::int AS mes,
           COALESCE(SUM(subtotal * CASE WHEN moneda = 'PEN' OR moneda IS NULL
                                         THEN 1
                                         ELSE total_equivalente / NULLIF(total, 0)
                                    END), 0) AS base,
           COALESCE(SUM(impuestos * CASE WHEN moneda = 'PEN' OR moneda IS NULL
                                          THEN 1
                                          ELSE total_equivalente / NULLIF(total, 0)
                                     END), 0) AS igv,
           COALESCE(SUM(total_equivalente), 0) AS total,
           COUNT(*)::int AS n
      FROM purchases
     WHERE NOT deleted
        AND UPPER(TRIM(REPLACE(COALESCE(tipo_comprobante, ''), '_', ' '))) = ANY(%(tipos)s)
        AND UPPER(COALESCE(estado, '')) = ANY(%(estados)s)
       AND fecha_compra >= %(desde)s::date
       AND fecha_compra <  %(hasta)s::date
     GROUP BY 1
"""


def ventas_igv_mensual(anio, mes=None):
    """IGV débito y base imponible de ventas agrupados por mes del período."""
    desde, hasta = _rango(anio, mes)
    return _norm_por_mes(db.fetch_all(_SQL_VENTAS, {
        "estado": ESTADO_FISCAL_CONTABILIZABLE,
        "tipos": list(VENTAS_IGV_TIPOS),
        "desde": desde, "hasta": hasta,
    }), mes)


def compras_igv_mensual(anio, mes=None):
    """IGV crédito y base de compras agrupados por mes del período."""
    desde, hasta = _rango(anio, mes)
    estados = list(config()["purchase_credit_states"])
    return _norm_por_mes(db.fetch_all(_SQL_COMPRAS, {
        "tipos": list(COMPRAS_IGV_TIPOS),
        "estados": estados,
        "desde": desde, "hasta": hasta,
    }), mes)


def _norm_por_mes(filas, mes):
    """Normaliza el resultado de un GROUP BY mes a {1..12} o a un solo mes."""
    mapa = {}
    for f in filas:
        m = int(f["mes"])
        mapa[m] = {
            "base": r2(f["base"]), "igv": r2(f["igv"]),
            "total": r2(f["total"]), "count": int(f["n"] or 0),
        }
    if mes:
        return {int(mes): mapa.get(int(mes), _vacio())}
    return {m: mapa.get(m, _vacio()) for m in range(1, 13)}


def _suma(dic):
    return {
        "base": r2(sum((v["base"] for v in dic.values()), Decimal("0"))),
        "igv": r2(sum((v["igv"] for v in dic.values()), Decimal("0"))),
        "total": r2(sum((v["total"] for v in dic.values()), Decimal("0"))),
        "count": sum(v["count"] for v in dic.values()),
    }


# ---------------------------------------------------------------------------
# Gastos deducibles (registro explícito, independiente de las compras)
# ---------------------------------------------------------------------------

def gastos_deducibles_mensual(anio, mes=None):
    """Gastos deducibles válidos agrupados por mes, con detalle por categoría."""
    if mes:
        filas = db.fetch_all(
            """SELECT COALESCE(SUM(monto_pen), 0) AS total, COUNT(*)::int AS n
                 FROM gastos_deducibles
                WHERE NOT deleted AND estado = 'VALIDO'
                  AND anio = %(anio)s AND mes = %(mes)s""",
            {"anio": int(anio), "mes": int(mes)},
        )
    else:
        filas = db.fetch_all(
            """SELECT EXTRACT(MONTH FROM fecha_gasto)::int AS mes,
                      COALESCE(SUM(monto_pen), 0) AS total, COUNT(*)::int AS n
                 FROM gastos_deducibles
                WHERE NOT deleted AND estado = 'VALIDO' AND anio = %(anio)s
                GROUP BY 1""",
            {"anio": int(anio)},
        )
    mapa = {}
    for f in filas:
        if mes:
            clave = int(mes)
        else:
            clave = int(f["mes"])
        mapa[clave] = {"total": r2(f["total"]), "count": int(f["n"] or 0)}
    if mes:
        return {int(mes): mapa.get(int(mes), {"total": Decimal("0.00"), "count": 0})}
    return {m: mapa.get(m, {"total": Decimal("0.00"), "count": 0}) for m in range(1, 13)}


def gastos_deducibles_por_categoria(anio, mes=None):
    """Detalle por categoría de naturaleza del gasto (para validar deducibilidad)."""
    if mes:
        filas = db.fetch_all(
            """SELECT categoria, COALESCE(SUM(monto_pen), 0) AS total, COUNT(*)::int AS n
                 FROM gastos_deducibles
                WHERE NOT deleted AND estado = 'VALIDO'
                  AND anio = %(anio)s AND mes = %(mes)s
                GROUP BY 1 ORDER BY 1""",
            {"anio": int(anio), "mes": int(mes)},
        )
    else:
        filas = db.fetch_all(
            """SELECT categoria, COALESCE(SUM(monto_pen), 0) AS total, COUNT(*)::int AS n
                 FROM gastos_deducibles
                WHERE NOT deleted AND estado = 'VALIDO' AND anio = %(anio)s
                GROUP BY 1 ORDER BY 1""",
            {"anio": int(anio)},
        )
    return [{"categoria": f["categoria"], "total": r2(f["total"]),
             "count": int(f["n"] or 0)} for f in filas]


# ---------------------------------------------------------------------------
# Pagos a cuenta del IR (registro persistente)
# ---------------------------------------------------------------------------

def pagos_cuenta_mensual(anio, mes=None):
    """Pagos a cuenta registrados por el usuario, agrupados por mes."""
    if mes:
        filas = db.fetch_all(
            """SELECT COALESCE(SUM(COALESCE(monto_pagado, monto_calculado, 0)), 0) AS pagado,
                      COALESCE(SUM(monto_calculado), 0) AS calculado,
                      COUNT(*)::int AS n
                 FROM pagos_cuenta_ir
                WHERE NOT deleted AND estado = 'PAGADO'
                  AND anio = %(anio)s AND mes = %(mes)s""",
            {"anio": int(anio), "mes": int(mes)},
        )
    else:
        filas = db.fetch_all(
            """SELECT mes,
                      COALESCE(SUM(COALESCE(monto_pagado, monto_calculado, 0)), 0) AS pagado,
                      COALESCE(SUM(monto_calculado), 0) AS calculado,
                      COUNT(*)::int AS n
                 FROM pagos_cuenta_ir
                WHERE NOT deleted AND estado = 'PAGADO' AND anio = %(anio)s
                GROUP BY mes""",
            {"anio": int(anio)},
        )
    mapa = {}
    for f in filas:
        clave = int(mes) if mes else int(f["mes"])
        mapa[clave] = {"pagado": r2(f["pagado"]), "calculado": r2(f["calculado"]),
                       "count": int(f["n"] or 0)}
    if mes:
        return {int(mes): mapa.get(int(mes), {"pagado": Decimal("0.00"),
                                              "calculado": Decimal("0.00"), "count": 0})}
    return {m: mapa.get(m, {"pagado": Decimal("0.00"), "calculado": Decimal("0.00"),
                            "count": 0}) for m in range(1, 13)}


# ---------------------------------------------------------------------------
# UIT y tramos del IR anual
# ---------------------------------------------------------------------------

def uit(anio):
    """Valor de la UIT para el año, desde `uit_config`."""
    row = db.fetch_one(
        "SELECT valor_uit FROM uit_config WHERE anio = %s", (int(anio),))
    if row and row["valor_uit"] is not None:
        return r2(row["valor_uit"])
    return r2(DEFAULT_UIT)


def tramos_ir(regimen):
    """Tramos del IR anual configurados para un régimen, ordenados por UIT."""
    return db.fetch_all(
        """SELECT desde_uit, hasta_uit, tasa, descripcion
             FROM ir_tramos
            WHERE regimen = %s AND activo
            ORDER BY desde_uit""",
        (str(regimen),),
    )


def calcular_impuesto_anual(renta_neta, tramos, valor_uit):
    """Impuesto anual por tramos progresivos sobre la renta neta.

    Cada tramo se aplica SOLO a la parte de la renta neta que le corresponde.
    Devuelve `(impuesto, detalle_tramos)` con detalle en soles.
    """
    renta_neta = r2(renta_neta)
    if renta_neta <= 0 or not tramos:
        return Decimal("0.00"), []

    acumulado = Decimal("0.00")
    detalle = []
    for t in tramos:
        desde = r2(dec(t["desde_uit"]) * valor_uit)
        hasta = (r2(dec(t["hasta_uit"]) * valor_uit)
                 if t["hasta_uit"] is not None else None)
        if hasta is not None and acumulado >= hasta:
            continue
        base_tramo = (renta_neta - acumulado) if hasta is None \
            else (renta_neta - acumulado if renta_neta < hasta else hasta - acumulado)
        if base_tramo <= 0:
            break
        tasa = dec(t["tasa"])
        impuesto = r2(base_tramo * tasa)
        acumulado = r2(acumulado + base_tramo)
        detalle.append({
            "desde_uit": r2(t["desde_uit"]),
            "hasta_uit": r2(t["hasta_uit"]) if t["hasta_uit"] is not None else None,
            "tasa": float(tasa),
            "base_soles": r2(base_tramo),
            "impuesto": impuesto,
            "descripcion": t.get("descripcion"),
        })
    return r2(sum((d["impuesto"] for d in detalle), Decimal("0.00"))), detalle


# ---------------------------------------------------------------------------
# Bloque de declaración anual
# ---------------------------------------------------------------------------

def ir_anual(anio):
    """Declaración anual del Impuesto a la Renta de tercera categoría."""
    cfg = config()
    regimen = cfg["ir_regime"]
    valor_uit = uit(anio)

    ventas = _suma(ventas_igv_mensual(anio))
    gastos_m = gastos_deducibles_mensual(anio)
    gastos = r2(sum((g["total"] for g in gastos_m.values()), Decimal("0")))

    ingresos_netos = ventas["base"]
    renta_neta = r2(ingresos_netos - gastos)
    if renta_neta < 0:
        renta_neta = Decimal("0.00")

    tramos = tramos_ir(regimen)
    requiere_config = not tramos
    if requiere_config:
        # Sin tabla de tramos vigente NO se inventa un impuesto: se informa.
        tramos_fallback = tramos_ir("GENERAL")
        impuesto, detalle = calcular_impuesto_anual(
            renta_neta, tramos_fallback, valor_uit)
        referencia = True
    else:
        impuesto, detalle = calcular_impuesto_anual(renta_neta, tramos, valor_uit)
        referencia = False

    pagos = pagos_cuenta_mensual(anio)
    pagos_pagados = r2(sum((p["pagado"] for p in pagos.values()), Decimal("0")))
    saldo = r2(impuesto - pagos_pagados)

    return {
        "anio": int(anio),
        "regimen": regimen,
        "valor_uit": f2(valor_uit),
        "ingresos_netos": f2(ingresos_netos),
        "gastos_deducibles": f2(gastos),
        "renta_neta": f2(renta_neta),
        "impuesto_anual": f2(impuesto),
        "pagos_a_cuenta": f2(pagos_pagados),
        "saldo": f2(abs(saldo)),
        "resultado": "A_PAGAR" if saldo > 0 else ("A_FAVOR" if saldo < 0 else "SIN_SALDO"),
        "tramos": detalle,
        "tramos_configurados": not requiere_config,
        "tramos_referencia": referencia,
        "advertencia": (
            "No hay tramos del IR anual configurados para el régimen "
            f"{regimen}; se muestran los tramos del Régimen General solo "
            "como referencia. Configura la tabla oficial vigente."
        ) if requiere_config else None,
        "meses_con_pago": sorted(
            m for m in pagos if pagos[m]["pagado"] > 0 or pagos[m]["count"] > 0),
    }


# ---------------------------------------------------------------------------
# Resumen consolidado (mensual y anual)
# ---------------------------------------------------------------------------

def resumen(anio, mes=None):
    """Payload completo del resumen tributario.

    - `annual`: serie de los 12 meses del año (para tabla y gráfico anual).
    - `resumen`: el período pedido (un mes o el año completo).
    - `igv`: mismo criterio que el dashboard y que las ventas, sin duplicar
      reglas en otros módulos.
    - `ir_anual`: declaración anual.
    """
    anio = int(anio)
    cfg = config()
    tasa_ir = cfg["ir_rate"]

    v_mes = ventas_igv_mensual(anio)
    c_mes = compras_igv_mensual(anio)
    g_mes = gastos_deducibles_mensual(anio)
    p_mes = pagos_cuenta_mensual(anio)

    def _fila(m):
        v = v_mes.get(m, _vacio())
        c = c_mes.get(m, _vacio())
        g = g_mes.get(m, {"total": Decimal("0.00"), "count": 0})
        p = p_mes.get(m, {"pagado": Decimal("0.00"), "calculado": Decimal("0.00"),
                          "count": 0})
        dif = r2(v["igv"] - c["igv"])
        pago_calc = r2(v["base"] * tasa_ir)
        # Si el mes tiene un pago a cuenta REGISTRADO se muestra ese; si no,
        # el cálculo oficial. Nunca se inventa un pago efectuado.
        pago_cta = p["pagado"] if p["count"] else pago_calc
        return {
            "mes": f"{anio:04d}-{m:02d}",
            "mes_num": m,
            "mes_nombre": MESES[m - 1],
            "ventas_base": f2(v["base"]),
            "ventas_igv": f2(v["igv"]),
            "ventas_total": f2(v["total"]),
            "ventas_count": v["count"],
            "compras_base": f2(c["base"]),
            "compras_igv": f2(c["igv"]),
            "compras_total": f2(c["total"]),
            "compras_count": c["count"],
            "gastos_deducibles": f2(g["total"]),
            "gastos_count": g["count"],
            "igv_por_pagar": f2(max(Decimal("0"), dif)),
            "saldo_a_favor": f2(max(Decimal("0"), -dif)),
            "igv_neto": f2(dif),
            "ir_pago_cuenta_calculado": f2(pago_calc),
            "ir_pago_cuenta_pagado": f2(p["pagado"]),
            "ir_pago_cuenta": f2(pago_cta),
            "total_referencial": f2(max(Decimal("0"), dif) + pago_cta),
        }

    annual = [_fila(m) for m in range(1, 13)]

    if mes:
        idx = int(mes) - 1
        resumen_periodo = annual[idx]
        etiqueta = f"{MESES[idx]} {anio}"
    else:
        vt = _suma(v_mes)
        ct = _suma(c_mes)
        gt = r2(sum((g["total"] for g in g_mes.values()), Decimal("0")))
        pt = r2(sum((p["pagado"] for p in p_mes.values()), Decimal("0")))
        dif = r2(vt["igv"] - ct["igv"])
        calc = r2(vt["base"] * tasa_ir)
        hay_pago = any(p["count"] for p in p_mes.values())
        pago_cta = pt if hay_pago else calc
        resumen_periodo = {
            "mes": f"{anio:04d}",
            "mes_num": None,
            "mes_nombre": f"Año {anio}",
            "ventas_base": f2(vt["base"]),
            "ventas_igv": f2(vt["igv"]),
            "ventas_total": f2(vt["total"]),
            "ventas_count": vt["count"],
            "compras_base": f2(ct["base"]),
            "compras_igv": f2(ct["igv"]),
            "compras_total": f2(ct["total"]),
            "compras_count": ct["count"],
            "gastos_deducibles": f2(gt),
            "gastos_count": sum(g["count"] for g in g_mes.values()),
            "igv_por_pagar": f2(max(Decimal("0"), dif)),
            "saldo_a_favor": f2(max(Decimal("0"), -dif)),
            "igv_neto": f2(dif),
            "ir_pago_cuenta_calculado": f2(calc),
            "ir_pago_cuenta_pagado": f2(pt),
            "ir_pago_cuenta": f2(pago_cta),
            "total_referencial": f2(max(Decimal("0"), dif) + pago_cta),
        }
        etiqueta = f"Año {anio}"

    r = resumen_periodo
    return {
        "config": {
            "igv_rate": float(cfg["igv_rate"]),
            "igv_name": cfg["igv_name"],
            "base_currency": cfg["base_currency"],
            "ir_regime": cfg["ir_regime"],
            "ir_rate": float(cfg["ir_rate"]),
            "ventas_igv_tipos": list(VENTAS_IGV_TIPOS),
            "compras_igv_tipos": list(COMPRAS_IGV_TIPOS),
            "purchase_credit_states": list(cfg["purchase_credit_states"]),
            "gastos_categorias": list(GASTO_CATEGORIAS),
        },
        "etiqueta": etiqueta,
        "anio": anio,
        "mes": int(mes) if mes else None,
        "resumen": r,
        "detalle_igv": {
            "igv_ventas": r["ventas_igv"],
            "igv_compras": r["compras_igv"],
            "igv_por_pagar": r["igv_por_pagar"],
            "saldo_a_favor": r["saldo_a_favor"],
            "igv_neto": r["igv_neto"],
        },
        "detalle_ir": {
            "ingresos_netos": r["ventas_base"],
            "tasa": float(cfg["ir_rate"]),
            "regimen": cfg["ir_regime"],
            "pago_cuenta_calculado": r["ir_pago_cuenta_calculado"],
            "pago_cuenta_pagado": r["ir_pago_cuenta_pagado"],
            "pago_cuenta": r["ir_pago_cuenta"],
        },
        "gastos_deducibles_detalle": gastos_deducibles_por_categoria(anio, mes),
        "ir_anual": ir_anual(anio),
        "annual": annual,
        "hay_ventas": r["ventas_count"] > 0,
        "hay_compras": r["compras_count"] > 0,
    }


# ---------------------------------------------------------------------------
# Indicadores para el dashboard (misma fuente de verdad que el resumen)
# ---------------------------------------------------------------------------

def dashboard(anio, mes=None):
    """IGV del período para tarjetas del dashboard. Usa exactamente las mismas
    reglas que `/api/resumen-tributario` (una sola definición del impuesto)."""
    v = ventas_igv_mensual(anio, mes)
    c = compras_igv_mensual(anio, mes)
    vt = _suma(v)
    ct = _suma(c)
    dif = r2(vt["igv"] - ct["igv"])
    return {
        "anio": int(anio),
        "mes": int(mes) if mes else None,
        "ventas_base": f2(vt["base"]),
        "igv": f2(dif),
        "igv_ventas": f2(vt["igv"]),
        "igv_compras": f2(ct["igv"]),
        "igv_por_pagar": f2(max(Decimal("0"), dif)),
        "saldo_a_favor": f2(max(Decimal("0"), -dif)),
        "total": f2(vt["total"]),
    }
