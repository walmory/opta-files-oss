/**
 * QR Code payload builders.
 * Each QR type declares its own form fields; `buildQrValue` turns the collected values
 * into the string that gets encoded, following the usual de-facto standards
 * (WIFI:, MECARD/vCard, mailto:, tel:, SMSTO:) and the BACEN EMV BR Code for PIX.
 */
import { Link2, Type, Wifi, Contact, Mail, Phone, MessageCircle, MessageSquare, QrCode, type LucideIcon } from 'lucide-react';

export type QrType = 'url' | 'text' | 'wifi' | 'vcard' | 'email' | 'phone' | 'whatsapp' | 'sms' | 'pix';

export interface QrField {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'number';
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  /** render two fields side by side */
  half?: boolean;
}

export interface QrTypeDef {
  id: QrType;
  label: string;
  description: string;
  icon: LucideIcon;
  fields: QrField[];
}

export const QR_TYPES: QrTypeDef[] = [
  {
    id: 'url',
    label: 'Link (URL)',
    description: 'Abre um site ao escanear.',
    icon: Link2,
    fields: [{ key: 'url', label: 'Endereço', placeholder: 'https://exemplo.com', required: true }]
  },
  {
    id: 'text',
    label: 'Texto',
    description: 'Qualquer texto livre.',
    icon: Type,
    fields: [{ key: 'text', label: 'Texto', type: 'textarea', placeholder: 'Escreva aqui…', required: true }]
  },
  {
    id: 'wifi',
    label: 'Wi-Fi',
    description: 'Conecta o celular à rede sem digitar senha.',
    icon: Wifi,
    fields: [
      { key: 'ssid', label: 'Nome da rede (SSID)', placeholder: 'MinhaRede', required: true },
      { key: 'password', label: 'Senha', placeholder: '••••••••' },
      { key: 'encryption', label: 'Segurança', type: 'select', half: true, options: [{ value: 'WPA', label: 'WPA/WPA2/WPA3' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: 'Sem senha' }] },
      { key: 'hidden', label: 'Rede oculta', type: 'select', half: true, options: [{ value: 'false', label: 'Não' }, { value: 'true', label: 'Sim' }] }
    ]
  },
  {
    id: 'vcard',
    label: 'Contato (vCard)',
    description: 'Salva o contato na agenda.',
    icon: Contact,
    fields: [
      { key: 'firstName', label: 'Nome', half: true, required: true },
      { key: 'lastName', label: 'Sobrenome', half: true },
      { key: 'org', label: 'Empresa', half: true },
      { key: 'title', label: 'Cargo', half: true },
      { key: 'phone', label: 'Telefone', placeholder: '+351 912 345 678', half: true },
      { key: 'email', label: 'E-mail', placeholder: 'nome@empresa.com', half: true },
      { key: 'website', label: 'Site', placeholder: 'https://empresa.com' },
      { key: 'address', label: 'Endereço', placeholder: 'Rua, nº, cidade, país' },
      { key: 'note', label: 'Observação', type: 'textarea' }
    ]
  },
  {
    id: 'email',
    label: 'E-mail',
    description: 'Abre o app de e-mail com a mensagem pronta.',
    icon: Mail,
    fields: [
      { key: 'to', label: 'Destinatário', placeholder: 'nome@empresa.com', required: true },
      { key: 'subject', label: 'Assunto' },
      { key: 'body', label: 'Mensagem', type: 'textarea' }
    ]
  },
  {
    id: 'phone',
    label: 'Telefone',
    description: 'Inicia uma chamada.',
    icon: Phone,
    fields: [{ key: 'phone', label: 'Número', placeholder: '+351 912 345 678', required: true }]
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    description: 'Abre a conversa com mensagem sugerida.',
    icon: MessageCircle,
    fields: [
      { key: 'phone', label: 'Número (com código do país)', placeholder: '+351 912 345 678', required: true, help: 'Só dígitos são enviados; o “+” e espaços são ignorados.' },
      { key: 'message', label: 'Mensagem inicial', type: 'textarea', placeholder: 'Olá! Gostaria de um orçamento…' }
    ]
  },
  {
    id: 'sms',
    label: 'SMS',
    description: 'Abre o app de mensagens.',
    icon: MessageSquare,
    fields: [
      { key: 'phone', label: 'Número', placeholder: '+351 912 345 678', required: true },
      { key: 'message', label: 'Mensagem', type: 'textarea' }
    ]
  },
  {
    id: 'pix',
    label: 'PIX (copia e cola)',
    description: 'BR Code estático do Banco Central para receber pagamentos.',
    icon: QrCode,
    fields: [
      { key: 'key', label: 'Chave PIX', placeholder: 'CPF/CNPJ, e-mail, telefone ou aleatória', required: true },
      { key: 'name', label: 'Nome do recebedor', placeholder: 'EMPRESA LDA', required: true, half: true, help: 'Máx. 25 caracteres.' },
      { key: 'city', label: 'Cidade', placeholder: 'LISBOA', required: true, half: true, help: 'Máx. 15 caracteres.' },
      { key: 'amount', label: 'Valor (R$)', type: 'number', placeholder: 'opcional', half: true },
      { key: 'txid', label: 'Identificador', placeholder: '***', half: true, help: 'Sem espaços, máx. 25 caracteres.' },
      { key: 'description', label: 'Descrição', placeholder: 'opcional' }
    ]
  }
];

export const findQrType = (id: QrType) => QR_TYPES.find((t) => t.id === id) as QrTypeDef;

const wifiEscape = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
const vcardEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const digits = (s: string) => s.replace(/[^\d]/g, '');
/** Strips accents/symbols the EMV spec does not accept and clips to a max length. */
const emvText = (s: string, max: number) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, max);

/** EMV field: 2-digit id + 2-digit length + value */
const emv = (id: string, value: string) => (value ? `${id}${String(value.length).padStart(2, '0')}${value}` : '');

/** CRC16/CCITT-FALSE, as required by the BR Code spec (field 63). */
const crc16 = (payload: string) => {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

export const buildPixPayload = (v: Record<string, string>) => {
  const key = emvText(v.key || '', 77);
  if (!key) return '';
  // Field 26 holds at most 99 chars: 18 for the GUI + 4 + key + 4 + description.
  const descMax = Math.max(0, 73 - key.length);
  const account = emv('00', 'br.gov.bcb.pix') + emv('01', key) + emv('02', emvText(v.description || '', descMax));
  const amount = (v.amount || '').replace(',', '.').trim();
  const numericAmount = amount && Number(amount) > 0 ? Number(amount).toFixed(2) : '';
  const txid = emvText(v.txid || '', 25).replace(/\s/g, '') || '***';
  const body =
    emv('00', '01') +
    emv('01', '11') +
    emv('26', account) +
    emv('52', '0000') +
    emv('53', '986') +
    emv('54', numericAmount) +
    emv('58', 'BR') +
    emv('59', emvText(v.name || '', 25) || 'RECEBEDOR') +
    emv('60', emvText(v.city || '', 15) || 'CIDADE') +
    emv('62', emv('05', txid));
  const withTag = `${body}6304`;
  return `${withTag}${crc16(withTag)}`;
};

/** Turns the form values of a given type into the string encoded in the QR. */
export const buildQrValue = (type: QrType, v: Record<string, string>): string => {
  const val = (k: string) => (v[k] || '').trim();
  switch (type) {
    case 'url': {
      const url = val('url');
      if (!url) return '';
      return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    }
    case 'text':
      return val('text');
    case 'wifi': {
      const ssid = val('ssid');
      if (!ssid) return '';
      const enc = val('encryption') || 'WPA';
      const pass = enc === 'nopass' ? '' : val('password');
      return `WIFI:T:${enc};S:${wifiEscape(ssid)};${pass ? `P:${wifiEscape(pass)};` : ''}${val('hidden') === 'true' ? 'H:true;' : ''};`;
    }
    case 'vcard': {
      const first = val('firstName');
      const last = val('lastName');
      if (!first && !last) return '';
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${vcardEscape(last)};${vcardEscape(first)};;;`,
        `FN:${vcardEscape([first, last].filter(Boolean).join(' '))}`,
        val('org') && `ORG:${vcardEscape(val('org'))}`,
        val('title') && `TITLE:${vcardEscape(val('title'))}`,
        val('phone') && `TEL;TYPE=CELL:${vcardEscape(val('phone'))}`,
        val('email') && `EMAIL;TYPE=INTERNET:${vcardEscape(val('email'))}`,
        val('website') && `URL:${vcardEscape(val('website'))}`,
        val('address') && `ADR;TYPE=WORK:;;${vcardEscape(val('address'))}`,
        val('note') && `NOTE:${vcardEscape(val('note'))}`,
        'END:VCARD'
      ];
      return lines.filter(Boolean).join('\n');
    }
    case 'email': {
      const to = val('to');
      if (!to) return '';
      const params = [val('subject') && `subject=${encodeURIComponent(val('subject'))}`, val('body') && `body=${encodeURIComponent(val('body'))}`].filter(Boolean).join('&');
      return `mailto:${to}${params ? `?${params}` : ''}`;
    }
    case 'phone': {
      const phone = val('phone');
      return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : '';
    }
    case 'whatsapp': {
      const phone = digits(val('phone'));
      if (!phone) return '';
      const msg = val('message');
      return `https://wa.me/${phone}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
    }
    case 'sms': {
      const phone = val('phone');
      if (!phone) return '';
      const msg = val('message');
      return `SMSTO:${phone.replace(/[^\d+]/g, '')}${msg ? `:${msg}` : ''}`;
    }
    case 'pix':
      return buildPixPayload(v);
    default:
      return '';
  }
};

/** Suggested file name (without extension) for the generated code. */
export const qrFileName = (type: QrType, v: Record<string, string>) => {
  const raw =
    type === 'url' ? (v.url || '').replace(/^https?:\/\//, '') : type === 'wifi' ? v.ssid : type === 'vcard' ? [v.firstName, v.lastName].filter(Boolean).join('-') : type === 'pix' ? v.name : type === 'email' ? v.to : type === 'text' ? (v.text || '').slice(0, 24) : v.phone;
  const slug = (raw || type)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `qrcode-${slug || type}`;
};
