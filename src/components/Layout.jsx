import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Tractor, Wrench, ClipboardList, UserRound, Tags,
  ShoppingCart, LogOut, Menu, CalendarDays, Leaf, BadgeDollarSign, Tractor as TractorIcon,
} from 'lucide-react';
import { useAuth } from '../auth';

const NAV = [
  { section: 'Principal' },
  { to: '/', end: true, icon: LayoutDashboard, label: 'Dashboard', section: 'Principal' },
  { section: 'Gestión' },
  { to: '/asesores', icon: Users, label: 'Asesores' },
  { to: '/productos', icon: Tractor, label: 'Productos' },
  { to: '/repuestos', icon: Wrench, label: 'Repuestos' },
  { to: '/servicios', icon: BadgeDollarSign, label: 'Servicios' },
  { to: '/clientes', icon: UserRound, label: 'Clientes' },
  { to: '/promociones', icon: Tags, label: 'Promociones' },
  { to: '/ventas', icon: ShoppingCart, label: 'Ventas' },
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
          <span className="logo"><TractorIcon size={24} /></span>
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
                <item.icon size={18} />
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
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn-icon menu-btn" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="crumb">
            <b>{title}</b>
          </div>
          <span style={{ flex: 1 }} />
          <span className="date-chip">
            <CalendarDays size={14} /> {today}
          </span>
          <span className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Leaf size={12} /> El Iqueño SAC
          </span>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}