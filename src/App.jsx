import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Advisors from './pages/Advisors';
import Products from './pages/Products';
import SpareParts from './pages/SpareParts';
import Services from './pages/Services';
import Clients from './pages/Clients';
import Promotions from './pages/Promotions';
import Sales from './pages/Sales';
import DocView from './pages/DocView';

function Shell() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout>
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
          <Route path="/login" element={<Gate />} />
          <Route path="/doc/:saleId/:token" element={<DocView />} />
          <Route path="/*" element={<Shell />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}