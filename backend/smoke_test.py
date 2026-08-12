"""Smoke test end-to-end contra la API local (puerto 8012) y Neon."""
import json
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8012"


def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=90) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode())
        except Exception:
            detail = str(e)
        return e.code, detail


ok = True
for p in [None, "bad"]:
    code, resp = call("POST", "/api/auth/login", body={"password": "iqueño2026" if p is None else p})
    status = "OK" if (code == 200 and p is None) or (code == 401 and p == "bad") else f"ERROR({code}): {resp}"
    print(f"LOGIN {p or 'correcta'}: {code} -> {status}")
    if p is None:
        token = resp["token"]

checks = [
    ("GET", "/api/health", None),
    ("GET", "/api/stats", None),
    ("GET", "/api/advisors", None),
    ("GET", "/api/products", None),
    ("GET", "/api/spare-parts", None),
    ("GET", "/api/services", None),
    ("GET", "/api/clients", None),
    ("GET", "/api/clients-ruc", None),
    ("GET", "/api/promotions", None),
    ("GET", "/api/sales", None),
]
for method, path, body in checks:
    code, resp = call(method, path, token, body)
    good = code == 200
    ok = ok and good
    label = resp if isinstance(resp, dict) and "detail" in resp else f"{len(resp)} registros"
    print(f"{method} {path}: {code} {'OK' if good else 'FALLO'}  {label if not good else ''}")

new_client = {"dni": "12345678", "names": "Prueba", "last_names": "QA Tester", "address": "Av. Test 123"}
code, resp = call("POST", "/api/clients", token, new_client)
ok = ok and code == 200
print(f"POST /api/clients: {code} {'OK' if code == 200 else resp}")
client_id = resp.get("id") if code == 200 else None

new_advisor = {"name": "Asesor Prueba", "position": "QA", "whatsapp": "999888777", "specialties": ["Ventas"]}
import json as _j
code, resp = call("POST", "/api/advisors", token, {**new_advisor, "specialties": _j.dumps(new_advisor["specialties"])})
ok = ok and code == 200
print(f"POST /api/advisors: {code} {'OK' if code == 200 else resp}")
advisor_id = resp.get("id") if code == 200 else None

sale = {
    "client_id": client_id, "client_type": "dni", "advisor_id": advisor_id,
    "invoice_type": "proforma", "invoice_number": None,
    "with_igv": True, "subtotal": 1000, "igv": 180, "total": 1180,
    "payment_status": "a_cuenta", "payment_description": "Abono inicial",
    "amount_paid": 500, "amount_pending": 680, "pending_payment_date": "2026-09-01",
    "items": [
        {"item_type": "machine", "item_id": 1, "manual_name": None, "manual_description": None, "quantity": 2, "unit_price": 400},
        {"item_type": "service", "item_id": 1, "manual_name": None, "manual_description": None, "quantity": 1, "unit_price": 200},
        {"item_type": "manual", "item_id": None, "manual_name": "Flete", "manual_description": "Transporte", "quantity": 1, "unit_price": 0},
    ],
}
code, resp = call("POST", "/api/sales", token, sale)
ok = ok and code == 200
print(f"POST /api/sales: {code} {'OK' if code == 200 else resp}")
if code == 200:
    print(f"   -> venta #{resp['invoice_number']}, items con nombre: {[i['name'] for i in resp['items']]}")
    sale_id = resp["id"]
    code, resp = call("GET", f"/api/sales/{sale_id}", token)
    print(f"GET /api/sales/{sale_id}: {code} {'OK' if code == 200 else resp}")
    code, resp = call("DELETE", f"/api/sales/{sale_id}", token)
    ok = ok and code == 200
    print(f"DELETE /api/sales/{sale_id}: {code} {'OK' if code == 200 else resp}")

if client_id:
    code, resp = call("DELETE", f"/api/clients/{client_id}", token)
    print(f"DELETE /api/clients/{client_id}: {code}")
if advisor_id:
    code, resp = call("DELETE", f"/api/advisors/{advisor_id}", token)
    print(f"DELETE /api/advisors/{advisor_id}: {code}")

print("\nRESULTADO GLOBAL:", "TODO OK" if ok else "HAY FALLOS")
