-- ============================================================================
--  IQUEÑO SAC · MÓDULO DE COMPRAS NACIONALES E INTERNACIONALES
--  Tablas: suppliers, purchases, purchase_items, purchase_orders,
--          purchase_order_items, purchase_receipts, purchase_receipt_items,
--          supplier_payments, purchase_imports, import_costs,
--          import_cost_allocations, purchase_documents,
--          purchase_status_history, inventory_movements, settings.
--  Idempotente: se puede re-ejecutar sin errores (IF NOT EXISTS / ADD COLUMN).
--  Todos los importes usan NUMERIC (nunca FLOAT).
-- ============================================================================

-- ==== TABLA: suppliers (Proveedores) ========================================
CREATE TABLE IF NOT EXISTS public.suppliers (
    id                BIGSERIAL PRIMARY KEY,
    tipo_proveedor    VARCHAR(20)  NOT NULL DEFAULT 'NACIONAL',
    tipo_documento    VARCHAR(30)  NOT NULL DEFAULT 'RUC',
    numero_documento  VARCHAR(40),
    razon_social      VARCHAR(300) NOT NULL,
    nombre_comercial  VARCHAR(200),
    pais              VARCHAR(100) NOT NULL DEFAULT 'Perú',
    direccion         TEXT,
    ciudad            VARCHAR(100),
    departamento      VARCHAR(100),
    telefono          VARCHAR(50),
    email             VARCHAR(200),
    contacto          VARCHAR(200),
    moneda_principal  VARCHAR(10)  NOT NULL DEFAULT 'PEN',
    condiciones_pago  VARCHAR(250),
    banco             VARCHAR(200),
    numero_cuenta     VARCHAR(100),
    swift             VARCHAR(50),
    estado            VARCHAR(20)  NOT NULL DEFAULT 'ACTIVO',
    observaciones     TEXT,
    deleted           BOOLEAN      NOT NULL DEFAULT false,
    created_by        BIGINT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_tipo_proveedor CHECK (tipo_proveedor IN ('NACIONAL','EXTRANJERO')),
    CONSTRAINT check_supplier_estado CHECK (estado IN ('ACTIVO','INACTIVO'))
);

CREATE INDEX IF NOT EXISTS idx_suppliers_deleted ON public.suppliers(deleted);
CREATE INDEX IF NOT EXISTS idx_suppliers_tipo ON public.suppliers(tipo_proveedor);
CREATE INDEX IF NOT EXISTS idx_suppliers_pais ON public.suppliers(pais);
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_doc
    ON public.suppliers(tipo_documento, numero_documento)
    WHERE numero_documento IS NOT NULL AND numero_documento <> '' AND NOT deleted;

-- ==== TABLA: purchases (Compras) ============================================
CREATE TABLE IF NOT EXISTS public.purchases (
    id                 BIGSERIAL PRIMARY KEY,
    codigo_compra      VARCHAR(30) UNIQUE NOT NULL,
    tipo_compra        VARCHAR(20) NOT NULL,
    proveedor_id       BIGINT NOT NULL REFERENCES public.suppliers(id),
    purchase_order_id  BIGINT,
    fecha_compra       DATE NOT NULL DEFAULT CURRENT_DATE,
    moneda             VARCHAR(10) NOT NULL DEFAULT 'PEN',
    tipo_cambio        NUMERIC(12,4) NOT NULL DEFAULT 1,
    fecha_tipo_cambio  DATE,
    subtotal           NUMERIC(16,2) NOT NULL DEFAULT 0,
    impuestos          NUMERIC(16,2) NOT NULL DEFAULT 0,
    costos_adicionales NUMERIC(16,2) NOT NULL DEFAULT 0,
    total              NUMERIC(16,2) NOT NULL DEFAULT 0,
    total_equivalente  NUMERIC(16,2) NOT NULL DEFAULT 0,
    tipo_item          VARCHAR(15),
    condiciones_pago   VARCHAR(250),
    fecha_vencimiento  DATE,
    estado             VARCHAR(25) NOT NULL DEFAULT 'BORRADOR',
    estado_pago        VARCHAR(25) NOT NULL DEFAULT 'PENDIENTE',
    observaciones      TEXT,
    deleted            BOOLEAN NOT NULL DEFAULT false,
    created_by         BIGINT,
    updated_by         BIGINT,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_tipo_compra CHECK (tipo_compra IN ('NACIONAL','INTERNACIONAL')),
    CONSTRAINT check_purchase_estado CHECK (estado IN
        ('BORRADOR','ORDENADA','CONFIRMADA','EN_TRANSITO','RECIBIDA_PARCIAL','RECIBIDA_COMPLETA','CANCELADA')),
    CONSTRAINT check_purchase_estado_pago CHECK (estado_pago IN
        ('PENDIENTE','PAGADA_PARCIAL','PAGADA','VENCIDA','ANULADA')),
    CONSTRAINT check_purchase_tipo_cambio CHECK (tipo_cambio > 0)
);

CREATE INDEX IF NOT EXISTS idx_purchases_deleted ON public.purchases(deleted);
CREATE INDEX IF NOT EXISTS idx_purchases_proveedor ON public.purchases(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_purchases_fecha ON public.purchases(fecha_compra DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_tipo ON public.purchases(tipo_compra);
CREATE INDEX IF NOT EXISTS idx_purchases_estado ON public.purchases(estado);
CREATE INDEX IF NOT EXISTS idx_purchases_estado_pago ON public.purchases(estado_pago);

-- ==== TABLA: purchase_items (Detalle de compra) =============================
CREATE TABLE IF NOT EXISTS public.purchase_items (
    id                       BIGSERIAL PRIMARY KEY,
    purchase_id              BIGINT NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    product_id               BIGINT REFERENCES public.machine_products(id),
    spare_part_id            BIGINT REFERENCES public.spare_parts(id),
    descripcion              VARCHAR(300),
    codigo                   VARCHAR(100),
    cantidad                 NUMERIC(14,2) NOT NULL,
    unidad                   VARCHAR(20) DEFAULT 'UNIDAD',
    precio_unitario          NUMERIC(16,4) NOT NULL DEFAULT 0,
    descuento                NUMERIC(14,2) NOT NULL DEFAULT 0,
    subtotal                 NUMERIC(16,2) NOT NULL DEFAULT 0,
    impuesto                 NUMERIC(16,2) NOT NULL DEFAULT 0,
    total                    NUMERIC(16,2) NOT NULL DEFAULT 0,
    costo_original           NUMERIC(16,4) NOT NULL DEFAULT 0,
    costo_adicional_asignado NUMERIC(16,2) NOT NULL DEFAULT 0,
    costo_real               NUMERIC(16,2) NOT NULL DEFAULT 0,
    peso_kg                  NUMERIC(14,4),
    volumen_m3               NUMERIC(14,4),
    CONSTRAINT check_item_kind CHECK (
        (product_id IS NOT NULL AND spare_part_id IS NULL)
        OR (spare_part_id IS NOT NULL AND product_id IS NULL)
        OR (product_id IS NULL AND spare_part_id IS NULL)
    ),
    CONSTRAINT check_item_cantidad CHECK (cantidad > 0),
    CONSTRAINT check_item_precio CHECK (precio_unitario >= 0)
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON public.purchase_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_spare ON public.purchase_items(spare_part_id);

-- ==== TABLA: purchase_orders (Órdenes de compra) ============================
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id                     BIGSERIAL PRIMARY KEY,
    codigo_orden           VARCHAR(30) UNIQUE NOT NULL,
    purchase_id            BIGINT REFERENCES public.purchases(id),
    proveedor_id           BIGINT NOT NULL REFERENCES public.suppliers(id),
    tipo_compra            VARCHAR(20) NOT NULL DEFAULT 'NACIONAL',
    fecha_orden            DATE NOT NULL DEFAULT CURRENT_DATE,
    moneda                 VARCHAR(10) NOT NULL DEFAULT 'PEN',
    tipo_cambio            NUMERIC(12,4) NOT NULL DEFAULT 1,
    condiciones_pago       VARCHAR(250),
    fecha_estimada_entrega DATE,
    subtotal               NUMERIC(16,2) NOT NULL DEFAULT 0,
    impuestos              NUMERIC(16,2) NOT NULL DEFAULT 0,
    total                  NUMERIC(16,2) NOT NULL DEFAULT 0,
    estado                 VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    observaciones          TEXT,
    deleted                BOOLEAN NOT NULL DEFAULT false,
    created_by             BIGINT,
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at             TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_order_estado CHECK (estado IN
        ('BORRADOR','ENVIADA','ACEPTADA','RECHAZADA','RECIBIDA','CANCELADA')),
    CONSTRAINT check_order_tipo_cambio CHECK (tipo_cambio > 0)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_proveedor ON public.purchase_orders(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_estado ON public.purchase_orders(estado);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_deleted ON public.purchase_orders(deleted);

-- ==== TABLA: purchase_order_items (Detalle de orden) ========================
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id              BIGSERIAL PRIMARY KEY,
    order_id        BIGINT NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    product_id      BIGINT REFERENCES public.machine_products(id),
    spare_part_id   BIGINT REFERENCES public.spare_parts(id),
    descripcion     VARCHAR(300),
    codigo          VARCHAR(100),
    cantidad        NUMERIC(14,2) NOT NULL,
    unidad          VARCHAR(20) DEFAULT 'UNIDAD',
    precio_unitario NUMERIC(16,4) NOT NULL DEFAULT 0,
    descuento       NUMERIC(14,2) NOT NULL DEFAULT 0,
    subtotal        NUMERIC(16,2) NOT NULL DEFAULT 0,
    impuesto        NUMERIC(16,2) NOT NULL DEFAULT 0,
    total           NUMERIC(16,2) NOT NULL DEFAULT 0,
    CONSTRAINT check_order_item_kind CHECK (
        (product_id IS NOT NULL AND spare_part_id IS NULL)
        OR (spare_part_id IS NOT NULL AND product_id IS NULL)
        OR (product_id IS NULL AND spare_part_id IS NULL)
    ),
    CONSTRAINT check_order_item_cantidad CHECK (cantidad > 0),
    CONSTRAINT check_order_item_precio CHECK (precio_unitario >= 0)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON public.purchase_order_items(order_id);

-- ==== TABLA: purchase_receipts (Recepción de mercadería) ====================
CREATE TABLE IF NOT EXISTS public.purchase_receipts (
    id               BIGSERIAL PRIMARY KEY,
    codigo_recepcion VARCHAR(30) UNIQUE NOT NULL,
    purchase_id      BIGINT NOT NULL REFERENCES public.purchases(id),
    purchase_order   BIGINT REFERENCES public.purchase_orders(id),
    proveedor_id     BIGINT NOT NULL REFERENCES public.suppliers(id),
    fecha_recepcion  DATE NOT NULL DEFAULT CURRENT_DATE,
    estado           VARCHAR(20) NOT NULL DEFAULT 'RECIBIDA',
    observaciones    TEXT,
    deleted          BOOLEAN NOT NULL DEFAULT false,
    created_by       BIGINT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_recepcion_estado CHECK (estado IN ('RECIBIDA','INCOMPLETA','ANULADA'))
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_purchase ON public.purchase_receipts(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_deleted ON public.purchase_receipts(deleted);

-- ==== TABLA: purchase_receipt_items (Detalle de recepción) ==================
CREATE TABLE IF NOT EXISTS public.purchase_receipt_items (
    id                 BIGSERIAL PRIMARY KEY,
    receipt_id         BIGINT NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
    purchase_item_id   BIGINT REFERENCES public.purchase_items(id),
    product_id         BIGINT REFERENCES public.machine_products(id),
    spare_part_id      BIGINT REFERENCES public.spare_parts(id),
    descripcion        VARCHAR(300),
    cantidad_solicitada NUMERIC(14,2) NOT NULL DEFAULT 0,
    cantidad_recibida  NUMERIC(14,2) NOT NULL DEFAULT 0,
    cantidad_danada    NUMERIC(14,2) NOT NULL DEFAULT 0,
    cantidad_faltante  NUMERIC(14,2) NOT NULL DEFAULT 0,
    observaciones      TEXT,
    CONSTRAINT check_receipt_item_recibida CHECK (cantidad_recibida >= 0),
    CONSTRAINT check_receipt_item_danada CHECK (cantidad_danada >= 0),
    CONSTRAINT check_receipt_item_faltante CHECK (cantidad_faltante >= 0)
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON public.purchase_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_purchase_item ON public.purchase_receipt_items(purchase_item_id);

-- ==== TABLA: supplier_payments (Pagos a proveedores) ========================
CREATE TABLE IF NOT EXISTS public.supplier_payments (
    id                 BIGSERIAL PRIMARY KEY,
    purchase_id        BIGINT NOT NULL REFERENCES public.purchases(id),
    supplier_id        BIGINT NOT NULL REFERENCES public.suppliers(id),
    fecha_pago         DATE NOT NULL DEFAULT CURRENT_DATE,
    moneda             VARCHAR(10) NOT NULL DEFAULT 'PEN',
    monto              NUMERIC(16,2) NOT NULL,
    tipo_cambio        NUMERIC(12,4) NOT NULL DEFAULT 1,
    medio_pago         VARCHAR(60) NOT NULL,
    numero_operacion   VARCHAR(100),
    banco              VARCHAR(200),
    observaciones      TEXT,
    anulado            BOOLEAN NOT NULL DEFAULT false,
    motivo_anulacion   TEXT,
    fecha_anulacion    TIMESTAMP WITH TIME ZONE,
    created_by         BIGINT,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_pago_monto CHECK (monto > 0),
    CONSTRAINT check_pago_tipo_cambio CHECK (tipo_cambio > 0)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase ON public.supplier_payments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);

-- ==== TABLA: purchase_imports (Datos de importación) ========================
CREATE TABLE IF NOT EXISTS public.purchase_imports (
    id                        BIGSERIAL PRIMARY KEY,
    purchase_id               BIGINT NOT NULL UNIQUE REFERENCES public.purchases(id),
    pais_origen               VARCHAR(100),
    proveedor_extranjero      VARCHAR(300),
    puerto_origen             VARCHAR(150),
    puerto_destino            VARCHAR(150),
    medio_transporte          VARCHAR(60),
    incoterm                  VARCHAR(10),
    numero_orden_compra       VARCHAR(100),
    numero_proforma           VARCHAR(100),
    numero_factura_comercial  VARCHAR(100),
    fecha_embarque            DATE,
    fecha_estimada_arribo     DATE,
    fecha_arribo              DATE,
    numero_conocimiento_embarque VARCHAR(100),
    agente_aduanas            VARCHAR(200),
    numero_declaracion_aduanera VARCHAR(100),
    estado_logistico          VARCHAR(30) NOT NULL DEFAULT 'COTIZACIÓN',
    observaciones             TEXT,
    created_at                TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at                TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_estado_logistico CHECK (estado_logistico IN
        ('COTIZACIÓN','ORDENADA','PRODUCCIÓN','LISTA_PARA_EMBARQUE','EMBARCADA',
         'EN_TRANSITO','ARRIBADA','ADUANAS','LIBERADA','RECIBIDA','CANCELADA'))
);

-- ==== TABLA: import_costs (Costos adicionales de importación) ===============
CREATE TABLE IF NOT EXISTS public.import_costs (
    id                       BIGSERIAL PRIMARY KEY,
    purchase_id              BIGINT NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    purchase_item_id         BIGINT REFERENCES public.purchase_items(id),
    cost_type                VARCHAR(60) NOT NULL,
    concepto                 VARCHAR(250),
    monto                    NUMERIC(16,2) NOT NULL,
    moneda                   VARCHAR(10) NOT NULL DEFAULT 'USD',
    tipo_cambio              NUMERIC(12,4) NOT NULL DEFAULT 1,
    monto_equivalente        NUMERIC(16,2) NOT NULL,
    metodo_distribucion      VARCHAR(20) NOT NULL DEFAULT 'POR_VALOR',
    distribuir               BOOLEAN NOT NULL DEFAULT true,
    observaciones            TEXT,
    deleted                  BOOLEAN NOT NULL DEFAULT false,
    created_by               BIGINT,
    created_at               TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at               TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_costo_monto CHECK (monto >= 0),
    CONSTRAINT check_costo_tipo_cambio CHECK (tipo_cambio > 0),
    CONSTRAINT check_metodo_distribucion CHECK (metodo_distribucion IN
        ('POR_VALOR','POR_CANTIDAD','POR_PESO','POR_VOLUMEN','MANUAL'))
);

CREATE INDEX IF NOT EXISTS idx_import_costs_purchase ON public.import_costs(purchase_id);

-- ==== TABLA: import_cost_allocations (Distribución de costos por item) ======
CREATE TABLE IF NOT EXISTS public.import_cost_allocations (
    id               BIGSERIAL PRIMARY KEY,
    cost_id          BIGINT NOT NULL REFERENCES public.import_costs(id) ON DELETE CASCADE,
    purchase_item_id BIGINT NOT NULL REFERENCES public.purchase_items(id) ON DELETE CASCADE,
    monto_asignado   NUMERIC(16,4) NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cost_allocations_cost ON public.import_cost_allocations(cost_id);
CREATE INDEX IF NOT EXISTS idx_cost_allocations_item ON public.import_cost_allocations(purchase_item_id);

-- ==== TABLA: purchase_documents (Documentos de compra) ======================
CREATE TABLE IF NOT EXISTS public.purchase_documents (
    id              BIGSERIAL PRIMARY KEY,
    purchase_id     BIGINT NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    supplier_id     BIGINT REFERENCES public.suppliers(id),
    documento_tipo  VARCHAR(40) NOT NULL,
    serie           VARCHAR(20),
    numero          VARCHAR(40),
    numero_completo VARCHAR(60),
    fecha_emision   DATE,
    fecha_vencimiento DATE,
    archivo_url     TEXT,
    nombre_archivo  VARCHAR(200),
    observaciones   TEXT,
    deleted         BOOLEAN NOT NULL DEFAULT false,
    created_by      BIGINT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_documents_purchase ON public.purchase_documents(purchase_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_documents
    ON public.purchase_documents(supplier_id, documento_tipo, serie, numero)
    WHERE numero IS NOT NULL AND numero <> '' AND deleted = false;

-- ==== TABLA: purchase_status_history (Historial / trazabilidad) =============
CREATE TABLE IF NOT EXISTS public.purchase_status_history (
    id           BIGSERIAL PRIMARY KEY,
    purchase_id  BIGINT NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    evento       VARCHAR(50) NOT NULL,
    estado_previo VARCHAR(25),
    estado_nuevo VARCHAR(25),
    descripcion  TEXT,
    user_id      BIGINT,
    user_email   VARCHAR(200),
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_history_purchase ON public.purchase_status_history(purchase_id);

-- ==== TABLA: inventory_movements (Movimientos de inventario) ================
CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id              BIGSERIAL PRIMARY KEY,
    item_type       VARCHAR(20) NOT NULL,
    item_id         BIGINT NOT NULL,
    tipo_movimiento VARCHAR(30) NOT NULL,
    cantidad        NUMERIC(14,2) NOT NULL,
    stock_previo    NUMERIC(14,2) NOT NULL,
    stock_nuevo     NUMERIC(14,2) NOT NULL,
    referencia_tipo VARCHAR(30),
    referencia_id   BIGINT,
    user_id         BIGINT,
    user_email      VARCHAR(200),
    fecha           TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    observaciones   TEXT,
    CONSTRAINT check_inv_item_type CHECK (item_type IN ('product','spare_part')),
    CONSTRAINT check_inv_movimiento CHECK (tipo_movimiento IN
        ('INVENTARIO_ENTRADA','RECEPCION','AJUSTE','VENTA_SALIDA','OTRO'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON public.inventory_movements(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_ref ON public.inventory_movements(referencia_tipo, referencia_id);

-- ==== TABLA: settings (Configuración centralizada / tributaria) =============
CREATE TABLE IF NOT EXISTS public.settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

INSERT INTO public.settings (key, value, description) VALUES
    ('igv_rate', '0.18', 'Tasa de IGV aplicable (Perú). Centralizada para ventas y compras.'),
    ('igv_name', 'IGV', 'Nombre del impuesto principal.'),
    ('base_currency', 'PEN', 'Moneda base del sistema contable.'),
    ('purchase_prefix', 'CP', 'Prefijo de código para compras.')
ON CONFLICT (key) DO NOTHING;

-- ==== VISTA: v_accounts_payable (Cuentas por pagar) =========================
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
    SELECT purchase_id, COALESCE(SUM(monto), 0) AS total_pagado
    FROM public.supplier_payments
    WHERE anulado = false
    GROUP BY purchase_id
) paid ON paid.purchase_id = p.id;

-- ==== TRIGGERS: updated_at ===================================================
DROP TRIGGER IF EXISTS set_updated_at_suppliers ON public.suppliers;
CREATE TRIGGER set_updated_at_suppliers
    BEFORE UPDATE ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_purchases ON public.purchases;
CREATE TRIGGER set_updated_at_purchases
    BEFORE UPDATE ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_purchase_orders ON public.purchase_orders;
CREATE TRIGGER set_updated_at_purchase_orders
    BEFORE UPDATE ON public.purchase_orders
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_purchase_receipts ON public.purchase_receipts;
CREATE TRIGGER set_updated_at_purchase_receipts
    BEFORE UPDATE ON public.purchase_receipts
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_import_costs ON public.import_costs;
CREATE TRIGGER set_updated_at_import_costs
    BEFORE UPDATE ON public.import_costs
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_purchase_imports ON public.purchase_imports;
CREATE TRIGGER set_updated_at_purchase_imports
    BEFORE UPDATE ON public.purchase_imports
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_settings ON public.settings;
CREATE TRIGGER set_updated_at_settings
    BEFORE UPDATE ON public.settings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();