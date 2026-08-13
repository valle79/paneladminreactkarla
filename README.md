# Iqueño SAC · Panel Administrativo (React + FastAPI + Neon)

Panel administrativo moderno para **Fabricaciones & Servicios El Iqueño SAC**, con React, backend Python (FastAPI) y base de datos PostgreSQL en **Neon**.

Colores corporativos: **verde** 🟢 y **amarillo tractor** 🟡.

## Estructura

```
iqueñoreact/
├── database/
│   └── neon_schema.sql        ← Script SQL completo para Neon (ejecutar UNA vez)
├── backend/                   ← API Python (FastAPI)
│   ├── main.py                ← Endpoints CRUD de todos los módulos
│   ├── db.py                  ← Pool de conexiones a Neon
│   ├── auth.py                ← Login con token firmado
│   ├── uploads/               ← Imágenes, PDFs y videos (se crea solo)
│   ├── .env                   ← TU conexión a Neon + contraseña del panel
│   └── requirements.txt
├── src/                       ← Frontend React (Vite)
│   ├── pages/                 ← Dashboard, Asesores, Productos, Repuestos,
│   │                            Servicios, Clientes, Promociones, Ventas
│   └── components/            ← Layout, modales, toasts, subidas de archivos
├── iniciar-backend.bat        ← Arranca la API en http://localhost:8000
├── iniciar-frontend.bat       ← Arranca el panel en http://localhost:5173
```

## 1) Configurar la base de datos en Neon (una sola vez)

1. Crea el proyecto en [console.neon.tech](https://console.neon.tech).
2. Abre el **SQL Editor** de tu base y pega TODO el contenido de
   `database\neon_schema.sql` y ejecútalo.
   Crea las 9 tablas (`promotions`, `advisors`, `machine_products`, `spare_parts`,
   `services`, `clients`, `clients_ruc`, `sales`, `sale_items`) + datos de ejemplo.
3. En Neon, copia la cadena de conexión (pestaña **Connection Details**).

## 2) Configurar el backend

1. Copia `backend\.env.example` → `backend\.env`.
2. Pega tu cadena de conexión de Neon en `DATABASE_URL`.
3. Cambia `AUTH_PASSWORD` (es la contraseña del panel) y `AUTH_SECRET`.

```env
DATABASE_URL=postgresql://user:password@ep-xxxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
AUTH_PASSWORD=tu-contraseña-del-panel
AUTH_SECRET=cambia-este-secreto
PORT=8000
```

## 3) Arrancar

| Paso | Comando | URL |
|---|---|---|
| 1. Backend | `iniciar-backend.bat` (crea venv e instala dependencias la primera vez) | http://localhost:8000/docs |
| 2. Frontend | `iniciar-frontend.bat` | http://localhost:5173 |

> El panel te pedirá la contraseña definida en `AUTH_PASSWORD`.

## Funcionalidades

- **Dashboard**: estadísticas, ventas por mes (gráfico) y últimas ventas.
- **Asesores / Productos / Repuestos / Servicios / Clientes (DNI y RUC) / Promociones / Ventas**: CRUD completo.
- **Ventas**: boleta, factura, proforma y cotización; IGV 18%, estados de pago (pagado / por pagar / a cuenta), numeración automática para proforma y cotización, items de productos, repuestos, servicios o manuales.
- **Subidas de archivos**: imágenes, PDF (fichas técnicas) y videos, guardados en `backend/uploads/`.
- **Eliminación suave** con restauración (los registros no se borran físicamente, salvo promociones).
- Diseño responsive, modo móvil con menú lateral deslizante.

## API (resumen)

```
POST   /api/auth/login           → { token }
GET    /api/stats                → indicadores del dashboard
GET/POST/PUT/DELETE  /api/advisors · /api/products · /api/spare-parts
GET/POST/PUT/DELETE  /api/services · /api/clients · /api/clients-ruc
GET/POST/PUT/DELETE  /api/promotions
GET/POST/PUT/DELETE  /api/sales          (incluye items y nombres resueltos)
POST   /api/upload               → { url }  (imagen / pdf / video)
```

Todas las rutas (excepto login y health) requieren el header `Authorization: Bearer <token>`.
Documentación interactiva: http://localhost:8000/docs

## Despliegue

### Backend (Render)
1. Crea la cuenta en render.com → **New → Web Service** → conécta el repo GitHub `valle79/paneladminreactkarla` (rama `develop`).
2. En **Root Directory** pon `backend` (el `Dockerfile` está en `backend/Dockerfile`; Render lo detecta solo).
3. Échale un nombre (ej. `iqueno-backend`), región e **Instance Type**: Free (o Starter si quieres que nunca duerma).
4. En **Environment** agrega: `DATABASE_URL`, `AUTH_PASSWORD`, `AUTH_SECRET`, `DECOLECTA_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (PORT lo asigna Render automáticamente).
5. **Health Check Path**: `/api/health`.
6. **Create Web Service**. Render re-despliega automáticamente con cada push a `develop`.
7. Para migrar archivos locales a Cloudinary: `python backend/migrate_uploads.py`.

### Frontend (Netlify)
Configura la variable `VITE_API_URL` con la URL de la API de Render y haz build desde la raíz del proyecto.

## Notas

- El proyecto NO modifica nada de `panelAdminIqueno`; usa las mismas tablas y columnas, así que si algún día vuelves a Supabase, los datos son compatibles.
- `promotions.features` es texto libre; `specialties`, `specifications`, `features` y `dimensions` se guardan como JSON en texto (igual que en el panel original).
