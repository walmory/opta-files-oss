/**
 * Delivery of verification codes. Every channel is optional and chosen in .env:
 *
 *   EMAIL_VERIFICATION = off | console | resend
 *   PHONE_VERIFICATION = off | console | whatsapp | twilio
 *
 * `off`      the channel is not verified at all (default — no cost, no provider needed).
 * `console`  the code is printed in the server log. For development and testing only.
 * `resend`   e-mail through resend.com (free tier: 3,000 e-mails/month). RESEND_API_KEY, EMAIL_FROM.
 * `whatsapp` WhatsApp through a self-hosted Evolution API (free, uses your own number).
 *            EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE.
 * `twilio`   SMS through Twilio (paid). TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM.
 */
const axios = require('axios');

const mode = (name, allowed) => {
  const v = String(process.env[name] || 'off').trim().toLowerCase();
  return allowed.includes(v) ? v : 'off';
};
const EMAIL_MODE = mode('EMAIL_VERIFICATION', ['off', 'console', 'resend']);
const PHONE_MODE = mode('PHONE_VERIFICATION', ['off', 'console', 'whatsapp', 'twilio']);
const APP = process.env.APP_NAME || 'Opta Files';

const text = (code) => `${APP}: seu código de verificação é ${code}. Ele expira em 10 minutos. Não compartilhe com ninguém.`;

const senders = {
  console: async (channel, to, code) => {
    console.log(`[opta-files] (dev) código ${channel} para ${to}: ${code}`);
  },
  resend: async (_channel, to, code) => {
    await axios.post('https://api.resend.com/emails', {
      from: process.env.EMAIL_FROM,
      to: [to],
      subject: `${code} é o seu código ${APP}`,
      text: text(code),
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px">
        <h2 style="margin:0 0 8px">${APP}</h2><p>Use este código para confirmar seu e-mail:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>
        <p style="color:#64748b;font-size:13px">Ele expira em 10 minutos. Se não foi você, ignore este e-mail.</p></div>`
    }, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, timeout: 10_000 });
  },
  whatsapp: async (_channel, to, code) => {
    const base = String(process.env.EVOLUTION_URL || '').replace(/\/$/, '');
    await axios.post(`${base}/message/sendText/${encodeURIComponent(process.env.EVOLUTION_INSTANCE || '')}`,
      { number: to.replace('+', ''), text: text(code) },
      { headers: { apikey: process.env.EVOLUTION_API_KEY }, timeout: 10_000 });
  },
  twilio: async (_channel, to, code) => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      new URLSearchParams({ To: to, From: process.env.TWILIO_FROM || '', Body: text(code) }),
      { auth: { username: sid, password: process.env.TWILIO_AUTH_TOKEN || '' }, timeout: 10_000 });
  }
};

const enabled = { email: EMAIL_MODE !== 'off', phone: PHONE_MODE !== 'off' };

/** Sends a code; throws on provider failure (the caller turns it into product copy). */
const sendCode = (channel, to, code) => {
  const m = channel === 'email' ? EMAIL_MODE : PHONE_MODE;
  if (m === 'off') throw new Error(`channel ${channel} disabled`);
  return senders[m](channel, to, code);
};

module.exports = { sendCode, enabled, EMAIL_MODE, PHONE_MODE };
