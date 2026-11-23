import express, { Request, Response } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { playwrightService } from './services/playwrightService';
import { TestScenarioConfig } from './types';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Middleware
app.use(
  cors({
    origin: '*',
    credentials: true,
  })
);
app.use(express.json());

// Create HTTP and WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Store active WebSocket clients
const clients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Securitier WebSocket Stream Connected' }));

  ws.on('close', () => {
    clients.delete(ws);
  });
});

const broadcast = (data: any) => {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
};

// Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Securitier Web Security Testing Agent',
    engine: 'Playwright (Chromium)',
    timestamp: new Date().toISOString(),
  });
});

// Demo Target Login Page (Built-in for immediate safe local testing)
app.get('/demo-login', (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Securitier Demo Test Target</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 2rem; border-radius: 12px; width: 340px; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        h2 { margin-top: 0; font-size: 1.25rem; color: #38bdf8; }
        label { display: block; font-size: 0.85rem; margin-top: 1rem; color: #94a3b8; }
        input { width: 100%; padding: 0.6rem; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #fff; margin-top: 0.25rem; box-sizing: border-box; }
        button { width: 100%; padding: 0.75rem; border: none; border-radius: 6px; background: #0284c7; color: white; font-weight: bold; margin-top: 1.5rem; cursor: pointer; }
        button:hover { background: #0369a1; }
        .msg { margin-top: 1rem; font-size: 0.85rem; padding: 0.5rem; border-radius: 6px; display: none; }
        .error { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
        .success { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Secure Portal Test</h2>
        <p style="font-size: 0.8rem; color: #64748b;">Target login interface for security evaluation.</p>
        <form id="loginForm">
          <label for="demo-email">Email Address</label>
          <input type="email" id="demo-email" name="email" placeholder="admin@example.com" required />

          <label for="demo-password">Password</label>
          <input type="password" id="demo-password" name="password" placeholder="••••••••" required />

          <button type="submit" id="demo-submit">Sign In</button>
          <div id="statusMessage" class="msg"></div>
        </form>
      </div>

      <script>
        const form = document.getElementById('loginForm');
        const msg = document.getElementById('statusMessage');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = document.getElementById('demo-email').value;
          const password = document.getElementById('demo-password').value;

          try {
            const res = await fetch('/demo-login/api/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            msg.style.display = 'block';
            if (res.ok) {
              msg.className = 'msg success';
              msg.textContent = 'Authentication successful! Redirecting...';
            } else {
              msg.className = 'msg error';
              msg.textContent = data.message || 'Invalid credentials.';
            }
          } catch (err) {
            msg.style.display = 'block';
            msg.className = 'msg error';
            msg.textContent = 'Server connection error.';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Demo Auth API Route
let demoAttemptCounts = 0;
app.post('/demo-login/api/auth', (req: Request, res: Response) => {
  demoAttemptCounts++;
  const { email, password } = req.body;

  // Simulate rate-limiting check
  if (demoAttemptCounts > 4) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please wait 60 seconds before trying again.',
    });
  }

  // Validate credentials
  if (email === 'admin@example.com' && password === 'ValidSecurePass2026!') {
    res.cookie('securitier_session', 'demo_session_token_xyz', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });
    return res.json({
      success: true,
      message: 'Authentication successful',
      user: { id: 'usr_1', email: 'admin@example.com' },
    });
  }

  // Safe generic error
  return res.status(401).json({
    success: false,
    message: 'Invalid credentials provided.',
  });
});

// Reset demo attempts
app.post('/demo-login/api/reset', (req: Request, res: Response) => {
  demoAttemptCounts = 0;
  res.json({ message: 'Demo attempt counter reset' });
});

// ==========================================
// Security Testing Agent Endpoints
// ==========================================

// 1. Initialize Playwright Browser Session
app.post('/api/sessions/start', async (req: Request, res: Response) => {
  const { targetUrl, authorized } = req.body;

  if (!targetUrl) {
    return res.status(400).json({ error: 'targetUrl is required' });
  }

  if (!authorized) {
    return res.status(403).json({
      error: 'Authorization Required',
      message: 'You must confirm explicit authorization or ownership to test this web target.',
    });
  }

  const sessionId = `sess-${Date.now()}`;

  try {
    const { elements, screenshot } = await playwrightService.startSession(
      sessionId,
      targetUrl,
      authorized,
      broadcast
    );

    res.json({
      success: true,
      sessionId,
      targetUrl,
      elementsCount: elements.length,
      elements,
      screenshot,
    });
  } catch (error: any) {
    console.error('Session start error:', error);
    res.status(500).json({
      error: 'Failed to start testing session',
      message: error?.message || 'Unknown browser error',
    });
  }
});

// 2. Re-inspect DOM
app.get('/api/sessions/:id/inspect', async (req: Request, res: Response) => {
  const sessionId = req.params.id as string;
  try {
    const elements = await playwrightService.inspectDOM(sessionId);
    const screenshot = await playwrightService.captureScreenshot(sessionId);
    res.json({ success: true, elements, screenshot });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Execute Controlled Security Test Scenario
app.post('/api/sessions/:id/test', async (req: Request, res: Response) => {
  const sessionId = req.params.id as string;
  const {
    scenario,
    usernameSelector,
    passwordSelector,
    submitSelector,
    usernameValue,
    passwordValue,
    requestDelayMs,
    rateLimitIterations,
  } = req.body;

  if (!scenario || !usernameSelector || !passwordSelector || !submitSelector) {
    return res.status(400).json({
      error: 'Missing required configuration: scenario, usernameSelector, passwordSelector, submitSelector',
    });
  }

  try {
    const config: TestScenarioConfig = {
      scenario,
      usernameSelector,
      passwordSelector,
      submitSelector,
      usernameValue,
      passwordValue,
      requestDelayMs,
      rateLimitIterations,
    };

    const result = await playwrightService.executeTest(sessionId, config);
    const screenshot = await playwrightService.captureScreenshot(sessionId);

    broadcast({
      type: 'TEST_COMPLETED',
      data: result,
    });

    res.json({ success: true, result, screenshot });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Retrieve Network Monitor Logs
app.get('/api/sessions/:id/logs', (req: Request, res: Response) => {
  const sessionId = req.params.id as string;
  const session = playwrightService.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    success: true,
    logs: session.networkLogs,
  });
});

// 5. Retrieve Test History
app.get('/api/sessions/:id/history', (req: Request, res: Response) => {
  const sessionId = req.params.id as string;
  const session = playwrightService.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    success: true,
    history: session.testHistory,
  });
});

// 6. Security Report Generation
app.get('/api/sessions/:id/report', (req: Request, res: Response) => {
  const sessionId = req.params.id as string;
  try {
    const report = playwrightService.generateReport(sessionId);
    res.json({ success: true, report });
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

// 7. Terminate Session
app.delete('/api/sessions/:id', async (req: Request, res: Response) => {
  const sessionId = req.params.id as string;
  try {
    await playwrightService.closeSession(sessionId);
    res.json({ success: true, message: 'Session closed and browser terminated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Securitier Security Testing Server running on http://localhost:${PORT}`);
  console.log(`WebSocket Stream active at ws://localhost:${PORT}/ws`);
  console.log(`Demo local login target available at http://localhost:${PORT}/demo-login`);
});
