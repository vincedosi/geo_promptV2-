'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import type { DspConnectionPublic } from '@/types/dsp';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  zoneId: string;
  zoneName: string;
  cpCount: number;
  onClose: () => void;
}

interface PushResult {
  location_list_id: string;
  location_list_name: string;
  assigned_count: number;
  unmapped_postal_codes: string[];
}

/**
 * Crée la zone dans DV360 sous forme de location list régionale
 * (codes postaux → geo IDs Google), réutilisable sur tout line item.
 */
export function ZoneDv360Dialog({ zoneId, zoneName, cpCount, onClose }: Props) {
  const [conn, setConn] = useState<DspConnectionPublic | null | undefined>(undefined); // undefined = chargement
  const [advertiserId, setAdvertiserId] = useState('');
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch('/api/admin/dsp/connections')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { connections: DspConnectionPublic[] }) => {
        if (cancelled) return;
        const dv360 = data.connections.find(c => c.provider === 'dv360') ?? null;
        setConn(dv360);
        if (dv360?.advertiser_ids?.length) setAdvertiserId(dv360.advertiser_ids[0].id);
      })
      .catch(() => { if (!cancelled) setConn(null); });
    return () => { cancelled = true; };
  }, []);

  const handlePush = async () => {
    if (!advertiserId.trim()) return;
    setPushing(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/dsp/dv360/zones/push', {
        method: 'POST',
        body: JSON.stringify({ zone_id: zoneId, advertiser_id: advertiserId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data as PushResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

  const advertisers = conn?.advertiser_ids ?? [];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-default)', borderRadius: 10, width: 440, fontFamily: fInter }}>
        <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--border-subtle)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          Créer la zone dans DV360
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {conn === undefined && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Chargement de la connexion DV360…</div>
          )}

          {conn === null && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Aucune connexion DV360 configurée pour votre organisation.{' '}
              <Link href="/admin/api/dv360" style={{ color: 'var(--brand-teal)' }}>Configurer la connexion</Link>
            </div>
          )}

          {conn && !result && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Crée une liste de localisations « {zoneName} » ({cpCount} codes postaux convertis en geo IDs Google)
                chez l&apos;advertiser choisi. La liste sera ensuite attachable à n&apos;importe quel line item dans DV360.
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6 }}>Advertiser</div>
                {advertisers.length > 0 ? (
                  <select
                    value={advertiserId}
                    onChange={e => setAdvertiserId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: fInter, fontSize: 13, outline: 'none' }}
                  >
                    {advertisers.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={advertiserId}
                    onChange={e => setAdvertiserId(e.target.value.replace(/\D/g, ''))}
                    placeholder="ID advertiser DV360 (chiffres)"
                    autoFocus
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: fMono, fontSize: 13, outline: 'none' }}
                  />
                )}
                {advertisers.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                    Aucun advertiser en cache — lancer « Tester » sur la page connexion DV360 pour remplir la liste, ou saisir l&apos;ID manuellement.
                  </div>
                )}
              </div>

              {error && (
                <div style={{ fontSize: 12, lineHeight: 1.5, padding: '10px 12px', borderRadius: 6, background: 'rgba(255,87,87,0.1)', border: '0.5px solid rgba(255,87,87,0.2)', color: 'var(--danger)', fontFamily: fMono, wordBreak: 'break-word' }}>
                  {error}
                </div>
              )}
            </>
          )}

          {result && (
            <div style={{ fontSize: 12, lineHeight: 1.7, padding: '10px 12px', borderRadius: 6, background: 'rgba(61,255,160,0.1)', border: '0.5px solid rgba(61,255,160,0.2)', color: 'var(--success)' }}>
              Liste « {result.location_list_name} » créée dans DV360
              <span style={{ fontFamily: fMono }}> (ID {result.location_list_id})</span> —{' '}
              {result.assigned_count} localisations assignées.
              {result.unmapped_postal_codes.length > 0 && (
                <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                  {result.unmapped_postal_codes.length} CP sans geo ID Google (à cibler manuellement) :{' '}
                  <span style={{ fontFamily: fMono }}>{result.unmapped_postal_codes.join(', ')}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '0.5px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, background: 'transparent', border: '0.5px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: fInter }}>
            {result ? 'Fermer' : 'Annuler'}
          </button>
          {conn && !result && (
            <button
              onClick={handlePush}
              disabled={pushing || !advertiserId.trim()}
              style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'var(--brand-teal)', border: 'none', color: 'var(--background)', cursor: 'pointer', opacity: pushing || !advertiserId.trim() ? 0.5 : 1, fontFamily: fInter }}
            >
              {pushing ? 'Création en cours…' : 'Créer dans DV360'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
