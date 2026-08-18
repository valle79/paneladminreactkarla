import { useState } from 'react';
import Icon from '../components/Icon';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { errMsg } from '../api';
import logoElIqueno from '../images/Logo-El-Iqueño.png';
import iqueñoImage from '../images/iqueñov2.png';

const IMG = iqueñoImage;
const IMG_FALLBACK = iqueñoImage;

const FEATURES = ['Cultivadoras', 'Cosechadoras', 'Repuestos', 'Asesoría técnica'];

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!password.trim()) return setError('Ingresa la contraseña del panel');
    setError('');
    setBusy(true);
    try {
      await login(password);
      toast.success('Bienvenido al panel administrativo');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-split">
      {/* Mitad izquierda: imagen */}
      <div className="login-media">
        <img src={IMG} onError={(e) => { e.target.src = IMG_FALLBACK; }} alt="Campo agrícola" />
        <div className="login-media-veil" />
        <div className="login-media-content">

        </div>
      </div>

      {/* Mitad derecha: formulario */}
      <div className="login-form-side">
        <div className="login-form-wrap">
          <div className="login-brand">
            <img src={logoElIqueno} alt="El Iqueño SAC" className="login-brand-logo" />
            <div>
              <h1>EL IQUEÑO SAC</h1>
              <p>Panel de gestión</p>
            </div>
          </div>

          <h2 className="login-title">Bienvenido de nuevo</h2>
          <p className="login-sub">Ingresa la contraseña para acceder al sistema.</p>

          {error && (
            <div className="login-error" role="alert">
              <Icon name="high-priority" size={16} /> {error}
            </div>
          )}

          <form onSubmit={submit}>
            <div className="field">
              <label> Ingresa tu contraseña</label>
              <div className="input-icon">
                <Icon name="lock" size={16} />
                <input
                  className="input"
                  type={show ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-action"
                  onClick={() => setShow(!show)}
                  title={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {show ? <Icon name="hide" size={16} /> : <Icon name="visible" size={16} />}
                </button>
              </div>
            </div>

            <button className="btn btn-primary btn-lg w-full" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
              {busy ? <span className="spinner" /> : <Icon name="security-checked" size={17} />}
              Ingresar al panel
              {!busy && <Icon name="arrow" size={16} />}
            </button>
          </form>

          <div className="login-foot">
            © {new Date().getFullYear()} Fabricaciones & Servicios El Iqueño SAC · Todos los derechos reservados
          </div>
        </div>
      </div>
    </div>
  );
}