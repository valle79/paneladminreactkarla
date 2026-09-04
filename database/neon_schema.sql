-- ============================================================================
--  IQUEÑO SAC - Fabricaciones & Servicios El Iqueño
--  SCRIPT COMPLETO DE BASE DE DATOS PARA NEON (PostgreSQL)
--  Ejecutar en el SQL Editor de Neon
-- ============================================================================

-- Extensiones necesarias (pgcrypto para gen_random_uuid, pg_trgm para búsquedas)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- TABLA: promotions (Promociones)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.promotions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    subtitle VARCHAR(200),
    features TEXT NOT NULL,
    image_url TEXT,
    valid_until VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    show_in_web BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    media_type VARCHAR(10) DEFAULT 'image',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT check_media_type CHECK (media_type IN ('image', 'video'))
);

CREATE INDEX IF NOT EXISTS idx_promotions_is_active ON public.promotions(is_active);
CREATE INDEX IF NOT EXISTS idx_promotions_show_in_web ON public.promotions(show_in_web);
CREATE INDEX IF NOT EXISTS idx_promotions_display_order ON public.promotions(display_order);
CREATE INDEX IF NOT EXISTS idx_promotions_created_at ON public.promotions(created_at DESC);

-- ============================================================================
-- TABLA: advisors (Asesores)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.advisors (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    position VARCHAR(200),
    whatsapp VARCHAR(50),
    specialties TEXT,
    image_url TEXT,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_advisors_deleted ON public.advisors(deleted);
CREATE INDEX IF NOT EXISTS idx_advisors_created_at ON public.advisors(created_at DESC);

-- ============================================================================
-- TABLA: machine_products (Productos / Maquinarias - Galería)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.machine_products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    image_url TEXT,
    pdf_url TEXT,
    specifications TEXT,
    features TEXT,
    dimensions TEXT,
    price NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_machine_products_deleted ON public.machine_products(deleted);
CREATE INDEX IF NOT EXISTS idx_machine_products_created_at ON public.machine_products(created_at DESC);

-- ============================================================================
-- TABLA: spare_parts (Repuestos)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.spare_parts (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    image_url TEXT,
    pdf_url TEXT,
    specifications TEXT,
    features TEXT,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spare_parts_deleted ON public.spare_parts(deleted);
CREATE INDEX IF NOT EXISTS idx_spare_parts_created_at ON public.spare_parts(created_at DESC);

-- ============================================================================
-- TABLA: services (Servicios)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.services (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    price NUMERIC(12, 2) DEFAULT 0 NOT NULL,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_services_deleted ON public.services(deleted);

-- ============================================================================
-- TABLA: clients (Clientes DNI / Persona Natural)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.clients (
    id BIGSERIAL PRIMARY KEY,
    dni VARCHAR(8),
    names VARCHAR(200) NOT NULL,
    last_names VARCHAR(200),
    address TEXT,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_deleted ON public.clients(deleted);
CREATE INDEX IF NOT EXISTS idx_clients_dni ON public.clients(dni);

-- ============================================================================
-- TABLA: clients_ruc (Clientes Empresa)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.clients_ruc (
    id BIGSERIAL PRIMARY KEY,
    ruc VARCHAR(11),
    razonsocial VARCHAR(300) NOT NULL,
    nombrecomercial VARCHAR(200),
    telefonos TEXT[],
    estado VARCHAR(50),
    condicion VARCHAR(50),
    direccion TEXT,
    departamento VARCHAR(100),
    provincia VARCHAR(100),
    distrito VARCHAR(100),
    ubigeo VARCHAR(10),
    via_tipo VARCHAR(20),
    via_nombre VARCHAR(200),
    zona_codigo VARCHAR(20),
    zona_tipo VARCHAR(200),
    numero VARCHAR(20),
    interior VARCHAR(20),
    lote VARCHAR(20),
    dpto VARCHAR(20),
    manzana VARCHAR(20),
    kilometro VARCHAR(20),
    es_agente_retencion BOOLEAN DEFAULT false,
    es_buen_contribuyente BOOLEAN DEFAULT false,
    locales_anexos TEXT,
    capital NUMERIC(12, 2),
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.clients_ruc
    ADD COLUMN IF NOT EXISTS via_tipo VARCHAR(20),
    ADD COLUMN IF NOT EXISTS via_nombre VARCHAR(200),
    ADD COLUMN IF NOT EXISTS zona_codigo VARCHAR(20),
    ADD COLUMN IF NOT EXISTS zona_tipo VARCHAR(200),
    ADD COLUMN IF NOT EXISTS numero VARCHAR(20),
    ADD COLUMN IF NOT EXISTS interior VARCHAR(20),
    ADD COLUMN IF NOT EXISTS lote VARCHAR(20),
    ADD COLUMN IF NOT EXISTS dpto VARCHAR(20),
    ADD COLUMN IF NOT EXISTS manzana VARCHAR(20),
    ADD COLUMN IF NOT EXISTS kilometro VARCHAR(20),
    ADD COLUMN IF NOT EXISTS es_agente_retencion BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS es_buen_contribuyente BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS locales_anexos TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_ruc_deleted ON public.clients_ruc(deleted);
CREATE INDEX IF NOT EXISTS idx_clients_ruc_ruc ON public.clients_ruc(ruc);

-- ============================================================================
-- TABLA: sales (Ventas)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sales (
    id BIGSERIAL PRIMARY KEY,
    client_id BIGINT,
    client_type VARCHAR(10),
    advisor_id BIGINT,
    with_igv BOOLEAN DEFAULT false,
    subtotal NUMERIC(14, 2) DEFAULT 0 NOT NULL,
    igv NUMERIC(14, 2) DEFAULT 0 NOT NULL,
    total NUMERIC(14, 2) DEFAULT 0 NOT NULL,
    invoice_type VARCHAR(20),
    invoice_number BIGINT,
    payment_status VARCHAR(20) DEFAULT 'por_pagar',
    payment_description TEXT,
    payment_date DATE,
    amount_paid NUMERIC(14, 2),
    amount_pending NUMERIC(14, 2),
    pending_payment_date DATE,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_deleted ON public.sales(deleted);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON public.sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoice ON public.sales(invoice_type, invoice_number);

ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14, 2) DEFAULT 0 NOT NULL;

-- ============================================================================
-- TABLA: sale_items (Detalle de ventas)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sale_items (
    id BIGSERIAL PRIMARY KEY,
    sale_id BIGINT NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    item_type VARCHAR(20),
    item_id BIGINT,
    manual_name VARCHAR(200),
    manual_description TEXT,
    overrides TEXT,
    quantity NUMERIC(12, 2) DEFAULT 1 NOT NULL,
    unit_price NUMERIC(12, 2) DEFAULT 0 NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);

ALTER TABLE public.sale_items
    ADD COLUMN IF NOT EXISTS overrides TEXT;

-- ============================================================================
-- FUNCIÓN + TRIGGER: actualizar updated_at automáticamente
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.promotions;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.promotions
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- DATOS INICIALES (opcional: comenta si no quieres data de ejemplo)
-- ============================================================================

-- Asesores de ejemplo
INSERT INTO public.advisors (name, position, whatsapp, specialties) VALUES
    ('Juan Carlos Pérez', 'Técnico Agrícola', '987654321', '["Maquinaria","Tractores"]'),
    ('María Fernández', 'Asesora de Ventas', '912345678', '["Ventas","Servicio al Cliente"]'),
    ('Roberto Quispe', 'Ingeniero de Proyectos', '923456789', '["Proyectos Especiales","Agricultura"]')
ON CONFLICT DO NOTHING;

-- Productos de ejemplo
INSERT INTO public.machine_products (name, description, price, specifications, features, dimensions) VALUES
    ('Cultivadora 3000', 'Máquina para preparación de suelos, ideal para cultivos intensivos', 25000.00,
     '[{"label":"Potencia","value":"100 HP"},{"label":"Ancho de trabajo","value":"3 m"}]',
     '["Alta durabilidad","Fácil mantenimiento"]',
     '{"width":300,"height":120,"depth":80,"weight":900}'),
    ('Cadena Transportadora', 'Cadena acerada SAE 1045 para cosechadora de papa', 8000.00,
     '[{"label":"Material","value":"SAE 1045"},{"label":"Modelos","value":"Cajón 65, 70, 75 y 79cm"}]',
     '["Tecnología de punta para tu campo"]',
     '{"width":79,"height":10,"depth":5,"weight":25}')
ON CONFLICT DO NOTHING;

-- Repuestos de ejemplo
INSERT INTO public.spare_parts (name, description, price, specifications, features) VALUES
    ('Rodamiento 6205', 'Rodamiento de alta resistencia para maquinaria agrícola', 45.50,
     '[{"label":"Marca","value":"SKF"},{"label":"Medida","value":"25x52x15 mm"}]',
     '["Alta resistencia","Larga vida útil"]'),
    ('Filtro de aire', 'Filtro de aire para tractores serie 40', 78.00,
     '[{"label":"Compatibilidad","value":"Tractores serie 40"}]',
     '["Filtración eficiente"]')
ON CONFLICT DO NOTHING;

-- Servicios de ejemplo
INSERT INTO public.services (name, price) VALUES
    ('Mantenimiento Preventivo', 350.00),
    ('Reparación de Motores', 950.00),
    ('Instalación y Calibración', 420.00)
ON CONFLICT DO NOTHING;

-- Clientes de ejemplo (DNI)
INSERT INTO public.clients (dni, names, last_names, address) VALUES
    ('45678912', 'Carlos', 'Huamán Torres', 'Av. Los Andes 123, Huancayo'),
    ('98765432', 'Lucía', 'Ramírez Díaz', 'Jr. Grau 456, Jauja')
ON CONFLICT DO NOTHING;

-- Clientes de ejemplo (RUC)
INSERT INTO public.clients_ruc (ruc, razonsocial, nombrecomercial, telefonos, departamento, provincia, distrito) VALUES
    ('20601234567', 'Agroindustrias Andinas S.A.C.', 'AgroAndes', ARRAY['964123456','064123456'], 'Junín', 'Huancayo', 'El Tambo'),
    ('20512345678', 'Maquinarias del Centro E.I.R.L.', 'Maquicentro', ARRAY['981234567'], 'Junín', 'Jauja', 'Jauja')
ON CONFLICT DO NOTHING;

-- Promoción de ejemplo
INSERT INTO public.promotions (title, subtitle, features, valid_until, is_active, show_in_web, display_order) VALUES
    ('Cadena Transportadora', 'Nueva Presentación 2026',
     'Aprovecha esta oferta exclusiva en nuestra Cadena transportadora acerada SAE 1045 para cosechadora de papa para modelos con cajón 65, 70, 75 y 79cm. Tecnología de punta para tu campo.',
     '30 de Abril del 2026', true, true, 1)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFICACIÓN: listar tablas creadas
-- ============================================================================
SELECT
    tablename AS tabla,
    obj_description(('public.' || tablename)::regclass) AS descripcion
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;