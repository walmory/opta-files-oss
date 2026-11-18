/**
 * Readable report for `security/validate-signature`.
 *
 * The engine answers with an array (one entry per signature in the document) carrying the raw
 * PKCS#7 / X.509 facts. Dumping that JSON tells the user nothing, so we turn each entry into a
 * card with a verdict headline plus the five checks that actually decide whether a signature
 * can be trusted: integrity, chain, trust anchor, validity window and revocation.
 */
import { AlertTriangle, CalendarClock, CheckCircle2, Fingerprint, ShieldAlert, ShieldCheck, ShieldX, XCircle } from 'lucide-react';
import { cn } from '../../../components/ui';

export interface SignatureInfo {
  valid?: boolean;
  coversEntireDocument?: boolean;
  chainValid?: boolean;
  chainValidationError?: string | null;
  trustValid?: boolean;
  notExpired?: boolean;
  selfSigned?: boolean;
  revocationChecked?: boolean;
  revocationStatus?: string | null;
  signerName?: string | null;
  subjectDN?: string | null;
  issuerDN?: string | null;
  signatureDate?: string | null;
  reason?: string | null;
  location?: string | null;
  signatureAlgorithm?: string | null;
  keySize?: number | null;
  serialNumber?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  errorMessage?: string | null;
}

/** Engine dates come as `Fri Sep 04 14:18:03 UTC 2026`; fall back to the raw string if unparseable. */
const fmtDate = (raw?: string | null) => {
  if (!raw) return '—';
  const t = Date.parse(raw);
  return Number.isNaN(t) ? raw : new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

/** Pulls CN= out of a DN, which is the only part a human cares about. */
const cn_ = (dn?: string | null) => (dn ? (dn.match(/CN=([^,]+)/i)?.[1] ?? dn) : '—');

type State = 'ok' | 'bad' | 'warn';

const Check = ({ state, label, detail }: { state: State; label: string; detail: string }) => {
  const Icon = state === 'ok' ? CheckCircle2 : state === 'bad' ? XCircle : AlertTriangle;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', state === 'ok' ? 'text-emerald-600' : state === 'bad' ? 'text-red-600' : 'text-amber-500')} />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-800">{label}</p>
        <p className="text-[11px] text-slate-500 break-words">{detail}</p>
      </div>
    </div>
  );
};

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className="text-xs text-slate-700 break-words">{value}</dd>
  </div>
);

const SignatureCard = ({ sig, index, total }: { sig: SignatureInfo; index: number; total: number }) => {
  const intact = sig.valid === true && sig.coversEntireDocument !== false;
  const trusted = intact && sig.chainValid === true && sig.trustValid === true && sig.notExpired !== false;
  const headline = !intact
    ? { Icon: ShieldX, tone: 'bg-red-50 text-red-700 border-red-200', title: 'Assinatura inválida', text: sig.errorMessage || 'O documento foi alterado depois de assinado ou a assinatura está corrompida.' }
    : trusted
      ? { Icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', title: 'Assinatura válida e confiável', text: 'Documento íntegro e certificado emitido por uma autoridade reconhecida.' }
      : { Icon: ShieldAlert, tone: 'bg-amber-50 text-amber-700 border-amber-200', title: 'Documento íntegro, certificado não confiável', text: sig.selfSigned ? 'O certificado é autoassinado: comprova que nada mudou, mas não prova quem assinou.' : sig.chainValidationError || 'Não foi possível ligar o certificado a uma autoridade confiável.' };

  const revocation: [State, string] = sig.revocationChecked
    ? /good|valid|not[-_ ]?revoked/i.test(sig.revocationStatus ?? '') ? ['ok', 'Certificado não revogado.'] : ['bad', `Situação: ${sig.revocationStatus ?? 'revogado'}.`]
    : ['warn', 'Não consultada (sem CRL/OCSP disponível no momento da validação).'];

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      {total > 1 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
          <Fingerprint className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[11px] font-semibold text-slate-600">Assinatura {index + 1} de {total}</span>
        </div>
      )}
      <div className={cn('flex items-start gap-3 px-4 py-3 border-b', headline.tone)}>
        <headline.Icon className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{headline.title}</p>
          <p className="text-xs opacity-80 break-words">{headline.text}</p>
        </div>
      </div>

      <div className="p-4 space-y-4 bg-white">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Assinado por" value={sig.signerName || cn_(sig.subjectDN)} />
          <Field label="Emissor" value={cn_(sig.issuerDN)} />
          <Field label="Data da assinatura" value={fmtDate(sig.signatureDate)} />
          {sig.reason ? <Field label="Motivo" value={sig.reason} /> : null}
          {sig.location ? <Field label="Local" value={sig.location} /> : null}
          <Field label="Algoritmo" value={[sig.signatureAlgorithm, sig.keySize ? `${sig.keySize} bits` : ''].filter(Boolean).join(' · ') || '—'} />
        </dl>

        <div className="grid sm:grid-cols-2 gap-2">
          <Check
            state={intact ? 'ok' : 'bad'}
            label="Integridade do documento"
            detail={intact ? (sig.coversEntireDocument ? 'Nada foi alterado depois da assinatura.' : 'Válida, mas cobre apenas parte do documento.') : 'O conteúdo não confere com a assinatura.'}
          />
          <Check
            state={sig.chainValid ? 'ok' : 'bad'}
            label="Cadeia de certificação"
            detail={sig.chainValid ? 'Ligada a uma autoridade certificadora.' : sig.chainValidationError || 'Não foi possível montar a cadeia até uma raiz conhecida.'}
          />
          <Check
            state={sig.trustValid ? 'ok' : sig.selfSigned ? 'warn' : 'bad'}
            label="Confiança do certificado"
            detail={sig.trustValid ? 'A raiz é reconhecida.' : sig.selfSigned ? 'Certificado autoassinado — sirva-o apenas para uso interno.' : 'A raiz não está entre as autoridades confiáveis.'}
          />
          <Check
            state={sig.notExpired === false ? 'bad' : 'ok'}
            label="Vigência do certificado"
            detail={`${fmtDate(sig.validFrom)} até ${fmtDate(sig.validUntil)}`}
          />
          <Check state={revocation[0]} label="Revogação" detail={revocation[1]} />
          <Check
            state={sig.signatureDate ? 'warn' : 'bad'}
            label="Carimbo do tempo"
            detail={sig.signatureDate ? 'Data declarada pelo signatário, sem carimbo de uma autoridade de tempo (PAdES B-T).' : 'Sem data de assinatura.'}
          />
        </div>

        {sig.serialNumber ? (
          <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
            <CalendarClock className="h-3 w-3" />
            Série do certificado: <span className="font-mono break-all">{sig.serialNumber}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
};

export const SignatureReport = ({ data }: { data: unknown }) => {
  const list = (Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : []) as SignatureInfo[];
  if (!list.length) {
    return (
      <div className="p-6 text-center">
        <ShieldAlert className="h-6 w-6 mx-auto text-slate-300 mb-2" />
        <p className="text-sm font-medium text-slate-700">Nenhuma assinatura digital encontrada</p>
        <p className="text-xs text-slate-500 mt-1">Este PDF não foi assinado com certificado. Um carimbo visual desenhado na página não é uma assinatura digital.</p>
      </div>
    );
  }
  return <div className="p-3 space-y-3 max-h-[520px] overflow-auto custom-scrollbar">{list.map((sig, i) => <SignatureCard key={i} sig={sig} index={i} total={list.length} />)}</div>;
};
