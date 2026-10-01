-- ============================================================================
--  IQUEÑO SAC - Sincronización Neon -> Supabase (escrituras duales)
--  INSTALAR EN SUPABASE: SQL Editor -> New query -> Pegar -> Run
--
--  QUÉ HACE ESTO
--  El backend (FastAPI + Neon) replica aquí cada alta/edición/baja de
--  productos, repuestos, asesoría y promociones para que el otro panel
--  (Supabase, sin backend) y la web pública vean los mismos datos.
--
--  POR QUÉ FUNCIONES Y NO UN INSERT DIRECTO
--  1) Las columnas JSON son jsonb en Supabase y text en Neon: se castean aquí.
--  2) spare_parts.price es TEXT en Supabase y NUMERIC en Neon.
--  3) Supabase exige NOT NULL en columnas que Neon permite nulas: se rellenan.
--  4) CRÍTICO: al insertar un `id` explícito en una columna bigserial, la
--     secuencia de Supabase NO avanza. Sin esto, el próximo producto creado
--     desde el otro panel elegiría un id repetido y fallaría por PK duplicada.
--     Cada función deja la secuencia en max(id)+1.
--
--  SEGURIDAD
--  Se revoca el permiso al público/anon/authenticated y se concede solo a
--  service_role, que es la única clave que usa el backend.
--
--  Es idempotente: se puede volver a ejecutar sin romper nada.
--
--  IMPORTANTE: después de este script hay que correr también
--  database/supabase_sync_columns.sql, que agrega las columnas stock/status y
--  reemplaza estas dos funciones para que las repliquen.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Helper: convierte el texto JSON de Neon a jsonb, sin fallar si viene nulo o
-- con contenido inválido (devuelve NULL en ese caso en lugar de abortar).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_text_to_jsonb(txt text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF txt IS NULL OR btrim(txt) = '' THEN
        RETURN NULL;
    END IF;
    RETURN txt::jsonb;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;


-- ----------------------------------------------------------------------------
-- machine_products  (productos / maquinaria)
--   jsonb: specifications, features, dimensions
--   Nota: stock/status NO se replican en esta versión; los agrega
--   database/supabase_sync_columns.sql (que reemplaza esta función).
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
         specifications, features, dimensions, price, deleted, created_at)
    VALUES (
        p_id,
        COALESCE(p_row->>'name', ''),
        p_row->>'description',
        COALESCE(p_row->>'image_url', ''),   -- NOT NULL en Supabase
        p_row->>'pdf_url',
        public.sync_text_to_jsonb(p_row->>'specifications'),
        public.sync_text_to_jsonb(p_row->>'features'),
        public.sync_text_to_jsonb(p_row->>'dimensions'),
        COALESCE(NULLIF(btrim(p_row->>'price'), '')::numeric, 0),
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
        deleted       = EXCLUDED.deleted,
        created_at    = EXCLUDED.created_at;

    -- Mantiene la secuencia por delante de max(id) (ver nota 4 de la cabecera).
    PERFORM setval(
        pg_get_serial_sequence('public.machine_products', 'id'),
        COALESCE((SELECT max(id) FROM public.machine_products), 0) + 1,
        false
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- spare_parts  (repuestos)
--   OJO: aquí `price` es TEXT, no numeric.
--   stock/status se agregan en database/supabase_sync_columns.sql.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_spare_parts(p_id bigint, p_row jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.spare_parts AS t
        (id, name, description, image_url, pdf_url,
         specifications, features, price, deleted, created_at)
    VALUES (
        p_id,
        COALESCE(p_row->>'name', ''),
        p_row->>'description',
        p_row->>'image_url',
        p_row->>'pdf_url',
        public.sync_text_to_jsonb(p_row->>'specifications'),
        public.sync_text_to_jsonb(p_row->>'features'),
        NULLIF(btrim(p_row->>'price'), ''),
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
-- advisors  (asesores)
--   jsonb: specialties. position / image_url / whatsapp son NOT NULL aquí.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_advisors(p_id bigint, p_row jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.advisors AS t
        (id, name, position, image_url, whatsapp, specialties, deleted, created_at)
    VALUES (
        p_id,
        COALESCE(p_row->>'name', ''),
        COALESCE(p_row->>'position', ''),
        COALESCE(p_row->>'image_url', ''),
        COALESCE(p_row->>'whatsapp', ''),
        COALESCE(public.sync_text_to_jsonb(p_row->>'specialties'), '[]'::jsonb),
        COALESCE((p_row->>'deleted')::boolean, false),
        COALESCE((p_row->>'created_at')::timestamptz, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        name       = EXCLUDED.name,
        position   = EXCLUDED.position,
        image_url  = EXCLUDED.image_url,
        whatsapp   = EXCLUDED.whatsapp,
        specialties = EXCLUDED.specialties,
        deleted    = EXCLUDED.deleted,
        created_at = EXCLUDED.created_at;

    PERFORM setval(
        pg_get_serial_sequence('public.advisors', 'id'),
        COALESCE((SELECT max(id) FROM public.advisors), 0) + 1,
        false
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- promotions  (promociones)
--   id uuid. No tiene columna `deleted`: en Neon el borrado es físico, así que
--   la eliminación se replica con sync_delete_promotion().
--   No lleva setval porque el id lo genera gen_random_uuid().
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_promotions(p_id uuid, p_row jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.promotions AS t
        (id, title, subtitle, features, image_url, valid_until,
         is_active, show_in_web, display_order, media_type, created_at, updated_at)
    VALUES (
        p_id,
        COALESCE(p_row->>'title', ''),
        p_row->>'subtitle',
        COALESCE(p_row->>'features', ''),
        p_row->>'image_url',
        COALESCE(p_row->>'valid_until', ''),
        COALESCE((p_row->>'is_active')::boolean, true),
        COALESCE((p_row->>'show_in_web')::boolean, false),
        COALESCE(NULLIF(p_row->>'display_order', '')::integer, 0),
        COALESCE(NULLIF(p_row->>'media_type', ''), 'image'),
        COALESCE((p_row->>'created_at')::timestamptz, now()),
        COALESCE((p_row->>'updated_at')::timestamptz, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        title         = EXCLUDED.title,
        subtitle      = EXCLUDED.subtitle,
        features      = EXCLUDED.features,
        image_url     = EXCLUDED.image_url,
        valid_until   = EXCLUDED.valid_until,
        is_active     = EXCLUDED.is_active,
        show_in_web   = EXCLUDED.show_in_web,
        display_order = EXCLUDED.display_order,
        media_type    = EXCLUDED.media_type,
        created_at    = EXCLUDED.created_at,
        updated_at    = EXCLUDED.updated_at;
END;
$$;


-- ----------------------------------------------------------------------------
-- Borrado físico de promociones (refleja el DELETE de Neon).
-- Devuelve true si había fila que borrar.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_delete_promotion(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted boolean;
BEGIN
    DELETE FROM public.promotions WHERE id = p_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted > 0;
END;
$$;


-- ----------------------------------------------------------------------------
-- Comprobación de instalación: el backend la llama para verificar que todo está
-- en su sitio y comparar el número de filas con Neon.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN jsonb_build_object(
        'version',                '1.0',
        'advisors',               (SELECT count(*) FROM public.advisors),
        'advisors_max_id',        (SELECT COALESCE(max(id), 0) FROM public.advisors),
        'machine_products',       (SELECT count(*) FROM public.machine_products),
        'machine_products_max_id',(SELECT COALESCE(max(id), 0) FROM public.machine_products),
        'spare_parts',            (SELECT count(*) FROM public.spare_parts),
        'spare_parts_max_id',     (SELECT COALESCE(max(id), 0) FROM public.spare_parts),
        'promotions',             (SELECT count(*) FROM public.promotions)
    );
END;
$$;


-- ============================================================================
-- PERMISOS: solo service_role (la clave del backend) puede ejecutar esto.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.sync_text_to_jsonb(text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_machine_products(bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_spare_parts(bigint, jsonb)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_advisors(bigint, jsonb)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_promotions(uuid, jsonb)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_delete_promotion(uuid)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_status()                      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_text_to_jsonb(text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_machine_products(bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_spare_parts(bigint, jsonb)     TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_advisors(bigint, jsonb)         TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_promotions(uuid, jsonb)         TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_delete_promotion(uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_status()                        TO service_role;


-- ============================================================================
-- VERIFICACIÓN (ejecutar al final para confirmar que quedó instalado)
-- ============================================================================
-- SELECT public.sync_status();