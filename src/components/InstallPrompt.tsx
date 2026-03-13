import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X } from 'lucide-react';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
      // Update UI notify the user they can install the PWA
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    
    // Show the install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setShowPrompt(false);
    }
    
    // We've used the prompt, and can't use it again, throw it away
    setDeferredPrompt(null);
  };

  if (!showPrompt) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 50, opacity: 0 }}
        className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-zinc-900 border border-emerald-500/30 shadow-2xl shadow-emerald-900/20 rounded-2xl p-4 z-50 flex items-start gap-4"
      >
        <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
          <Download size={24} />
        </div>
        <div className="flex-1">
          <h3 className="text-white font-medium mb-1">Instalar WZChat</h3>
          <p className="text-sm text-zinc-400 mb-3">Instala nuestra app en tu dispositivo para un acceso más rápido y mejor experiencia.</p>
          <div className="flex gap-2">
            <button
              onClick={handleInstall}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Instalar
            </button>
            <button
              onClick={() => setShowPrompt(false)}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
        <button onClick={() => setShowPrompt(false)} className="text-zinc-500 hover:text-white">
          <X size={16} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
