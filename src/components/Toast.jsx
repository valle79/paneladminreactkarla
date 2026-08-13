import { useState, createContext, useContext, useCallback, useRef } from 'react';
import Icon from './Icon';

const ToastContext = createContext(null);

let uid = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const push = useCallback((type, message) => {
    const id = ++uid;
    setToasts((t) => [...t, { id, type, message, leaving: false }]);
    timers.current[id] = setTimeout(() => dismiss(id), 3800);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      clearTimeout(timers.current[id]);
    }, 260);
  }, []);

  const toast = useCallback(
    {
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      warning: (m) => push('warning', m),
      info: (m) => push('info', m),
    },
    [push]
  );

  const icons = {
    success: <Icon name="checkmark--v1" size={19} style={{ color: '#29a744' }} />,
    error: <Icon name="cancel" size={19} style={{ color: '#dc3545' }} />,
    warning: <Icon name="high-priority" size={19} style={{ color: '#e0a800' }} />,
    info: <Icon name="info" size={19} style={{ color: '#1e88e5' }} />,
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type} ${t.leaving ? 'leaving' : ''}`}>
            {icons[t.type]}
            <span>{t.message}</span>
            <button className="close-x" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}