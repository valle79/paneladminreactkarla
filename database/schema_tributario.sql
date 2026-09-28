-- ============================================================================
--  IQUEÑO SAC · MÓDULO TRIBUTARIO (IGV + Impuesto a la Renta · RMT)
--  Corrige y completa la base para soportar el cálculo tributario:
--    * ventas: fecha de emisión, estado fiscal, unicidad de comprobante,
--      invariante base imponible + IGV = importe total.
--    * compras: unicidad de comprobante del proveedor e invariantes de importes.
--    * parámetros: UIT por año, tasas de tramos del IR anual,settings.
--    * gastos deducibles: registro explícito (NO se derivan de las compras).
--    * pagos a cuenta del IR: registro persistente y acumulable por período.
--  Idempotente: se puede re-ejecutar sin errores.
--  Todos los importes usan NUMERIC (nunca FLOAT).
-- ============================================================================

-- ============================================================================
-- 1. VENTAS: fecha de emisión y estado fiscal
-- ============================================================================
ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS fecha_emision   DATE,
    ADD COLUMN IF NOT EXISTS estado_fiscal   VARCHAR(20) NOT NULL DEFAULT 'VALIDO';

-- La fecha de emisión es obligatoria: se backfillea desde created_at.
UPDATE public.sales
   SET fecha_emision = (created_at AT TIME ZONE 'America/Lima')::date
 WHERE fecha_emision IS NULL;

ALTER TABLE public.sales
    ALTER COLUMN fecha_emision SET NOT NULL;

-- Comprobantes con número correlativo: índice de apoyo.
CREATE INDEX IF NOT EXISTS idx_sales_fecha_emision
    ON public.sales(fecha_emision DESC);

CREATE INDEX IF NOT EXISTS idx_sales_fiscal
    ON public.sales(estado_fiscal, invoice_type);

-- ============================================================================
-- 2. VENTAS: unicidad del comprobante (evita doble conteo del IGV)
-- ============================================================================
-- Se eliminan duplicados previos conservando el registro más antiguo.
DELETE FROM public.sales a
      USING public.sales b
     WHERE a.invoice_type = b.invoice_type
       AND a.invoice_number = b.invoice_number
       AND a.invoice_number IS NOT NULL
       AND NOT a.deleted
       AND NOT b.deleted
       AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_comprobante
    ON public.sales(invoice_type, invoice_number)
    WHERE NOT deleted AND invoice_number IS NOT NULL;

-- ============================================================================
-- 3. VENTAS: reparación de importes + invariante base + IGV = total
--    (histórico con descuento aplicado sobre el bruto con IGV)
-- ============================================================================
UPDATE public.sales
   SET subtotal = ROUND(total / 1.18, 2),
       igv      = ROUND(total - ROUND(total / 1.18, 2), 2)
 WHERE with_igv
   AND total > 0
   AND ROUND(subtotal + igv, 2) <> ROUND(total, 2);

UPDATE public.sales
   SET subtotal = total,
       igv      = 0
 WHERE NOT with_igv
   AND igv <> 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_sales_estado_fiscal'
    ) THEN
        ALTER TABLE public.sales
            ADD CONSTRAINT check_sales_estado_fiscal
            CHECK (estado_fiscal IN ('VALIDO','ANULADO','OBSERVADO'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_sales_totales'
    ) THEN
        ALTER TABLE public.sales
            ADD CONSTRAINT check_sales_totales
            CHECK (total = ROUND(subtotal + igv, 2));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_sales_no_negativo'
    ) THEN
        ALTER TABLE public.sales
            ADD CONSTRAINT check_sales_no_negativo
            CHECK (subtotal >= 0 AND igv >= 0 AND total >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_sales_invoice_type'
    ) THEN
        ALTER TABLE public.sales
            ADD CONSTRAINT check_sales_invoice_type
            CHECK (invoice_type IS NULL OR invoice_type IN
                   ('factura','boleta','proforma','cotizacion'));
    END IF;
END $$;

-- ============================================================================
-- 4. COMPRAS: unicidad del comprobante del proveedor (crédito fiscal)
--    La lista de tipos debe coincidir EXACTAMENTE con `TIPO_COMPROBANTE`
--    en backend/purchases.py; si divergen, el INSERT falla.
-- ============================================================================
DO $$
BEGIN
    -- Se rehace siempre: la versión anterior no aceptaba 'NOTA_DE_VENTA'
    -- (con guion bajo) que sí envía la aplicación.
    ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS check_purchases_tipo_comprobante;
    ALTER TABLE public.purchases
        ADD CONSTRAINT check_purchases_tipo_comprobante
        CHECK (tipo_comprobante IS NULL
               OR UPPER(TRIM(REPLACE(tipo_comprobante, '_', ' '))) IN
               ('FACTURA','RECIBO DE LUZ','RECIBO DE AGUA','RECIBO DE GAS',
                'PROFORMA','BOLETA','RECIBO','NOTA DE VENTA','OTRO'));
END $$;

-- Duplicados previos: se marca `deleted` en las repetidas, nunca se borran.
UPDATE public.purchases p
   SET deleted = true
  FROM public.purchases d
 WHERE d.proveedor_id  = p.proveedor_id
   AND d.tipo_comprobante IS NOT DISTINCT FROM p.tipo_comprobante
   AND d.serie_comprobante  IS NOT DISTINCT FROM p.serie_comprobante
   AND d.numero_comprobante IS NOT DISTINCT FROM p.numero_comprobante
   AND d.numero_comprobante IS NOT NULL
   AND d.numero_comprobante <> ''
   AND NOT d.deleted
   AND NOT p.deleted
   AND d.id < p.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_comprobante
    ON public.purchases(proveedor_id, tipo_comprobante, serie_comprobante, numero_comprobante)
    WHERE NOT deleted
      AND numero_comprobante IS NOT NULL
      AND numero_comprobante <> '';

CREATE INDEX IF NOT EXISTS idx_purchases_credito_fiscal
    ON public.purchases(fecha_compra)
    WHERE NOT deleted;

-- Invariante de importes de compra: base + IGV + costos adicionales = total.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_purchases_totales'
    ) THEN
        ALTER TABLE public.purchases
            ADD CONSTRAINT check_purchases_totales
            CHECK (total = ROUND(subtotal + impuestos + costos_adicionales, 2));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_purchases_no_negativo'
    ) THEN
        ALTER TABLE public.purchases
            ADD CONSTRAINT check_purchases_no_negativo
            CHECK (subtotal >= 0 AND impuestos >= 0 AND costos_adicionales >= 0 AND total >= 0);
    END IF;
END $$;

-- ============================================================================
-- 5. PARÁMETROS TRIBUTARIOS (UIT por año y tramos del IR anual)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.uit_config (
    anio            INTEGER PRIMARY KEY,
    valor_uit       NUMERIC(12,2) NOT NULL,
    vigencia_desde  DATE,
    descripcion     TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_uit_anio CHECK (anio BETWEEN 2000 AND 2200),
    CONSTRAINT check_uit_valor CHECK (valor_uit > 0)
);

INSERT INTO public.uit_config (anio, valor_uit, vigencia_desde, descripcion) VALUES
    (2024, 5350.00, DATE '2024-01-01', 'UIT 2024 (MINEDU).'),
    (2025, 5500.00, DATE '2025-01-01', 'UIT 2025 (MINEDU).'),
    (2026, 6000.00, DATE '2026-01-01', 'UIT 2026 (MINEDU). Actualizar según resolución vigente.')
ON CONFLICT (anio) DO NOTHING;

-- ============================================================================
-- 5b. TRAMOS DEL IR ANUAL POR RÉGIMEN (tabla, no constantes en código)
--      La Ley exige actualizar las tablas cada año con resolución del MEF;
--      por eso viven en la base y son configurables desde el sistema.
--     hasta_uit = NULL  →  tramo sin límite superior.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ir_tramos (
    id           BIGSERIAL PRIMARY KEY,
    regimen      VARCHAR(20) NOT NULL,
    desde_uit    NUMERIC(12,2) NOT NULL,
    hasta_uit    NUMERIC(12,2),
    tasa         NUMERIC(6,4) NOT NULL,
    activo       BOOLEAN NOT NULL DEFAULT true,
    descripcion  TEXT,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_tramo_regimen CHECK (regimen IN ('GENERAL','RMT','NRUS')),
    CONSTRAINT check_tramo_rango CHECK (
        hasta_uit IS NULL OR hasta_uit > desde_uit),
    CONSTRAINT check_tramo_tasa CHECK (tasa >= 0 AND tasa <= 1),
    CONSTRAINT uq_tramo UNIQUE (regimen, desde_uit)
);

-- Régimen General (Art. 38° TUO LIR): hasta 15 UIT → 10%, exceso → 29.5%.
INSERT INTO public.ir_tramos (regimen, desde_uit, hasta_uit, tasa, descripcion) VALUES
    ('GENERAL', 0, 15,  0.100, 'Primer tramo: hasta 15 UIT de renta neta anual → 10%.'),
    ('GENERAL', 15, NULL, 0.295, 'Exceso: monto excedente a 15 UIT de renta neta anual → 29.5%.')
ON CONFLICT (regimen, desde_uit) DO NOTHING;

-- MYPE Tributario (RMT): los tramos anuales los fija la resolución vigente del
-- MEF para cada año. NO se siembran para evitar dar un dato tributario falso;
-- el sistema avisa que falta configurarlos y no calcula un IR anual incorrecto.
CREATE INDEX IF NOT EXISTS idx_ir_tramos_regimen
    ON public.ir_tramos(regimen, desde_uit) WHERE activo;

DROP TRIGGER IF EXISTS set_updated_at_ir_tramos ON public.ir_tramos;
CREATE TRIGGER set_updated_at_ir_tramos
    BEFORE UPDATE ON public.ir_tramos
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Tasas y tramos configurables (settings). No hay hardcodeo de la UIT.
INSERT INTO public.settings (key, value, description) VALUES
    ('igv_rate',                '0.18',  'Tasa de IGV aplicable (Perú). Centralizada para ventas y compras.'),
    ('igv_name',                'IGV',   'Nombre del impuesto principal.'),
    ('base_currency',           'PEN',   'Moneda base del sistema contable.'),
    ('purchase_prefix',         'CP',    'Prefijo de código para compras.'),
    ('ir_regime',               'RMT',   'Régimen tributario: RMT (MYPE Tributario), GENERAL o NRUS.'),
    ('ir_rate',                 '0.01',  'Tasa del pago a cuenta mensual del IR (1% de ingresos netos en RMT).'),
    ('ir_annual_tramo_uit',     '15',    'Cantidad de UIT de la renta neta con tasa reducida del IR anual.'),
    ('ir_annual_rate_1',        '0.10',  'Tasa del primer tramo del IR anual (hasta el tramo de UIT).'),
    ('ir_annual_rate_2',        '0.295', 'Tasa del exceso sobre el tramo de UIT del IR anual.'),
    ('purchase_credit_states',   'RECIBIDA_COMPLETA,RECIBIDA_PARCIAL',
                                'Estados de compra que generan crédito fiscal. ORDENADA/CONFIRMADA/EN_TRANSITO quedan fuera.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 6. GASTOS DEDUCIBLES (registro explícito e independiente de las compras)
--    Nunca se derivan automáticamente de `purchases`: cada gasto se valida
--    por su naturaleza (categoría), importe y sustento.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gastos_deducibles (
    id                BIGSERIAL PRIMARY KEY,
    anio              INTEGER NOT NULL,
    mes               INTEGER NOT NULL,
    fecha_gasto       DATE NOT NULL DEFAULT CURRENT_DATE,
    categoria         VARCHAR(40) NOT NULL,
    descripcion       VARCHAR(300) NOT NULL,
    proveedor         VARCHAR(300),
    documento_tipo    VARCHAR(40),
    documento_numero  VARCHAR(60),
    moneda            VARCHAR(10) NOT NULL DEFAULT 'PEN',
    tipo_cambio       NUMERIC(12,4) NOT NULL DEFAULT 1,
    monto             NUMERIC(16,2) NOT NULL,
    monto_pen         NUMERIC(16,2) NOT NULL,
    estado            VARCHAR(20) NOT NULL DEFAULT 'VALIDO',
    observaciones     TEXT,
    deleted           BOOLEAN NOT NULL DEFAULT false,
    created_by        BIGINT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_gasto_mes CHECK (mes BETWEEN 1 AND 12),
    CONSTRAINT check_gasto_anio CHECK (anio BETWEEN 2000 AND 2200),
    CONSTRAINT check_gasto_categoria CHECK (categoria IN (
        'COMPRA_MERCADERIA','SERVICIOS','ALQUILER','TRANSPORTE',
        'SERVICIOS_PROFESIONALES','GASTOS_BANCARIOS','OTROS_GASTOS')),
    CONSTRAINT check_gasto_estado CHECK (estado IN ('BORRADOR','VALIDO','ANULADO')),
    CONSTRAINT check_gasto_monto CHECK (monto > 0 AND monto_pen > 0),
    CONSTRAINT check_gasto_tipo_cambio CHECK (tipo_cambio > 0),
    CONSTRAINT check_gasto_coherencia CHECK (
        fecha_gasto >= make_date(anio, mes, 1)
        AND fecha_gasto < (make_date(anio, mes, 1) + INTERVAL '1 month')::date)
);

CREATE INDEX IF NOT EXISTS idx_gastos_periodo
    ON public.gastos_deducibles(anio DESC, mes DESC, fecha_gasto DESC);
CREATE INDEX IF NOT EXISTS idx_gastos_deleted
    ON public.gastos_deducibles(deleted);

-- ============================================================================
-- 7. PAGOS A CUENTA DEL IR (registro persistente, único por período)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pagos_cuenta_ir (
    id                BIGSERIAL PRIMARY KEY,
    anio              INTEGER NOT NULL,
    mes               INTEGER NOT NULL,
    ingresos_netos    NUMERIC(16,2) NOT NULL DEFAULT 0,
    tasa              NUMERIC(6,4) NOT NULL DEFAULT 0.01,
    monto_calculado   NUMERIC(16,2) NOT NULL DEFAULT 0,
    monto_pagado      NUMERIC(16,2) NOT NULL DEFAULT 0,
    fecha_pago        DATE,
    numero_operacion  VARCHAR(100),
    entidad           VARCHAR(120),
    estado            VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    observaciones     TEXT,
    deleted           BOOLEAN NOT NULL DEFAULT false,
    created_by        BIGINT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_pago_mes CHECK (mes BETWEEN 1 AND 12),
    CONSTRAINT check_pago_anio CHECK (anio BETWEEN 2000 AND 2200),
    CONSTRAINT check_pago_estado CHECK (estado IN ('PENDIENTE','PAGADO','ANULADO')),
    CONSTRAINT check_pago_tasa CHECK (tasa >= 0 AND tasa <= 1),
    CONSTRAINT check_pago_montos CHECK (
        ingresos_netos >= 0 AND monto_calculado >= 0 AND monto_pagado >= 0)
);

-- Un único registro de pago a cuenta por período → impide duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pagos_cuenta_periodo
    ON public.pagos_cuenta_ir(anio, mes)
    WHERE NOT deleted;

CREATE INDEX IF NOT EXISTS idx_pagos_cuenta_anio
    ON public.pagos_cuenta_ir(anio DESC, mes DESC);

-- ============================================================================
-- 8. TRIGGERS updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS set_updated_at_uit_config ON public.uit_config;
CREATE TRIGGER set_updated_at_uit_config
    BEFORE UPDATE ON public.uit_config
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_gastos_deducibles ON public.gastos_deducibles;
CREATE TRIGGER set_updated_at_gastos_deducibles
    BEFORE UPDATE ON public.gastos_deducibles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_pagos_cuenta_ir ON public.pagos_cuenta_ir;
CREATE TRIGGER set_updated_at_pagos_cuenta_ir
    BEFORE UPDATE ON public.pagos_cuenta_ir
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 9. INTEGRIDAD DE SECUENCIAS
-- ============================================================================
-- Una secuencia por debajo de max(id) provoca "duplicate key value violates
-- unique constraint" al insertar desde la aplicación, aunque la fila no
-- exista. Se alinean todas las secuencias de 'public' que esten rezagadas.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT t.tablename AS tabla, pg_get_serial_sequence('public.'||t.tablename, 'id') AS seq
          FROM pg_tables t
          JOIN information_schema.columns col
            ON col.table_schema = t.schemaname
           AND col.table_name = t.tablename
           AND col.column_name = 'id'
         WHERE t.schemaname = 'public'
           AND t.tablename NOT LIKE 'pg\_%'
           AND pg_get_serial_sequence('public.'||t.tablename, 'id') IS NOT NULL
    LOOP
        EXECUTE format(
            'SELECT setval(%L, GREATEST((SELECT last_value FROM %s), '
            '(SELECT COALESCE(MAX(id), 0) FROM public.%I)), true)',
            r.seq, r.seq, r.tabla
        );
    END LOOP;
END $$;
