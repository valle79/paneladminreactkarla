-- ============================================================================
--  IQUEÑO SAC · REDISEÑO COMPRAS INTERIORES
--  Comprobante en compras, vínculo cliente/producto-trabajo/utilización por
--  ítem (destino) y catálogo controlado de unidades.
--  Idempotente: se puede re-ejecutar sin errores (ADD COLUMN IF NOT EXISTS).
-- ============================================================================

-- ==== purchases: datos del comprobante del proveedor =========================
ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS tipo_comprobante  VARCHAR(20),
    ADD COLUMN IF NOT EXISTS serie_comprobante VARCHAR(20),
    ADD COLUMN IF NOT EXISTS numero_comprobante VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_purchases_comprobante
    ON public.purchases(tipo_comprobante, serie_comprobante, numero_comprobante);

-- ==== purchase_items: destino y utilización de cada material ================
ALTER TABLE public.purchase_items
    ADD COLUMN IF NOT EXISTS destino       VARCHAR(20) NOT NULL DEFAULT 'OTRO',
    ADD COLUMN IF NOT EXISTS cliente_tipo  VARCHAR(10),
    ADD COLUMN IF NOT EXISTS cliente_id    BIGINT,
    ADD COLUMN IF NOT EXISTS trabajo_tipo  VARCHAR(20),
    ADD COLUMN IF NOT EXISTS trabajo_id    BIGINT,
    ADD COLUMN IF NOT EXISTS trabajo_desc  VARCHAR(300),
    ADD COLUMN IF NOT EXISTS utilizacion   TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_items_destino ON public.purchase_items(destino);
CREATE INDEX IF NOT EXISTS idx_purchase_items_cliente ON public.purchase_items(cliente_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_trabajo ON public.purchase_items(trabajo_id);

-- ==== TABLA: units (Catálogo de unidades de medida) ==========================
CREATE TABLE IF NOT EXISTS public.units (
    code    VARCHAR(10) PRIMARY KEY,
    name    VARCHAR(60) NOT NULL,
    active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

INSERT INTO public.units (code, name) VALUES
    ('UND', 'Unidad'),
    ('KG',  'Kilogramo'),
    ('GR',  'Gramo'),
    ('MT',  'Metro'),
    ('LT',  'Litro'),
    ('GAL', 'Galón'),
    ('PAR', 'Par'),
    ('JGO', 'Juego'),
    ('CJ',  'Caja'),
    ('PZA', 'Pieza'),
    ('SERV','Servicio')
ON CONFLICT (code) DO NOTHING;

-- ==== purchases: cliente al que está enlazada la compra (cabecera) ===========
ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS cliente_tipo VARCHAR(10),
    ADD COLUMN IF NOT EXISTS cliente_id   BIGINT;

CREATE INDEX IF NOT EXISTS idx_purchases_cliente ON public.purchases(cliente_id);

-- ==== purchase_items: pieza comprada (nueva) ================================
ALTER TABLE public.purchase_items
    ADD COLUMN IF NOT EXISTS pieza_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_purchase_items_pieza ON public.purchase_items(pieza_id);

-- ==== TABLA: piezas (Piezas a utilizar en la elaboración) ====================
CREATE TABLE IF NOT EXISTS public.piezas (
    id         BIGSERIAL PRIMARY KEY,
    codigo     TEXT,
    name       TEXT NOT NULL,
    descripcion TEXT,
    precio     NUMERIC(14,2) NOT NULL DEFAULT 0,
    unidad     VARCHAR(10) NOT NULL DEFAULT 'UND',
    stock      NUMERIC(14,2) NOT NULL DEFAULT 0,
    active     BOOLEAN NOT NULL DEFAULT true,
    deleted    BOOLEAN NOT NULL DEFAULT false,
    created_by BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_piezas_name ON public.piezas (lower(name));

-- ==== constraint: destino válido (no bloquea registros históricos) ============
-- Solo aplica a partir de ahora; los datos existentes con NULL ya tienen DEFAULT OTRO.