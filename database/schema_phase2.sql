-- FASE 2: Pagos + Cuentas por Pagar
-- v_accounts_payable con conversión de moneda en pagos.
-- Antes: SUM(monto) sin convertir -> saldo incorrecto si el pago fue en otra moneda.
-- Ahora: cada pago se convierte a la moneda de la compra (monto * tc_pago / tc_compra),
-- mismo criterio que el detalle en purchases.py.
CREATE OR REPLACE VIEW public.v_accounts_payable AS
SELECT
    p.id                          AS purchase_id,
    p.codigo_compra,
    p.tipo_compra,
    p.tipo_item,
    p.moneda,
    p.tipo_cambio,
    p.total,
    p.total_equivalente,
    p.proveedor_id,
    p.fecha_compra,
    p.fecha_vencimiento,
    p.estado,
    p.estado_pago,
    p.deleted,
    COALESCE(paid.total_pagado, 0)::NUMERIC(16,2) AS total_pagado,
    GREATEST(p.total - COALESCE(paid.total_pagado, 0), 0)::NUMERIC(16,2) AS saldo
FROM public.purchases p
LEFT JOIN (
    SELECT sp.purchase_id,
           COALESCE(SUM(sp.monto * (COALESCE(sp.tipo_cambio, 1) / NULLIF(COALESCE(pr.tipo_cambio, 1), 0))), 0)
               AS total_pagado
    FROM public.supplier_payments sp
    JOIN public.purchases pr ON pr.id = sp.purchase_id
    WHERE sp.anulado = false
    GROUP BY sp.purchase_id, pr.tipo_cambio
) paid ON paid.purchase_id = p.id;