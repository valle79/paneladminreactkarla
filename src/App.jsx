import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
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
const DocView = lazy(() => import('./pages/DocView'));

function Shell() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Suspense fallback={<Loader text="Cargando..." />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/asesores" element={<Advisors />} />
          <Route path="/productos" element={<Products />} />
          <Route path="/repuestos" element={<SpareParts />} />
          <Route path="/servicios" element={<Services />} />
          <Route path="/clientes" element={<Clients />} />
          <Route path="/promociones" element={<Promotions />} />
          <Route path="/ventas" element={<Sales />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Suspense fallback={<Loader text="Cargando..." />}><Gate /></Suspense>} />
          <Route path="/doc/:saleId/:token" element={<Suspense fallback={<Loader text="Cargando..." />}><DocView /></Suspense>} />
          <Route path="/*" element={<Shell />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}