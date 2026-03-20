import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Camera, Upload, Save, Fingerprint } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { startRegistration } from '@simplewebauthn/browser';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const { user, token, updateUser, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 400;
          const MAX_HEIGHT = 400;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            setAvatar(canvas.toDataURL('image/jpeg', 0.8));
          }
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setShowCamera(true);
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("No se pudo acceder a la cámara.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  };

  const takePhoto = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 400;
      const MAX_HEIGHT = 400;
      let width = video.videoWidth;
      let height = video.videoHeight;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(video, 0, 0, width, height);
        setAvatar(canvas.toDataURL('image/jpeg', 0.8));
        stopCamera();
      }
    }
  };

  const handleSave = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name, avatar })
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          return;
        }
        throw new Error(data.error);
      }
      
      updateUser(data.token, data.user);
      onClose();
    } catch (err) {
      console.error(err);
      alert("Error al guardar el perfil");
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterBiometric = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const resOptions = await fetch('/api/auth/generate-registration-options', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const options = await resOptions.json();
      if (!resOptions.ok) {
        if (resOptions.status === 401) {
          logout();
          return;
        }
        throw new Error(options.error || 'Error al obtener opciones');
      }

      const regResp = await startRegistration(options);

      const resVerify = await fetch('/api/auth/verify-registration', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(regResp)
      });
      const verifyData = await resVerify.json();
      if (!resVerify.ok) {
        if (resVerify.status === 401) {
          logout();
          return;
        }
        throw new Error(verifyData.error || 'Error al verificar registro');
      }

      alert('¡Biometría registrada con éxito! Ya puedes iniciar sesión con tu huella o rostro.');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error al registrar biometría');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md relative"
      >
        <button 
          onClick={() => { stopCamera(); onClose(); }}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white"
        >
          <X size={24} />
        </button>

        <h2 className="text-2xl font-bold text-white mb-6">Editar Perfil</h2>

        <div className="flex flex-col items-center mb-6">
          <div className="w-24 h-24 rounded-full bg-zinc-800 border-2 border-emerald-500 overflow-hidden mb-4 flex items-center justify-center">
            {avatar ? (
              <img src={avatar} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="text-4xl text-emerald-500">{name.charAt(0).toUpperCase()}</span>
            )}
          </div>

          <div className="flex gap-3">
            <label className="cursor-pointer bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors">
              <Upload size={16} /> Subir
              <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
            </label>
            <button 
              onClick={showCamera ? stopCamera : startCamera}
              className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors"
            >
              <Camera size={16} /> {showCamera ? 'Cancelar' : 'Cámara'}
            </button>
          </div>
        </div>

        {showCamera && (
          <div className="mb-6 flex flex-col items-center">
            <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg bg-black mb-3" />
            <button 
              onClick={takePhoto}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-4 py-2 rounded-lg text-sm"
            >
              Tomar Foto
            </button>
          </div>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Nombre</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>

        <div className="mb-8">
          <label className="block text-sm font-medium text-zinc-400 mb-2">Seguridad</label>
          <button
            onClick={handleRegisterBiometric}
            disabled={loading}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 border border-white/10"
          >
            <Fingerprint size={20} className="text-emerald-400" /> Activar inicio con Huella / Rostro
          </button>
        </div>

        <button
          onClick={handleSave}
          disabled={loading || !name.trim()}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Save size={20} /> {loading ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </motion.div>
    </div>
  );
}
