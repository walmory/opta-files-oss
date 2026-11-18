/**
 * End-to-end tests for accounts + freemium gate. Spins up the real server against a fake
 * PDF engine and a throwaway data folder:   npm test
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let server, engine, base, logs = '';
const engineSaw = [];
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opta-auth-'));

const freePort = () => new Promise((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

before(async () => {
  const enginePort = await freePort();
  engine = http.createServer((req, res) => {
    engineSaw.push({ url: req.url, auth: req.headers.authorization });
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF-fake'); });
  }).listen(enginePort, '127.0.0.1');
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: DATA, API_TOKEN: '', ALLOWED_ORIGINS: '',
      PDF_ENGINE_URL: `http://127.0.0.1:${enginePort}`,
      EMAIL_VERIFICATION: 'console', PHONE_VERIFICATION: 'console', REQUIRE_VERIFIED: 'false',
      ANON_DAILY_LIMIT: '3', FREE_DAILY_LIMIT: '4', MAX_ACCOUNTS_PER_DEVICE: '2', MAX_SIGNUPS_PER_IP_DAY: '0',
      AUTH_RATE_PER_MIN: '1000', SIGNUP_RATE_PER_HOUR: '1000'
    }
  });
  server.stdout.on('data', (d) => (logs += d));
  server.stderr.on('data', (d) => (logs += d));
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start:\n' + logs);
});
after(() => { server?.kill(); engine?.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

const call = async (method, p, body, token) => {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};
const pdf = (endpoint, token) => fetch(`${base}/pdf/api/v1/${endpoint}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: 'x' });

let joao; // token
const DEVICE = 'device-aaaaaaaaaaaaaaaa';

test('registers a person', async () => {
  const r = await call('POST', '/auth/register', { name: 'João Silva', email: 'Joao.Silva+pdf@gmail.com', phone: '+55 (11) 98765-4321', password: 'segura123', deviceId: DEVICE });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.token);
  assert.equal(r.body.user.email, 'joao.silva+pdf@gmail.com');
  assert.equal(r.body.user.verified, false);
  joao = r.body.token;
});

test('same inbox via gmail dots/plus/googlemail is a duplicate', async () => {
  for (const email of ['joaosilva@gmail.com', 'j.o.a.o.s.i.l.v.a@googlemail.com', 'JOAOSILVA+outra@gmail.com']) {
    const r = await call('POST', '/auth/register', { name: 'Clone', email, phone: '+5521999990001', password: 'segura123' });
    assert.equal(r.status, 409, email);
    assert.equal(r.body.code, 'EMAIL_TAKEN');
  }
});

test('same phone typed differently is a duplicate (with or without the 9th digit)', async () => {
  for (const phone of ['+5511987654321', '+55 11 8765-4321', '0055 011 98765 4321']) {
    const r = await call('POST', '/auth/register', { name: 'Clone', email: `x${Math.random()}@outlook.com`.replace('0.', ''), phone, password: 'segura123' });
    assert.equal(r.status, 409, phone);
    assert.equal(r.body.code, 'PHONE_TAKEN');
  }
});

test('rejects throwaway e-mails, landlines and weak passwords', async () => {
  let r = await call('POST', '/auth/register', { name: 'Temp', email: 'a@yopmail.com', phone: '+5531988887777', password: 'segura123' });
  assert.equal(r.body.code, 'EMAIL_DISPOSABLE');
  r = await call('POST', '/auth/register', { name: 'Fixo', email: 'fixo@uol.com.br', phone: '+55 11 3456-7890', password: 'segura123' });
  assert.equal(r.body.code, 'PHONE_LANDLINE');
  r = await call('POST', '/auth/register', { name: 'Fraca', email: 'fraca@uol.com.br', phone: '+5531988887777', password: '12345678' });
  assert.equal(r.body.code, 'PASSWORD_WEAK');
});

test('caps accounts per device', async () => {
  let r = await call('POST', '/auth/register', { name: 'Maria', email: 'maria@uol.com.br', phone: '+5531988887777', password: 'segura123', deviceId: DEVICE });
  assert.equal(r.status, 201);
  r = await call('POST', '/auth/register', { name: 'Terceira', email: 'terceira@uol.com.br', phone: '+5531988887778', password: 'segura123', deviceId: DEVICE });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'DEVICE_LIMIT');
});

test('logs in with e-mail alias or phone, and locks after 5 wrong passwords', async () => {
  let r = await call('POST', '/auth/login', { identifier: 'JoaoSilva@gmail.com', password: 'segura123' });
  assert.equal(r.status, 200);
  r = await call('POST', '/auth/login', { identifier: '+55 11 98765-4321', password: 'segura123' });
  assert.equal(r.status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { identifier: 'maria@uol.com.br', password: 'errada000' })).status, 401);
  r = await call('POST', '/auth/login', { identifier: 'maria@uol.com.br', password: 'segura123' });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'LOCKED');
});

test('/auth/me needs a valid session', async () => {
  assert.equal((await call('GET', '/auth/me')).status, 401);
  assert.equal((await call('GET', '/auth/me', null, 'forged')).status, 401);
  const r = await call('GET', '/auth/me', null, joao);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.phone, '+55 ••••• 4321');
});

test('verifies e-mail and phone with 6-digit codes', async () => {
  for (const channel of ['email', 'phone']) {
    let r = await call('POST', '/auth/verify/send', { channel }, joao);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await call('POST', '/auth/verify/send', { channel }, joao);
    assert.equal(r.body.code, 'COOLDOWN');
    await new Promise((res) => setTimeout(res, 200));
    const code = [...logs.matchAll(new RegExp(`código ${channel} para [^:]+: (\\d{6})`, 'g'))].pop()[1];
    r = await call('POST', '/auth/verify/confirm', { channel, code: code === '000000' ? '111111' : '000000' }, joao);
    assert.equal(r.body.code, 'CODE_WRONG');
    r = await call('POST', '/auth/verify/confirm', { channel, code }, joao);
    assert.equal(r.status, 200);
    assert.equal(r.body.user[channel === 'email' ? 'emailVerified' : 'phoneVerified'], true);
  }
  assert.equal((await call('GET', '/auth/me', null, joao)).body.user.verified, true);
});

test('freemium: heavy tools need an account, basic tools are open', async () => {
  let r = await pdf('misc/ocr-pdf');
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, 'AUTH_REQUIRED');
  r = await pdf('convert/pdf/word');
  assert.equal(r.status, 401);
  r = await pdf('general/merge-pdfs');
  assert.equal(r.status, 200);
  r = await pdf('misc/ocr-pdf', joao);
  assert.equal(r.status, 200);
});

test('the customer session token never reaches the PDF engine', () => {
  assert.ok(engineSaw.length >= 2);
  for (const hit of engineSaw) assert.notEqual(hit.auth, `Bearer ${joao}`);
});

test('daily quota: anonymous 3/day, free plan 4/day', async () => {
  // anonymous already used 1 (merge above)
  assert.equal((await pdf('general/rotate-pdf')).status, 200);
  assert.equal((await pdf('general/rotate-pdf')).status, 200);
  let r = await pdf('general/rotate-pdf');
  assert.equal(r.status, 429);
  assert.equal((await r.json()).anonymous, true);
  // logged in user has used 1 (ocr above)
  for (let i = 0; i < 3; i++) assert.equal((await pdf('general/rotate-pdf', joao)).status, 200);
  r = await pdf('general/rotate-pdf', joao);
  assert.equal(r.status, 429);
  const me = await call('GET', '/auth/me', null, joao);
  assert.deepEqual(me.body.usage, { used: 4, limit: 4, remaining: 0 });
});

test('JSON store is private to each account', async () => {
  assert.equal((await call('GET', '/api/store/pdf-history')).status, 401);
  const maria = (await call('POST', '/auth/login', { identifier: '+5531988887777', password: 'segura123' }));
  // maria is locked from the previous test; use a fresh account instead
  assert.equal(maria.status, 429);
  const ana = (await call('POST', '/auth/register', { name: 'Ana', email: 'ana@terra.com.br', phone: '+5541977776666', password: 'segura123' })).body.token;
  await call('PUT', '/api/store/pdf-history', { id: 'doc-1', name: 'contrato-joao.pdf' }, joao);
  assert.equal((await call('GET', '/api/store/pdf-history', null, joao)).body.length, 1);
  assert.equal((await call('GET', '/api/store/pdf-history', null, ana)).body.length, 0);
});

test('logout kills the session', async () => {
  const t = (await call('POST', '/auth/login', { identifier: 'ana@terra.com.br', password: 'segura123' })).body.token;
  assert.equal((await call('POST', '/auth/logout', null, t)).status, 200);
  assert.equal((await call('GET', '/auth/me', null, t)).status, 401);
});

test('passwords and tokens are not stored in clear', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(DATA, 'accounts.db'));
  const u = db.prepare("SELECT password_hash FROM users WHERE email_canonical = 'joaosilva@gmail.com'").get();
  assert.match(u.password_hash, /^scrypt\$/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(joao).n, 0);
  db.close();
});
