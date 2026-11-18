/**
 * Identity normalisation — the heart of "one person, one account".
 *
 * Uniqueness is enforced on the CANONICAL form of the e-mail and the phone, so the usual
 * tricks to open a second account with the same inbox or the same SIM are rejected:
 *   joao.silva+teste@gmail.com, JoaoSilva@googlemail.com  →  joaosilva@gmail.com
 *   (11) 8765-4321 typed without the 9, +55 11 98765-4321 →  +5511987654321
 */

// Throwaway inbox providers. Not exhaustive — extend with BLOCKED_EMAIL_DOMAINS in .env.
const DISPOSABLE = new Set(`
10minemail.com 10minutemail.com 10minutemail.net 10mail.org 1secmail.com 1secmail.net 1secmail.org
20minutemail.com bccto.me burnermail.io byom.de chacuo.net cool.fr.nf courriel.fr.nf crazymailing.com
discard.email discardmail.com dispostable.com dpptd.com dropmail.me emailfake.com email-fake.com
emailondeck.com emltmp.com esiix.com ezztt.com fakeinbox.com fakemail.net fakemailgenerator.com
fexbox.org fexpost.com getairmail.com getnada.com grr.la guerrillamail.biz guerrillamail.com
guerrillamail.de guerrillamail.net guerrillamail.org guerrillamailblock.com harakirimail.com
icznn.com inboxkitten.com incognitomail.org jetable.fr.nf kzccv.com laafd.com linshiyouxiang.net
luxusmail.org mail.gw mail.tm mailcatch.com maildrop.cc mailforspam.com mailinator.com mailinator.net
mailnesia.com mailpoof.com mailsac.com mailto.plus mega.zik.dj minuteinbox.com mintemail.com moakt.com
mohmal.com moncourrier.fr.nf monemail.fr.nf monmail.fr.nf mytemp.email nada.email nomail.xl.cx
nospam.ze.tc owlymail.com pokemail.net qiott.com rover.info sharklasers.com snapmail.cc spam4.me
spambox.us spamfree24.org spamgourmet.com speed.1s.fr tempail.com tempemail.net tempinbox.com
tempm.com tempmail.com tempmail.dev tempmail.email tempmail.net tempmail.plus tempmailaddress.com
tempmailo.com temp-mail.io temp-mail.org tempr.email throwawaymail.com tmail.ws tmpmail.net
tmpmail.org trashmail.com trashmail.de trashmail.me trashmail.net trbvm.com txcct.com vomoto.com
wuuvo.com wwjmp.com xojxe.com yoggm.com yopmail.com yopmail.fr yopmail.net
`.split(/\s+/).filter(Boolean));
for (const d of (process.env.BLOCKED_EMAIL_DOMAINS || '').split(',')) if (d.trim()) DISPOSABLE.add(d.trim().toLowerCase());

// Providers that ignore dots in the local part.
const DOTLESS = new Set(['gmail.com']);
const DOMAIN_ALIASES = { 'googlemail.com': 'gmail.com' };

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

class IdentityError extends Error {
  constructor(field, code, message) {
    super(message);
    this.field = field;
    this.code = code;
  }
}

const isDisposable = (domain) => {
  const parts = domain.split('.');
  // match the domain and every parent (anything.yopmail.com is still yopmail)
  for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE.has(parts.slice(i).join('.'))) return true;
  return false;
};

/** @returns {{ email: string, canonical: string }} */
const normalizeEmail = (raw) => {
  const email = String(raw || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new IdentityError('email', 'EMAIL_INVALID', 'Informe um e-mail válido.');
  let [local, domain] = [email.slice(0, email.lastIndexOf('@')), email.slice(email.lastIndexOf('@') + 1)];
  if (isDisposable(domain)) throw new IdentityError('email', 'EMAIL_DISPOSABLE', 'E-mails temporários não são aceitos. Use seu e-mail pessoal.');
  domain = DOMAIN_ALIASES[domain] || domain;
  local = local.split('+')[0]; // plus-addressing: joao+x@ is the same inbox as joao@
  if (DOTLESS.has(domain)) local = local.replace(/\./g, '');
  if (!local) throw new IdentityError('email', 'EMAIL_INVALID', 'Informe um e-mail válido.');
  return { email, canonical: `${local}@${domain}` };
};

/** Accepts anything a human types and returns strict E.164. */
const normalizePhone = (raw) => {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (!digits.startsWith('+')) throw new IdentityError('phone', 'PHONE_INVALID', 'Informe o telefone com o código do país.');
  digits = digits.slice(1).replace(/\+/g, '');

  if (digits.startsWith('55')) {
    // Brazil: +55 DDD number. Mobiles have 9 digits starting with 9; the old 8-digit form
    // (before the "nono dígito") is the same line, so it is upgraded to keep uniqueness honest.
    const rest = digits.slice(2).replace(/^0+/, ''); // trunk prefix: +55 011 … → +55 11 …
    const ddd = rest.slice(0, 2);
    let num = rest.slice(2);
    if (!/^[1-9][1-9]$/.test(ddd)) throw new IdentityError('phone', 'PHONE_INVALID', 'DDD inválido.');
    if (num.length === 8 && /^[6-9]/.test(num)) num = '9' + num;
    if (num.length === 8) throw new IdentityError('phone', 'PHONE_LANDLINE', 'Use um número de celular (fixo não recebe o código).');
    if (!/^9\d{8}$/.test(num)) throw new IdentityError('phone', 'PHONE_INVALID', 'Número de celular inválido.');
    return `+55${ddd}${num}`;
  }
  if (digits.startsWith('351')) {
    // Portugal: mobiles are 9 digits starting with 9.
    const num = digits.slice(3);
    if (!/^9[1236]\d{7}$/.test(num)) throw new IdentityError('phone', 'PHONE_INVALID', 'Número de telemóvel inválido.');
    return `+351${num}`;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new IdentityError('phone', 'PHONE_INVALID', 'Número de telefone inválido.');
  return `+${digits}`;
};

const normalizeName = (raw) => {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) throw new IdentityError('name', 'NAME_INVALID', 'Informe seu nome.');
  return name;
};

const maskEmail = (e) => e.replace(/^(.{1,2})[^@]*(@.*)$/, (_, a, b) => `${a}•••${b}`);
const maskPhone = (p) => `${p.slice(0, 3)} ••••• ${p.slice(-4)}`;

module.exports = { normalizeEmail, normalizePhone, normalizeName, maskEmail, maskPhone, isDisposable, IdentityError };
