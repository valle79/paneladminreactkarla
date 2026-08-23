import { createContext, useContext, useState, useCallback } from 'react';
import { api, getToken, setToken, clearToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() =>
    getToken() ? { name: 'Administrador' } : null
  );

  const login = useCallback(async (password) => {
    const { data } = await api.post('/auth/login', {
      password,
    });

    setToken(data.token);
    setUser(data.user);

    return data;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}