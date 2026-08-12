"""Consulta de DNI (RENIEC) y RUC (SUNAT) via decolecta.com.

Si DECOLECTA_TOKEN esta vacio en .env, se usan respuestas DEMO.
"""

import os

import httpx

DECOLECTA_BASE = "https://api.decolecta.com/v1"


def _headers() -> dict:
    return {"Authorization": f"Bearer {os.getenv('DECOLECTA_TOKEN', '')}"}


def consultar_dni(dni: str) -> dict:
    if not os.getenv("DECOLECTA_TOKEN"):
        return _demo_dni(dni)
    r = httpx.get(
        f"{DECOLECTA_BASE}/reniec/dni",
        params={"numero": dni},
        headers=_headers(),
        timeout=15,
    )
    if r.status_code != 200:
        raise ValueError("No se pudo consultar el DNI (revisa el token de decolecta)")
    data = r.json()
    return {
        "tipo_documento": "DNI",
        "numero_documento": data.get("document_number") or dni,
        "nombre_completo": data.get("full_name") or "",
        "nombres": data.get("first_name", ""),
        "apellidos": f"{data.get('first_last_name', '')} {data.get('second_last_name', '')}".strip(),
        "direccion": "",
        "fuente": "RENIEC",
    }


_RUC_FIELDS = (
    "razon_social",
    "numero_documento",
    "estado",
    "condicion",
    "direccion",
    "ubigeo",
    "via_tipo",
    "via_nombre",
    "zona_codigo",
    "zona_tipo",
    "numero",
    "interior",
    "lote",
    "dpto",
    "manzana",
    "kilometro",
    "distrito",
    "provincia",
    "departamento",
    "es_agente_retencion",
    "es_buen_contribuyente",
    "locales_anexos",
)


def _map_ruc(data: dict, ruc: str) -> dict:
    return {
        "tipo_documento": "RUC",
        "numero_documento": data.get("numero_documento") or ruc,
        **{f: data.get(f, "") for f in _RUC_FIELDS},
        "fuente": "SUNAT",
    }


def consultar_ruc(ruc: str) -> dict:
    if not os.getenv("DECOLECTA_TOKEN"):
        return _demo_ruc(ruc)
    r = httpx.get(
        f"{DECOLECTA_BASE}/sunat/ruc",
        params={"numero": ruc},
        headers=_headers(),
        timeout=15,
    )
    if r.status_code != 200:
        raise ValueError("No se pudo consultar el RUC (revisa el token de decolecta)")
    return _map_ruc(r.json(), ruc)


def _demo_dni(dni: str) -> dict:
    return {
        "tipo_documento": "DNI",
        "numero_documento": dni,
        "nombre_completo": "JUAN CARLOS PEREZ GONZALES",
        "nombres": "JUAN CARLOS",
        "apellidos": "PEREZ GONZALES",
        "direccion": "AV. LOS PROCERES MZ B LT 12 DISTRITO IMPERIAL",
        "fuente": "RENIEC (DEMO - configura DECOLECTA_TOKEN en backend/.env)",
    }


def _demo_ruc(ruc: str) -> dict:
    return {
        "tipo_documento": "RUC",
        "numero_documento": ruc,
        "razon_social": f"EMPRESA AGROINDUSTRIAL DEMO {ruc} SAC",
        "estado": "ACTIVO",
        "condicion": "HABIDO",
        "direccion": "JR. LOS AGROINDUSTRIALES Nº 123 INT. 2 URB. CENTRO CAÑETE",
        "ubigeo": "150501",
        "via_tipo": "JR.",
        "via_nombre": "LOS AGROINDUSTRIALES",
        "zona_codigo": "URB.",
        "zona_tipo": "CENTRO",
        "numero": "123",
        "interior": "2",
        "lote": "-",
        "dpto": "-",
        "manzana": "-",
        "kilometro": "-",
        "distrito": "IMPERIAL",
        "provincia": "CAÑETE",
        "departamento": "LIMA",
        "es_agente_retencion": False,
        "es_buen_contribuyente": False,
        "locales_anexos": None,
        "fuente": "SUNAT (DEMO - configura DECOLECTA_TOKEN en backend/.env)",
    }