-- ============================================================================
--  IQUEÑO SAC - RBAC (Users, Roles, Permissions, Audit)
--  Ejecutar de forma segura e idempotente (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--  Aplicar tras neon_schema.sql para no romper el sistema existente.
-- ============================================================================

-- ==== TABLA: users =========================================================
CREATE TABLE IF NOT EXISTS public.users (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    email           VARCHAR(200) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    active          BOOLEAN DEFAULT true NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    last_login_at   TIMESTAMP WITH TIME ZONE
);

-- ==== TABLA: roles =========================================================
CREATE TABLE IF NOT EXISTS public.roles (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(100) UNIQUE NOT NULL,
    code        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    is_system   BOOLEAN DEFAULT false NOT NULL,
    active      BOOLEAN DEFAULT true NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- ==== TABLA: permissions ===================================================
CREATE TABLE IF NOT EXISTS public.permissions (
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    module      VARCHAR(100)
);

-- ==== TABLA: user_roles (muchos a muchos - preparado para multirol) ========
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id     BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role_id     BIGINT NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

-- ==== TABLA: role_permissions =============================================
CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id         BIGINT NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id   BIGINT NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);

-- ==== TABLA: audit_logs ====================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT,
    user_email  VARCHAR(200),
    action      VARCHAR(100) NOT NULL,
    resource    VARCHAR(100),
    resource_id VARCHAR(100),
    details     TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions(role_id);
