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

const C = {
  bg:          '#050505',
  bgElevated:  '#0d0d0d',
  bgSurface:   '#111118',
  border:      '#261a35',
  borderLight: 'rgba(168,85,247,0.2)',
  accent:      '#a855f7',
  accentDim:   'rgba(168,85,247,0.12)',
  text:        '#e2e8f0',
  textDim:     '#94a3b8',
  textSec:     '#6b7280',
  muted:       '#4b5563',
  green:       '#3dffa0',
  greenDim:    'rgba(61,255,160,0.12)',
  red:         '#f87171',
  redDim:      'rgba(248,113,113,0.1)',
  warn:        '#fbbf24',
  warnDim:     'rgba(251,191,36,0.1)',
  blue:        '#3b82f6',
};
const fontOrbitron = "'Orbitron', sans-serif";
const fontMichroma = "'Michroma', 'Orbitron', sans-serif";
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  padding: '8px 12px',
  color: C.text,
  fontFamily: fontMono,
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: fontMichroma,
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: C.textDim,
  display: 'block',
  marginBottom: 4,
};

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
    <div style={{ maxWidth: 760, padding: '24px 20px', fontFamily: fontInter, color: C.text, background: C.bg, minHeight: '100vh' }}>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontFamily: fontOrbitron, fontSize: 20, letterSpacing: '0.08em', color: C.text, margin: 0, fontWeight: 700 }}>
            admin / network-cache
          </h1>
          <span style={{
            fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: C.warn, background: C.warnDim, border: `1px solid ${C.warn}`, borderRadius: 2,
            padding: '2px 6px',
          }}>
            ADMIN
          </span>
        </div>
        <p style={{ fontFamily: fontInter, fontSize: 12, color: C.textDim, margin: 0, lineHeight: 1.6 }}>
          Pre-calcule les isochrones ORS pour un reseau de POI et les stocke en cache Supabase.
          Le copilote pourra ensuite repondre instantanement aux questions de couverture reseau.
        </p>
      </div>

      {/* Info box */}
      <div style={{
        padding: '12px 16px',
        background: C.accentDim,
        border: `1px solid ${C.borderLight}`,
        borderRadius: 2,
        marginBottom: 20,
        fontSize: 12,
        color: C.textSec,
        lineHeight: 1.6,
        fontFamily: fontInter,
      }}>
        <span style={{ color: C.accent, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', marginRight: 8 }}>
          FONCTIONNEMENT
        </span>
        Ce script appelle l&apos;API ORS pour chaque POI du reseau et sauvegarde les isochrones dans{' '}
        <code style={{ fontFamily: fontMono, color: C.accent, fontSize: 11 }}>isochrones_cache</code>.
        Duree estimee : 1-5 min selon le nombre de POIs. Ensuite, le copilote repond en quelques secondes.
      </div>

      {/* Presets */}
      <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span style={{ fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.accent }}>
            PRESETS RAPIDES
          </span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => applyPreset(p)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textAlign: 'left',
                background: C.bgSurface,
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                padding: '8px 12px',
                color: C.textDim,
                fontFamily: fontMono,
                fontSize: 11,
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = C.accent; (e.currentTarget as HTMLButtonElement).style.color = C.text; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; (e.currentTarget as HTMLButtonElement).style.color = C.textDim; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93a10 10 0 1 0 0 14.14" />
            </svg>
            <span style={{ fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.accent }}>
              PARAMETRES
            </span>
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Categorie POI *</label>
                <input
                  style={inputStyle}
                  value={poi_category}
                  onChange={e => setPoi(e.target.value)}
                  placeholder="ex: CIRFA"
                  required
                />
              </div>
              <div>
                <label style={labelStyle}>Temps (min) *</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="5"
                  max="120"
                  value={minutes}
                  onChange={e => setMinutes(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={labelStyle}>Mode *</label>
                <select
                  style={{ ...inputStyle, cursor: 'pointer' }}
                  value={mode}
                  onChange={e => setMode(e.target.value)}
                >
                  <option value="drive">Voiture</option>
                  <option value="walk">A pied</option>
                  <option value="bike">Velo</option>
                </select>
              </div>
            </div>

            {/* Row 2 — optional geo filters */}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <div style={{ fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textSec, marginBottom: 10 }}>
                Filtre geographique — laisser vide pour France entiere
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Region</label>
                  <input style={inputStyle} value={region} onChange={e => setRegion(e.target.value)} placeholder="ex: Bretagne" />
                </div>
                <div>
                  <label style={labelStyle}>Ville</label>
                  <input style={inputStyle} value={ville} onChange={e => setVille(e.target.value)} placeholder="ex: Rennes" />
                </div>
                <div>
                  <label style={labelStyle}>Departement</label>
                  <input style={inputStyle} value={departement} onChange={e => setDept(e.target.value)} placeholder="ex: 29 ou Finistere" />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 24px',
            background: loading ? C.muted : C.accent,
            border: 'none',
            borderRadius: 2,
            color: loading ? C.textDim : '#000',
            fontFamily: fontMichroma,
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Calcul en cours... {elapsed}s
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              Lancer le pre-calcul
            </>
          )}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 16,
          padding: '12px 16px',
          background: C.redDim,
          border: `1px solid ${C.red}`,
          borderRadius: 2,
          fontSize: 11,
          color: C.red,
          fontFamily: fontMono,
        }}>
          <span style={{ fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>ERREUR</span>
          {' '}{error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          marginTop: 16,
          padding: '16px',
          background: C.greenDim,
          border: `1px solid ${C.green}`,
          borderRadius: 2,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ color: C.green, fontFamily: fontMichroma, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>
              Cache mis a jour avec succes
            </span>
            <span style={{ marginLeft: 'auto', color: C.textDim, fontSize: 11, fontFamily: fontMono }}>
              {result.duration_sec}s
            </span>
          </div>

          <div style={{
            padding: '10px 14px',
            background: C.bgSurface,
            border: `1px solid ${C.border}`,
            borderRadius: 2,
            fontFamily: fontMono,
            fontSize: 11,
            lineHeight: 1.9,
            marginBottom: 12,
          }}>
            <div><span style={{ color: C.textDim }}>cache_key:    </span><span style={{ color: C.blue }}>{result.cache_key}</span></div>
            <div><span style={{ color: C.textDim }}>poi_category: </span><span style={{ color: C.text }}>{result.poi_category}</span></div>
            <div><span style={{ color: C.textDim }}>geo_scope:    </span><span style={{ color: C.text }}>{result.geo_scope}</span></div>
            <div><span style={{ color: C.textDim }}>params:       </span><span style={{ color: C.text }}>{result.minutes}min · {result.mode}</span></div>
            <div><span style={{ color: C.textDim }}>nb_pois:      </span><span style={{ color: C.green, fontWeight: 700 }}>{result.nb_pois}</span></div>
            <div><span style={{ color: C.textDim }}>nb_iso:       </span><span style={{ color: C.green, fontWeight: 700 }}>{result.nb_isochrones}</span></div>
            {result.skipped_pois > 0 && (
              <div><span style={{ color: C.textDim }}>skipped:      </span><span style={{ color: C.warn }}>{result.skipped_pois} POIs (ile/hors reseau)</span></div>
            )}
          </div>

          {result.skipped_names.length > 0 && (
            <div style={{ fontSize: 11, color: C.textDim, fontFamily: fontMono, marginBottom: 12 }}>
              <span style={{ color: C.warn }}>POIs ignores : </span>
              {result.skipped_names.join(' · ')}
              {result.skipped_pois > result.skipped_names.length && (
                <span> + {result.skipped_pois - result.skipped_names.length} autres</span>
              )}
            </div>
          )}

          <div style={{
            padding: '10px 14px',
            background: C.accentDim,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 2,
            fontSize: 11,
            color: C.textSec,
            fontFamily: fontInter,
            lineHeight: 1.6,
          }}>
            <span style={{ color: C.accent, fontFamily: fontMichroma, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>
              PRET
            </span>{' '}
            Le copilote peut maintenant calculer la couverture de ce reseau en quelques secondes.
            Dans la discussion, demandez :{' '}
            <em style={{ color: C.textDim }}>
              &quot;Quelle est la couverture totale du reseau {result.poi_category} en {result.minutes}min en {result.mode === 'drive' ? 'voiture' : result.mode === 'walk' ? 'marchant' : 'velo'} ?&quot;
            </em>
          </div>
        </div>
      )}
    </div>
  );
}
