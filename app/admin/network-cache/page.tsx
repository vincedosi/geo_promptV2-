'use client';

/**
 * /admin/network-cache
 * Pré-calcul des isochrones réseau pour le cache Supabase.
 * Permet au copilote de répondre instantanément aux questions de couverture réseau.
 */

import { useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

interface PrecomputeResult {
  cache_key:     string;
  poi_category:  string;
  geo_scope:     string;
  nb_pois:       number;
  nb_isochrones: number;
  skipped_pois:  number;
  skipped_names: string[];
  duration_sec:  number;
  minutes:       number;
  mode:          string;
  error?:        string;
}

const PRESETS = [
  { label: 'CIRFA — France entière, 30min voiture',   poi_category: 'CIRFA', minutes: 30, mode: 'drive' },
  { label: 'CIRFA — France entière, 60min voiture',   poi_category: 'CIRFA', minutes: 60, mode: 'drive' },
  { label: 'CIRFA — France entière, 15min à pied',    poi_category: 'CIRFA', minutes: 15, mode: 'walk' },
  { label: 'Pharmacies — France entière, 15min à pied', poi_category: 'Pharmacie', minutes: 15, mode: 'walk' },
];

export default function NetworkCachePage() {
  const [poi_category, setPoi]      = useState('CIRFA');
  const [minutes, setMinutes]       = useState('30');
  const [mode, setMode]             = useState('drive');
  const [region, setRegion]         = useState('');
  const [ville, setVille]           = useState('');
  const [departement, setDept]      = useState('');

  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<PrecomputeResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [elapsed, setElapsed]       = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);
    setElapsed(0);

    const t0 = Date.now();
    const interval = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);

    try {
      const body: Record<string, any> = { poi_category, minutes: Number(minutes), mode };
      if (region)      body.region      = region;
      if (ville)       body.ville       = ville;
      if (departement) body.departement = departement;

      const res = await adminFetch('/api/admin/precompute-network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: PrecomputeResult = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message ?? 'Erreur inconnue');
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  }

  function applyPreset(p: typeof PRESETS[0]) {
    setPoi(p.poi_category);
    setMinutes(String(p.minutes));
    setMode(p.mode);
    setRegion('');
    setVille('');
    setDept('');
  }

  return (
    <div className="genesis-content" style={{ maxWidth: 760 }}>

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h1 className="page-title">admin / network-cache</h1>
          <span className="g-badge g-badge-orange">ADMIN</span>
        </div>
        <p className="page-subtitle">
          Pré-calcule les isochrones ORS pour un réseau de POI et les stocke en cache Supabase.
          Le copilote pourra ensuite répondre instantanément aux questions de couverture réseau.
        </p>
      </div>

      {/* Info box */}
      <div style={{
        padding: '12px 16px',
        background: 'rgba(99,102,241,0.08)',
        border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: 8,
        marginBottom: 20,
        fontSize: 12,
        color: 'var(--text-secondary)',
        lineHeight: 1.6,
      }}>
        <span style={{ color: '#a5b4fc', fontWeight: 600 }}>Comment ca fonctionne :</span>{' '}
        Ce script appelle l&apos;API ORS pour chaque POI du réseau et sauvegarde les isochrones dans{' '}
        <code style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>isochrones_cache</code>.
        Durée estimée : 1–5 min selon le nombre de POIs. Ensuite, le copilote répond en quelques secondes.
      </div>

      {/* Presets */}
      <div className="g-card" style={{ marginBottom: 20 }}>
        <div className="g-card-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span className="g-card-title">Presets rapides</span>
        </div>
        <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PRESETS.map((p, i) => (
            <button
              key={i}
              className="g-btn"
              onClick={() => applyPreset(p)}
              style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 12 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div className="g-card" style={{ marginBottom: 20 }}>
          <div className="g-card-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93a10 10 0 1 0 0 14.14" />
            </svg>
            <span className="g-card-title">Paramètres</span>
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                  Catégorie POI *
                </label>
                <input
                  className="g-input"
                  value={poi_category}
                  onChange={e => setPoi(e.target.value)}
                  placeholder="ex: CIRFA"
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                  Temps (min) *
                </label>
                <input
                  className="g-input"
                  type="number"
                  min="5"
                  max="120"
                  value={minutes}
                  onChange={e => setMinutes(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                  Mode *
                </label>
                <select className="g-input" value={mode} onChange={e => setMode(e.target.value)}>
                  <option value="drive">Voiture</option>
                  <option value="walk">A pied</option>
                  <option value="bike">Velo</option>
                </select>
              </div>
            </div>

            {/* Row 2 — optional geo filters */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, fontFamily: 'JetBrains Mono, monospace' }}>
                Filtre géographique (optionnel — laisser vide pour France entière)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                    Région
                  </label>
                  <input className="g-input" value={region} onChange={e => setRegion(e.target.value)} placeholder="ex: Bretagne" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                    Ville
                  </label>
                  <input className="g-input" value={ville} onChange={e => setVille(e.target.value)} placeholder="ex: Rennes" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                    Département
                  </label>
                  <input className="g-input" value={departement} onChange={e => setDept(e.target.value)} placeholder="ex: 29 ou Finistère" />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="g-btn g-btn-primary"
          disabled={loading}
          style={{ width: '100%', justifyContent: 'center', padding: '12px 24px', fontSize: 13, fontWeight: 600 }}
        >
          {loading ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Calcul en cours… {elapsed}s
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              Lancer le pré-calcul
            </>
          )}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 16,
          padding: '12px 16px',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8,
          fontSize: 12,
          color: '#fca5a5',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          <span style={{ color: 'var(--red)', fontWeight: 700 }}>ERREUR: </span>{error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          marginTop: 16,
          padding: '16px',
          background: 'rgba(34,197,94,0.06)',
          border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 13 }}>Cache mis à jour avec succès</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
              {result.duration_sec}s
            </span>
          </div>

          <div className="g-code" style={{ fontSize: 11, marginBottom: 12 }}>
            <div><span style={{ color: 'var(--text-dim)' }}>cache_key:    </span><span style={{ color: '#a5b4fc' }}>{result.cache_key}</span></div>
            <div><span style={{ color: 'var(--text-dim)' }}>poi_category: </span><span style={{ color: 'var(--text-primary)' }}>{result.poi_category}</span></div>
            <div><span style={{ color: 'var(--text-dim)' }}>geo_scope:    </span><span style={{ color: 'var(--text-primary)' }}>{result.geo_scope}</span></div>
            <div><span style={{ color: 'var(--text-dim)' }}>params:       </span><span style={{ color: 'var(--text-primary)' }}>{result.minutes}min · {result.mode}</span></div>
            <div><span style={{ color: 'var(--text-dim)' }}>nb_pois:      </span><span style={{ color: 'var(--green)', fontWeight: 700 }}>{result.nb_pois}</span></div>
            <div><span style={{ color: 'var(--text-dim)' }}>nb_iso:       </span><span style={{ color: 'var(--green)', fontWeight: 700 }}>{result.nb_isochrones}</span></div>
            {result.skipped_pois > 0 && (
              <div><span style={{ color: 'var(--text-dim)' }}>skipped:      </span><span style={{ color: 'var(--orange)' }}>{result.skipped_pois} POIs (ile/hors réseau)</span></div>
            )}
          </div>

          {result.skipped_names.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ color: 'var(--orange)' }}>POIs ignorés : </span>
              {result.skipped_names.join(' · ')}
              {result.skipped_pois > result.skipped_names.length && (
                <span> + {result.skipped_pois - result.skipped_names.length} autres</span>
              )}
            </div>
          )}

          <div style={{
            marginTop: 12,
            padding: '10px 14px',
            background: 'rgba(99,102,241,0.08)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--text-dim)',
          }}>
            <span style={{ color: '#a5b4fc', fontWeight: 600 }}>Prêt !</span>{' '}
            Le copilote peut maintenant calculer la couverture de ce réseau en quelques secondes.
            Dans la discussion, demandez :{' '}
            <em style={{ color: 'var(--text-secondary)' }}>
              &quot;Quelle est la couverture totale du réseau {result.poi_category} en {result.minutes}min en {result.mode === 'drive' ? 'voiture' : result.mode === 'walk' ? 'marchant' : 'vélo'} ?&quot;
            </em>
          </div>
        </div>
      )}
    </div>
  );
}
