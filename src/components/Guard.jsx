import { useAuth } from '../auth';

/** Renderiza children solo si el usuario tiene TODOS los permisos indicados. */
export function RequirePermission({ permission, fallback = null, children }) {
  const { can } = useAuth();
  if (!can(permission)) return fallback;
  return children;
}

/** Renderiza children si el usuario tiene CUALQUIERA de los permisos. */
export function RequireAnyPermission({ permissions, fallback = null, children }) {
  const { can } = useAuth();
  if (!Array.isArray(permissions)) return children;
  if (!permissions.some((p) => can(p))) return fallback;
  return children;
}

/** Renderiza un children condicional según permiso (para botones). */
export function IfCan({ permission, children }) {
  const { can } = useAuth();
  return can(permission) ? children : null;
}
