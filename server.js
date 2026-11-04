'use strict';

const express = require('express');
const path = require('node:path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_MESSAGE_LENGTH = 4000;

app.disable('x-powered-by');
app.use(express.json({ limit: '8kb', strict: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function connectionStatus() {
  return {
    status: 'ONLINE',
    service: 'CONNECTION_TELEGRAM_ONLY',
    telegramConfigured: telegramConfigured(),
    notificationAuthConfigured: Boolean(process.env.TELEGRAM_NOTIFY_TOKEN)
  };
}

app.get('/health', (_req, res) => res.json(connectionStatus()));
app.get('/api/connection', (_req, res) => res.json(connectionStatus()));

app.post('/api/telegram/notify', async (req, res) => {
  const expected = process.env.TELEGRAM_NOTIFY_TOKEN || '';
  const auth = req.get('authorization') || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!expected || !supplied || supplied.length !== expected.length ||
      !require('node:crypto').timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }

  if (!telegramConfigured()) {
    return res.status(503).json({ ok: false, error: 'TELEGRAM_NOT_CONFIGURED' });
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ ok: false, error: 'MESSAGE_REQUIRED_OR_TOO_LONG', maxLength: MAX_MESSAGE_LENGTH });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      console.error('Telegram delivery failed:', response.status, result.description || 'unknown error');
      return res.status(502).json({ ok: false, error: 'TELEGRAM_DELIVERY_FAILED' });
    }
    return res.json({ ok: true, messageId: result.result?.message_id ?? null });
  } catch (error) {
    console.error('Telegram request failed:', error.message);
    return res.status(502).json({ ok: false, error: 'TELEGRAM_CONNECTION_FAILED' });
  }
});

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'REQUEST_TOO_LARGE' });
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'INVALID_JSON' });
  console.error('Unhandled request error:', error);
  return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Connection + Telegram notification service listening on ${PORT}`));
}

module.exports = { app, connectionStatus, telegramConfigured };
