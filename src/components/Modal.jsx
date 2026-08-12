import { X, Check, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

export function Modal({ open, onClose, title, icon, children, footer, size = '' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size}`}>
        <div className="modal-head">
          <h3 className="flex">
            {icon}
            {title}
          </h3>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmText = 'Eliminar', loading }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      icon={<AlertTriangle size={18} />}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? <span className="spinner" /> : <Check size={15} />} {confirmText}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>{message}</p>
    </Modal>
  );
}

export function useConfirm() {
  const [state, setState] = useState({ open: false, title: '', message: '', onYes: null, confirmText: 'Eliminar', loading: false });

  const ask = (opts) =>
    new Promise((resolve) => {
      setState({ open: true, ...opts, onYes: resolve });
    });

  const close = () => setState((s) => ({ ...s, open: false }));

  const ConfirmDialog = (
    <ConfirmModal
      open={state.open}
      onClose={close}
      title={state.title || 'Confirmar acción'}
      message={state.message}
      confirmText={state.confirmText}
      onConfirm={async () => {
        setState((s) => ({ ...s, loading: true }));
        try {
          await state.onYes?.();
          close();
        } finally {
          setState((s) => ({ ...s, loading: false }));
        }
      }}
    />
  );

  return { ask, ConfirmDialog };
}