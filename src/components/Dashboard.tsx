import React, { useState, useEffect, useRef } from 'react';
import { useAuth, User } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, Bot, User as UserIcon, Send, Sparkles, MessageSquare, Settings, Paperclip, X, File as FileIcon, ArrowLeft } from 'lucide-react';
import ProfileModal from './ProfileModal';

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  created_at: string;
}

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const { socket, onlineUsers } = useSocket();
  const [users, setUsers] = useState<User[]>([]);
  const [activeChat, setActiveChat] = useState<User | 'ai' | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ url: string, name: string, type: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token) {
      fetchUsers();
      subscribeToPush();
    }
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted' && token) {
          subscribeToPush();
        }
      });
    }
  }, [token]);

  const subscribeToPush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
        const response = await fetch('/api/push/vapid-public-key');
        const vapidPublicKey = await response.text();
        const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey
        });
      }

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(subscription)
      });
    } catch (error) {
      console.error('Error subscribing to push notifications:', error);
    }
  };

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  useEffect(() => {
    if (socket) {
      socket.on('receive_message', (msg: Message) => {
        const isCurrentChat = (activeChat !== 'ai' && activeChat?.id === msg.sender_id) ||
                              (user?.id === msg.sender_id && activeChat !== 'ai' && activeChat?.id === msg.receiver_id);
        
        if (isCurrentChat) {
          setMessages(prev => [...prev, msg]);
        }
      });

      socket.on('user_status_change', ({ userId, isOnline }) => {
        setUsers(prev => {
          const newUsers = prev.map(u => u.id === userId ? { ...u, is_online: isOnline } : u);
          if (activeChat !== 'ai' && activeChat?.id === userId) {
            setActiveChat(newUsers.find(u => u.id === userId) || null);
          }
          return newUsers;
        });
      });

      return () => {
        socket.off('receive_message');
        socket.off('user_status_change');
      };
    }
  }, [socket, activeChat, user, users]);

  useEffect(() => {
    if (activeChat && activeChat !== 'ai') {
      fetchMessages(activeChat.id);
    } else if (activeChat === 'ai') {
      setMessages([]);
    }
  }, [activeChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchUsers = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          return;
        }
        throw new Error(data.error || 'Failed to fetch users');
      }
      setUsers(data.filter((u: User) => u.id !== user?.id));
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMessages = async (otherUserId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/messages/${otherUserId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          return;
        }
        throw new Error(data.error || 'Failed to fetch messages');
      }
      setMessages(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        alert("El archivo es demasiado grande. El límite es 10MB.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedFile({
          url: reader.result as string,
          name: file.name,
          type: file.type
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !selectedFile) || !activeChat || !token) return;

    const content = input;
    const fileData = selectedFile;
    
    setInput('');
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (activeChat === 'ai') {
      const aiMsg: Message = {
        id: Date.now().toString(),
        sender_id: user!.id,
        receiver_id: 'ai',
        content,
        file_url: fileData?.url,
        file_name: fileData?.name,
        file_type: fileData?.type,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMsg]);
      setLoading(true);

      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ message: content, file: fileData })
        });
        
        if (!res.ok) {
          if (res.status === 401) {
            logout();
            return;
          }
          throw new Error('Error en la respuesta de la IA');
        }
        const data = await res.json();
        
        const replyMsg: Message = {
          id: (Date.now() + 1).toString(),
          sender_id: 'ai',
          receiver_id: user!.id,
          content: data.reply || 'Sin respuesta',
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, replyMsg]);

        if (!document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('WZChat AI', {
            body: data.reply || 'Sin respuesta',
            icon: '/vite.svg'
          });
        }
      } catch (err) {
        console.error(err);
        const errorMsg: Message = {
          id: (Date.now() + 1).toString(),
          sender_id: 'ai',
          receiver_id: user!.id,
          content: 'Hubo un error al conectar con la IA. Por favor, intenta de nuevo.',
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, errorMsg]);
      } finally {
        setLoading(false);
      }
    } else {
      socket?.emit('send_message', {
        receiverId: activeChat.id,
        content,
        fileUrl: fileData?.url,
        fileName: fileData?.name,
        fileType: fileData?.type
      });
    }
  };

  return (
    <div className="flex h-screen bg-black text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <div className={`w-full md:w-80 border-r border-white/10 bg-zinc-950 flex-col shrink-0 ${activeChat ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsProfileOpen(true)}
              className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center border border-white/10 overflow-hidden hover:border-emerald-500/50 transition-colors"
            >
              {user?.avatar ? (
                <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon size={20} className="text-zinc-400" />
              )}
            </button>
            <div>
              <h2 className="font-semibold text-white truncate max-w-[120px]">{user?.name}</h2>
              <p className="text-xs text-zinc-500 truncate max-w-[120px]">{user?.email}</p>
            </div>
          </div>
          <button onClick={logout} className="text-zinc-500 hover:text-red-400 transition-colors" title="Cerrar sesión">
            <LogOut size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <button
            onClick={() => setActiveChat('ai')}
            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
              activeChat === 'ai' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'hover:bg-white/5 text-zinc-400'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Bot size={20} />
            </div>
            <div className="flex-1 text-left">
              <h3 className="font-medium">WZ AI</h3>
              <p className="text-xs opacity-70">Asistente Gemini</p>
            </div>
            <Sparkles size={16} className="opacity-50" />
          </button>

          <div className="pt-4 pb-2 px-2 text-xs font-semibold text-zinc-600 uppercase tracking-wider">
            Mensajes Directos
          </div>

          {users.map(u => (
            <button
              key={u.id}
              onClick={() => setActiveChat(u)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                activeChat !== 'ai' && activeChat?.id === u.id ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-zinc-400'
              }`}
            >
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
                  {u.avatar ? (
                    <img src={u.avatar} alt={u.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    u.name.charAt(0).toUpperCase()
                  )}
                </div>
                {u.is_online === 1 && (
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-zinc-950"></div>
                )}
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-medium">{u.name}</h3>
                <p className="text-xs opacity-70 truncate">{u.email}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`flex-1 flex-col bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-zinc-900/20 via-black to-black ${!activeChat ? 'hidden md:flex' : 'flex'}`}>
        {activeChat ? (
          <>
            <div className="h-20 border-b border-white/10 flex items-center px-4 md:px-8 bg-zinc-950/50 backdrop-blur-md">
              <div className="flex items-center gap-3 md:gap-4">
                <button 
                  onClick={() => setActiveChat(null)}
                  className="md:hidden p-2 -ml-2 text-zinc-400 hover:text-white transition-colors"
                >
                  <ArrowLeft size={24} />
                </button>
                {activeChat === 'ai' ? (
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                    <Bot size={24} />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-xl font-medium overflow-hidden">
                    {activeChat.avatar ? (
                      <img src={activeChat.avatar} alt={activeChat.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      activeChat.name.charAt(0).toUpperCase()
                    )}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {activeChat === 'ai' ? 'WZ AI' : activeChat.name}
                  </h2>
                  <p className="text-sm text-zinc-500">
                    {activeChat === 'ai' ? 'Impulsado por Gemini 3.1 Pro' : (activeChat.is_online === 1 ? 'En línea' : 'Desconectado')}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
              {messages.map((msg, i) => {
                const isMe = msg.sender_id === user?.id;
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={msg.id || i}
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 md:px-5 ${
                      isMe 
                        ? 'bg-emerald-500 text-black rounded-tr-sm' 
                        : 'bg-zinc-900 border border-white/10 text-zinc-100 rounded-tl-sm'
                    }`}>
                      {msg.file_url && (
                        <div className="mb-2">
                          {msg.file_type?.startsWith('image/') ? (
                            <img src={msg.file_url} alt={msg.file_name || 'Imagen adjunta'} className="max-w-full rounded-lg max-h-64 object-contain" />
                          ) : (
                            <a href={msg.file_url} download={msg.file_name} className={`flex items-center gap-2 p-3 rounded-lg ${isMe ? 'bg-emerald-600/30 hover:bg-emerald-600/50' : 'bg-zinc-800 hover:bg-zinc-700'} transition-colors`}>
                              <FileIcon size={20} />
                              <span className="text-sm truncate max-w-[200px]">{msg.file_name}</span>
                            </a>
                          )}
                        </div>
                      )}
                      {msg.content && <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>}
                      <span className={`text-[10px] mt-2 block ${isMe ? 'text-emerald-900/60' : 'text-zinc-500'}`}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-900 border border-white/10 rounded-2xl rounded-tl-sm px-5 py-4 flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 md:p-6 bg-zinc-950/50 backdrop-blur-md border-t border-white/10">
              {selectedFile && (
                <div className="mb-4 flex items-center gap-3 bg-zinc-900 border border-white/10 p-3 rounded-xl max-w-sm">
                  {selectedFile.type.startsWith('image/') ? (
                    <img src={selectedFile.url} alt="Preview" className="w-12 h-12 rounded object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-zinc-800 flex items-center justify-center">
                      <FileIcon size={24} className="text-emerald-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{selectedFile.name}</p>
                    <p className="text-xs text-zinc-500">Archivo adjunto</p>
                  </div>
                  <button 
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-zinc-400 hover:text-red-400"
                  >
                    <X size={20} />
                  </button>
                </div>
              )}
              <form onSubmit={handleSend} className="flex items-center gap-2 md:gap-4 max-w-4xl mx-auto">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileSelect} 
                  className="hidden" 
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-12 h-12 md:w-14 md:h-14 shrink-0 rounded-full bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition-all"
                >
                  <Paperclip size={20} />
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Escribe un mensaje..."
                  className="flex-1 bg-zinc-900 border border-white/10 rounded-full px-4 md:px-6 py-3 md:py-4 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all min-w-0"
                />
                <button
                  type="submit"
                  disabled={(!input.trim() && !selectedFile) || loading}
                  className="w-12 h-12 md:w-14 md:h-14 shrink-0 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black flex items-center justify-center transition-all disabled:opacity-50 disabled:hover:bg-emerald-500"
                >
                  <Send size={20} className="ml-1" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500">
            <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6 border border-white/10">
              <MessageSquare size={40} className="opacity-50" />
            </div>
            <h2 className="text-xl font-medium text-white mb-2">Bienvenido a WZChat</h2>
            <p>Selecciona un usuario o IA para empezar a chatear</p>
          </div>
        )}
      </div>
      {/* Profile Modal */}
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
    </div>
  );
}
