import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from './Icon';
import { useAuth } from '../auth';
import logoElIqueno from '../images/Logo-El-Iqueño.png';

const NAV = [
  { section: 'Principal' },
  { to: '/', end: true, icon: 'dashboard', label: 'Dashboard', section: 'Principal' },
  { section: 'Gestión' },
  { to: '/asesores', icon: 'conference', label: 'Asesores' },
  { to: '/productos', icon: 'tractor', label: 'Productos' },
  { to: '/repuestos', icon: 'wrench', label: 'Repuestos' },
  { to: '/servicios', icon: 'money-bag', label: 'Servicios' },
  { to: '/clientes', icon: 'user-male-circle', label: 'Clientes' },
  { to: '/promociones', icon: 'price-tag', label: 'Promociones' },
  { to: '/ventas', icon: 'shopping-cart', label: 'Ventas' },
];

const TITLES = {
  '/': 'Dashboard',
  '/asesores': 'Gestión de Asesores',
  '/productos': 'Gestión de Productos',
  '/repuestos': 'Gestión de Repuestos',
  '/servicios': 'Gestión de Servicios',
  '/clientes': 'Gestión de Clientes',
  '/promociones': 'Gestión de Promociones',
  '/ventas': 'Gestión de Ventas',
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const title = TITLES[pathname] || 'Panel Administrativo';

  const today = new Date().toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="layout">
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <img src={logoElIqueno} alt="El Iqueño" className="sidebar-logo" />
          <span>
            <b>Iqueño SAC</b>
            <small>Fabricaciones & Servicios</small>
          </span>
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', paddingBottom: 10 }}>
          {NAV.map((item, i) =>
            item.section && !item.to ? (
              <div key={i} className="nav-section">{item.section}</div>
            ) : item.to ? (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </NavLink>
            ) : null
          )}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user">
            <span className="avatar">A</span>
            <span style={{ minWidth: 0 }}>
              <b>{user?.name || 'Administrador'}</b>
              <small>Panel de control</small>
            </span>
            <button className="btn-icon" style={{ marginLeft: 'auto', borderColor: 'rgba(255,255,255,0.15)', color: '#c8dfd0' }} onClick={logout} title="Cerrar sesión">
              <Icon name="exit" size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn-icon menu-btn" onClick={() => setOpen(true)} title="Abrir menú" aria-label="Abrir menú">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" style={{ display: 'block' }}>
              <path d="M3.5 6.5h17" />
              <path d="M6.5 12h11" />
              <path d="M5.5 17.5h13" />
            </svg>
          </button>
          <div className="crumb">
            <b>{title}</b>
          </div>
          <span style={{ flex: 1 }} />
          <span className="date-chip">
            <Icon name="calendar" size={14} /> {today}
          </span>

        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}