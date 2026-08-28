import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { api, getToken, setToken, clearToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  // Al cargar, si hay token guardado, obtenemos el perfil real desde el backend.
  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async ({ email, password }) => {
    const { data } = await api.post('/auth/login', { email, password });
    setToken(data.token);
    const { data: me } = await api.get('/auth/me');
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const permissions = useMemo(() => new Set(user?.permissions || []), [user]);
  const roles = useMemo(() => (user?.roles || []).map((r) => r.code), [user]);

  const can = useCallback((perm) => permissions.has(perm), [permissions]);
  const hasRole = useCallback((roleCode) => roles.includes(roleCode), [roles]);

  const value = useMemo(
    () => ({
      user,
      roles,
      permissions: Array.from(permissions),
      can,
      hasRole,
      login,
      logout,
      refreshUser,
      loading,
    }),
    [user, roles, permissions, can, hasRole, login, logout, refreshUser, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
