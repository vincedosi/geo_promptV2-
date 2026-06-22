'use client';

import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { PROVIDERS, C, fInter, fMono } from '../_lib/constants';
import type { DspConnectionPublic } from '@/types/dsp';

type Method = 'service_account' | 'oauth';

export default function Dv360Page() {
  const { toast } = useToast();
  const provider = PROVIDERS.find((p) => p.key === 'dv360')!;

  const [conn, setConn] = useState<DspConnectionPublic | null>(null);
  const [method, setMethod] = useState<Method>('service_account');
  const [partnerId, setPartnerId] = useState('');
  const [saJson, setSaJson] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/dsp/connections');
      const json = await res.json();
      const dv = (json.connections ?? []).find((c: DspConnectionPublic) => c.provider === 'dv360') ?? null;
      setConn(dv);
      if (dv?.partner_id) setPartnerId(dv.partner_id);
      if (dv?.auth_method) setMethod(dv.auth_method);
    } catch {
      toast.error('Impossible de charger la connexion DV360.');
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

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
        body: JSON.stringify({ auth_method: 'service_account', partner_id: partnerId, service_account_json: saJson }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      toast.success('Connexion enregistrée.');
      setSaJson('');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
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
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/connect', { method: 'DELETE' });
      if (!res.ok) throw new Error('Erreur déconnexion');
      toast.success('Déconnecté.');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const status = conn?.status ?? 'disconnected';
  const statusColor = status === 'connected' ? C.green : status === 'error' ? C.red : C.textDim;

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <img src={provider.logo} alt="DV360" style={{ height: 28 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: fMono, fontSize: 12, color: statusColor }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
          {status === 'connected' ? 'Connecté' : status === 'error' ? 'Erreur' : 'Déconnecté'}
        </span>
      </div>

      {conn?.last_error && (
        <div style={{ background: 'rgba(255,87,87,0.1)', border: `0.5px solid ${C.red}`, borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontFamily: fMono, fontSize: 11, color: C.red }}>
          {conn.last_error}
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
              <button onClick={save} disabled={busy || !partnerId || !saJson} style={btnTeal(busy || !partnerId || !saJson)}>Enregistrer</button>
              <button onClick={test} disabled={busy || !conn} style={btnOutline(busy || !conn)}>Tester la connexion</button>
              {conn && <button onClick={disconnect} disabled={busy} style={btnDanger(busy)}>Déconnecter</button>}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <a href="/api/admin/dsp/dv360/oauth/start" style={{ ...btnTeal(false), textDecoration: 'none', display: 'inline-block' }}>Se connecter avec Google</a>
            <button onClick={test} disabled={busy || !conn} style={btnOutline(busy || !conn)}>Tester la connexion</button>
            {conn && <button onClick={disconnect} disabled={busy} style={btnDanger(busy)}>Déconnecter</button>}
          </div>
        )}
      </div>

      {conn && conn.advertiser_ids.length > 0 && (
        <p style={{ fontFamily: fMono, fontSize: 12, color: C.textSec, marginTop: 16 }}>
          Advertisers détectés : {conn.advertiser_ids.length}
        </p>
      )}
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
