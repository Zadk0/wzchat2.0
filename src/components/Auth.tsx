import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { motion } from 'motion/react';
import { MessageSquare, ArrowRight, UserPlus, LogIn, Fingerprint, ScanFace } from 'lucide-react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isLogin) {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');
        login(data.token, data.user);
      } else {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al registrarse');
        
        // Try to register biometrics automatically
        try {
          const resOptions = await fetch('/api/auth/generate-registration-options', {
            headers: { Authorization: `Bearer ${data.token}` }
          });
          const options = await resOptions.json();
          if (resOptions.ok) {
            const regResp = await startRegistration(options);
            await fetch('/api/auth/verify-registration', {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                Authorization: `Bearer ${data.token}` 
              },
              body: JSON.stringify(regResp)
            });
          }
        } catch (bioErr) {
          console.error("Biometric registration skipped or failed:", bioErr);
        }

        // Login after biometric attempt
        login(data.token, data.user);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (!email) {
      setError('Ingresa tu correo primero para usar biometría');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const resOptions = await fetch('/api/auth/generate-authentication-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const options = await resOptions.json();
      if (!resOptions.ok) throw new Error(options.error || 'Error al obtener opciones');

      const authResp = await startAuthentication(options);

      const resVerify = await fetch('/api/auth/verify-authentication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, response: authResp })
      });
      const verifyData = await resVerify.json();
      if (!resVerify.ok) throw new Error(verifyData.error || 'Error al verificar biometría');

      login(verifyData.token, verifyData.user);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error en autenticación biométrica');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-black to-black"></div>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 mb-6 border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
            <MessageSquare size={32} />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">WZChat</h1>
          <p className="text-zinc-400">Conéctate con otros y con IA en tiempo real.</p>
        </div>

        <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/5 p-8 rounded-3xl shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Nombre</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
                  placeholder="Juan Pérez"
                />
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Correo electrónico</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
                placeholder="juan@ejemplo.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Contraseña</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
                placeholder="••••••"
              />
            </div>

            {error && <div className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">{error}</div>}
            {message && <div className="text-emerald-400 text-sm bg-emerald-400/10 p-3 rounded-lg border border-emerald-400/20 whitespace-pre-line">{message}</div>}

            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? 'Procesando...' : isLogin ? (
                  <><LogIn size={20} /> Iniciar Sesión</>
                ) : (
                  <><UserPlus size={20} /> Registrarse</>
                )}
              </button>

              {isLogin && (
                <button
                  type="button"
                  onClick={handleBiometricLogin}
                  disabled={loading}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 border border-white/10"
                >
                  <Fingerprint size={20} /> <ScanFace size={20} /> Iniciar con Huella / Face ID
                </button>
              )}
            </div>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
                setMessage('');
              }}
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              {isLogin ? "¿No tienes una cuenta? Regístrate" : "¿Ya tienes una cuenta? Inicia Sesión"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
