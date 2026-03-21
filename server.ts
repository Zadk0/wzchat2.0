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
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

import { GoogleGenAI } from '@google/genai';
import webpush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-neon-key-2026';

// --- Web Push Setup ---
let vapidKeys = {
  publicKey: '',
  privateKey: ''
};

try {
  const existingKeys = db.prepare('SELECT * FROM settings WHERE key = ?').get('vapid_keys') as any;
  if (existingKeys) {
    vapidKeys = JSON.parse(existingKeys.value);
  } else {
    vapidKeys = webpush.generateVAPIDKeys();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('vapid_keys', JSON.stringify(vapidKeys));
  }
} catch (e) {
  console.error("Error setting up VAPID keys", e);
}

webpush.setVapidDetails(
  'mailto:test@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    maxHttpBufferSize: 1e7 // 10MB
  });
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

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
      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'El nombre, correo y contraseña son obligatorios' });
      }

      const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (existingUser) {
        return res.status(400).json({ error: 'El correo ya está registrado' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const userId = uuidv4();

      db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(
        userId, name, email, hashedPassword
      );

      const token = jwt.sign({ id: userId, name, email }, JWT_SECRET, { expiresIn: '7d' });

      res.status(201).json({ 
        message: 'Registro exitoso.',
        token,
        user: { id: userId, name, email, avatar: null }
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
      
      res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // --- WebAuthn (Passkeys) ---
  const rpName = 'WZChat';

  // 1. Generate Registration Options
  app.get('/api/auth/generate-registration-options', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
      const token = authHeader.split(' ')[1];
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET) as any;
      } catch (err) {
        return res.status(401).json({ error: 'No autorizado' });
      }
      const userId = decoded.id;

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
      if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

      // Get existing authenticators
      const userAuthenticators = db.prepare('SELECT credential_id FROM authenticators WHERE user_id = ?').all(userId) as any[];

      const expectedOrigin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : 'http://localhost:3000');
      const rpID = new URL(expectedOrigin).hostname;

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: new Uint8Array(Buffer.from(user.id)),
        userName: user.email,
        userDisplayName: user.name,
        // Don't prompt users for their authenticator if they already registered it
        excludeCredentials: userAuthenticators.map(auth => ({
          id: auth.credential_id,
          type: 'public-key',
        })),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      });

      // Save challenge to user
      db.prepare('UPDATE users SET current_challenge = ? WHERE id = ?').run(options.challenge, userId);

      res.json(options);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al generar opciones de registro' });
    }
  });

  // 2. Verify Registration
  app.post('/api/auth/verify-registration', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
      const token = authHeader.split(' ')[1];
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET) as any;
      } catch (err) {
        return res.status(401).json({ error: 'No autorizado' });
      }
      const userId = decoded.id;

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
      if (!user || !user.current_challenge) return res.status(400).json({ error: 'No hay un desafío pendiente' });

      const expectedOrigin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : 'http://localhost:3000');
      const rpID = new URL(expectedOrigin).hostname;

      const verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge: user.current_challenge,
        expectedOrigin: [expectedOrigin, expectedOrigin.replace(/\/$/, '')], // Handle trailing slash
        expectedRPID: rpID,
      });

      if (verification.verified && verification.registrationInfo) {
        const { credential } = verification.registrationInfo;
        
        // Save authenticator
        db.prepare('INSERT INTO authenticators (credential_id, user_id, credential_public_key, counter, transports) VALUES (?, ?, ?, ?, ?)').run(
          credential.id,
          userId,
          Buffer.from(credential.publicKey).toString('base64url'),
          credential.counter,
          JSON.stringify(req.body.response.transports || [])
        );

        // Clear challenge
        db.prepare('UPDATE users SET current_challenge = NULL WHERE id = ?').run(userId);

        res.json({ verified: true });
      } else {
        res.status(400).json({ error: 'Verificación fallida' });
      }
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Error al verificar registro' });
    }
  });

  // 3. Generate Authentication Options
  app.post('/api/auth/generate-authentication-options', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'El correo es obligatorio' });

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
      if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

      const userAuthenticators = db.prepare('SELECT credential_id, transports FROM authenticators WHERE user_id = ?').all(user.id) as any[];
      if (userAuthenticators.length === 0) {
        return res.status(400).json({ error: 'No hay datos biométricos registrados para este usuario' });
      }

      const expectedOrigin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : 'http://localhost:3000');
      const rpID = new URL(expectedOrigin).hostname;

      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: userAuthenticators.map(auth => ({
          id: auth.credential_id,
          type: 'public-key',
          transports: JSON.parse(auth.transports || '[]'),
        })),
        userVerification: 'preferred',
      });

      // Save challenge to user
      db.prepare('UPDATE users SET current_challenge = ? WHERE id = ?').run(options.challenge, user.id);

      res.json(options);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al generar opciones de autenticación' });
    }
  });

  // 4. Verify Authentication
  app.post('/api/auth/verify-authentication', async (req, res) => {
    try {
      const { email, response } = req.body;
      if (!email || !response) return res.status(400).json({ error: 'Datos incompletos' });

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
      if (!user || !user.current_challenge) return res.status(400).json({ error: 'No hay un desafío pendiente' });

      const authenticator = db.prepare('SELECT * FROM authenticators WHERE credential_id = ? AND user_id = ?').get(response.id, user.id) as any;
      if (!authenticator) return res.status(400).json({ error: 'Autenticador no encontrado' });

      const expectedOrigin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : 'http://localhost:3000');
      const rpID = new URL(expectedOrigin).hostname;

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: user.current_challenge,
        expectedOrigin: [expectedOrigin, expectedOrigin.replace(/\/$/, '')],
        expectedRPID: rpID,
        credential: {
          id: authenticator.credential_id,
          publicKey: new Uint8Array(Buffer.from(authenticator.credential_public_key, 'base64url')),
          counter: authenticator.counter,
        },
      });

      if (verification.verified && verification.authenticationInfo) {
        // Update counter
        db.prepare('UPDATE authenticators SET counter = ? WHERE credential_id = ?').run(
          verification.authenticationInfo.newCounter,
          authenticator.credential_id
        );

        // Clear challenge
        db.prepare('UPDATE users SET current_challenge = NULL WHERE id = ?').run(user.id);

        // Generate JWT
        const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
      } else {
        res.status(400).json({ error: 'Verificación fallida' });
      }
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Error al verificar autenticación' });
    }
  });

  // Get Users
  app.get('/api/users', (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
      
      const token = authHeader.split(' ')[1];
      jwt.verify(token, JWT_SECRET);

      const users = db.prepare('SELECT id, name, email, avatar, is_online FROM users').all();
      res.json(users);
    } catch (error) {
      res.status(401).json({ error: 'No autorizado' });
    }
  });

  // --- Push Notifications ---
  app.get('/api/push/vapid-public-key', (req, res) => {
    res.send(vapidKeys.publicKey);
  });

  app.post('/api/push/subscribe', (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.id;

      const subscription = req.body;
      const subId = uuidv4();

      // Check if already exists
      const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint);
      if (!existing) {
        db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)').run(
          subId,
          userId,
          subscription.endpoint,
          subscription.keys.p256dh,
          subscription.keys.auth
        );
      }

      res.status(201).json({ message: 'Suscrito a notificaciones push' });
    } catch (error) {
      console.error('Error subscribing to push:', error);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  // Update Profile
  app.put('/api/users/profile', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
      
      const token = authHeader.split(' ')[1];
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET) as any;
      } catch (err) {
        return res.status(401).json({ error: 'No autorizado' });
      }
      const userId = decoded.id;

      const { name, avatar } = req.body;
      if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });

      db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?').run(name, avatar || null, userId);
      
      const updatedUser = db.prepare('SELECT id, name, email, avatar FROM users WHERE id = ?').get(userId) as any;
      const newToken = jwt.sign({ id: updatedUser.id, name: updatedUser.name, email: updatedUser.email }, JWT_SECRET, { expiresIn: '7d' });

      res.json({ token: newToken, user: updatedUser });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al actualizar el perfil' });
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

  // AI Chat Endpoint
  app.post('/api/ai/chat', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'No autorizado' });
      
      const token = authHeader.split(' ')[1];
      try {
        jwt.verify(token, JWT_SECRET); // Verify token
      } catch (err) {
        return res.status(401).json({ error: 'No autorizado' });
      }

      const { message, file } = req.body;
      if (!message && !file) return res.status(400).json({ error: 'Mensaje o archivo requerido' });

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let contents: any = message || '';
      
      if (file && file.url && file.type.startsWith('image/')) {
        const base64Data = file.url.split(',')[1];
        contents = {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: file.type
              }
            },
            { text: message || 'Describe esta imagen' }
          ]
        };
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents
      });

      res.json({ reply: response.text });
    } catch (error) {
      console.error('AI Error:', error);
      res.status(500).json({ error: 'Error al procesar la respuesta de la IA' });
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
      const { receiverId, content, fileUrl, fileName, fileType } = data;
      const messageId = uuidv4();
      
      db.prepare('INSERT INTO messages (id, sender_id, receiver_id, content, file_url, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        messageId, userId, receiverId, content || '', fileUrl || null, fileName || null, fileType || null
      );

      const message = {
        id: messageId,
        sender_id: userId,
        receiver_id: receiverId,
        content: content || '',
        file_url: fileUrl || null,
        file_name: fileName || null,
        file_type: fileType || null,
        created_at: new Date().toISOString()
      };

      // Send to receiver
      io.to(receiverId).emit('receive_message', message);
      // Send back to sender for confirmation
      socket.emit('receive_message', message);

      // Send push notification
      const sender = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as any;
      const subscriptions = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(receiverId) as any[];
      
      const payload = JSON.stringify({
        title: sender ? sender.name : 'Nuevo mensaje',
        body: content || (fileName ? `Archivo: ${fileName}` : 'Mensaje recibido'),
        icon: '/vite.svg',
        data: {
          url: `/?chat=${userId}`
        }
      });

      subscriptions.forEach(sub => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };
        webpush.sendNotification(pushSubscription, payload).catch(err => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            console.log('Subscription has expired or is no longer valid: ', err);
            db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
          } else {
            console.error('Error sending push notification:', err);
          }
        });
      });
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
