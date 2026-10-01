-- ============================================================================
--  IQUEÑO SAC - Cola de sincronización Neon -> Supabase
--  EJECUTAR EN NEON (SQL Editor)  ·  Idempotente
--
--  ¿POR QUÉ?
--  Si una escritura en Supabase falla (red caída, timeout, indisponibilidad),
--  el cambio YA está guardado en Neon y la petición al usuario debe responder
--  igual. Para no perder nada en silencio, el intento fallido se guarda aquí y
--  un hilo del backend lo reintenta periódicamente hasta que funcione.
--
--  Así Neon es siempre la fuente de verdad y Supabase termina convergiendo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supabase_sync_queue (
    id           BIGSERIAL PRIMARY KEY,
    table_name   VARCHAR(50)  NOT NULL,
    row_id       VARCHAR(100) NOT NULL,
    op           VARCHAR(10)  NOT NULL DEFAULT 'upsert',  -- 'upsert' | 'delete'
    payload      JSONB,
    attempts     INTEGER      NOT NULL DEFAULT 0,
    last_error   TEXT,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
    ON public.supabase_sync_queue (created_at)
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sync_queue_target
    ON public.supabase_sync_queue (table_name, row_id);


-- ============================================================================
--  VERIFICACIÓN
-- ============================================================================
-- SELECT count(*) FROM public.supabase_sync_queue WHERE resolved_at IS NULL;