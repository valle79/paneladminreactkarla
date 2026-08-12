# 📄 Paginación Implementada

## 🎯 Resumen

Se ha implementado **paginación** tanto en el backend (Python/FastAPI) como en el frontend (React) para mejorar el rendimiento de carga de datos en todos los módulos principales del sistema.

---

## 🔧 Backend (FastAPI + PostgreSQL)

### Funciones Helper

Se agregaron dos funciones helper en `backend/main.py`:

```python
def paginate_query(base_query: str, page: int = 1, limit: int = 50, order_by: str = "id"):
    """Genera consulta paginada y calcula offset."""
    page = max(1, page)
    limit = min(max(1, limit), 100)  # Máximo 100 por página
    offset = (page - 1) * limit
    paginated = f"{base_query} ORDER BY {order_by} LIMIT {limit} OFFSET {offset}"
    return paginated, offset, limit

def get_total_count(table: str, where_clause: str = ""):
    """Obtiene el conteo total de registros."""
    wh = f"WHERE {where_clause}" if where_clause else ""
    row = db.fetch_one(f"SELECT COUNT(*)::int as total FROM {table} {wh}")
    return row["total"]
```

### Clase `SoftDeleteMixin` Actualizada

El método `list()` ahora retorna:

```python
{
    "items": [...],  # Lista de registros
    "pagination": {
        "page": 1,
        "limit": 50,
        "total": 250,
        "total_pages": 5
    }
}
```

### Endpoints Actualizados

Todos los endpoints de listado ahora aceptan parámetros de paginación:

- **`GET /api/advisors?page=1&limit=50`**
- **`GET /api/products?page=1&limit=50`**
- **`GET /api/spare-parts?page=1&limit=50`**
- **`GET /api/services?page=1&limit=50`**
- **`GET /api/clients?page=1&limit=50`**
- **`GET /api/clients-ruc?page=1&limit=50`**
- **`GET /api/promotions?page=1&limit=50`**
- **`GET /api/sales?page=1&limit=50`**

### Parámetros Query

| Parámetro | Tipo | Por Defecto | Descripción |
|-----------|------|-------------|-------------|
| `page` | int | 1 | Número de página |
| `limit` | int | 50 | Registros por página (máx: 100) |
| `include_deleted` | bool | false | Incluir registros eliminados |

---

## ⚛️ Frontend (React)

### Componente `Pagination`

Ubicación: `src/components/Pagination.jsx`

```jsx
<Pagination
  currentPage={1}
  totalPages={5}
  totalItems={250}
  limit={50}
  onPageChange={(page) => setPage(page)}
/>
```

#### Props

| Prop | Tipo | Descripción |
|------|------|-------------|
| `currentPage` | number | Página actual |
| `totalPages` | number | Total de páginas |
| `totalItems` | number | Total de registros |
| `limit` | number | Registros por página |
| `onPageChange` | function | Callback al cambiar página |

### Características del Componente

✅ **Navegación intuitiva**: Botones prev/next + números de página  
✅ **Ellipsis inteligente**: Muestra "..." cuando hay muchas páginas  
✅ **Responsive**: Se adapta a diferentes cantidades de páginas  
✅ **Info de registros**: "Mostrando 1 - 50 de 250 registros"  
✅ **Página activa destacada**: Visual claro de la página actual

### Ejemplo de Implementación

```jsx
import { Pagination } from '../components/Pagination';

function ClientsPage() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  const load = () => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString()
    });
    api.get(`/clients?${params}`).then((r) => setData(r.data));
  };

  useEffect(() => { load(); }, [page]);

  const rows = data?.items || [];
  const pagination = data?.pagination;

  return (
    <>
      <table>
        {/* ... */}
      </table>
      
      {pagination && pagination.total_pages > 1 && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.total_pages}
          totalItems={pagination.total}
          limit={pagination.limit}
          onPageChange={setPage}
        />
      )}
    </>
  );
}
```

---

## 🎨 Estilos CSS

Los estilos de paginación se agregaron a `src/styles/global.css`:

```css
.pagination { /* Contenedor principal */ }
.pagination-info { /* "Mostrando X - Y de Z registros" */ }
.pagination-controls { /* Botones de navegación */ }
.pagination-btn { /* Botón individual */ }
.pagination-btn.active { /* Página activa */ }
.pagination-ellipsis { /* "..." */ }
```

---

## ✅ Módulos Actualizados

Los siguientes módulos ya tienen paginación implementada:

| Módulo | Backend | Frontend | Estado |
|--------|---------|----------|--------|
| Asesores | ✅ | ⏳ Pendiente | Funcional en backend |
| Productos | ✅ | ⏳ Pendiente | Funcional en backend |
| Repuestos | ✅ | ⏳ Pendiente | Funcional en backend |
| Servicios | ✅ | ⏳ Pendiente | Funcional en backend |
| **Clientes DNI** | ✅ | ✅ | **Completado** |
| **Clientes RUC** | ✅ | ✅ | **Completado** |
| Promociones | ✅ | ⏳ Pendiente | Funcional en backend |
| Ventas | ✅ | ⏳ Pendiente | Funcional en backend |

---

## 🚀 Beneficios

### Rendimiento
- ⚡ **Carga inicial más rápida**: Solo se cargan 50 registros en lugar de todos
- 💾 **Menor consumo de memoria**: Datos manejables en el frontend
- 🔄 **Queries SQL optimizadas**: Uso de LIMIT y OFFSET

### Experiencia de Usuario
- 📱 **Mejor UX**: Navegación clara entre páginas
- 🎯 **Información contextual**: Contador de registros totales
- ⏱️ **Respuesta inmediata**: Cambios de página instantáneos

### Escalabilidad
- 📈 **Soporta grandes volúmenes**: Miles de registros sin problemas
- 🔧 **Configurable**: Límite ajustable por módulo
- 🛡️ **Protección**: Límite máximo de 100 registros por página

---

## 📝 Tareas Pendientes

Para completar la implementación en todos los módulos:

1. ✅ Clientes (DNI y RUC) - **Completado**
2. ⏳ Productos (Galería)
3. ⏳ Repuestos
4. ⏳ Servicios
5. ⏳ Asesores
6. ⏳ Promociones
7. ⏳ Ventas

### Template para Implementar

```jsx
// 1. Importar componente
import { Pagination } from '../components/Pagination';

// 2. Agregar estados
const [data, setData] = useState(null);
const [page, setPage] = useState(1);
const [limit] = useState(50);

// 3. Actualizar función load
const load = () => {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString()
  });
  api.get(`/endpoint?${params}`).then((r) => setData(r.data));
};

// 4. Actualizar useEffect
useEffect(() => { load(); }, [page]);

// 5. Extraer datos
const rows = data?.items || [];
const pagination = data?.pagination;

// 6. Agregar componente en JSX
{pagination && pagination.total_pages > 1 && (
  <Pagination
    currentPage={pagination.page}
    totalPages={pagination.total_pages}
    totalItems={pagination.total}
    limit={pagination.limit}
    onPageChange={setPage}
  />
)}
```

---

## 🔍 Testing

### Verificar Backend

```bash
# Con curl
curl "http://localhost:8000/api/clients?page=1&limit=10"

# Respuesta esperada
{
  "items": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 250,
    "total_pages": 25
  }
}
```

### Verificar Frontend

1. Abrir módulo de Clientes
2. Verificar que aparezca el componente de paginación
3. Navegar entre páginas
4. Verificar contador de registros
5. Cambiar filtros y verificar reset de página

---

## 📚 Referencias

- [FastAPI Query Parameters](https://fastapi.tiangolo.com/tutorial/query-params/)
- [PostgreSQL LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html)
- [React useState Hook](https://react.dev/reference/react/useState)
- [React useEffect Hook](https://react.dev/reference/react/useEffect)

---

**Implementado por:** Sistema de mejoras de rendimiento  
**Fecha:** Diciembre 2024  
**Versión:** 1.0.0
