import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from './server/db.js';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-neon-key-2026';

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });
  const PORT = 3000;

  app.use(express.json());

  // --- Mock Email Service (Ethereal) ---
  // In a real app, you'd use a real SMTP server.
  let transporter: nodemailer.Transporter | null = null;
  nodemailer.createTestAccount((err, account) => {
    if (err) {
      console.error('Failed to create a testing account. ' + err.message);
      return;
    }
    transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    });
  });

  // --- API Routes ---

  // Register
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, email } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: 'El nombre y el correo son obligatorios' });
      }

      const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (existingUser) {
        return res.status(400).json({ error: 'El correo ya está registrado' });
      }

      // Generate a random 6-character password
      const generatedPassword = Math.random().toString(36).slice(-6).toUpperCase();
      const hashedPassword = await bcrypt.hash(generatedPassword, 10);
      const userId = uuidv4();

      db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(
        userId, name, email, hashedPassword
      );

      // Send Email
      let emailPreviewUrl = '';
      if (transporter) {
        const info = await transporter.sendMail({
          from: '"WZChat Admin" <admin@wzchat.com>',
          to: email,
          subject: 'Tu Contraseña de WZChat',
          text: `Hola ${name},\n\n¡Bienvenido a WZChat! Tu contraseña temporal es: ${generatedPassword}\n\nPor favor, úsala para iniciar sesión.`,
          html: `<p>Hola <strong>${name}</strong>,</p><p>¡Bienvenido a WZChat! Tu contraseña temporal es: <strong>${generatedPassword}</strong></p><p>Por favor, úsala para iniciar sesión.</p>`
        });
        emailPreviewUrl = nodemailer.getTestMessageUrl(info) || '';
      }

      res.json({ 
        message: 'Registro exitoso. Revisa tu correo para ver la contraseña.',
        demoPassword: generatedPassword, // For demo purposes, we return it here
        emailPreviewUrl
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Login
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

      if (!user) {
        return res.status(400).json({ error: 'Credenciales inválidas' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Credenciales inválidas' });
      }

      const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
      
      res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Get Users
  app.get('/api/users', (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
      
      const token = authHeader.split(' ')[1];
      jwt.verify(token, JWT_SECRET);

      const users = db.prepare('SELECT id, name, email, is_online FROM users').all();
      res.json(users);
    } catch (error) {
      res.status(401).json({ error: 'No autorizado' });
    }
  });

  // Get Messages between two users
  app.get('/api/messages/:otherUserId', (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
      
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const myId = decoded.id;
      const otherId = req.params.otherUserId;

      const messages = db.prepare(`
        SELECT * FROM messages 
        WHERE (sender_id = ? AND receiver_id = ?) 
           OR (sender_id = ? AND receiver_id = ?)
        ORDER BY created_at ASC
      `).all(myId, otherId, otherId, myId);

      res.json(messages);
    } catch (error) {
      res.status(401).json({ error: 'No autorizado' });
    }
  });

  // --- Socket.io ---
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Error de autenticación'));
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Error de autenticación'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    
    // Mark user as online
    db.prepare('UPDATE users SET is_online = 1 WHERE id = ?').run(userId);
    io.emit('user_status_change', { userId, isOnline: 1 });

    // Join a personal room to receive private messages
    socket.join(userId);

    socket.on('send_message', (data) => {
      const { receiverId, content } = data;
      const messageId = uuidv4();
      
      db.prepare('INSERT INTO messages (id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)').run(
        messageId, userId, receiverId, content
      );

      const message = {
        id: messageId,
        sender_id: userId,
        receiver_id: receiverId,
        content,
        created_at: new Date().toISOString()
      };

      // Send to receiver
      io.to(receiverId).emit('receive_message', message);
      // Send back to sender for confirmation
      socket.emit('receive_message', message);
    });

    socket.on('disconnect', () => {
      db.prepare('UPDATE users SET is_online = 0 WHERE id = ?').run(userId);
      io.emit('user_status_change', { userId, isOnline: 0 });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
