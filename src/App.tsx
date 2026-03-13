import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import InstallPrompt from './components/InstallPrompt';

function AppContent() {
  const { user } = useAuth();
  return (
    <>
      {user ? <Dashboard /> : <Auth />}
      <InstallPrompt />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <AppContent />
      </SocketProvider>
    </AuthProvider>
  );
}

