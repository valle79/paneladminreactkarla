import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import { RequirePermission } from './components/Guard';
import { Loader } from './components/ui';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Advisors = lazy(() => import('./pages/Advisors'));
const Products = lazy(() => import('./pages/Products'));
const SpareParts = lazy(() => import('./pages/SpareParts'));
const Services = lazy(() => import('./pages/Services'));
const Clients = lazy(() => import('./pages/Clients'));
const Promotions = lazy(() => import('./pages/Promotions'));
const Sales = lazy(() => import('./pages/Sales'));
const Users = lazy(() => import('./pages/Users'));
const Roles = lazy(() => import('./pages/Roles'));
const DocView = lazy(() => import('./pages/DocView'));

const NoAccess = () => (
  <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>
    <h2 style={{ color: 'var(--danger, #c0392b)' }}>Sin acceso</h2>
    <p>No tienes permisos para ver este módulo.</p>
  </div>
);

function Shell() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Suspense fallback={<Loader text="Cargando..." />}>
        <Routes>
          <Route path="/" element={<RequirePermission permission="DASHBOARD_VIEW" fallback={<NoAccess />}><Dashboard /></RequirePermission>} />
          <Route path="/asesores" element={<RequirePermission permission="ADVISORS_VIEW" fallback={<NoAccess />}><Advisors /></RequirePermission>} />
          <Route path="/productos" element={<RequirePermission permission="PRODUCTS_VIEW" fallback={<NoAccess />}><Products /></RequirePermission>} />
          <Route path="/repuestos" element={<RequirePermission permission="SPARE_PARTS_VIEW" fallback={<NoAccess />}><SpareParts /></RequirePermission>} />
          <Route path="/servicios" element={<RequirePermission permission="SERVICES_VIEW" fallback={<NoAccess />}><Services /></RequirePermission>} />
          <Route path="/clientes" element={<RequirePermission permission="CLIENTS_VIEW" fallback={<NoAccess />}><Clients /></RequirePermission>} />
          <Route path="/promociones" element={<RequirePermission permission="PROMOTIONS_VIEW" fallback={<NoAccess />}><Promotions /></RequirePermission>} />
          <Route path="/ventas" element={<RequirePermission permission="SALES_VIEW" fallback={<NoAccess />}><Sales /></RequirePermission>} />
          <Route path="/usuarios" element={<RequirePermission permission="USERS_VIEW" fallback={<NoAccess />}><Users /></RequirePermission>} />
          <Route path="/roles" element={<RequirePermission permission="ROLES_VIEW" fallback={<NoAccess />}><Roles /></RequirePermission>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <Loader text="Verificando sesión..." />;
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

function RootGuard() {
  const { user, loading } = useAuth();
  if (loading) return <Loader text="Verificando sesión..." />;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Suspense fallback={<Loader text="Cargando..." />}><Gate /></Suspense>} />
          <Route path="/doc/:saleId/:token" element={<Suspense fallback={<Loader text="Cargando..." />}><DocView /></Suspense>} />
          <Route path="/*" element={<Suspense fallback={<Loader text="Cargando..." />}><RootGuard /></Suspense>} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
