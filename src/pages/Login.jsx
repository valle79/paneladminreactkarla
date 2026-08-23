import { useState } from 'react';
import Icon from '../components/Icon';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { errMsg } from '../api';

import logoElIqueno from '../images/Logo-El-Iqueño.png';
import iqueñoImage from '../images/iqueñov2.png';

const FEATURES = [
  'Cultivadoras',
  'Cosechadoras',
  'Repuestos',
  'Asesoría técnica',
];

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();

  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();

    if (!password.trim()) {
      setError('Ingresa la contraseña del panel');
      return;
    }

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

      {/* =====================================================
          MITAD IZQUIERDA - IMAGEN
      ====================================================== */}
      <div className="login-media">
        <img
          src={iqueñoImage}
          alt="Campo agrícola"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />

        <div className="login-media-veil" />

        <div className="login-media-content">
          <span className="login-media-bar" />

          <h2>
            El respaldo que su <b>campo</b> necesita
          </h2>

          <p>
            Fabricaciones y servicios agrícolas que impulsan su producción,
            con repuestos originales y asesoría técnica especializada.
          </p>

          <div className="login-media-chips">
            {FEATURES.map((feature) => (
              <span key={feature}>
                {feature}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* =====================================================
          MITAD DERECHA - FORMULARIO
      ====================================================== */}
      <div className="login-form-side">
        <div className="login-form-wrap">

          {/* =================================================
              LOGO / MARCA
          ================================================== */}
          <div className="login-brand">
            <img
              src={logoElIqueno}
              alt="El Iqueño SAC"
              className="login-brand-logo"
            />

            <div>
              <h1>EL IQUEÑO SAC</h1>
              <p>Panel de gestión</p>
            </div>
          </div>

          {/* =================================================
              TÍTULO
          ================================================== */}
          <h2 className="login-title">
            Bienvenido de nuevo
          </h2>

          <p className="login-sub">
            Ingresa la contraseña para acceder al sistema.
          </p>

          {/* =================================================
              ERROR
          ================================================== */}
          {error && (
            <div className="login-error" role="alert">
              <Icon
                name="high-priority"
                size={16}
              />

              <span>{error}</span>
            </div>
          )}

          {/* =================================================
              BADGES DE SEGURIDAD
          ================================================== */}
          <div className="login-badges">
            <span>
              <Icon
                name="security-checked"
                size={13}
              />
              Acceso seguro
            </span>

            <span>
              <Icon
                name="user-male-circle"
                size={13}
              />
              Solo personal autorizado
            </span>
          </div>

          {/* =================================================
              FORMULARIO
          ================================================== */}
          <form onSubmit={submit}>

            {/* =================================================
                CONTRASEÑA
            ================================================== */}
            <div className="field">
              <label htmlFor="password">
                Contraseña
              </label>

              <div className="input-icon">
                <Icon
                  name="lock"
                  size={16}
                />

                <input
                  id="password"
                  className="input"
                  type={show ? 'text' : 'password'}
                  placeholder="Ingresa tu contraseña"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);

                    if (error) {
                      setError('');
                    }
                  }}
                  autoFocus
                  autoComplete="current-password"
                  disabled={busy}
                />

                <button
                  type="button"
                  className="input-action"
                  onClick={() => setShow((prev) => !prev)}
                  title={
                    show
                      ? 'Ocultar contraseña'
                      : 'Mostrar contraseña'
                  }
                  aria-label={
                    show
                      ? 'Ocultar contraseña'
                      : 'Mostrar contraseña'
                  }
                  disabled={busy}
                >
                  {show ? (
                    <Icon
                      name="hide"
                      size={16}
                    />
                  ) : (
                    <Icon
                      name="visible"
                      size={16}
                    />
                  )}
                </button>
              </div>
            </div>

            {/* =================================================
                BOTÓN LOGIN
            ================================================== */}
            <button
              className="btn btn-primary btn-lg w-full"
              type="submit"
              disabled={busy}
              style={{
                justifyContent: 'center',
              }}
            >
              {busy ? (
                <span className="spinner" />
              ) : (
                <Icon
                  name="security-checked"
                  size={17}
                />
              )}

              {busy
                ? 'Ingresando...'
                : 'Ingresar al panel'
              }

              {!busy && (
                <Icon
                  name="arrow"
                  size={16}
                />
              )}
            </button>
          </form>

          {/* =================================================
              FOOTER
          ================================================== */}
          <div className="login-foot">
            © {new Date().getFullYear()} Fabricaciones &amp;
            Servicios El Iqueño SAC · Todos los derechos reservados
          </div>

        </div>
      </div>

    </div>
  );
}