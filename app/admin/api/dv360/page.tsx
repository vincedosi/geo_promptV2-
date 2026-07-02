'use client';

import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { PROVIDERS, C, fInter, fMono } from '../_lib/constants';
import type { DspConnectionPublic, DspApiLogRow } from '@/types/dsp';

type Method = 'service_account' | 'oauth';

interface Dv360Config {
  env: {
    enc_key: boolean;
    oauth_client_id: boolean;
    oauth_client_secret: boolean;
    oauth_redirect_uri: boolean;
    redirect_uri_value: string | null;
  };
  ready: { service_account: boolean; oauth: boolean };
}

export default function Dv360Page() {
  const { toast } = useToast();
  const provider = PROVIDERS.find((p) => p.key === 'dv360')!;

  const [conn, setConn] = useState<DspConnectionPublic | null>(null);
  const [config, setConfig] = useState<Dv360Config | null>(null);
  const [logs, setLogs] = useState<DspApiLogRow[]>([]);
  const [logsBusy, setLogsBusy] = useState(false);
  const [method, setMethod] = useState<Method>('service_account');
  const [partnerId, setPartnerId] = useState('');
  const [saJson, setSaJson] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/dsp/connections');
      const json = await res.json();
      const dv = (json.connections ?? []).find((c: DspConnectionPublic) => c.provider === 'dv360') ?? null;
      setConn(dv);
      if (dv?.partner_id) setPartnerId(dv.partner_id);
      if (dv?.oauth_client_id) setClientId(dv.oauth_client_id);
      if (dv?.auth_method === 'service_account' || dv?.auth_method === 'oauth') setMethod(dv.auth_method);
    } catch {
      toast.error('Impossible de charger la connexion DV360.');
    }
  }, [toast]);

  const loadConfig = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/config');
      const json = await res.json();
      if (res.ok) setConfig(json as Dv360Config);
    } catch { /* le panneau affichera "diagnostic indisponible" */ }
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/logs?provider=dv360&limit=20');
      const json = await res.json();
      if (res.ok) setLogs((json.logs ?? []) as DspApiLogRow[]);
    } catch { /* ignore : flux de logs best-effort */ }
    finally { setLogsBusy(false); }
  }, []);

  useEffect(() => { load(); loadConfig(); loadLogs(); }, [load, loadConfig, loadLogs]);

  // Retour OAuth (query ?oauth=success|error) — lu côté client pour éviter
  // la contrainte Suspense de useSearchParams() au build Next 14.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const o = params.get('oauth');
    if (o === 'success') toast.success('DV360 connecté via Google.');
    else if (o === 'error') toast.error(`Échec OAuth : ${params.get('reason') ?? 'inconnu'}`);
  }, [toast]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_method: method, partner_id: partnerId, service_account_json: saJson }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      toast.success('Connexion enregistrée.');
      setSaJson('');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); loadLogs(); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/test', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      toast.success(`Connexion OK — ${json.advertisers?.length ?? 0} advertisers.`);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); loadLogs(); }
  };

  const saveOAuthConfig = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/oauth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_id: partnerId, oauth_client_id: clientId, oauth_client_secret: clientSecret }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      toast.success('Config OAuth enregistrée.');
      setClientSecret('');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); loadLogs(); }
  };

  const startOAuth = async () => {
    if (!partnerId) { toast.error('Renseigne le Partner ID avant de connecter Google.'); return; }
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_id: partnerId }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Erreur');
      window.location.href = json.url; // détour consentement Google
    } catch (e) { toast.error((e as Error).message); setBusy(false); loadLogs(); }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/connect', { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Erreur déconnexion');
      toast.success('Déconnecté.');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); loadLogs(); }
  };

  const status = conn?.status ?? 'disconnected';
  const statusColor = status === 'connected' ? C.green : status === 'error' ? C.red : C.textDim;

  // Testable seulement si des credentials existent réellement (clé SA ou refresh
  // token) — évite le faux « status: error » quand le flux OAuth n'est pas fini.
  const canTest = Boolean(conn?.has_credentials);

  // Config serveur insuffisante pour la méthode choisie → on bloque + on explique.
  // OAuth est prêt si les env vars sont là OU si un client OAuth a été saisi par formulaire.
  const oauthClientReady = Boolean(config?.ready.oauth || conn?.oauth_client_id);
  const methodReady = method === 'oauth' ? oauthClientReady : config?.ready.service_account;
  const configKnown = config !== null;

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <img src={provider?.logo} alt="DV360" style={{ height: 28 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: fMono, fontSize: 12, color: statusColor }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
          {status === 'connected' ? 'Connecté' : status === 'error' ? 'Erreur' : 'Déconnecté'}
        </span>
      </div>

      {/* ── Diagnostic config serveur ───────────────────────────── */}
      <SectionHeader title="Diagnostic — configuration serveur" />
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 16, marginBottom: 16 }}>
        {!configKnown ? (
          <span style={{ fontFamily: fMono, fontSize: 11, color: C.textDim }}>Diagnostic indisponible.</span>
        ) : (
          <>
            <ConfigRow label="Chiffrement des secrets (DSP_ENC_KEY)" ok={config!.env.enc_key} />
            <ConfigRow label="OAuth — Client ID (DV360_OAUTH_CLIENT_ID)" ok={config!.env.oauth_client_id} />
            <ConfigRow label="OAuth — Client Secret (DV360_OAUTH_CLIENT_SECRET)" ok={config!.env.oauth_client_secret} />
            <ConfigRow
              label="OAuth — Redirect URI"
              ok={config!.env.oauth_redirect_uri}
              value={config!.env.redirect_uri_value ?? undefined}
            />
            <ConfigRow
              label="OAuth — Client de l'organisation (formulaire)"
              ok={Boolean(conn?.oauth_client_id)}
              value={conn?.oauth_client_id ?? undefined}
            />
            <div style={{ display: 'flex', gap: 16, marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${C.border}` }}>
              <ReadyPill label="Service Account" ok={config!.ready.service_account} />
              <ReadyPill label="OAuth Google" ok={oauthClientReady} />
            </div>
          </>
        )}
      </div>

      {conn?.last_error && (
        <div style={{ background: C.elevated, border: `0.5px solid ${C.red}`, borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontFamily: fMono, fontSize: 11, color: C.red }}>
          Dernière erreur : {conn.last_error}
        </div>
      )}

      {/* Avertissement si la méthode sélectionnée n'est pas prête côté serveur */}
      {configKnown && !methodReady && (
        <div style={{ background: C.elevated, border: `0.5px solid ${C.warn}`, borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontFamily: fInter, fontSize: 12, color: C.warn }}>
          {method === 'oauth'
            ? 'Client OAuth non configuré : renseigne Client ID + Client Secret dans le formulaire ci-dessous (ou les env vars DV360_OAUTH_* + redémarrage).'
            : 'Service Account indisponible : DSP_ENC_KEY manquante dans .env.local.'}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24 }}>
        {/* Méthode */}
        <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Méthode d'authentification</label>
        <div style={{ display: 'flex', gap: 16, margin: '8px 0 16px' }}>
          {(['service_account', 'oauth'] as Method[]).map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: fInter, fontSize: 13, color: C.textSec, cursor: 'pointer' }}>
              <input type="radio" checked={method === m} onChange={() => setMethod(m)} />
              {m === 'service_account' ? 'Service Account' : 'OAuth Google'}
            </label>
          ))}
        </div>

        {/* Partner ID */}
        <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Partner ID</label>
        <input
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
          placeholder="ex : 123456"
          style={{ width: '100%', margin: '6px 0 16px', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: fInter, fontSize: 13 }}
        />

        {method === 'service_account' ? (
          <>
            <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Clé Service Account (JSON)</label>
            <textarea
              value={saJson}
              onChange={(e) => setSaJson(e.target.value)}
              placeholder='{ "client_email": "...", "private_key": "..." }'
              rows={6}
              style={{ width: '100%', margin: '6px 0 16px', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: fMono, fontSize: 11, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={save} disabled={busy || !partnerId || !saJson || !methodReady} style={btnTeal(busy || !partnerId || !saJson || !methodReady)}>Enregistrer</button>
              <button onClick={test} disabled={busy || !canTest} title={canTest ? undefined : 'Enregistre d’abord une clé Service Account.'} style={btnOutline(busy || !canTest)}>Tester la connexion</button>
              {conn && <button onClick={disconnect} disabled={busy} style={btnDanger(busy)}>Déconnecter</button>}
            </div>
          </>
        ) : (
          <>
            <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Client ID OAuth</label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="xxxxx.apps.googleusercontent.com"
              style={{ width: '100%', margin: '6px 0 12px', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: fMono, fontSize: 12 }}
            />
            <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>
              Client Secret OAuth {conn?.oauth_client_id && <span style={{ color: C.green }}>— client déjà enregistré ✓ (re-saisir pour modifier)</span>}
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="GOCSPX-…"
              style={{ width: '100%', margin: '6px 0 12px', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: fMono, fontSize: 12 }}
            />
            <button
              onClick={saveOAuthConfig}
              disabled={busy || !partnerId || !clientId || !clientSecret}
              style={{ ...btnOutline(busy || !partnerId || !clientId || !clientSecret), marginBottom: 16 }}
            >
              Enregistrer la config OAuth
            </button>

            <div style={{ borderTop: `0.5px solid ${C.border}`, paddingTop: 16, display: 'flex', gap: 10 }}>
              <button onClick={startOAuth} disabled={busy || !partnerId || !methodReady} style={btnTeal(busy || !partnerId || !methodReady)}>Se connecter avec Google</button>
              <button onClick={test} disabled={busy || !canTest} title={canTest ? undefined : 'Termine d’abord la connexion Google (bouton « Se connecter avec Google »).'} style={btnOutline(busy || !canTest)}>Tester la connexion</button>
              {conn && <button onClick={disconnect} disabled={busy} style={btnDanger(busy)}>Déconnecter</button>}
            </div>
          </>
        )}
      </div>

      {conn && conn.advertiser_ids.length > 0 && (
        <p style={{ fontFamily: fMono, fontSize: 12, color: C.textSec, marginTop: 16 }}>
          Advertisers détectés : {conn.advertiser_ids.length}
        </p>
      )}

      {/* ── Flux de logs en direct ──────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <SectionHeader
          title="Logs DV360 (temps réel)"
          action={
            <button onClick={loadLogs} disabled={logsBusy} style={{ background: 'transparent', border: 'none', color: C.teal, fontFamily: fMono, fontSize: 11, cursor: logsBusy ? 'not-allowed' : 'pointer' }}>
              {logsBusy ? '…' : 'rafraîchir'}
            </button>
          }
        />
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 4, maxHeight: 280, overflowY: 'auto' }}>
          {logs.length === 0 ? (
            <span style={{ display: 'block', padding: 12, fontFamily: fMono, fontSize: 11, color: C.textDim }}>Aucun log pour l'instant.</span>
          ) : (
            logs.map((l) => <LogLine key={l.id} log={l} />)
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sous-composants ───────────────────────────────────────────── */

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ background: C.elevated, borderTop: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, borderRadius: '8px 8px 0 0', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal }} />
      <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: C.text }}>{title}</span>
      {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
    </div>
  );
}

function ConfigRow({ label, ok, value }: { label: string; ok: boolean; value?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <span style={{ fontFamily: fMono, fontSize: 12, color: ok ? C.green : C.red, width: 14 }}>{ok ? '✓' : '✗'}</span>
      <span style={{ fontFamily: fInter, fontSize: 12, color: C.textSec }}>{label}</span>
      {value && <span style={{ marginLeft: 'auto', fontFamily: fMono, fontSize: 11, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{value}</span>}
    </div>
  );
}

function ReadyPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: fInter, fontSize: 12, color: ok ? C.green : C.textDim }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? C.green : C.textDim }} />
      {label} : {ok ? 'prête' : 'non configurée'}
    </span>
  );
}

function LogLine({ log }: { log: DspApiLogRow }) {
  const levelColor = log.level === 'error' ? C.red : log.level === 'warn' ? C.warn : C.textSec;
  const time = new Date(log.created_at).toLocaleTimeString('fr-FR');
  const meta = [
    log.status_code != null ? `${log.status_code}` : null,
    log.duration_ms != null ? `${log.duration_ms}ms` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: `0.5px solid ${C.border}`, fontFamily: fMono, fontSize: 11, alignItems: 'baseline' }}>
      <span style={{ color: C.textDim, flexShrink: 0 }}>{time}</span>
      <span style={{ color: levelColor, flexShrink: 0, textTransform: 'uppercase', width: 42 }}>{log.level}</span>
      <span style={{ color: C.textSec, flexShrink: 0 }}>{log.action}</span>
      <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.message ?? ''}</span>
      {meta && <span style={{ marginLeft: 'auto', color: C.textDim, flexShrink: 0 }}>{meta}</span>}
    </div>
  );
}

function btnTeal(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', border: `0.5px solid ${C.teal}`, color: C.teal, borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
}
function btnOutline(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', border: `0.5px solid ${C.borderDefault}`, color: C.textSec, borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
}
function btnDanger(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', border: `0.5px solid ${C.red}`, color: C.red, borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
}
