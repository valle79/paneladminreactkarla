import { useRef, useState } from 'react';
import { UploadCloud, X, FileText } from 'lucide-react';
import { uploadFile } from '../api';
import { useToast } from './Toast';

export function FileUpload({
  value,
  onChange,
  accept = 'image/*',
  label = 'Arrastra un archivo aquí o haz clic para seleccionarlo',
  hint,
  isImage = true,
}) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const handleFile = async (file) => {
    if (!file) return;
    if (isImage && !file.type.startsWith('image/')) return toast.error('Solo se permiten imágenes');
    if (!isImage && file.type !== 'application/pdf' && !file.type.startsWith('video/'))
      return toast.error('Solo se permiten PDF o video');
    if (file.size > 60 * 1024 * 1024) return toast.error('El archivo supera los 60MB');
    setBusy(true);
    try {
      const url = await uploadFile(file);
      onChange(url);
    } catch (e) {
      toast.error('No se pudo subir el archivo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        className={`upload-zone ${drag ? 'drag' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]); }}
      >
        {busy ? <span className="spinner" /> : isImage ? <UploadCloud size={26} /> : <FileText size={26} />}
        <div>{busy ? 'Subiendo archivo...' : label}</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
      />
      {value && (
        <div className="preview-box">
          {isImage ? (
            <img src={value} alt="vista previa" />
          ) : (
            <span style={{ color: 'var(--danger)' }}><FileText size={30} /></span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="fname">{value.split('/').pop()}</div>
            <div className="fsize">{isImage ? 'Imagen cargada' : 'Archivo cargado'}</div>
          </div>
          <button type="button" className="btn-icon danger" onClick={() => onChange(null)} title="Quitar">
            <X size={15} />
          </button>
        </div>
      )}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}