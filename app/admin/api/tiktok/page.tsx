'use client';

/**
 * MAGELIAN — /admin/api/tiktok : connexion TikTok Business API.
 * OAuth uniquement (self-service) : App ID + Secret de l'app développeur
 * TikTok → « Se connecter avec TikTok » → access token longue durée → Tester.
 */
import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { PROVIDERS, C, fInter, fMono } from '../_lib/constants';
import type { DspConnectionPublic, DspApiLogRow } from '@/types/dsp';

interface TiktokConfig {
  env: {
    enc_key: boolean;
    app_id: boolean;
    app_secret: boolean;
    redirect_uri: boolean;
    redirect_uri_value: string | null;
  };
}

export default function TiktokPage() {
  const { toast } = useToast();
  const provider = PROVIDERS.find((p) => p.key === 'tiktok')!;

  const [conn, setConn] = useState<DspConnectionPublic | null>(null);
  const [config, setConfig] = useState<TiktokConfig | null>(null);
  const [logs, setLogs] = useState<DspApiLogRow[]>([]);
  const [logsBusy, setLogsBusy] = useState(false);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/dsp/connections');
      const json = await res.json();
      const tt = (json.connections ?? []).find((c: DspConnectionPublic) => c.provider === 'tiktok') ?? null;
      setConn(tt);
      if (tt?.oauth_client_id) setAppId(tt.oauth_client_id);
    } catch {
      toast.error('Impossible de charger la connexion TikTok.');
    }
  }, [toast]);

  const loadConfig = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/dsp/tiktok/config');
      const json = await res.json();
      if (res.ok) setConfig(json as TiktokConfig);
    } catch { /* le panneau affichera "diagnostic indisponible" */ }
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/logs?provider=tiktok&limit=20');
      const json = await res.json();
      if (res.ok) setLogs((json.logs ?? []) as DspApiLogRow[]);
    } catch { /* flux de logs best-effort */ }
    finally { setLogsBusy(false); }
  }, []);

  useEffect(() => { load(); loadConfig(); loadLogs(); }, [load, loadConfig, loadLogs]);

  // Retour OAuth (query ?oauth=success|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const o = params.get('oauth');
    if (o === 'success') toast.success('TikTok connecté — lance « Tester la connexion ».');
    else if (o === 'error') toast.error(`Échec OAuth : ${params.get('reason') ?? 'inconnu'}`);
  }, [toast]);

  const saveApp = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/tiktok/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      toast.success('App TikTok enregistrée.');
      setAppSecret('');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); loadLogs(); }
  };

  const startOAuth = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/tiktok/oauth/start', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Erreur');
      window.location.href = json.url; // détour consentement TikTok
    } catch (e) { toast.error((e as Error).message); setBusy(false); loadLogs(); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/tiktok/test', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      toast.success(`Connexion OK — ${json.advertisers?.length ?? 0} advertisers.`);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); loadLogs(); }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/tiktok/connect', { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Erreur déconnexion');
      toast.success('Déconnecté.');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); loadLogs(); }
  };

  const purgeAuth = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/tiktok/connect?scope=full', { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Erreur effacement');
      setConn(null);
      setAppId('');
      setAppSecret('');
      toast.success('Données d\'authentification effacées.');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); setConfirmPurge(false); loadLogs(); }
  };

  const status = conn?.status ?? 'disconnected';
  const statusColor = status === 'connected' ? C.green : status === 'error' ? C.red : C.textDim;
  const appReady = Boolean(conn?.oauth_client_id || config?.env.app_id);
  const canTest = Boolean(conn?.has_credentials);

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo SVG de provider : rien a optimiser pour next/image */}
        <img src={provider?.logo} alt="TikTok" style={{ height: 28 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: fMono, fontSize: 12, color: statusColor }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
          {status === 'connected' ? 'Connecté' : status === 'error' ? 'Erreur' : 'Déconnecté'}
        </span>
      </div>

      {/* ── Diagnostic config serveur ───────────────────────────── */}
      <SectionHeader title="Diagnostic — configuration serveur" />
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 16, marginBottom: 16 }}>
        {config === null ? (
          <span style={{ fontFamily: fMono, fontSize: 11, color: C.textDim }}>Diagnostic indisponible.</span>
        ) : (
          <>
            <ConfigRow label="Chiffrement des secrets (DSP_ENC_KEY)" ok={config.env.enc_key} />
            <ConfigRow label="App ID (env TIKTOK_APP_ID — optionnel)" ok={config.env.app_id} />
            <ConfigRow label="App Secret (env TIKTOK_APP_SECRET — optionnel)" ok={config.env.app_secret} />
            <ConfigRow
              label="Redirect URI (à déclarer dans l'app TikTok)"
              ok={config.env.redirect_uri}
              value={config.env.redirect_uri_value ?? undefined}
            />
            <ConfigRow
              label="App de l'organisation (formulaire)"
              ok={Boolean(conn?.oauth_client_id)}
              value={conn?.oauth_client_id ?? undefined}
            />
          </>
        )}
      </div>

      {conn?.last_error && (
        <div style={{ background: C.elevated, border: `0.5px solid ${C.red}`, borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontFamily: fMono, fontSize: 11, color: C.red }}>
          Dernière erreur : {conn.last_error}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24 }}>
        <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>App ID (app développeur TikTok)</label>
        <input
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          placeholder="ex : 7412345678901234567"
          style={{ width: '100%', margin: '6px 0 12px', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: fMono, fontSize: 12 }}
        />
        <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>
          App Secret {conn?.oauth_client_id && <span style={{ color: C.green }}>— app déjà enregistrée ✓ (re-saisir pour modifier)</span>}
        </label>
        <input
          type="password"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          placeholder="secret de l'app TikTok"
          style={{ width: '100%', margin: '6px 0 12px', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: fMono, fontSize: 12 }}
        />
        <button
          onClick={saveApp}
          disabled={busy || !appId || !appSecret}
          style={{ ...btnOutline(busy || !appId || !appSecret), marginBottom: 16 }}
        >
          Enregistrer l&apos;app
        </button>

        <div style={{ borderTop: `0.5px solid ${C.border}`, paddingTop: 16, display: 'flex', gap: 10 }}>
          <button onClick={startOAuth} disabled={busy || !appReady} style={btnTeal(busy || !appReady)}>Se connecter avec TikTok</button>
          <button onClick={test} disabled={busy || !canTest} title={canTest ? undefined : 'Termine d\'abord la connexion TikTok.'} style={btnOutline(busy || !canTest)}>Tester la connexion</button>
          {conn && <button onClick={disconnect} disabled={busy} style={btnDanger(busy)}>Déconnecter</button>}
        </div>
      </div>

      {conn && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            onClick={() => setConfirmPurge(true)}
            disabled={busy}
            style={{ background: 'transparent', border: 'none', color: C.red, fontFamily: fInter, fontSize: 11, cursor: busy ? 'not-allowed' : 'pointer', textDecoration: 'underline', padding: 0, opacity: busy ? 0.5 : 1 }}
          >
            Effacer les données d&apos;authentification
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmPurge}
        onClose={() => setConfirmPurge(false)}
        onConfirm={purgeAuth}
        title="Effacer les données d'authentification"
        message="Supprime définitivement l'app TikTok (App ID + Secret) et l'access token de cette organisation. Il faudra tout ressaisir."
        confirmLabel="Tout effacer"
        variant="danger"
        loading={busy}
      />

      {conn && conn.advertiser_ids.length > 0 && (
        <p style={{ fontFamily: fMono, fontSize: 12, color: C.textSec, marginTop: 16 }}>
          Advertisers détectés : {conn.advertiser_ids.length}
        </p>
      )}

      {/* ── Flux de logs en direct ──────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <SectionHeader
          title="Logs TikTok (temps réel)"
          action={
            <button onClick={loadLogs} disabled={logsBusy} style={{ background: 'transparent', border: 'none', color: C.teal, fontFamily: fMono, fontSize: 11, cursor: logsBusy ? 'not-allowed' : 'pointer' }}>
              {logsBusy ? '…' : 'rafraîchir'}
            </button>
          }
        />
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 4, maxHeight: 280, overflowY: 'auto' }}>
          {logs.length === 0 ? (
            <span style={{ display: 'block', padding: 12, fontFamily: fMono, fontSize: 11, color: C.textDim }}>Aucun log pour l&apos;instant.</span>
          ) : (
            logs.map((l) => <LogLine key={l.id} log={l} />)
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sous-composants (mêmes patterns que la page DV360) ─────────── */

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
