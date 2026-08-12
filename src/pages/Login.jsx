import { useState } from 'react';
import { Tractor, Lock, ShieldCheck, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { errMsg } from '../api';

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!password.trim()) return toast.warning('Ingresa la contraseña del panel');
    setBusy(true);
    try {
      await login(password);
      toast.success('Bienvenido al panel administrativo');
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <Tractor size={36} />
        </div>
        <h1>Panel Administrativo</h1>
        <div className="tagline">Fabricaciones & Servicios <b style={{ color: 'var(--g-dark)' }}>El Iqueño SAC</b></div>

        <div className="field">
          <label><Lock size={14} /> Contraseña de acceso</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type={show ? 'text' : 'password'}
              placeholder="Ingresa la contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              className="btn-icon"
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent' }}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button className="btn btn-primary btn-lg w-full" type="submit" disabled={busy} style={{ justifyContent: 'center', marginTop: 6 }}>
          {busy ? <span className="spinner" /> : <ShieldCheck size={18} />}
          Ingresar al panel
          {!busy && <ArrowRight size={17} />}
        </button>

        <div className="login-foot">
          © {new Date().getFullYear()} Fabricaciones & Servicios El Iqueño SAC · Todos los derechos reservados
        </div>
      </form>
    </div>
  );
}