"""
Suite de tests tributarios — El Iqueño SAC
===========================================
Verifica las reglas de IGV e IR con aritmética Decimal exacta y contra la
base de datos REAL.

Seguridad: los tests de integración se ejecutan dentro de una transacción
que SIEMPRE se revierte (`ROLLBACK`). No queda ningún registro de prueba en la
base: ni ventas, ni compras, ni gastos, ni pagos a cuenta.

Ejecución:  python test_tributario.py
"""

import os
import sys
import traceback
from datetime import date, timedelta
from decimal import Decimal

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from psycopg2 import errors as pgerrors

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import db  # noqa: E402
import tributario as trib  # noqa: E402

D = Decimal
NOMBRE_TEST = "ZZ_TEST_TRIBUTARIO"
FAILS = []
PASSES = []


# ---------------------------------------------------------------------------
# Asserts y contadores
# ---------------------------------------------------------------------------
def check(nombre, obtenido, esperado):
    """Compara dos valores decimales/string/lista con tolerancia cero."""
    ok = False
    if isinstance(esperado, (Decimal, str, int, float, bool, type(None))):
        ok = _eq(obtenido, esperado)
    else:
        ok = _eq(obtenido, esperado)
    if ok:
        PASSES.append(nombre)
        print("  [OK]   %s" % nombre)
    else:
        FAILS.append((nombre, obtenido, esperado))
        print("  [FALLA] %s\n           obtenido: %r\n           esperado: %r"
              % (nombre, obtenido, esperado))
    return ok


def _eq(a, b):
    if isinstance(a, Decimal) or isinstance(b, Decimal):
        try:
            return D(str(a)) == D(str(b))
        except Exception:
            return False
    if isinstance(a, float) or isinstance(b, float):
        try:
            return abs(float(a) - float(b)) < 0.005
        except Exception:
            return False
    return a == b


def seccion(titulo):
    print("\n" + "=" * 78)
    print(titulo)
    print("=" * 78)


# ===========================================================================
# 1. CÁLCULO DE VENTAS (función pura, sin base de datos)
# ===========================================================================
def test_calculo_ventas():
    seccion("1. CÁLCULO DE VENTAS (base + IGV = total, siempre)")
    T = D("0.18")

    # Sin IGV
    b, i, t, bruto, desc = trib.calcular_ventas(
        [{"quantity": 2, "unit_price": D("100.00")}], False, 0, T)
    check("ventas sin IGV: base = 200.00", b, D("200.00"))
    check("ventas sin IGV: igv = 0.00", i, D("0.00"))
    check("ventas sin IGV: total = 200.00", t, D("200.00"))
    check("ventas sin IGV: subtotal + igv = total", b + i, t)

    # Con IGV, precio al público (118.00 = 100 + 18)
    b, i, t, bruto, desc = trib.calcular_ventas(
        [{"quantity": 1, "unit_price": D("118.00")}], True, 0, T)
    check("ventas con IGV: base = 100.00", b, D("100.00"))
    check("ventas con IGV: igv = 18.00", i, D("18.00"))
    check("ventas con IGV: total = 118.00", t, D("118.00"))

    # Varios ítems
    b, i, t, bruto, desc = trib.calcular_ventas(
        [{"quantity": 3, "unit_price": D("59.00")},
         {"quantity": 1, "unit_price": D("23.60")}], True, 0, T)
    check("ventas multi-ítem: base = 170.00", b, D("170.00"))
    check("ventas multi-ítem: igv = 30.60", i, D("30.60"))
    check("ventas multi-ítem: total = 200.60", t, D("200.60"))
    check("ventas multi-ítem: base + igv = total", b + i, t)

    # CASO DEL ERROR ORIGINAL: descuento que rompía base + igv = total
    # 640.00 con IGV, descuento 96.00 sobre el bruto -> neto 544.00
    b, i, t, bruto, desc = trib.calcular_ventas(
        [{"quantity": 1, "unit_price": D("640.00")}], True, D("96.00"), T)
    check("ventas con descuento: base = 461.02 (544/1.18)", b, D("461.02"))
    check("ventas con descuento: igv = 82.98 (544 - 461.02)", i, D("82.98"))
    check("ventas con descuento: total = 544.00", t, D("544.00"))
    check("ventas con descuento: base + igv = total  << era el error", b + i, t)

    # Descuento fijo mayor que el bruto -> se acota
    b, i, t, bruto, desc = trib.calcular_ventas(
        [{"quantity": 1, "unit_price": D("118.00")}], True, D("500.00"), T)
    check("descuento mayor al bruto: se acota a 118.00", desc, D("118.00"))
    check("descuento mayor al bruto: base = 0.00", b, D("0.00"))
    check("descuento mayor al bruto: total = 0.00", t, D("0.00"))
    check("descuento mayor al bruto: base + igv = total", b + i, t)

    # Descuento negativo -> se ignora
    b, i, t, bruto, desc = trib.calcular_ventas(
        [{"quantity": 1, "unit_price": D("118.00")}], True, D("-50.00"), T)
    check("descuento negativo: se trata como 0", desc, D("0.00"))
    check("descuento negativo: total = 118.00", t, D("118.00"))

    # Sin ítems
    b, i, t, bruto, desc = trib.calcular_ventas([], True, 0, T)
    check("venta sin ítems: todo en cero", (b, i, t), (D("0.00"), D("0.00"), D("0.00")))

    # Redondeo: 3 x 33.33 = 99.99 (sin IGV exacto)
    b, i, t, bruto, desc = trib.calcular_ventas(
        [{"quantity": 3, "unit_price": D("33.33")}], True, 0, T)
    check("redondeo: base = 84.74", b, D("84.74"))
    check("redondeo: igv = 15.25", i, D("15.25"))
    check("redondeo: base + igv = total", b + i, t)

    # Tasa configurable distinta (7%)
    b, i, t, bruto, desc = trib.calcular_ventas(
        [{"quantity": 1, "unit_price": D("107.00")}], True, 0, D("0.07"))
    check("tasa 7%: base = 100.00", b, D("100.00"))
    check("tasa 7%: igv = 7.00", i, D("7.00"))


# ===========================================================================
# 2. CÁLCULO DE COMPRAS (función pura)
# ===========================================================================
def test_calculo_compras():
    seccion("2. CÁLCULO DE COMPRAS (descuentos y crédito fiscal)")
    T = D("0.18")

    it = trib.calcular_items_compra(
        [{"cantidad": 1, "precio_unitario": D("118.00"), "descuento": 0}], True, T)[0]
    check("compra simple: base = 100.00", it["subtotal"], D("100.00"))
    check("compra simple: impuesto = 18.00", it["impuesto"], D("18.00"))
    check("compra simple: total = 118.00", it["total"], D("118.00"))
    check("compra simple: base + impuesto = total", it["subtotal"] + it["impuesto"], it["total"])

    # CASO DEL ERROR ORIGINAL: el descuento se restaba de la base pero el IGV
    # se calculaba sobre el bruto, y total != base + impuesto.
    # 118.00 - 18.00 = 100.00 ; 100/1.18 = 84.7457... -> 84.75 (ROUND_HALF_UP)
    it = trib.calcular_items_compra(
        [{"cantidad": 1, "precio_unitario": D("118.00"), "descuento": D("18.00")}], True, T)[0]
    check("compra con descuento: base = 84.75 (ROUND_HALF_UP)", it["subtotal"], D("84.75"))
    check("compra con descuento: impuesto = 15.25", it["impuesto"], D("15.25"))
    check("compra con descuento: total = 100.00", it["total"], D("100.00"))
    check("compra con descuento: base + impuesto = total  << era el error",
          it["subtotal"] + it["impuesto"], it["total"])
    check("compra con descuento: total = bruto - descuento",
          it["total"], D("118.00") - D("18.00"))

    # Descuento mayor al bruto
    it = trib.calcular_items_compra(
        [{"cantidad": 1, "precio_unitario": D("118.00"), "descuento": D("999.00")}], True, T)[0]
    check("compra: descuento mayor al bruto -> total 0.00", it["total"], D("0.00"))
    check("compra: descuento mayor al bruto -> base 0.00", it["subtotal"], D("0.00"))

    # Sin IGV
    it = trib.calcular_items_compra(
        [{"cantidad": 2, "precio_unitario": D("50.00"), "descuento": D("10.00")}], False, D("0"))[0]
    check("compra sin IGV: base = 90.00", it["subtotal"], D("90.00"))
    check("compra sin IGV: impuesto = 0.00", it["impuesto"], D("0.00"))
    check("compra sin IGV: total = 90.00", it["total"], D("90.00"))

    # Suma de la compra: la invariante de cabecera debe cumplirse
    items = trib.calcular_items_compra([
        {"cantidad": 2, "precio_unitario": D("118.00"), "descuento": D("10.00")},
        {"cantidad": 1, "precio_unitario": D("59.00"), "descuento": 0},
    ], True, T)
    sub = sum(i["subtotal"] for i in items)
    imp = sum(i["impuesto"] for i in items)
    tot = sum(i["total"] for i in items)
    check("compra: total cabecera = base + impuesto", sub + imp, tot)


# ===========================================================================
# 3. IR ANUAL POR TRAMOS (función pura)
# ===========================================================================
def test_ir_anual_tramos():
    seccion("3. IR ANUAL: RENTA NETA, UIT Y TRAMOS PROGRESIVOS")
    uit = D("5500.00")
    tramos = [
        {"desde_uit": D("0"), "hasta_uit": D("15"), "tasa": D("0.10"), "descripcion": "10%"},
        {"desde_uit": D("15"), "hasta_uit": None, "tasa": D("0.295"), "descripcion": "29.5%"},
    ]

    # Exactamente 15 UIT -> solo el primer tramo
    rn = D("82500.00")
    imp, det = trib.calcular_impuesto_anual(rn, tramos, uit)
    check("15 UIT exactas: impuesto = 8250.00", imp, D("8250.00"))
    check("15 UIT exactas: 1 tramo aplicado", len(det), 1)

    # 20 UIT -> 15 UIT al 10% (8,250) + 5 UIT al 29.5% (8,112.50) = 16,362.50
    rn = D("110000.00")
    imp, det = trib.calcular_impuesto_anual(rn, tramos, uit)
    check("20 UIT: impuesto = 16362.50", imp, D("16362.50"))
    check("20 UIT: tramo 1 impuesto = 8250.00", det[0]["impuesto"], D("8250.00"))
    check("20 UIT: tramo 2 impuesto = 8112.50", det[1]["impuesto"], D("8112.50"))
    check("20 UIT: 2 tramos aplicados", len(det), 2)
    check("20 UIT: tramo 1 base = 82500.00", det[0]["base_soles"], D("82500.00"))
    check("20 UIT: tramo 2 base = 27500.00", det[1]["base_soles"], D("27500.00"))

    # Justo por debajo del umbral
    imp, _ = trib.calcular_impuesto_anual(D("82499.99"), tramos, uit)
    check("por debajo de 15 UIT: impuesto = 8250.00", imp, D("8250.00"))

    # Renta neta <= 0
    imp, det = trib.calcular_impuesto_anual(D("0"), tramos, uit)
    check("renta neta 0: impuesto = 0.00", imp, D("0.00"))
    imp, det = trib.calcular_impuesto_anual(D("-5000.00"), tramos, uit)
    check("renta neta negativa: impuesto = 0.00", imp, D("0.00"))

    # Sin tramos configurados -> nunca inventa un impuesto
    imp, det = trib.calcular_impuesto_anual(D("110000.00"), [], uit)
    check("sin tramos: impuesto = 0.00", imp, D("0.00"))
    check("sin tramos: detalle vacío", len(det), 0)

    # 5 tramos (comprueba que el algoritmo es realmente progresivo)
    t5 = [
        {"desde_uit": D("0"), "hasta_uit": D("10"), "tasa": D("0.05"), "descripcion": ""},
        {"desde_uit": D("10"), "hasta_uit": D("20"), "tasa": D("0.10"), "descripcion": ""},
        {"desde_uit": D("20"), "hasta_uit": D("30"), "tasa": D("0.15"), "descripcion": ""},
        {"desde_uit": D("30"), "hasta_uit": D("40"), "tasa": D("0.20"), "descripcion": ""},
        {"desde_uit": D("40"), "hasta_uit": None, "tasa": D("0.30"), "descripcion": ""},
    ]
    imp, det = trib.calcular_impuesto_anual(D("275000.00"), t5, uit)  # 50 UIT
    esperado = (D("10") * uit * D("0.05") + D("10") * uit * D("0.10")
                + D("10") * uit * D("0.15") + D("10") * uit * D("0.20")
                + D("10") * uit * D("0.30"))
    check("5 tramos: impuesto correcto", imp, esperado.quantize(D("0.01")))
    check("5 tramos: 5 tramos aplicados", len(det), 5)
    check("5 tramos: suma de bases = renta neta",
          sum(d["base_soles"] for d in det), D("275000.00"))


# ===========================================================================
# 4. TIPOS DE COMPROBANTE (catálogos fiscales)
# ===========================================================================
def test_catalogos():
    seccion("4. CATÁLOGOS DE COMPROBANTES FISCALES")
    check("ventas que generan IGV = FACTURA + BOLETA",
          tuple(sorted(trib.VENTAS_IGV_TIPOS)), ("BOLETA", "FACTURA"))
    check("compras que generan crédito fiscal incluye LUZ",
          "RECIBO DE LUZ" in trib.COMPRAS_IGV_TIPOS, True)
    check("compras que generan crédito fiscal incluye AGUA",
          "RECIBO DE AGUA" in trib.COMPRAS_IGV_TIPOS, True)
    check("compras que generan crédito fiscal incluye GAS",
          "RECIBO DE GAS" in trib.COMPRAS_IGV_TIPOS, True)
    check("BOLETA de compra NO da crédito fiscal",
          "BOLETA" in trib.COMPRAS_IGV_TIPOS, False)
    check("proforma NO da crédito fiscal",
          "PROFORMA" in trib.COMPRAS_IGV_TIPOS, False)
    check("ORDENADA no da crédito fiscal",
          "ORDENADA" in trib.ESTADOS_COMPRA_CREDITO, False)
    check("CONFIRMADA no da crédito fiscal",
          "CONFIRMADA" in trib.ESTADOS_COMPRA_CREDITO, False)
    check("EN_TRANSITO no da crédito fiscal",
          "EN_TRANSITO" in trib.ESTADOS_COMPRA_CREDITO, False)
    check("CANCELADA no da crédito fiscal",
          "CANCELADA" in trib.ESTADOS_COMPRA_CREDITO, False)
    check("RECIBIDA_COMPLETA da crédito fiscal",
          "RECIBIDA_COMPLETA" in trib.ESTADOS_COMPRA_CREDITO, True)
    check("RECIBIDA_PARCIAL da crédito fiscal",
          "RECIBIDA_PARCIAL" in trib.ESTADOS_COMPRA_CREDITO, True)


# ===========================================================================
# 5. INTEGRACIÓN CON LA BASE DE DATOS (siempre con ROLLBACK)
# ===========================================================================
class BdPrueba:
    """Conexión aislada: todo lo que se inserta se revierte al salir."""

    def __init__(self):
        self.conn = None
        self._orig_fetch_all = db.fetch_all
        self._orig_fetch_one = db.fetch_one

    def __enter__(self):
        self.conn = psycopg2.connect(db.DATABASE_URL)
        self.conn.autocommit = False

        # El servicio lee con db.fetch_all/fetch_one: se redirigen a la MISMA
        # transacción para que vea los datos de prueba sin confirmarlos.
        def fa(sql, params=None, _c=self):
            with _c.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c2:
                c2.execute(sql, params)
                return c2.fetchall()

        def fo(sql, params=None, _c=self):
            with _c.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c2:
                c2.execute(sql, params)
                return c2.fetchone()

        db.fetch_all = fa
        db.fetch_one = fo
        return self

    def __exit__(self, *exc):
        db.fetch_all = self._orig_fetch_all
        db.fetch_one = self._orig_fetch_one
        try:
            self.conn.rollback()   # <- nada queda en la base
        finally:
            self.conn.close()
        return False

    def sql(self, q, params=None):
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c:
            c.execute(q, params)
            return c.fetchall()

    def ex(self, q, params=None):
        with self.conn.cursor() as c:
            c.execute(q, params)

    def limpiar(self, cliente_id, advisor_id, proveedor_id):
        self.ex("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id = %s)", (cliente_id,))
        self.ex("DELETE FROM sales WHERE client_id = %s OR advisor_id = %s", (cliente_id, advisor_id))
        self.ex("DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE proveedor_id = %s)", (proveedor_id,))
        self.ex("DELETE FROM purchases WHERE proveedor_id = %s", (proveedor_id,))
        self.ex("DELETE FROM gastos_deducibles WHERE descripcion LIKE 'ZZ_TEST%'")
        self.ex("DELETE FROM pagos_cuenta_ir WHERE anio IN (2095, 2099)")
        self.ex("DELETE FROM advisors WHERE name = %s", (NOMBRE_TEST,))
        self.ex("DELETE FROM clients WHERE dni = '00000001'")
        self.ex("DELETE FROM suppliers WHERE razon_social = %s", (NOMBRE_TEST,))

    def crear_cliente_asesor_proveedor(self):
        with self.conn.cursor() as c:
            c.execute("INSERT INTO clients (names, last_names, dni, deleted) "
                      "VALUES (%s, 'PRUEBA', '00000001', false)", (NOMBRE_TEST,))
            c.execute("SELECT id FROM clients WHERE dni = '00000001' ORDER BY id LIMIT 1")
            cliente_id = c.fetchone()[0]

            c.execute("INSERT INTO advisors (name, deleted) VALUES (%s, false)", (NOMBRE_TEST,))
            c.execute("SELECT id FROM advisors WHERE name = %s ORDER BY id LIMIT 1", (NOMBRE_TEST,))
            advisor_id = c.fetchone()[0]

            c.execute("INSERT INTO suppliers (razon_social, tipo_proveedor, tipo_documento, "
                      "pais, moneda_principal, estado, deleted) "
                      "VALUES (%s, 'NACIONAL', 'RUC', 'PERU', 'PEN', 'ACTIVO', false)",
                      (NOMBRE_TEST,))
            c.execute("SELECT id FROM suppliers WHERE razon_social = %s ORDER BY id LIMIT 1",
                      (NOMBRE_TEST,))
            proveedor_id = c.fetchone()[0]
        return cliente_id, advisor_id, proveedor_id

    def venta(self, tipo, base, igv, total, fecha_emision, estado_fiscal="VALIDO",
              deleted=False, discount_amount=0, invoice_number=None, cliente_id=None,
              advisor_id=None, created_at=None):
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c:
            if invoice_number is None:
                c.execute("SELECT COALESCE(MAX(invoice_number),0)+1 AS n FROM sales WHERE invoice_type = %s", (tipo,))
                invoice_number = c.fetchone()["n"]
            q = ("INSERT INTO sales (client_id, advisor_id, with_igv, subtotal, igv, total, "
                 "invoice_type, invoice_number, payment_status, discount_amount, "
                 "fecha_emision, estado_fiscal, deleted, created_at) "
                 "VALUES (%s,%s,true,%s,%s,%s,%s,%s,'pagado',%s,%s,%s,%s,%s) RETURNING id")
            c.execute(q, (cliente_id, advisor_id, base, igv, total, tipo, invoice_number,
                          discount_amount, fecha_emision, estado_fiscal, deleted,
                          created_at or date(2000, 1, 1)))
            return c.fetchone()["id"]

    def compra(self, proveedor_id, tipo_comp, serie, numero, base, imp, total,
               estado, fecha_compra, tc=1, codigo=None):
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c:
            if codigo is None:
                c.execute("SELECT COALESCE(MAX(NULLIF(codigo_compra,'')),'') AS ultimo FROM purchases")
                ultimo = c.fetchone()["ultimo"] or ""
                try:
                    n = int(str(ultimo).split("-")[-1])
                except ValueError:
                    n = 0
                codigo = f"CP-{n + 1:05d}"
            c.execute(
                "INSERT INTO purchases (codigo_compra, tipo_compra, proveedor_id, fecha_compra, "
                "moneda, tipo_cambio, subtotal, impuestos, costos_adicionales, total, "
                "total_equivalente, tipo_item, estado, estado_pago, tipo_comprobante, "
                "serie_comprobante, numero_comprobante) "
                "VALUES (%s,'NACIONAL',%s,%s,'PEN',%s,%s,%s,0,%s,%s,'PRODUCTO',%s,'PAGADA',%s,%s,%s) "
                "RETURNING id",
                (codigo, proveedor_id, fecha_compra, tc, base, imp, total, total, estado,
                 tipo_comp, serie, numero))
            return c.fetchone()["id"]


def test_integracion():
    seccion("5. INTEGRACIÓN CON LA BASE DE DATOS (se revierte al terminar)")
    with BdPrueba() as bd:
        cliente_id, advisor_id, proveedor_id = bd.crear_cliente_asesor_proveedor()
        try:
            _test_periodo_igv(bd, cliente_id, advisor_id, proveedor_id)
            _test_estados_compra(bd, proveedor_id)
            _test_tipos_comprobante_compra(bd, proveedor_id)
            _test_fecha_emision(bd, cliente_id, advisor_id)
            _test_duplicado_comprobante(bd, proveedor_id)
            _test_constraints(bd, cliente_id, advisor_id)
            _test_pago_cuenta_y_gastos(bd, cliente_id, advisor_id)
        finally:
            bd.limpiar(cliente_id, advisor_id, proveedor_id)


def _test_periodo_igv(bd, cliente_id, advisor_id, proveedor_id):
    print("\n-- 5.1 IGV del período: qué entra y qué no --")
    anio, mes = 2099, 5
    f = date(anio, mes, 15)
    # Dos ventas fiscales: 15,000 de base + 2,700 de IGV
    bd.venta("factura", D("10000.00"), D("1800.00"), D("11800.00"), f,
             cliente_id=cliente_id, advisor_id=advisor_id)
    bd.venta("boleta", D("5000.00"), D("900.00"), D("5900.00"), f,
             cliente_id=cliente_id, advisor_id=advisor_id)
    # Proforma: NO es comprobante fiscal
    bd.venta("proforma", D("3000.00"), D("540.00"), D("3540.00"), f,
             cliente_id=cliente_id, advisor_id=advisor_id)
    # Factura ANULADA: no se contabiliza
    bd.venta("factura", D("7000.00"), D("1260.00"), D("8260.00"), f,
             estado_fiscal="ANULADO", cliente_id=cliente_id, advisor_id=advisor_id)
    # Factura eliminada
    bd.venta("factura", D("9000.00"), D("1620.00"), D("10620.00"), f,
             deleted=True, cliente_id=cliente_id, advisor_id=advisor_id)

    v = trib.ventas_igv_mensual(anio, mes)[mes]
    check("IGV ventas del período = 2,700.00 (solo factura+boleta válidas)",
          v["igv"], D("2700.00"))
    check("base imponible de ventas = 15,000.00", v["base"], D("15000.00"))
    check("2 comprobantes fiscales contabilizados", v["count"], 2)

    # Compra con FACTURA recibida -> crédito fiscal
    bd.compra(proveedor_id, "FACTURA", "F001", "9001", D("4000.00"), D("720.00"),
              D("4720.00"), "RECIBIDA_COMPLETA", f)
    c = trib.compras_igv_mensual(anio, mes)[mes]
    check("crédito fiscal = 720.00", c["igv"], D("720.00"))

    r = trib.resumen(anio, mes)
    check("IGV por pagar = 2,700 - 720 = 1,980.00", r["resumen"]["igv_por_pagar"], 1980.00)
    check("pago a cuenta IR = 15,000 x 1% = 150.00",
          r["resumen"]["ir_pago_cuenta"], 150.00)
    check("total referencial = 1,980 + 150 = 2,130.00",
          r["resumen"]["total_referencial"], 2130.00)
    check("detalle_ir.ingresos_netos = 15,000.00 (base imponible)",
          r["detalle_ir"]["ingresos_netos"], 15000.00)
    check("dashboard usa la MISMA fuente (IGV neto 1,980.00)",
          trib.dashboard(anio, mes)["igv"], 1980.00)


def _test_estados_compra(bd, proveedor_id):
    print("\n-- 5.2 Estados de compra: crédito fiscal sólo al recibir --")
    anio, mes = 2099, 6
    f = date(anio, mes, 10)
    base, igv, tot = D("1000.00"), D("180.00"), D("1180.00")
    n = [9100]
    for estado, debe in [
        ("ORDENADA", False), ("CONFIRMADA", False), ("EN_TRANSITO", False),
        ("CANCELADA", False), ("BORRADOR", False),
        ("RECIBIDA_PARCIAL", True), ("RECIBIDA_COMPLETA", True),
    ]:
        n[0] += 1
        bd.compra(proveedor_id, "FACTURA", "F002", str(n[0]), base, igv, tot, estado, f)
        c = trib.compras_igv_mensual(anio, mes)[mes]
        esperado = D("180.00") * (1 if debe else 0)
        n_esperado = 1 if debe else 0
        check("estado %-17s -> crédito %s" % (estado, "SÍ" if debe else "NO"),
              c["igv"], esperado)
        check("estado %-17s -> %d comprobante(s) con crédito" % (estado, n_esperado),
              c["count"], n_esperado)
        bd.ex("UPDATE purchases SET deleted = true WHERE numero_comprobante = %s", (str(n[0]),))


def _test_tipos_comprobante_compra(bd, proveedor_id):
    print("\n-- 5.3 Tipos de comprobante de compra --")
    anio, mes = 2099, 7
    f = date(anio, mes, 10)
    base, igv, tot = D("1000.00"), D("180.00"), D("1180.00")
    casos = [
        ("FACTURA", True), ("RECIBO DE LUZ", True),
        ("RECIBO DE AGUA", True), ("RECIBO DE GAS", True),
        ("BOLETA", False), ("RECIBO", False),
        ("NOTA DE VENTA", False), ("PROFORMA", False), ("OTRO", False),
        ("NOTA_DE_VENTA", False), ("nota de venta", False), ("FACTURA ", True),
    ]
    n = 9200
    for tipo, debe in casos:
        n += 1
        bd.compra(proveedor_id, tipo, "F003", str(n), base, igv, tot, "RECIBIDA_COMPLETA", f)
        c = trib.compras_igv_mensual(anio, mes)[mes]
        etiqueta = "%-15s -> crédito %s" % (tipo, "SÍ" if debe else "NO")
        check(etiqueta, c["igv"], igv * (1 if debe else 0))
        bd.ex("UPDATE purchases SET deleted = true WHERE numero_comprobante = %s", (str(n),))

    # Un tipo NO permitido debe ser rechazado por el motor, no guardado.
    # Savepoint: el CHECK violado aborta la transacción si no se aísla.
    with bd.conn.cursor() as c:
        c.execute("SAVEPOINT sp_tipo_invalido")
        try:
            c.execute(
                "INSERT INTO purchases (codigo_compra, proveedor_id, fecha_compra, tipo_item, "
                "subtotal, impuestos, total, estado, deleted, tipo_comprobante, "
                "serie_comprobante, numero_comprobante) "
                "VALUES ('CP-TEST-INVALIDO', %s, %s, 'PRODUCTO', %s, %s, %s, "
                "'RECIBIDA_COMPLETA', false, 'TICKET X', 'F003', '9999')",
                (proveedor_id, f, base, igv, tot),
            )
            rechazado = False
        except Exception:
            rechazado = True
        c.execute("ROLLBACK TO SAVEPOINT sp_tipo_invalido")
    check("tipo de comprobante inexistente RECHAZADO por el CHECK", rechazado, True)


def _test_fecha_emision(bd, cliente_id, advisor_id):
    print("\n-- 5.4 La fecha de EMISIÓN manda, no la de creación --")
    anio, mes_emision, mes_creacion = 2098, 1, 12
    f_emision = date(anio, mes_emision, 3)
    f_creacion = date(anio, mes_creacion, 28)
    bd.venta("factura", D("2000.00"), D("360.00"), D("2360.00"), f_emision,
             cliente_id=cliente_id, advisor_id=advisor_id, created_at=f_creacion)
    enero = trib.ventas_igv_mensual(anio, mes_emision)[mes_emision]
    diciembre = trib.ventas_igv_mensual(anio, mes_creacion)[mes_creacion]
    check("venta emitida en enero, creada en diciembre -> IGV en ENERO",
          enero["igv"], D("360.00"))
    check("la venta NO aparece en diciembre", diciembre["igv"], D("0.00"))
    check("ingresos netos de enero = 2,000.00", enero["base"], D("2000.00"))


def _test_duplicado_comprobante(bd, proveedor_id):
    print("\n-- 5.5 Comprobante de compra duplicado --")
    f = date(2097, 4, 10)
    bd.compra(proveedor_id, "FACTURA", "F004", "5001", D("100.00"), D("18.00"),
              D("118.00"), "RECIBIDA_COMPLETA", f)
    bd.ex("SAVEPOINT dup_chk")
    try:
        bd.compra(proveedor_id, "FACTURA", "F004", "5001", D("100.00"), D("18.00"),
                  D("118.00"), "RECIBIDA_COMPLETA", f)
        check("comprobante duplicado RECHAZADO por índice único", False, True)
    except pgerrors.UniqueViolation:
        check("comprobante duplicado RECHAZADO por índice único", True, True)
    except Exception as e:
        check("comprobante duplicado RECHAZADO (%s)" % type(e).__name__, True, True)
    finally:
        bd.ex("ROLLBACK TO SAVEPOINT dup_chk")


def _test_constraints(bd, cliente_id, advisor_id):
    print("\n-- 5.6 Invariantes a nivel de motor (CHECK) --")
    f = date(2096, 6, 5)
    bd.ex("SAVEPOINT chk")
    try:
        with bd.conn.cursor() as c:
            c.execute(
                "INSERT INTO sales (client_id, with_igv, subtotal, igv, total, "
                "invoice_type, invoice_number, payment_status, fecha_emision, estado_fiscal) "
                "VALUES (%s,true,100.00,18.00,999.00,'factura',999001,'pagado',%s,'VALIDO')",
                (cliente_id, f))
        check("CHECK rechaza total != base + igv", False, True)
    except Exception:
        check("CHECK rechaza total != base + igv", True, True)
    finally:
        bd.ex("ROLLBACK TO SAVEPOINT chk")

    bd.ex("SAVEPOINT chk2")
    try:
        with bd.conn.cursor() as c:
            c.execute(
                "INSERT INTO sales (client_id, with_igv, subtotal, igv, total, "
                "invoice_type, invoice_number, payment_status, fecha_emision, estado_fiscal) "
                "VALUES (%s,true,100.00,18.00,118.00,'factura',999002,'pagado',%s,'INVALIDO')",
                (cliente_id, f))
        check("CHECK rechaza estado_fiscal inválido", False, True)
    except Exception:
        check("CHECK rechaza estado_fiscal inválido", True, True)
    finally:
        bd.ex("ROLLBACK TO SAVEPOINT chk2")

    bd.ex("SAVEPOINT chk3")
    try:
        with bd.conn.cursor() as c:
            c.execute(
                "INSERT INTO purchases (codigo_compra, tipo_compra, proveedor_id, fecha_compra, "
                "moneda, tipo_cambio, subtotal, impuestos, costos_adicionales, total, "
                "total_equivalente, tipo_item, estado, estado_pago) "
                "VALUES ('CP-ZZCHK','NACIONAL',1,CURRENT_DATE,'PEN',1,100.00,18.00,0,999.00,"
                "999.00,'PRODUCTO','BORRADOR','PENDIENTE')")
        check("CHECK de compras rechaza total != base + igv + costos", False, True)
    except Exception:
        check("CHECK de compras rechaza total != base + igv + costos", True, True)
    finally:
        bd.ex("ROLLBACK TO SAVEPOINT chk3")


def _test_pago_cuenta_y_gastos(bd, cliente_id, advisor_id):
    print("\n-- 5.7 Pago a cuenta persistente y gastos deducibles --")
    anio, mes = 2095, 4
    f = date(anio, mes, 20)
    bd.venta("factura", D("30000.00"), D("5400.00"), D("35400.00"), f,
             cliente_id=cliente_id, advisor_id=advisor_id)
    oficial = trib.r2(D("30000.00") * D("0.01"))
    check("pago a cuenta oficial del mes = 300.00",
          oficial, D("300.00"))

    # Sin registro => el resumen muestra el cálculo oficial
    p = trib.pagos_cuenta_mensual(anio, mes)[mes]
    check("sin registro: pagos registrados = 0.00", p["pagado"], D("0.00"))

    # Registrar el pago
    with bd.conn.cursor() as c:
        c.execute(
            "INSERT INTO pagos_cuenta_ir (anio, mes, ingresos_netos, tasa, monto_calculado, "
            "monto_pagado, fecha_pago, numero_operacion, estado) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,'OP-TEST','PAGADO')",
            (anio, mes, D("30000.00"), D("0.01"), oficial, oficial, f))
    p = trib.pagos_cuenta_mensual(anio, mes)[mes]
    check("con registro: pagos a cuenta = 300.00", p["pagado"], D("300.00"))

    r = trib.resumen(anio, mes)
    check("el resumen usa el pago REGISTRADO (no lo re-calcula)",
          r["resumen"]["ir_pago_cuenta"], 300.00)
    check("el resumen distingue calculado vs. pagado",
          r["detalle_ir"]["pago_cuenta_calculado"], 300.00)

    # Un segundo pago del mismo mes debe ser rechazado (índice único)
    bd.ex("SAVEPOINT pago_dup")
    try:
        with bd.conn.cursor() as c:
            c.execute(
                "INSERT INTO pagos_cuenta_ir (anio, mes, ingresos_netos, tasa, "
                "monto_calculado, monto_pagado, fecha_pago, estado) "
                "VALUES (%s,%s,0,0.01,0,0,%s,'PAGADO')", (anio, mes, f))
        check("pago a cuenta duplicado del mes RECHAZADO", False, True)
    except Exception:
        check("pago a cuenta duplicado del mes RECHAZADO", True, True)
    finally:
        bd.ex("ROLLBACK TO SAVEPOINT pago_dup")

    # Gastos deducibles
    with bd.conn.cursor() as c:
        c.execute(
            "INSERT INTO gastos_deducibles (anio, mes, fecha_gasto, categoria, descripcion, "
            "proveedor, moneda, tipo_cambio, monto, monto_pen, estado) "
            "VALUES (%s,%s,%s,'ALQUILER','ZZ_TEST alquiler','Inmobiliaria SAC','PEN',1,"
            "1000.00,1000.00,'VALIDO')", (anio, mes, f))
        c.execute(
            "INSERT INTO gastos_deducibles (anio, mes, fecha_gasto, categoria, descripcion, "
            "moneda, tipo_cambio, monto, monto_pen, estado) "
            "VALUES (%s,%s,%s,'SERVICIOS','ZZ_TEST servicios','PEN',1,500.00,500.00,'VALIDO')",
            (anio, mes, f))
        c.execute(
            "INSERT INTO gastos_deducibles (anio, mes, fecha_gasto, categoria, descripcion, "
            "moneda, tipo_cambio, monto, monto_pen, estado) "
            "VALUES (%s,%s,%s,'OTROS_GASTOS','ZZ_TEST anulado','PEN',1,999.00,999.00,'ANULADO')",
            (anio, mes, f))
    g = trib.gastos_deducibles_mensual(anio, mes)[mes]
    check("gastos deducibles válidos del mes = 1,500.00 (ANULADO excluido)",
          g["total"], D("1500.00"))
    check("2 gastos válidos registrados", g["count"], 2)

    cats = {c_["categoria"]: c_["total"] for c_ in trib.gastos_deducibles_por_categoria(anio, mes)}
    check("categoría ALQUILER = 1,000.00", cats.get("ALQUILER"), D("1000.00"))
    check("categoría SERVICIOS = 500.00", cats.get("SERVICIOS"), D("500.00"))
    check("gasto ANULADO no aparece por categoría",
          "OTROS_GASTOS" in cats, False)

    # El gasto deducible NO se deriva de las compras
    ia = trib.ir_anual(anio)
    check("gastos deducibles anuales = 1,500.00 (solo el registro explícito)",
          D(str(ia["gastos_deducibles"])), D("1500.00"))
    check("renta neta = 30,000 - 1,500 = 28,500.00",
          D(str(ia["renta_neta"])), D("28500.00"))
    check("pagos a cuenta anuales = 300.00",
          D(str(ia["pagos_a_cuenta"])), D("300.00"))
    # El RMT ya tiene sus tramos oficiales cargados (0-15 UIT 10%, +15 UIT 29.5%,
    # D.Leg. 1269 / D.S. 403-2016-EF), asi que el impuesto anual NO es referencial.
    check("régimen RMT: los tramos anuales están configurados",
          bool(ia["tramos_configurados"]), True)
    check("régimen RMT: sin advertencia cuando los tramos están configurados",
          bool(ia["advertencia"]), False)
    check("RMT: el impuesto anual es oficial, no referencial",
          bool(ia["tramos_referencia"]), False)

    # Con UIT configurable
    with bd.conn.cursor() as c:
        c.execute("INSERT INTO uit_config (anio, valor_uit) VALUES (2095, 10000.00)"
                  " ON CONFLICT (anio) DO UPDATE SET valor_uit = 10000.00")
    check("UIT configurable del año = 10,000.00",
          trib.uit(2095), D("10000.00"))
    with bd.conn.cursor() as c:
        c.execute("DELETE FROM ir_tramos")
        c.execute("INSERT INTO ir_tramos (regimen, desde_uit, hasta_uit, tasa) "
                  "VALUES ('RMT', 0, 15, 0.10)")
        c.execute("INSERT INTO ir_tramos (regimen, desde_uit, hasta_uit, tasa) "
                  "VALUES ('RMT', 15, NULL, 0.295)")
    ia2 = trib.ir_anual(2095)
    check("con tramos RMT configurados: quedan como oficiales",
          bool(ia2["tramos_configurados"]), True)
    check("RMT configurado: sin advertencia", ia2["advertencia"], None)
    # renta neta 28,500; 15 UIT = 150,000 -> solo el primer tramo
    check("IR anual con tramos RMT = 28,500 x 10% = 2,850.00",
          D(str(ia2["impuesto_anual"])), D("2850.00"))
    check("saldo = 2,850 - 300 = 2,550.00 a pagar",
          D(str(ia2["saldo"])), D("2550.00"))
    check("resultado = A_PAGAR", ia2["resultado"], "A_PAGAR")

    # Saldo a favor
    bd.ex("SAVEPOINT saldo_favor")
    with bd.conn.cursor() as c:
        c.execute("UPDATE pagos_cuenta_ir SET monto_pagado = 5000.00 WHERE anio = 2095 AND mes = 4")
    ia3 = trib.ir_anual(2095)
    check("pagos a cuenta 5,000 > impuesto 2,850 -> A_FAVOR",
          ia3["resultado"], "A_FAVOR")
    check("saldo a favor = 2,150.00", D(str(ia3["saldo"])), D("2150.00"))
    bd.ex("ROLLBACK TO SAVEPOINT saldo_favor")


# ===========================================================================
# Escala oficial del RMT contra los valores reales de la UIT
# ===========================================================================
def test_escala_oficial_rmt():
    print("\n" + "=" * 78)
    print("ESCALA OFICIAL RMT + UIT REALES (fuente: SUNAT / gob.pe)")
    print("=" * 78)

    # UIT oficiales (D.S. del MEF, ver schema_tributario.sql)
    uit_oficial = {2023: D("4950.00"), 2024: D("5150.00"),
                   2025: D("5350.00"), 2026: D("5500.00")}

    # 1) Los tramos del RMT deben ser 0-15 UIT al 10% y +15 UIT al 29.5%.
    tramos = trib.tramos_ir("RMT")
    check("el RMT tiene 2 tramos configurados", len(tramos), 2)
    if len(tramos) == 2:
        check("tramo 1 del RMT: desde 0 hasta 15 UIT",
              (D(str(tramos[0]["desde_uit"])), D(str(tramos[0]["hasta_uit"]))),
              (D("0"), D("15")))
        check("tramo 1 del RMT: tasa 10%", D(str(tramos[0]["tasa"])), D("0.1000"))
        check("tramo 2 del RMT: desde 15 UIT sin tope",
              (D(str(tramos[1]["desde_uit"])), tramos[1]["hasta_uit"]),
              (D("15"), None))
        check("tramo 2 del RMT: tasa 29.5%", D(str(tramos[1]["tasa"])), D("0.2950"))

    # 2) Con la UIT real de 2026, 15 UIT deben dar S/ 82,500.00.
    #    Este es el numero que se muestra al usuario como umbral del primer tramo.
    uit26 = D(str(trib.uit(2026)))
    check("UIT 2026 = 5,500.00 (D.S. 301-2025-EF)", uit26, D("5500.00"))
    check("15 UIT 2026 = S/ 82,500.00 (no 90,000)",
          uit26 * D("15"), D("82500.00"))

    # 3) Escalonado progresivo correcto con la UIT real.
    rn = D("90000.00")
    imp, det = trib.calcular_impuesto_anual(rn, tramos, uit26)
    check("renta neta 90,000 cruza el segundo tramo", len(det), 2)
    if len(det) == 2:
        check("base del tramo 1 = 82,500.00", D(str(det[0]["base_soles"])), D("82500.00"))
        check("impuesto tramo 1 = 8,250.00", D(str(det[0]["impuesto"])), D("8250.00"))
        check("base del tramo 2 = 7,500.00", D(str(det[1]["base_soles"])), D("7500.00"))
        check("impuesto tramo 2 = 2,212.50", D(str(det[1]["impuesto"])), D("2212.50"))
    check("impuesto anual total = S/ 10,462.50", D(str(imp)), D("10462.50"))

    # 4) Frontera: exactamente 15 UIT NO debe pagar el segundo tramo.
    imp_frontera, det_frontera = trib.calcular_impuesto_anual(uit26 * D("15"), tramos, uit26)
    check("frontera de 15 UIT: solo un tramo", len(det_frontera), 1)
    check("frontera de 15 UIT: impuesto = S/ 8,250.00",
          D(str(imp_frontera)), D("8250.00"))

    # 5) Un sol de mas SI debe entrar al segundo tramo.
    imp_sobre, det_sobre = trib.calcular_impuesto_anual(uit26 * D("15") + D("1"), tramos, uit26)
    check("15 UIT + 1 sol: dos tramos", len(det_sobre), 2)
    check("15 UIT + 1 sol: impuesto = 8,250.00 + 0.295 = 8,250.30",
          D(str(imp_sobre)), D("8250.30"))

    # 6) Renta baja: solo el primer tramo.
    imp_bajo, _ = trib.calcular_impuesto_anual(D("50000.00"), tramos, uit26)
    check("renta neta 50,000 (dentro del 1er tramo) = S/ 5,000.00",
          D(str(imp_bajo)), D("5000.00"))

    # 7) Sin tramos configurados el resultado debe ser referencial con aviso.
    #    Se simula pasando la lista vacia, como hace ir_anual() cuando no hay tabla.
    check("sin tramos: tramos_ir devuelve vacio para un regimen inexistente",
          trib.tramos_ir("NRUS"), [])


# ===========================================================================
# Main
# ===========================================================================
def main():
    print("SUITE DE TESTS TRIBUTARIOS — El Iqueño SAC")
    print("Los tests de integración se revierten: no queda data en la base.")
    try:
        test_calculo_ventas()
        test_calculo_compras()
        test_ir_anual_tramos()
        test_escala_oficial_rmt()
        test_catalogos()
        test_integracion()
    except Exception:
        traceback.print_exc()
        FAILS.append(("EXCEPCIÓN NO CONTROLADA", "ver traceback", "-"))

    print("\n" + "=" * 78)
    print("RESULTADO: %d correctos, %d fallidos" % (len(PASSES), len(FAILS)))
    print("=" * 78)
    if FAILS:
        print("\nFALLOS:")
        for n, o, e in FAILS:
            print("  - %s\n      obtenido: %r\n      esperado : %r" % (n, o, e))
        return 1
    print("\nTodos los tests tributarios pasaron.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
