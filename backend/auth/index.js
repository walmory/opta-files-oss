/**
 * Opta Files — accounts, sessions and freemium gate.
 *
 *   GET  /auth/config            public: which verifications are on, daily limits
 *   POST /auth/register          { name, email, phone, password, deviceId }
 *   POST /auth/login             { identifier (e-mail or phone), password }
 *   POST /auth/logout
 *   GET  /auth/me                current user + today's usage
 *   POST /auth/verify/send       { channel: 'email' | 'phone' }
 *   POST /auth/verify/confirm    { channel, code }
 *
 * Sessions are opaque bearer tokens (Authorization: Bearer …). Only their SHA-256 is stored.
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { open } = require('./db');
const { normalizeEmail, normalizePhone, normalizeName, maskEmail, maskPhone, IdentityError } = require('./identity');
const notifier = require('./notifier');

const scrypt = promisify(crypto.scrypt);
const int = (name, def) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

const CFG = {
  sessionDays: int('SESSION_DAYS', 30),
  maxAccountsPerDevice: int('MAX_ACCOUNTS_PER_DEVICE', 2),
  maxSignupsPerIpDay: int('MAX_SIGNUPS_PER_IP_DAY', 3),
  anonDaily: int('ANON_DAILY_LIMIT', 10),   // operations/day without an account (0 = unlimited)
  freeDaily: int('FREE_DAILY_LIMIT', 50),   // operations/day on the free plan
  proDaily: int('PRO_DAILY_LIMIT', 0),      // 0 = unlimited
  requireVerified: /^(1|true|yes)$/i.test(process.env.REQUIRE_VERIFIED || '')
};

// Engine endpoints (relative to /api/v1) that need an account. Everything else is open,
// subject to the anonymous daily limit. Mirror of PREMIUM_TOOL_IDS in the web app.
const ACCOUNT_ONLY = [
  /^convert\/(?!pdf\/img$|img\/pdf$)/,   // Office/HTML/Markdown/PDF-A conversions (LibreOffice: CPU heavy)
  /^misc\/ocr-pdf$/,
  /^misc\/extract-image-scans$/,
  /^security\/cert-sign$/,
  /^security\/auto-redact$/
];
const needsAccount = (endpoint) => ACCOUNT_ONLY.some((re) => re.test(endpoint));

const err = (res, status, code, message, extra = {}) => res.status(status).json({ code, message, ...extra });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- passwords (scrypt, built in)
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashPassword = async (pw) => {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
};
const verifyPassword = async (pw, stored) => {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(key, expected);
};
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

const checkPassword = (pw) => {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.';
  return null;
};

const createAuth = ({ dataDir, rateLimit }) => {
  const db = open(dataDir);

  // Stable secret for hashing IPs (so the raw address is never stored).
  const secretFile = path.join(dataDir, '.ip-secret');
  let ipSecret = process.env.IP_HASH_SECRET;
  if (!ipSecret) {
    try {
      ipSecret = fs.readFileSync(secretFile, 'utf8').trim();
    } catch {
      ipSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(secretFile, ipSecret, { mode: 0o600 });
    }
  }
  const ipKey = (req) => crypto.createHmac('sha256', ipSecret).update(String(req.ip || '')).digest('hex').slice(0, 32);

  // ---------------------------------------------------------------- statements
  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email_canonical = ?'),
    userByPhone: db.prepare('SELECT * FROM users WHERE phone = ?'),
    countByDevice: db.prepare('SELECT COUNT(*) n FROM users WHERE device_id = ?'),
    countByIpSince: db.prepare('SELECT COUNT(*) n FROM users WHERE created_ip = ? AND created_at > ?'),
    insertUser: db.prepare(`INSERT INTO users (id, name, email, email_canonical, phone, password_hash, device_id, created_ip, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    lastCode: db.prepare('SELECT * FROM verifications WHERE user_id = ? AND channel = ? ORDER BY id DESC LIMIT 1'),
    codesSince: db.prepare('SELECT COUNT(*) n FROM verifications WHERE user_id = ? AND channel = ? AND created_at > ?'),
    insertCode: db.prepare('INSERT INTO verifications (user_id, channel, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    bumpAttempt: db.prepare('UPDATE verifications SET attempts = attempts + 1 WHERE id = ?'),
    consumeCode: db.prepare('UPDATE verifications SET consumed_at = ? WHERE id = ?'),
    verifyEmail: db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?'),
    verifyPhone: db.prepare('UPDATE users SET phone_verified_at = ? WHERE id = ?'),
    usage: db.prepare('SELECT count FROM usage WHERE subject = ? AND day = ?'),
    addUsage: db.prepare(`INSERT INTO usage (subject, day, count) VALUES (?, ?, 1)
                          ON CONFLICT(subject, day) DO UPDATE SET count = count + 1`),
    refundUsage: db.prepare('UPDATE usage SET count = MAX(count - 1, 0) WHERE subject = ? AND day = ?')
  };

  const isVerified = (u) => (!notifier.enabled.email || Boolean(u.email_verified_at)) && (!notifier.enabled.phone || Boolean(u.phone_verified_at));
  const limitFor = (u) => (!u ? CFG.anonDaily : u.plan === 'pro' ? CFG.proDaily : CFG.freeDaily);
  const subjectFor = (req) => (req.user ? `u:${req.user.id}` : `ip:${ipKey(req)}`);
  const usageFor = (req) => {
    const limit = limitFor(req.user);
    const used = q.usage.get(subjectFor(req), today())?.count ?? 0;
    return { used, limit: limit || null, remaining: limit ? Math.max(limit - used, 0) : null };
  };

  const publicUser = (u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: maskPhone(u.phone),
    emailVerified: Boolean(u.email_verified_at),
    phoneVerified: Boolean(u.phone_verified_at),
    verified: isVerified(u),
    plan: u.plan,
    createdAt: u.created_at
  });

  const startSession = (res, user, req) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    q.insertSession.run(sha256(token), user.id, now, now + CFG.sessionDays * 86_400_000, now, String(req.get('user-agent') || '').slice(0, 200));
    return token;
  };

  // ---------------------------------------------------------------- middleware
  /** Attaches req.user when a valid bearer token is present. Never rejects. */
  const attachUser = (req, _res, next) => {
    const h = req.get('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (token && token.length <= 100) {
      const th = sha256(token);
      const s = q.session.get(th);
      const now = Date.now();
      if (s && s.expires_at > now) {
        const u = q.userById.get(s.user_id);
        if (u && u.status === 'active') {
          req.user = u;
          req.sessionHash = th;
          // sliding expiry, written at most once an hour
          if (now - s.last_seen_at > 3_600_000) q.touchSession.run(now, now + CFG.sessionDays * 86_400_000, th);
        }
      }
    }
    next();
  };
  const requireUser = (req, res, next) => (req.user ? next() : err(res, 401, 'AUTH_REQUIRED', 'Entre na sua conta para continuar.'));

  /** Freemium gate + daily quota for the PDF engine gateway. */
  const engineGate = (req, res, next) => {
    if (req.method !== 'POST') return next();
    const endpoint = req.path.replace(/^\/pdf\/api\/v1\//, '').replace(/\/$/, '');
    if (needsAccount(endpoint)) {
      if (!req.user) return err(res, 401, 'AUTH_REQUIRED', 'Crie uma conta grátis para usar esta ferramenta.');
      if (CFG.requireVerified && !isVerified(req.user)) return err(res, 403, 'VERIFY_REQUIRED', 'Confirme seu e-mail e telefone para usar esta ferramenta.');
    }
    const limit = limitFor(req.user);
    const subject = subjectFor(req);
    const day = today();
    if (limit) {
      const used = q.usage.get(subject, day)?.count ?? 0;
      if (used >= limit) {
        return err(res, 429, 'QUOTA_EXCEEDED', req.user
          ? `Você usou as ${limit} operações grátis de hoje. Volte amanhã ou assine o plano Pro.`
          : `Você usou as ${limit} operações de hoje sem conta. Crie uma conta grátis para continuar.`, { limit, anonymous: !req.user });
      }
    }
    q.addUsage.run(subject, day);
    // Our failures do not cost the customer an operation.
    res.on('finish', () => {
      if (res.statusCode >= 500) q.refundUsage.run(subject, day);
    });
    next();
  };

  // ---------------------------------------------------------------- routes
  const router = express.Router();
  router.use(express.json({ limit: '20kb' }));
  const authLimiter = rateLimit('auth', int('AUTH_RATE_PER_MIN', 20), 60_000);
  const signupLimiter = rateLimit('signup', int('SIGNUP_RATE_PER_HOUR', 5), 60 * 60_000);

  router.get('/config', (req, res) => {
    res.json({
      verification: { email: notifier.enabled.email, phone: notifier.enabled.phone, required: CFG.requireVerified },
      limits: { anonymous: CFG.anonDaily || null, free: CFG.freeDaily || null, pro: CFG.proDaily || null },
      usage: usageFor(req)
    });
  });

  router.post('/register', authLimiter, signupLimiter, async (req, res) => {
    try {
      const b = req.body || {};
      const name = normalizeName(b.name);
      const { email, canonical } = normalizeEmail(b.email);
      const phone = normalizePhone(b.phone);
      const pwError = checkPassword(b.password);
      if (pwError) return err(res, 400, 'PASSWORD_WEAK', pwError, { field: 'password' });
      const deviceId = typeof b.deviceId === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(b.deviceId) ? b.deviceId : null;

      // One person, one account.
      if (q.userByEmail.get(canonical)) return err(res, 409, 'EMAIL_TAKEN', 'Já existe uma conta com este e-mail. Entre nela.', { field: 'email' });
      if (q.userByPhone.get(phone)) return err(res, 409, 'PHONE_TAKEN', 'Este telefone já está ligado a outra conta.', { field: 'phone' });
      if (deviceId && CFG.maxAccountsPerDevice && q.countByDevice.get(deviceId).n >= CFG.maxAccountsPerDevice) {
        return err(res, 429, 'DEVICE_LIMIT', 'Este dispositivo já tem o número máximo de contas. Entre na conta existente.');
      }
      const ip = ipKey(req);
      if (CFG.maxSignupsPerIpDay && q.countByIpSince.get(ip, Date.now() - 86_400_000).n >= CFG.maxSignupsPerIpDay) {
        return err(res, 429, 'IP_LIMIT', 'Muitas contas criadas a partir desta rede hoje. Tente novamente amanhã.');
      }

      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(b.password);
      try {
        q.insertUser.run(id, name, email, canonical, phone, passwordHash, deviceId, ip, Date.now());
      } catch (e) {
        // Two simultaneous sign-ups with the same data: the UNIQUE index is the final word.
        if (/UNIQUE/.test(e.message)) return err(res, 409, /phone/.test(e.message) ? 'PHONE_TAKEN' : 'EMAIL_TAKEN', 'Estes dados já estão em uso por outra conta.');
        throw e;
      }
      const user = q.userById.get(id);
      const token = startSession(res, user, req);
      res.status(201).json({ token, user: publicUser(user) });
    } catch (e) {
      if (e instanceof IdentityError) return err(res, 400, e.code, e.message, { field: e.field });
      console.error('[opta-files] register failed:', e.message);
      err(res, 500, 'SERVER_ERROR', 'Não foi possível criar a conta agora. Tente novamente.');
    }
  });

  // Brute-force protection per account, on top of the per-IP limiter.
  const failures = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of failures) if (now > v.until) failures.delete(k);
  }, 60_000).unref();

  router.post('/login', authLimiter, async (req, res) => {
    const b = req.body || {};
    const raw = String(b.identifier || '').trim();
    const password = String(b.password || '');
    let user;
    let key;
    try {
      if (raw.includes('@')) {
        key = normalizeEmail(raw).canonical;
        user = q.userByEmail.get(key);
      } else {
        key = normalizePhone(raw);
        user = q.userByPhone.get(key);
      }
    } catch {
      key = raw.toLowerCase();
    }
    // Lock the ACCOUNT, not the spelling: guessing via e-mail then via phone shares one counter.
    if (user) key = `u:${user.id}`;
    const f = failures.get(key);
    if (f && f.count >= 5 && Date.now() < f.until) {
      return err(res, 429, 'LOCKED', 'Muitas tentativas. Aguarde 15 minutos ou redefina sua senha.');
    }
    // Always run scrypt so response time does not reveal whether the account exists.
    const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH).catch(() => false);
    if (!user || !ok || user.status !== 'active') {
      failures.set(key, { count: (f?.count || 0) + 1, until: Date.now() + 15 * 60_000 });
      return err(res, 401, 'BAD_CREDENTIALS', 'E-mail/telefone ou senha incorretos.');
    }
    failures.delete(key);
    const token = startSession(res, user, req);
    res.json({ token, user: publicUser(user) });
  });

  router.post('/logout', requireUser, (req, res) => {
    q.deleteSession.run(req.sessionHash);
    res.json({ ok: true });
  });

  router.get('/me', requireUser, (req, res) => {
    res.json({ user: publicUser(req.user), usage: usageFor(req) });
  });

  router.post('/verify/send', authLimiter, requireUser, async (req, res) => {
    const channel = req.body?.channel;
    if (channel !== 'email' && channel !== 'phone') return err(res, 400, 'BAD_CHANNEL', 'Canal inválido.');
    if (!notifier.enabled[channel]) return err(res, 400, 'CHANNEL_OFF', 'Esta verificação não está ativa.');
    const u = req.user;
    if (channel === 'email' ? u.email_verified_at : u.phone_verified_at) return err(res, 400, 'ALREADY_VERIFIED', 'Já verificado.');
    const now = Date.now();
    const last = q.lastCode.get(u.id, channel);
    if (last && now - last.created_at < 60_000) {
      return err(res, 429, 'COOLDOWN', 'Aguarde um minuto para pedir outro código.', { retryIn: Math.ceil((60_000 - (now - last.created_at)) / 1000) });
    }
    if (q.codesSince.get(u.id, channel, now - 3_600_000).n >= 5) return err(res, 429, 'TOO_MANY_CODES', 'Muitos códigos pedidos. Tente de novo em uma hora.');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const to = channel === 'email' ? u.email : u.phone;
    try {
      await notifier.sendCode(channel, to, code);
    } catch (e) {
      console.error(`[opta-files] ${channel} code delivery failed:`, e.message);
      return err(res, 502, 'DELIVERY_FAILED', 'Não conseguimos enviar o código agora. Tente novamente em instantes.');
    }
    q.insertCode.run(u.id, channel, sha256(`${u.id}:${code}`), now, now + 10 * 60_000);
    res.json({ sentTo: channel === 'email' ? maskEmail(to) : maskPhone(to), expiresIn: 600 });
  });

  router.post('/verify/confirm', authLimiter, requireUser, (req, res) => {
    const { channel } = req.body || {};
    const code = String(req.body?.code || '').replace(/\D/g, '');
    if (channel !== 'email' && channel !== 'phone') return err(res, 400, 'BAD_CHANNEL', 'Canal inválido.');
    const v = q.lastCode.get(req.user.id, channel);
    const now = Date.now();
    if (!v || v.consumed_at || v.expires_at < now) return err(res, 400, 'CODE_EXPIRED', 'Código expirado. Peça um novo.');
    if (v.attempts >= 5) return err(res, 429, 'CODE_LOCKED', 'Muitas tentativas. Peça um novo código.');
    const a = Buffer.from(sha256(`${req.user.id}:${code}`));
    const b = Buffer.from(v.code_hash);
    if (code.length !== 6 || !crypto.timingSafeEqual(a, b)) {
      q.bumpAttempt.run(v.id);
      return err(res, 400, 'CODE_WRONG', 'Código incorreto.', { attemptsLeft: Math.max(4 - v.attempts, 0) });
    }
    q.consumeCode.run(now, v.id);
    (channel === 'email' ? q.verifyEmail : q.verifyPhone).run(now, req.user.id);
    res.json({ user: publicUser(q.userById.get(req.user.id)) });
  });

  return { router, attachUser, requireUser, engineGate, config: CFG };
};

module.exports = { createAuth, needsAccount };
