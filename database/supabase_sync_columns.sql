-- ============================================================================
--  IQUEÑO SAC - stock / status en Supabase (migración)
--  INSTALAR EN SUPABASE: SQL Editor -> New query -> Pegar -> Run
--
--  QUÉ HACE
--  Añade a Supabase las columnas `stock` y `status` que ya existen en Neon
--  para machine_products y spare_parts, y actualiza las funciones de
--  sincronización para que también se repliquen.
--
--  POR QUÉ
--  Sin estas columnas, ocultar un producto con status='inactive' en este panel
--  NO lo ocultaba en la web: la web solo podía mirar `deleted`.
--
--  ES IDEMPOTENTE: se puede volver a ejecutar sin romper nada.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Columnas nuevas
-- ----------------------------------------------------------------------------
ALTER TABLE public.machine_products
    ADD COLUMN IF NOT EXISTS stock  INTEGER      DEFAULT 0      NOT NULL,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' NOT NULL;

ALTER TABLE public.spare_parts
    ADD COLUMN IF NOT EXISTS stock  INTEGER      DEFAULT 0      NOT NULL,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' NOT NULL;

CREATE INDEX IF NOT EXISTS idx_machine_products_status ON public.machine_products(status);
CREATE INDEX IF NOT EXISTS idx_spare_parts_status     ON public.spare_parts(status);


-- ----------------------------------------------------------------------------
-- 2) Funciones de sincronización actualizadas (ahora incluyen stock/status)
--    Deben ir DESPUÉS del ALTER de arriba.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_machine_products(p_id bigint, p_row jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.machine_products AS t
        (id, name, description, image_url, pdf_url,
         specifications, features, dimensions, price, stock, status, deleted, created_at)
    VALUES (
        p_id,
        COALESCE(p_row->>'name', ''),
        p_row->>'description',
        COALESCE(p_row->>'image_url', ''),
        p_row->>'pdf_url',
        public.sync_text_to_jsonb(p_row->>'specifications'),
        public.sync_text_to_jsonb(p_row->>'features'),
        public.sync_text_to_jsonb(p_row->>'dimensions'),
        COALESCE(NULLIF(btrim(p_row->>'price'), '')::numeric, 0),
        COALESCE(NULLIF(p_row->>'stock', '')::integer, 0),
        CASE WHEN p_row->>'status' IN ('active', 'inactive')
             THEN p_row->>'status' ELSE 'active' END,
        COALESCE((p_row->>'deleted')::boolean, false),
        COALESCE((p_row->>'created_at')::timestamptz, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        name          = EXCLUDED.name,
        description   = EXCLUDED.description,
        image_url     = EXCLUDED.image_url,
        pdf_url       = EXCLUDED.pdf_url,
        specifications = EXCLUDED.specifications,
        features      = EXCLUDED.features,
        dimensions    = EXCLUDED.dimensions,
        price         = EXCLUDED.price,
        stock         = EXCLUDED.stock,
        status        = EXCLUDED.status,
        deleted       = EXCLUDED.deleted,
        created_at    = EXCLUDED.created_at;

    PERFORM setval(
        pg_get_serial_sequence('public.machine_products', 'id'),
        COALESCE((SELECT max(id) FROM public.machine_products), 0) + 1,
        false
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.sync_spare_parts(p_id bigint, p_row jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.spare_parts AS t
        (id, name, description, image_url, pdf_url,
         specifications, features, price, stock, status, deleted, created_at)
    VALUES (
        p_id,
        COALESCE(p_row->>'name', ''),
        p_row->>'description',
        p_row->>'image_url',
        p_row->>'pdf_url',
        public.sync_text_to_jsonb(p_row->>'specifications'),
        public.sync_text_to_jsonb(p_row->>'features'),
        NULLIF(btrim(p_row->>'price'), ''),
        COALESCE(NULLIF(p_row->>'stock', '')::integer, 0),
        CASE WHEN p_row->>'status' IN ('active', 'inactive')
             THEN p_row->>'status' ELSE 'active' END,
        COALESCE((p_row->>'deleted')::boolean, false),
        COALESCE((p_row->>'created_at')::timestamptz, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        name          = EXCLUDED.name,
        description   = EXCLUDED.description,
        image_url     = EXCLUDED.image_url,
        pdf_url       = EXCLUDED.pdf_url,
        specifications = EXCLUDED.specifications,
        features      = EXCLUDED.features,
        price         = EXCLUDED.price,
        stock         = EXCLUDED.stock,
        status        = EXCLUDED.status,
        deleted       = EXCLUDED.deleted,
        created_at    = EXCLUDED.created_at;

    PERFORM setval(
        pg_get_serial_sequence('public.spare_parts', 'id'),
        COALESCE((SELECT max(id) FROM public.spare_parts), 0) + 1,
        false
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 3) Permisos (se mantienen solo para service_role)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.sync_machine_products(bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_spare_parts(bigint, jsonb)     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_machine_products(bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_spare_parts(bigint, jsonb)     TO service_role;


-- ----------------------------------------------------------------------------
-- 4) VERIFICACIÓN
--    Tras ejecutar esto, corre en el backend:  python supabase_sync.py --resync
--    para copiar el stock/status actual de Neon hacia Supabase.
-- ----------------------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name IN ('machine_products','spare_parts') AND column_name IN ('stock','status');