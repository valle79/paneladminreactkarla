"""
Verifica a nivel de RUTAS (TestClient) que los endpoints tributarios
responden con la forma que consume el frontend, y que el RBAC bloquea
a quien no tiene RESUMEN_TRIBUTARIO_EDIT.

IMPORTANTE: db.execute() hace COMMIT en su propia conexion del pool, asi que
estas escrituras SI se persisten. Por eso el script borra explicitamente
todo lo que creo en un bloque finally (no depende de un rollback).
Los datos que crea usan anio=2095 y descripcion='prueba' para no colisionar
con los datos reales sembrados por la migracion (2024/2025/2026, GENERAL).
"""
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.join(RAIZ, "backend"))

from fastapi.testclient import TestClient  # noqa: E402
import backend.db as db  # noqa: E402
import backend.main as main  # noqa: E402
from backend import auth as auth_mod  # noqa: E402
from backend import rbac as rbac_mod  # noqa: E402

API = "/api"
ANIO_TEST = 2095
MARCA = "prueba"
FALLA = []


def ok(nombre, cond, detalle=""):
    if cond:
        print(f"  OK   {nombre}")
    else:
        print(f"  FALLA {nombre} {detalle}")
        FALLA.append(nombre)


def limpiar():
    """Borra TODO lo que este test pudo crear. Idempotente."""
    for sql in [
        f"DELETE FROM gastos_deducibles WHERE anio = {ANIO_TEST} AND descripcion = '{MARCA}'",
        f"DELETE FROM pagos_cuenta_ir WHERE anio = {ANIO_TEST} AND numero_operacion = '{MARCA}-OP'",
        f"DELETE FROM uit_config WHERE anio = {ANIO_TEST} AND descripcion = '{MARCA}'",
        f"DELETE FROM ir_tramos WHERE descripcion = '{MARCA}'",
        f"""DELETE FROM audit_logs WHERE resource IN
              ('gastos_deducibles','pagos_cuenta_ir','uit_config','ir_tramos')
            AND created_at > TIMESTAMP '2026-09-28 17:00:00+00'""",
    ]:
        try:
            db.execute(sql, returning=False)
        except Exception as e:  # pragma: no cover
            print("  (aviso al limpiar)", str(e)[:90])


# --- Usuarios reales con y sin permiso -------------------------------
usuarios = db.fetch_all(
    """SELECT DISTINCT u.id, u.email, u.name
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.active
        WHERE u.active
        ORDER BY u.id LIMIT 40""")

limpiar()  # por si una corrida anterior fallo a mitad

if not usuarios:
    print("SKIP: no hay usuarios activos con roles en la BD")
    sys.exit(0)


def perms_de(u):
    return set(rbac_mod.get_user_permissions(u["id"]))


editor = next((u for u in usuarios if "RESUMEN_TRIBUTARIO_EDIT" in perms_de(u)), None)
lector = next(
    (u for u in usuarios
     if "RESUMEN_TRIBUTARIO_VIEW" in perms_de(u) and "RESUMEN_TRIBUTARIO_EDIT" not in perms_de(u)),
    None)

ok("existe usuario con RESUMEN_TRIBUTARIO_EDIT", editor is not None,
   f"(probados: {[u['email'] for u in usuarios]})")

client = TestClient(main.app)


def token_para(usuario):
    # El 'sub' del token es el id numerico del usuario.
    return auth_mod.create_token({"sub": usuario["id"]})


try:
    if editor:
        h = {"Authorization": f"Bearer {token_para(editor)}"}

        print("\n== Rutas GET tributarias (autorizado) ==")
        r = client.get(f"{API}/tributario/config", headers=h)
        ok("GET /tributario/config 200", r.status_code == 200, f"-> {r.status_code} {r.text[:120]}")

        r = client.get(f"{API}/gastos-deducibles", headers=h, params={"limit": 3})
        ok("GET /gastos-deducibles 200", r.status_code == 200, f"-> {r.status_code} {r.text[:160]}")
        if r.status_code == 200:
            d = r.json()
            ok("  -> items/total_valido/count_valido/pagination",
               all(k in d for k in ("items", "total_valido", "count_valido", "pagination")),
               f"claves={list(d)}")
            if d["items"]:
                esperados = {"id", "anio", "mes", "fecha_gasto", "categoria", "descripcion",
                             "moneda", "tipo_cambio", "monto", "monto_pen", "estado"}
                faltan = esperados - set(d["items"][0])
                ok("  -> item de gasto con las claves que usa la UI", not faltan, f"faltan={faltan}")

        # paginacion: la UI cambia de pagina, debe responder bien
        r = client.get(f"{API}/gastos-deducibles", headers=h, params={"page": 2, "limit": 2})
        ok("GET /gastos-deducibles?page=2 200 (paginacion)", r.status_code == 200,
           f"-> {r.status_code} {r.text[:120]}")

        r = client.get(f"{API}/pagos-cuenta-ir", headers=h, params={"anio": ANIO_TEST})
        ok("GET /pagos-cuenta-ir 200", r.status_code == 200, f"-> {r.status_code} {r.text[:160]}")
        if r.status_code == 200:
            d = r.json()
            ok("  -> items con 12 meses", len(d.get("items", [])) == 12, f"n={len(d.get('items', []))}")
            if d.get("items"):
                esperados = {"mes", "mes_nombre", "ingresos_netos", "tasa", "monto_calculado",
                             "registrado", "pago_cuenta_id", "monto_pagado", "estado", "diferencia"}
                faltan = esperados - set(d["items"][0])
                ok("  -> item de pago con las claves que usa la UI", not faltan, f"faltan={faltan}")

        r = client.get(f"{API}/uit", headers=h)
        ok("GET /uit 200", r.status_code == 200, f"-> {r.status_code} {r.text[:160]}")
        if r.status_code == 200:
            d = r.json()
            ok("  -> items + actual", "items" in d and "actual" in d, f"claves={list(d)}")
            if d.get("items"):
                esperados = {"anio", "valor_uit", "descripcion"}
                faltan = esperados - set(d["items"][0])
                ok("  -> item de UIT con las claves que usa la UI", not faltan, f"faltan={faltan}")

        r = client.get(f"{API}/ir-tramos", headers=h)
        ok("GET /ir-tramos 200", r.status_code == 200, f"-> {r.status_code} {r.text[:160]}")
        if r.status_code == 200:
            d = r.json()
            ok("  -> items agrupables por regimen",
               all("regimen" in i for i in d.get("items", [])), f"claves={list(d)}")
            ok("  -> no hay tramos de prueba (BD limpia al empezar)",
               all(i.get("descripcion") != MARCA for i in d.get("items", [])))

        print("\n== Escrituras con permiso EDIT ==")
        r = client.put(f"{API}/uit/{ANIO_TEST}", headers=h,
                       json={"valor_uit": 5555, "descripcion": MARCA})
        ok(f"PUT /uit/{ANIO_TEST} 200", r.status_code == 200, f"-> {r.status_code} {r.text[:160]}")

        # Rango 100-200 para no chocar con los tramos reales (0-15 UIT / 15+).
        r = client.post(f"{API}/ir-tramos", headers=h,
                        json={"regimen": "RMT", "desde_uit": 100, "hasta_uit": 200, "tasa": 0.05,
                              "descripcion": MARCA})
        ok("POST /ir-tramos 200", r.status_code == 200, f"-> {r.status_code} {r.text[:160]}")
        nuevo_tramo = r.json() if r.status_code == 200 else None

        r = client.get(f"{API}/ir-tramos", headers=h)
        if r.status_code == 200:
            items = r.json()["items"]
            ok("  -> el tramo creado aparece en el listado",
               any(t.get("descripcion") == MARCA for t in items))
            ok("  -> conviven los tramos oficiales RMT 0-15 / 15+ y el de prueba",
               any(t["regimen"] == "RMT" and float(t["desde_uit"]) == 0 for t in items)
               and any(t["regimen"] == "RMT" and float(t["desde_uit"]) == 15 for t in items))

        r = client.post(f"{API}/gastos-deducibles", headers=h,
                        json={"fecha_gasto": f"{ANIO_TEST}-06-15", "categoria": "SERVICIOS",
                              "descripcion": MARCA, "moneda": "USD",
                              "tipo_cambio": 3.75, "monto": 100, "estado": "VALIDO"})
        ok("POST /gastos-deducibles 200", r.status_code == 200, f"-> {r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            g = r.json()
            ok("  -> monto_pen = monto * tc (100 * 3.75 = 375)",
               abs(float(g["monto_pen"]) - 375.0) < 0.01, f"monto_pen={g.get('monto_pen')}")
            ok("  -> anio/mes derivados de la fecha",
               g.get("anio") == ANIO_TEST and g.get("mes") == 6,
               f"anio={g.get('anio')} mes={g.get('mes')}")

        r = client.post(f"{API}/pagos-cuenta-ir", headers=h,
                        json={"anio": ANIO_TEST, "mes": 6, "ingresos_netos": 10000, "tasa": 0.01,
                              "monto_calculado": 100, "monto_pagado": 100,
                              "fecha_pago": f"{ANIO_TEST}-07-05", "estado": "PAGADO",
                              "entidad": "SUNAT", "numero_operacion": f"{MARCA}-OP"})
        ok("POST /pagos-cuenta-ir 200", r.status_code == 200, f"-> {r.status_code} {r.text[:200]}")

        r = client.get(f"{API}/resumen-tributario", headers=h, params={"anio": ANIO_TEST})
        ok("GET /resumen-tributario 200 (con datos nuevos)", r.status_code == 200,
           f"-> {r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            d = r.json()
            ok("  -> ir_anual con tramos RMT configurados (no referencial)",
               d.get("ir_anual", {}).get("tramos_referencia") is False,
               f"tramos_referencia={d.get('ir_anual', {}).get('tramos_referencia')}")
            ok("  -> sin advertencia de referencia",
               not d.get("ir_anual", {}).get("advertencia"),
               f"advertencia={d.get('ir_anual', {}).get('advertencia')}")
            ok("  -> usa la UIT configurada para el anio consultado",
               float(d.get("ir_anual", {}).get("valor_uit", 0)) == 5555.0,
               f"valor_uit={d.get('ir_anual', {}).get('valor_uit')}")
            ok("  -> el gasto creado aparece en el total deducible",
               float(d["resumen"].get("gastos_deducibles", 0)) >= 375.0,
               f"total={d['resumen'].get('gastos_deducibles')}")
            ok("  -> gasto aparece en el detalle por naturaleza",
               any(g.get("total", 0) >= 375 for g in d.get("gastos_deducibles_detalle", [])),
               f"detalle={d.get('gastos_deducibles_detalle')}")

        print("\n== Actualizar y eliminar ==")
        r = client.put(f"{API}/gastos-deducibles/999999", headers=h,
                       json={"descripcion": MARCA, "monto": 1})
        ok("PUT /gastos-deducibles/<inexistente> -> 404/400",
           r.status_code in (404, 400), f"-> {r.status_code}")
        r = client.delete(f"{API}/gastos-deducibles/999999", headers=h)
        ok("DELETE /gastos-deducibles/<inexistente> -> 404/400",
           r.status_code in (404, 400), f"-> {r.status_code}")

        print("\n== Validaciones de negocio ==")
        r = client.post(f"{API}/ir-tramos", headers=h,
                        json={"regimen": "RMT", "desde_uit": 5, "hasta_uit": 2, "tasa": 0.1,
                              "descripcion": MARCA})
        ok("POST /ir-tramos con hasta<=desde -> 400", r.status_code == 400, f"-> {r.status_code}")
        r = client.post(f"{API}/ir-tramos", headers=h,
                        json={"regimen": "RMT", "desde_uit": 300, "hasta_uit": 400, "tasa": 1.5,
                              "descripcion": MARCA})
        ok("POST /ir-tramos con tasa>1 -> 400", r.status_code == 400, f"-> {r.status_code}")
        r = client.post(f"{API}/ir-tramos", headers=h,
                        json={"regimen": "RMT", "desde_uit": 0, "hasta_uit": 15, "tasa": 0.1,
                              "descripcion": MARCA})
        ok("POST /ir-tramos duplica (regimen, desde_uit) -> 400",
           r.status_code == 400, f"-> {r.status_code} {r.text[:120]}")
        r = client.post(f"{API}/ir-tramos", headers=h,
                        json={"regimen": "XX", "desde_uit": 0, "tasa": 0.1, "descripcion": MARCA})
        ok("POST /ir-tramos con regimen invalido -> 400", r.status_code == 400, f"-> {r.status_code}")
        r = client.post(f"{API}/gastos-deducibles", headers=h,
                        json={"fecha_gasto": f"{ANIO_TEST}-06-15", "categoria": "NO_EXISTE",
                              "descripcion": MARCA, "monto": 10})
        ok("POST /gastos con categoria invalida -> 400", r.status_code == 400, f"-> {r.status_code}")
        r = client.post(f"{API}/gastos-deducibles", headers=h,
                        json={"fecha_gasto": f"{ANIO_TEST}-06-15", "categoria": "SERVICIOS",
                              "descripcion": MARCA, "monto": -5})
        ok("POST /gastos con monto negativo -> 400", r.status_code == 400, f"-> {r.status_code}")
        r = client.post(f"{API}/pagos-cuenta-ir", headers=h,
                        json={"anio": ANIO_TEST, "mes": 6, "monto_pagado": 50, "estado": "PAGADO"})
        ok("POST /pagos duplicado en el mismo mes -> 400", r.status_code == 400, f"-> {r.status_code}")
        r = client.post(f"{API}/pagos-cuenta-ir", headers=h,
                        json={"anio": ANIO_TEST, "mes": 7, "monto_pagado": 50, "estado": "PAGADO"})
        ok("POST /pagos PAGADO sin fecha_pago -> 400", r.status_code == 400, f"-> {r.status_code}")
        r = client.post(f"{API}/pagos-cuenta-ir", headers=h,
                        json={"anio": ANIO_TEST, "mes": 99})
        ok("POST /pagos con mes fuera de rango -> 400", r.status_code == 400, f"-> {r.status_code}")

    print("\n== RBAC: usuario sin EDIT ==")
    if lector:
        hl = {"Authorization": f"Bearer {token_para(lector)}"}
        ok("GET /ir-tramos permitido (VIEW)", client.get(f"{API}/ir-tramos", headers=hl).status_code == 200)
        ok("GET /pagos-cuenta-ir permitido (VIEW)",
           client.get(f"{API}/pagos-cuenta-ir", headers=hl, params={"anio": ANIO_TEST}).status_code == 200)
        for metodo, ruta, payload in [
            ("post", "/gastos-deducibles", {"fecha_gasto": f"{ANIO_TEST}-01-01", "categoria": "SERVICIOS", "descripcion": MARCA, "monto": 1}),
            ("post", "/pagos-cuenta-ir", {"anio": ANIO_TEST, "mes": 1}),
            ("post", "/ir-tramos", {"regimen": "RMT", "desde_uit": 0, "tasa": 0.1, "descripcion": MARCA}),
            ("put", f"/uit/{ANIO_TEST}", {"valor_uit": 1}),
        ]:
            r = getattr(client, metodo)(f"{API}{ruta}", headers=hl, json=payload)
            ok(f"{metodo.upper()} {ruta} sin EDIT -> 403", r.status_code == 403, f"-> {r.status_code}")
    else:
        print("  (sin usuario con solo VIEW; se omite)")

    print("\n== Sin token ==")
    for ruta in ["/gastos-deducibles", f"/pagos-cuenta-ir?anio={ANIO_TEST}", "/uit", "/ir-tramos"]:
        r = client.get(f"{API}{ruta}")
        ok(f"GET {ruta.split('?')[0]} sin token -> 401", r.status_code == 401, f"-> {r.status_code}")

finally:
    limpiar()
    print("\n[limpieza aplicada]")
    for nombre, tabla, where in [
        ("gastos", "gastos_deducibles", f"anio={ANIO_TEST}"),
        ("pagos", "pagos_cuenta_ir", f"anio={ANIO_TEST}"),
        ("uit", "uit_config", f"anio={ANIO_TEST}"),
        ("tramos prueba", "ir_tramos", f"descripcion='{MARCA}'"),
    ]:
        n = db.fetch_one(f"SELECT COUNT(*) n FROM {tabla} WHERE {where}")["n"]
        ok(f"BD limpia: {nombre} = 0", n == 0, f"-> {n}")

print("\n" + "=" * 52)
if FALLA:
    print(f"RESULTADO: {len(FALLA)} FALLA(S): {FALLA}")
    sys.exit(1)
print("RESULTADO: todas las verificaciones de ruta pasaron")
