import axios from 'axios';

const TOKEN_KEY = 'iqueno_token';

export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function errMsg(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg || '').filter(Boolean).join('. ');
  if (d && typeof d === 'object') return d.msg || d.message || JSON.stringify(d);
  if (err?.response?.data && typeof err.response.data === 'string') return err.response.data;
  return err?.message || 'Ocurrió un error inesperado';
}

const fileApi = axios.create({ baseURL: '' });

export async function uploadFile(file) {
  const token = localStorage.getItem(TOKEN_KEY);
  const fd = new FormData();
  fd.append('file', file);
  const res = await axios.post(`${API_URL}/api/upload`, fd, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.url;
}

export function assetUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_URL}${path}`;
}

export { fileApi };