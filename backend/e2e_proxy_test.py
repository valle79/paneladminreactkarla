"""E2E: prueba la API a traves del proxy de Vite (puerto 5173) -> backend (8000)"""
import json
import urllib.request
import urllib.error

BASE = "http://localhost:5173/api"


def call(method, path, token=None, body=None, timeout=60):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode())
        except Exception:
            detail = str(e)
        return e.code, detail


t0 = __import__("time").time()
code, resp = call("POST", "/auth/login", body={"password": "iqueño2026"})
print(f"LOGIN via proxy: {code} ({(__import__('time').time()-t0)*1000:.0f} ms)")
token = resp["token"]

for path in ["/health", "/stats", "/advisors", "/products", "/spare-parts", "/services", "/clients", "/clients-ruc", "/promotions", "/sales"]:
    t0 = __import__("time").time()
    code, resp = call("GET", path, token)
    ms = (__import__("time").time() - t0) * 1000
    n = len(resp) if isinstance(resp, list) else (resp.get("counts", {}) or {})
    print(f"GET {path}: {code}  {ms:.0f} ms  {'OK' if code == 200 else resp}")

print("\nE2E VITE->BACKEND->NEON COMPLETADO")
