-- ============================================================================
--  IQUEÑO SAC - Actualización de esquema Neon
--  Añade columnas de stock y estado a machine_products y spare_parts.
--  Idempotente: se puede re-ejecutar sin errores.
-- ============================================================================

-- stock: cantidad en inventario
ALTER TABLE public.machine_products
    ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0 NOT NULL;

-- estado: 'active' (visible en web) | 'inactive' (oculto)
ALTER TABLE public.machine_products
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' NOT NULL;

ALTER TABLE public.spare_parts
    ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0 NOT NULL;

ALTER TABLE public.spare_parts
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' NOT NULL;

-- Índices para filtrado por estado
CREATE INDEX IF NOT EXISTS idx_machine_products_status ON public.machine_products(status);
CREATE INDEX IF NOT EXISTS idx_spare_parts_status ON public.spare_parts(status);
