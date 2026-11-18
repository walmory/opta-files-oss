/**
 * Opta Files — backend.
 *
 * Provides:
 *   - GET  /health                      liveness + config summary
 *   - GET  /pdf/health                  PDF engine availability probe (sanitised, never exposes the upstream)
 *   - ALL  /pdf/api/*                   gateway to the PDF engine (multipart streamed, no CORS pain)
 *   - GET  /fonts/ttf                   Google Fonts → TTF (for pdf-lib embedding)
 *   - GET|PUT /api/store/:collection    per-user JSON persistence (pdf history…) — login required
 *   - DELETE  /api/store/:collection/:id
 *   - /auth/*                           accounts, sessions, e-mail/phone verification (see auth/index.js)
 */
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { createAuth } = require('./auth');

// Optional .env next to this file (PDF_ENGINE_URL, DATA_DIR…). Absent = defaults.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // no .env, or Node < 20.12 — env vars can still come from the shell
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind nginx — req.ip must be the real client for rate limiting

// CORS allowlist. Dev origins apply only when ALLOWED_ORIGINS is unset (local machine);
// a public deployment declares its origins and gets nothing else.
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const clean = (o) => o.trim().replace(/\/$/, '');
const CONFIGURED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(clean).filter(Boolean);
const ALLOWED_ORIGINS = CONFIGURED_ORIGINS.length ? CONFIGURED_ORIGINS : DEV_ORIGINS;
app.use(cors({
  origin: (origin, cb) => cb(null, !origin ? false : ALLOWED_ORIGINS.includes(clean(origin))),
  credentials: false
}));

// ---------------------------------------------------------------- security layers
// CORS is not a security boundary: curl and bots ignore it. Everything below is.

// 1. Shared token. The frontend is a static bundle, so this token is public by design —
//    it stops drive-by scanners and scripted abuse, it is not a per-user secret.
//    Real per-user auth is required before customer data is stored here.
const API_TOKEN = (process.env.API_TOKEN || '').trim();
const PUBLIC_PATHS = new Set(['/health']);
app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path) || req.method === 'OPTIONS') return next();
  if (!API_TOKEN) return next(); // local dev with no token configured
  const sent = req.get('x-opta-token') || '';
  // Constant-time compare so the token cannot be recovered byte by byte.
  const a = Buffer.from(sent), b = Buffer.from(API_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ message: 'Nao autorizado.' });
  }
  next();
});

// 2. In-process rate limit, per IP and per bucket. nginx limits requests per second;
//    this limits sustained volume and survives an nginx misconfiguration.
const buckets = new Map();
const rateLimit = (name, max, windowMs) => (req, res, next) => {
  const now = Date.now();
  const key = `${name}:${req.ip}`;
  const hit = buckets.get(key);
  if (!hit || now > hit.reset) buckets.set(key, { count: 1, reset: now + windowMs });
  else if (++hit.count > max) {
    res.set('Retry-After', String(Math.ceil((hit.reset - now) / 1000)));
    return res.status(429).json({ message: 'Muitas requisicoes. Aguarde alguns instantes.' });
  }
  next();
};
// Bounded memory: drop expired buckets periodically.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
}, 60_000).unref();
// ---------------------------------------------------------------- accounts
// Must come after the token check and before every route that cares who the customer is.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const auth = createAuth({ dataDir: DATA_DIR, rateLimit });
app.use(auth.attachUser);
app.use('/auth', auth.router);

// JSON body parsing only for our own store routes — proxied requests must keep
// their body untouched so it can be streamed to the PDF engine.
const jsonParser = express.json({ limit: '2mb' });
app.use((req, res, next) => (req.path.startsWith('/api/store') ? jsonParser(req, res, next) : next()));

// PDF engine (private upstream). `PDF_ENGINE_URL` is the canonical variable; the
// legacy name is still honoured so existing .env files keep working.
const RAW_ENGINE = (process.env.PDF_ENGINE_URL || process.env.STIRLING_URL || 'http://localhost:8082').replace(/\/$/, '');
// Credentials may be carried inline (https://user:pass@host/path) — strip them out
// of the public URL and send them as a Basic auth header instead.
const ENGINE_TARGET = new URL(RAW_ENGINE);
const ENGINE_AUTH = ENGINE_TARGET.username ? 'Basic ' + Buffer.from(`${decodeURIComponent(ENGINE_TARGET.username)}:${decodeURIComponent(ENGINE_TARGET.password)}`).toString('base64') : null;
ENGINE_TARGET.username = '';
ENGINE_TARGET.password = '';
const ENGINE_URL = ENGINE_TARGET.toString().replace(/\/$/, '');
const ENGINE_HEADERS = ENGINE_AUTH ? { Authorization: ENGINE_AUTH } : {};

// Customer-facing copy: never leak infrastructure details.
const ENGINE_DOWN = { message: 'Serviço temporariamente indisponível. Tente novamente em instantes.' };
// Upstream response headers that would reveal the engine vendor to the browser.
const LEAKY_HEADERS = ['server', 'x-powered-by', 'x-application-context', 'x-frame-options', 'content-security-policy', 'set-cookie'];
const startedAt = Date.now();

// ---------------------------------------------------------------- health
app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'opta-files', uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
});

// ---------------------------------------------------------------- PDF engine gateway
const proxyTo = (targetBase, stripPrefix, extraHeaders = ENGINE_HEADERS, rewrite = (suffix) => suffix) => (req, res) => {
  const target = new URL(targetBase);
  // Never trust the incoming path: strip traversal segments before rebuilding the
  // upstream URL, so a crafted path can never escape the engine's location prefix.
  const raw = rewrite(req.originalUrl.replace(stripPrefix, '') || '/', req);
  const [rawPath, rawQuery] = raw.split(/\?(.*)/s);
  const safePath = '/' + rawPath.split('/').filter((seg) => seg && seg !== '.' && seg !== '..' && !/%2e%2e/i.test(seg)).join('/');
  const suffix = rawQuery ? `${safePath}?${rawQuery}` : safePath;
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: (target.pathname.replace(/\/$/, '') + suffix).replace(/\/{2,}/g, '/'),
    headers: { ...req.headers }
  };
  // Client-controlled trust and session headers must not reach the engine — including the
  // customer's session token, which is ours alone.
  for (const h of ['cookie', 'authorization', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'x-opta-token']) delete options.headers[h];
  Object.assign(options.headers, extraHeaders, { host: target.host });
  const lib = target.protocol === 'https:' ? https : http;
  const upstream = lib.request(options, (up) => {
    const headers = { ...up.headers };
    for (const h of LEAKY_HEADERS) delete headers[h];
    headers['x-powered-by'] = 'Opta Files';
    res.writeHead(up.statusCode || 502, headers);
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    console.error('[opta-files] engine error:', err.message);
    if (!res.headersSent) res.status(503).json(ENGINE_DOWN);
    else res.end();
  });
  req.pipe(upstream);
};

// Sanitised probe: tells the client only whether processing is available.
app.get('/pdf/health', async (req, res) => {
  try {
    await axios.get(`${ENGINE_URL}/api/v1/info/status`, { timeout: 4000, headers: ENGINE_HEADERS });
    res.json({ ok: true });
  } catch (e) {
    try {
      await axios.get(`${ENGINE_URL}/`, { timeout: 4000, headers: ENGINE_HEADERS });
      res.json({ ok: true });
    } catch (e2) {
      console.error('[opta-files] engine unreachable:', e2.message);
      res.status(503).json({ ok: false, ...ENGINE_DOWN });
    }
  }
});

// Everything under /pdf/api/* → engine /api/*   (multipart bodies streamed untouched).
// engineGate: heavy tools need an account, and every operation counts toward the daily limit.
app.all(/^\/pdf\/api\/.*/, rateLimit('engine', 60, 60_000), auth.engineGate, proxyTo(ENGINE_URL, '/pdf'));

// ---------------------------------------------------------------- Google Fonts → TTF (for PDF embedding)
const FONT_DIR = path.join(DATA_DIR, 'fonts');
const MAX_CACHED_FONTS = 500;
fs.mkdirSync(FONT_DIR, { recursive: true });
app.get('/fonts/ttf', rateLimit('fonts', 120, 60_000), async (req, res) => {
  const family = String(req.query.family || '').trim();
  const weight = Math.max(100, Math.min(900, parseInt(String(req.query.weight || '400'), 10) || 400));
  const italic = String(req.query.italic || '0') === '1';
  if (!/^[A-Za-z0-9 ]{2,40}$/.test(family)) return res.status(400).json({ message: 'family inválida' });
  const slug = `${family.replace(/\s+/g, '_')}-${weight}${italic ? 'i' : ''}.ttf`;
  const file = path.join(FONT_DIR, slug);
  // Defence in depth: the regex above already forbids separators, but confirm the
  // resolved path never leaves the cache directory.
  if (path.dirname(path.resolve(file)) !== path.resolve(FONT_DIR)) return res.status(400).json({ message: 'family invalida' });
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (fs.existsSync(file)) return res.type('font/ttf').send(fs.readFileSync(file));
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${italic ? 1 : 0},${weight}`;
    // An old user-agent makes Google serve plain TrueType files instead of woff2
    const css = await axios.get(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 4.0; Nexus)' }, timeout: 8000 });
    const m = String(css.data).match(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
    if (!m) return res.status(404).json({ message: 'TTF não encontrado para esta fonte/peso' });
    const font = await axios.get(m[1], { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 4.0; Nexus)' } });
    const buf = Buffer.from(font.data);
    const tag = buf.readUInt32BE(0);
    if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return res.status(502).json({ message: 'Formato de fonte inesperado (não é TrueType/OpenType)' });
    // Bounded cache: stop writing once the directory hits the ceiling.
    if (fs.readdirSync(FONT_DIR).length < MAX_CACHED_FONTS) fs.writeFileSync(file, buf);
    res.type('font/ttf').send(buf);
  } catch (error) {
    // Internal detail stays in the log; the client gets product copy only.
    console.error('[opta-files] font fetch failed:', error.message);
    res.status(502).json({ message: 'Nao foi possivel carregar esta fonte agora.' });
  }
});

// ---------------------------------------------------------------- JSON store (one folder per account)
// Each customer only ever sees their own collections; anonymous visitors keep history on the device.
const SAFE = /^[a-z0-9_-]{1,40}$/i;
const MAX_COLLECTIONS = 20;    // per account — stops disk exhaustion via random collection names
const MAX_ITEMS = 2000;        // stops unbounded growth of a single collection
const STORE_DIR = path.join(DATA_DIR, 'store');
const userDir = (req) => {
  const dir = path.join(STORE_DIR, req.user.id); // id is a server-generated UUID, never client input
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const readCollection = (dir, c) => {
  try {
    const raw = fs.readFileSync(path.join(dir, `${c}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const writeCollection = (dir, c, items) => {
  const file = path.join(dir, `${c}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(items));
  fs.renameSync(`${file}.tmp`, file);
};

const storeLimiter = rateLimit('store', 120, 60_000);

app.get('/api/store/:collection', storeLimiter, auth.requireUser, (req, res) => {
  const c = req.params.collection;
  if (!SAFE.test(c)) return res.status(400).json({ message: 'collection inválida' });
  res.json(readCollection(userDir(req), c));
});

// Upsert one item (needs id) — or replace whole collection when body is an array
app.put('/api/store/:collection', storeLimiter, auth.requireUser, (req, res) => {
  const c = req.params.collection;
  if (!SAFE.test(c)) return res.status(400).json({ message: 'collection inválida' });
  const dir = userDir(req);
  // New collections are capped so nobody can fill the disk with random names.
  if (!fs.existsSync(path.join(dir, `${c}.json`))) {
    const existing = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
    if (existing >= MAX_COLLECTIONS) return res.status(429).json({ message: 'Limite de coleções atingido.' });
  }
  const body = req.body;
  if (Array.isArray(body)) {
    if (body.length > MAX_ITEMS) return res.status(413).json({ message: 'Coleção grande demais.' });
    writeCollection(dir, c, body);
    return res.json({ ok: true, count: body.length });
  }
  if (!body || typeof body !== 'object' || !body.id) return res.status(400).json({ message: 'item precisa de id' });
  if (typeof body.id !== 'string' || body.id.length > 128) return res.status(400).json({ message: 'id inválido' });
  const items = readCollection(dir, c);
  if (items.length >= MAX_ITEMS && !items.some((i) => i.id === body.id)) return res.status(413).json({ message: 'Coleção cheia.' });
  const idx = items.findIndex((i) => i.id === body.id);
  const item = { ...body, updatedAt: Date.now() };
  if (idx === -1) items.push({ ...item, createdAt: Date.now() });
  else items[idx] = { ...items[idx], ...item };
  writeCollection(dir, c, items);
  res.json(item);
});

app.delete('/api/store/:collection/:id', storeLimiter, auth.requireUser, (req, res) => {
  const c = req.params.collection;
  if (!SAFE.test(c)) return res.status(400).json({ message: 'collection inválida' });
  const dir = userDir(req);
  const items = readCollection(dir, c).filter((i) => i.id !== req.params.id);
  writeCollection(dir, c, items);
  res.json({ ok: true, count: items.length });
});

// Anything else is not ours — never forward unknown paths to the engine.
app.use((req, res) => res.status(404).json({ message: 'Rota não encontrada' }));

const PORT = Number(process.env.PORT) || 3001;
// Loopback only: the public entrypoint is nginx, never the Node process itself.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`[opta-files] backend on http://${HOST}:${PORT}  →  engine: ${ENGINE_URL}  auth: ${API_TOKEN ? 'token' : 'OPEN (dev)'}`);
  console.log(`[opta-files] accounts: verificação e-mail=${process.env.EMAIL_VERIFICATION || 'off'} telefone=${process.env.PHONE_VERIFICATION || 'off'} · limites/dia anônimo=${auth.config.anonDaily || '∞'} grátis=${auth.config.freeDaily || '∞'}`);
});
