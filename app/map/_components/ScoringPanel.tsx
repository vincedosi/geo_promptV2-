'use client';

import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MaplibreMap } from 'maplibre-gl';

// ── Types ──────────────────────────────────────────────────────────────────────
interface ScoringCriterion {
  id: string;
  label: string;
  poids: number;
  type: 'distance' | 'demo_carreaux';
  poi_categorie?: string;
  rayon_max?: number;
  decay_step?: number;
  champ?: string;
  paliers?: Array<{ percentile: number; score: number }>;
  enabled: boolean;
}

interface ScoringProfileData {
  total_max?: number;
  criteres: ScoringCriterion[];
  isochrone?: { enabled: boolean; bonus: Record<string, unknown> };
}

interface ScoringProfile {
  id: string;
  nom: string;
  description?: string;
  is_template: boolean;
  profil: ScoringProfileData;
}

interface ScoredPanneau {
  id: string;
  reference_panneau: string | null;
  regie: string | null;
  type_panneau: string | null;
  lat: number;
  lng: number;
  ville: string;
  score_proximite_lycee: number;
  score_proximite_cirfa: number;
  score_transport: number;
  score_demo: number;
  score_ooh_total: number;
  bonus_isochrone: number;
  score_ooh_final: number;
  poi_lycee_distance_min: number | null;
  poi_lycee_nom_proche: string | null;
  nb_lycees_300m: number;
  poi_cirfa_distance_min: number | null;
  poi_cirfa_nom_proche: string | null;
  poi_transport_distance_min: number | null;
  poi_transport_nom_proche: string | null;
  nb_arrets_300m: number;
  in_isochrone_lycee: boolean;
  isochrone_lycee_minutes: number | null;
  in_isochrone_cirfa: boolean;
  isochrone_cirfa_minutes: number | null;
  score_computed_at: string | null;
  scoring_results: Record<string, { score: number; poids: number; distance?: number; nom?: string; valeur?: number; champ?: string }> | null;
  scoring_profile_id: string | null;
}

interface IsochroneEntry {
  categorie: string;
  minutes: number;
  features: GeoJSON.Feature[];
}

interface Props {
  mapRef:   MutableRefObject<MaplibreMap | null>;
  mapReady: boolean;
  onFlyTo:  (lat: number, lng: number, zoom?: number) => void;
  onScoreComputed?: (ville: string) => void;
  /** Quand true : embarqué dans un accordéon (pas de position absolute, pas de toggle) */
  inline?: boolean;
}

// ── Inject keyframes + reduced-motion ──────────────────────────────────────────
if (typeof document !== 'undefined') {
  const styleId = 'scoring-panel-keyframes';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes scoreFadeIn {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
      }
    `;
    document.head.appendChild(style);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function scoreColor(score: number): string {
  if (score >= 100) return '#16a34a';
  if (score >= 70)  return '#22c55e';
  if (score >= 50)  return '#eab308';
  if (score >= 30)  return '#f97316';
  if (score >= 1)   return '#ef4444';
  return '#9ca3af';
}

function scoreLabel(score: number): string {
  if (score >= 100) return 'TOP';
  if (score >= 70)  return 'BON+';
  if (score >= 50)  return 'BON';
  if (score >= 30)  return 'MOY';
  if (score >= 1)   return 'FAIBLE';
  return '—';
}

function pct(val: number, max: number): number {
  return Math.min(100, Math.round((val / max) * 100));
}

function isoLayerOpacity(cat: string, minutes: number): number {
  if (cat === 'lycee') return minutes <= 5 ? 0.15 : 0.08;
  if (cat === 'cirfa') return minutes <= 5 ? 0.15 : minutes <= 10 ? 0.10 : 0.05;
  return 0.08;
}

function isoLayerColor(cat: string): string {
  return cat === 'lycee' ? '#3b82f6' : '#22c55e';
}

// ── Popup HTML (dynamique depuis scoring_results) ──────────────────────────────
function buildPopupHtml(p: ScoredPanneau, rank: number, profile: ScoringProfile | null): string {
  const col   = scoreColor(p.score_ooh_final);
  const nom   = p.reference_panneau ?? 'Panneau';
  const maxScore = profile?.profil?.total_max ?? 100;

  const bar = (val: number, max: number) =>
    `<div style="background:#1a1a1a;border-radius:2px;height:4px;width:100%;margin-top:2px">` +
    `<div style="background:${col};height:4px;width:${pct(val, max)}%;border-radius:2px"></div></div>`;

  let criteriaHtml = '';

  if (p.scoring_results && Object.keys(p.scoring_results).length > 0) {
    // V2: dynamique depuis scoring_results
    for (const [key, crit] of Object.entries(p.scoring_results)) {
      const critLabel = profile?.profil?.criteres?.find(c => c.id === key)?.label ?? key;
      const fmtVal = crit.distance != null ? `${Math.round(crit.distance)}m` :
                     crit.valeur   != null ? String(crit.valeur) : '';
      criteriaHtml +=
        `<div style="font-size:10px;color:var(--text-tertiary);margin:4px 0 1px">${critLabel}</div>` +
        `<div style="display:flex;justify-content:space-between;font-size:10px">` +
        `<span style="color:#ccc">${crit.score}/${crit.poids}</span>` +
        `<span style="color:#555">${fmtVal}</span></div>` +
        bar(crit.score, crit.poids);
      if (crit.nom) {
        criteriaHtml += `<div style="font-size:9px;color:#444">${crit.nom}</div>`;
      }
    }
  } else {
    // V1 fallback: colonnes legacy
    criteriaHtml =
      `<div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">Proximité lycée</div>` +
      `<div style="font-size:10px;color:#ccc">${p.score_proximite_lycee}/30</div>` +
      bar(p.score_proximite_lycee, 30) +
      `<div style="font-size:10px;color:var(--text-tertiary);margin:4px 0 2px">Proximité CIRFA</div>` +
      `<div style="font-size:10px;color:#ccc">${p.score_proximite_cirfa}/20</div>` +
      bar(p.score_proximite_cirfa, 20) +
      `<div style="font-size:10px;color:var(--text-tertiary);margin:4px 0 2px">Transport</div>` +
      `<div style="font-size:10px;color:#ccc">${p.score_transport}/20</div>` +
      bar(p.score_transport, 20) +
      `<div style="font-size:10px;color:var(--text-tertiary);margin:4px 0 2px">Démographie</div>` +
      `<div style="font-size:10px;color:#ccc">${p.score_demo}/30</div>` +
      bar(p.score_demo, 30);
  }

  return `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;padding:10px 12px;color:#888;min-width:220px">` +
    `<div style="color:#fff;font-size:12px;font-weight:700;margin-bottom:4px">#${rank} ${nom}</div>` +
    `<div style="color:var(--text-tertiary);font-size:10px;margin-bottom:8px">` +
    `${p.regie ?? '—'} · ${p.type_panneau ?? '—'}</div>` +
    `<div style="color:${col};font-size:16px;font-weight:800;margin-bottom:8px">` +
    `${p.score_ooh_final}/${maxScore} <span style="font-size:10px;font-weight:400;color:#888">${scoreLabel(p.score_ooh_final)}</span></div>` +
    criteriaHtml +
    `<div style="border-top:1px solid #1a1a1a;margin:6px 0;padding-top:4px;font-size:10px;color:var(--text-tertiary)">` +
    `Sous-total <span style="color:#ccc">${p.score_ooh_total}/${maxScore}</span>` +
    (p.bonus_isochrone > 0 ? ` · Bonus iso <span style="color:${col}">+${p.bonus_isochrone}</span>` : '') +
    `</div>` +
    (p.in_isochrone_lycee ? `<div style="font-size:10px;color:#3b82f6">Iso lycee ${p.isochrone_lycee_minutes}min ✓</div>` : '') +
    (p.in_isochrone_cirfa ? `<div style="font-size:10px;color:#22c55e">Iso CIRFA ${p.isochrone_cirfa_minutes}min ✓</div>` : '') +
    `</div>`;
}

// ── Composant principal ────────────────────────────────────────────────────────
const ISO_SOURCE_PREFIX = 'scoring-iso';

export function ScoringPanel({ mapRef, mapReady, onFlyTo, onScoreComputed, inline = false }: Props) {
  const [open,       setOpen]       = useState(false);

  // En mode embarqué, forcer l'ouverture du contenu
  useEffect(() => {
    if (inline) setOpen(true);
  }, [inline]);
  const [panneaux,   setPanneaux]   = useState<ScoredPanneau[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [computing,  setComputing]  = useState(false);
  const [computeMsg, setComputeMsg] = useState('');
  const [isoVisible, setIsoVisible] = useState(false);
  const [isoData,    setIsoData]    = useState<IsochroneEntry[]>([]);
  const [minScore,   setMinScore]   = useState(0);
  const [ville,      setVille]      = useState('Brest');

  // Profile state
  const [profiles,      setProfiles]      = useState<ScoringProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ScoringProfile | null>(null);
  const [editMode,      setEditMode]      = useState(false);
  const [editProfile,   setEditProfile]   = useState<ScoringProfile | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const markersRef = useRef<maplibregl.Marker[]>([]);

  // ── Charger les profils ───────────────────────────────────────────────────
  const loadProfiles = async () => {
    try {
      const res  = await fetch('/api/scoring/profiles');
      const data = await res.json();
      const profs = (data.profiles ?? []) as ScoringProfile[];
      setProfiles(profs);
      if (!selectedProfile && profs.length > 0) {
        setSelectedProfile(profs[0]);
      }
    } catch { /* ignore */ }
  };

  // ── Charger les panneaux scorés ──────────────────────────────────────────
  const loadPanneaux = async (v = ville) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/scoring?ville=${encodeURIComponent(v)}&limit=100`, { cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setComputeMsg(`! Erreur chargement: ${err.error ?? res.statusText}`);
        return;
      }
      const data = await res.json();
      setPanneaux((data.panneaux ?? []) as ScoredPanneau[]);
    } catch (e: unknown) {
      setComputeMsg(`! Erreur chargement: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLoading(false); }
  };

  // ── Déclencher le calcul scoring ─────────────────────────────────────────
  const computeScores = async (layers: string[]) => {
    setComputing(true);
    setComputeMsg('Calcul en cours...');
    try {
      const body: Record<string, unknown> = { ville, layers };
      if (selectedProfile) body.profile_id = selectedProfile.id;

      const res  = await fetch('/api/scoring', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setComputeMsg(`! Erreur scoring: ${data.error ?? res.statusText}`);
        return;
      }
      setComputeMsg(
        `OK : ${data.panneaux_scored_proximity ?? 0} panneaux (${data.duration_ms ?? 0}ms)` +
        (data.isochrones_generated != null ? ` · ${data.isochrones_generated} iso` : '')
      );
      // Notifier l'onglet Étude avant le rechargement (garantit studyVille même si loadPanneaux échoue)
      onScoreComputed?.(ville);
      await loadPanneaux();
    } catch (e: unknown) {
      setComputeMsg(`! Erreur: ${e instanceof Error ? e.message : 'inconnue'}`);
    } finally { setComputing(false); }
  };

  // ── Charger les isochrones ────────────────────────────────────────────────
  const loadIsochrones = async () => {
    try {
      const res  = await fetch(`/api/scoring/isochrones?ville=${encodeURIComponent(ville)}`);
      const data = await res.json();
      setIsoData((data.isochrones ?? []) as IsochroneEntry[]);
    } catch { /* ignore */ }
  };

  // ── Entrer en mode édition (copie profil courant) ─────────────────────────
  const startEdit = () => {
    if (!selectedProfile) return;
    setEditProfile(JSON.parse(JSON.stringify(selectedProfile)) as ScoringProfile);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setEditProfile(null);
  };

  // ── Sauvegarder comme nouveau profil (clone depuis template) ─────────────
  const saveProfile = async () => {
    if (!editProfile) return;
    setSavingProfile(true);
    try {
      const body = {
        nom:         editProfile.nom,
        description: editProfile.description ?? '',
        profil:      editProfile.profil,
        is_template: false,
      };
      const res  = await fetch('/api/scoring/profiles', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (data.profile) {
        await loadProfiles();
        setSelectedProfile(data.profile as ScoringProfile);
        setEditMode(false);
        setEditProfile(null);
      }
    } catch { /* ignore */ } finally { setSavingProfile(false); }
  };

  // ── Mise à jour d'un critère dans le profil en édition ────────────────────
  const updateCrit = (idx: number, key: string, val: number | boolean) => {
    if (!editProfile) return;
    const newCriteres = [...editProfile.profil.criteres];
    newCriteres[idx] = { ...newCriteres[idx], [key]: val };
    setEditProfile({ ...editProfile, profil: { ...editProfile.profil, criteres: newCriteres } });
  };

  // ── Isochrones MapLibre ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const cleanLayers = () => {
      const style = map.getStyle();
      if (!style) return;
      for (const layer of style.layers ?? []) {
        if (typeof layer.id === 'string' && layer.id.startsWith(ISO_SOURCE_PREFIX)) {
          try { map.removeLayer(layer.id); } catch { /* */ }
        }
      }
      for (const sourceId of Object.keys(style.sources ?? {})) {
        if (sourceId.startsWith(ISO_SOURCE_PREFIX)) {
          try { map.removeSource(sourceId); } catch { /* */ }
        }
      }
    };
    if (!isoVisible || isoData.length === 0) { cleanLayers(); return; }
    cleanLayers();
    const sorted = [...isoData].sort((a, b) => b.minutes - a.minutes);
    for (const iso of sorted) {
      if (!iso.features?.length) continue;
      const srcId = `${ISO_SOURCE_PREFIX}-${iso.categorie}-${iso.minutes}`;
      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: iso.features };
      try {
        if (!map.getSource(srcId)) map.addSource(srcId, { type: 'geojson', data: fc });
        else (map.getSource(srcId) as maplibregl.GeoJSONSource).setData(fc);
        if (!map.getLayer(srcId)) {
          map.addLayer({ id: srcId, type: 'fill', source: srcId,
            paint: { 'fill-color': isoLayerColor(iso.categorie), 'fill-opacity': isoLayerOpacity(iso.categorie, iso.minutes) } });
        }
      } catch { /* */ }
    }
    const iso5L = isoData.find(i => i.categorie === 'lycee' && i.minutes === 5);
    const iso5C = isoData.find(i => i.categorie === 'cirfa' && i.minutes === 5);
    if (iso5L?.features?.length && iso5C?.features?.length) {
      const cId = `${ISO_SOURCE_PREFIX}-combo`;
      const cFc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [...iso5L.features, ...iso5C.features] };
      try {
        if (!map.getSource(cId)) map.addSource(cId, { type: 'geojson', data: cFc });
        if (!map.getLayer(cId)) map.addLayer({ id: cId, type: 'fill', source: cId, paint: { 'fill-color': '#4ecdc4', 'fill-opacity': 0.20 } });
      } catch { /* */ }
    }
  }, [isoVisible, isoData, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Marqueurs ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (!open || panneaux.length === 0) return;
    const filtered = panneaux.filter(p => p.score_ooh_final >= minScore);
    filtered.forEach((p, idx) => {
      const rank  = idx + 1;
      const color = scoreColor(p.score_ooh_final);
      const el    = document.createElement('div');
      el.style.cssText = [
        `width:18px;height:18px;background:${color}`,
        'border:2px solid rgba(255,255,255,0.85)',
        'border-radius:50%;cursor:pointer',
                'display:flex;align-items:center;justify-content:center',
        'color:white;font-size:9px;font-weight:700;font-family:system-ui,sans-serif',
      ].join(';');
      el.textContent = rank <= 20 ? String(rank) : '';
      const popup = new maplibregl.Popup({ offset: 12, closeButton: false, maxWidth: '260px' })
        .setHTML(buildPopupHtml(p, rank, selectedProfile));
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
    });
    return () => { markersRef.current.forEach(m => m.remove()); markersRef.current = []; };
  }, [panneaux, open, minScore, mapReady, selectedProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && panneaux.length === 0) loadPanneaux();
    if (open && profiles.length === 0) loadProfiles();
    if (open) loadIsochrones();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = panneaux.filter(p => p.score_ooh_final >= minScore);
  const activeProfile = editMode ? editProfile : selectedProfile;
  const maxScore = activeProfile?.profil?.total_max ?? 100;

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <div style={inline
      ? { fontFamily: "'JetBrains Mono',monospace" }
      : { position: 'absolute', top: 8, right: 8, zIndex: 900, fontFamily: "'JetBrains Mono',monospace" }
    }>
      {/* Toggle — masqué en mode inline (l'accordéon joue ce rôle) */}
      {!inline && (
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            background: open ? 'var(--brand-teal)' : 'var(--bg-surface)',
            border: `1px solid ${open ? 'var(--brand-teal)' : 'var(--border-default)'}`,
            color: open ? '#000' : 'var(--brand-teal)',
            padding: '5px 10px', borderRadius: 2, cursor: 'pointer',
            fontSize: 10, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif",
            display: 'block', marginLeft: 'auto', transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
          }}
        >
          {open ? 'Fermer scoring' : 'Scoring OOH'}
        </button>
      )}

      {(open || inline) && (
        <div style={inline
          ? {
              background: 'var(--bg-surface)', borderRadius: 2,
              display: 'flex', flexDirection: 'column', maxHeight: '60vh', width: '100%',
              animation: 'scoreFadeIn 300ms var(--ease-out)',
            }
          : {
              marginTop: 4, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              borderRadius: 2, width: 288, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 100px)',
              animation: 'scoreFadeIn 300ms var(--ease-out)',
            }
        }>
          {/* ─── Header ──────────────────────────────────────────────── */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-level-2)', borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ color: 'var(--brand-teal)', fontSize: 9, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif" }}>GEO.PROMPT</span>
              <span style={{ color: 'var(--text-primary)', fontSize: 10, fontWeight: 700 }}>Scoring OOH</span>
            </div>

            {/* Ville */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <input
                value={ville} onChange={e => setVille(e.target.value)}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-default)', color: '#ccc', padding: '3px 6px', fontSize: 10, borderRadius: 2, fontFamily: 'inherit', transition: 'border-color 300ms var(--ease-out)', outline: 'none' }}
                placeholder="Ville"
              />
              <button onClick={() => loadPanneaux()} disabled={loading}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                style={{ background: 'var(--border-subtle)', border: '1px solid var(--border-default)', color: 'var(--brand-teal)', padding: '3px 7px', borderRadius: 2, cursor: 'pointer', fontSize: 9, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif", transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)' }}>
                {loading ? '...' : 'Reload'}
              </button>
            </div>

            {/* Sélecteur de profil */}
            {!editMode && (
              <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
                <select
                  value={selectedProfile?.id ?? ''}
                  onChange={e => {
                    const p = profiles.find(x => x.id === e.target.value);
                    if (p) setSelectedProfile(p);
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                  style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-default)', color: '#ccc', padding: '3px 5px', fontSize: 9, borderRadius: 2, fontFamily: 'inherit', transition: 'border-color 300ms var(--ease-out)', outline: 'none' }}
                >
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.is_template ? '★ ' : '◇ '}{p.nom}
                    </option>
                  ))}
                </select>
                <button onClick={startEdit}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                  style={{ background: 'var(--bg-level-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', padding: '3px 6px', borderRadius: 2, cursor: 'pointer', fontSize: 9, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif", flexShrink: 0, transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)' }}>
                  Edit
                </button>
              </div>
            )}

            {/* Éditeur de profil inline */}
            {editMode && editProfile && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 2, padding: 8, marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--brand-teal)', fontSize: 9, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif" }}>Edit profil</span>
                  <button onClick={cancelEdit}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10, padding: 0 }}>✕</button>
                </div>
                {/* Nom */}
                <input
                  value={editProfile.nom}
                  onChange={e => setEditProfile({ ...editProfile, nom: e.target.value })}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                  style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-default)', color: '#ccc', padding: '3px 6px', fontSize: 9, borderRadius: 2, fontFamily: 'inherit', marginBottom: 6, boxSizing: 'border-box', transition: 'border-color 300ms var(--ease-out)', outline: 'none' }}
                  placeholder="Nom du profil"
                />
                {/* Critères */}
                {editProfile.profil.criteres.map((crit, idx) => (
                  <div key={crit.id} style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <input
                        type="checkbox" checked={crit.enabled}
                        onChange={e => updateCrit(idx, 'enabled', e.target.checked)}
                        style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
                      />
                      <span style={{ color: crit.enabled ? '#ccc' : '#444', fontSize: 9, fontWeight: 600, flex: 1 }}>{crit.label}</span>
                      <span style={{ color: 'var(--brand-teal)', fontSize: 9, fontWeight: 700 }}>{crit.poids}pts</span>
                    </div>
                    {crit.enabled && (
                      <div style={{ paddingLeft: 18 }}>
                        {/* Poids */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                          <span style={{ color: '#555', fontSize: 8, width: 50, flexShrink: 0 }}>Poids</span>
                          <input type="range" min={0} max={50} value={crit.poids}
                            onChange={e => updateCrit(idx, 'poids', Number(e.target.value))}
                            style={{ flex: 1, accentColor: 'var(--brand-teal)', cursor: 'pointer' }} />
                          <span style={{ color: '#888', fontSize: 8, width: 20, textAlign: 'right' }}>{crit.poids}</span>
                        </div>
                        {/* Distance: rayon_max */}
                        {crit.type === 'distance' && crit.rayon_max != null && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                            <span style={{ color: '#555', fontSize: 8, width: 50, flexShrink: 0 }}>Rayon</span>
                            <input type="range" min={50} max={3000} step={50} value={crit.rayon_max}
                              onChange={e => updateCrit(idx, 'rayon_max', Number(e.target.value))}
                              style={{ flex: 1, accentColor: 'var(--brand-teal)', cursor: 'pointer' }} />
                            <span style={{ color: '#888', fontSize: 8, width: 36, textAlign: 'right' }}>{crit.rayon_max}m</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {/* Boutons save/cancel */}
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={cancelEdit}
                    style={{ flex: 1, background: 'var(--bg-level-2)', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)', padding: '4px', borderRadius: 2, cursor: 'pointer', fontSize: 9, fontFamily: "'Inter', system-ui, sans-serif", transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)' }}>
                    Annuler
                  </button>
                  <button onClick={saveProfile} disabled={savingProfile}
                    style={{ flex: 1, background: 'var(--bg-level-2)', border: '1px solid var(--brand-teal)', color: 'var(--brand-teal)', padding: '4px', borderRadius: 2, cursor: 'pointer', fontSize: 9, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif", transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)' }}>
                    {savingProfile ? '...' : 'Sauvegarder'}
                  </button>
                </div>
              </div>
            )}

            {/* Boutons compute */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <button onClick={() => computeScores(['proximity'])} disabled={computing}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                style={{ flex: 1, background: 'var(--bg-level-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', padding: '4px', borderRadius: 2, cursor: 'pointer', fontSize: 9, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif", transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)' }}>
                {computing ? '...' : 'Calc proximite'}
              </button>
              <button onClick={() => computeScores(['proximity', 'isochrone'])} disabled={computing}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                style={{ flex: 1, background: 'var(--bg-level-2)', border: '1px solid var(--border-default)', color: 'var(--success)', padding: '4px', borderRadius: 2, cursor: 'pointer', fontSize: 9, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif", transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)' }}>
                {computing ? '...' : 'Calc + ISO'}
              </button>
            </div>
            {computeMsg && (
              <div style={{ fontSize: 9, color: computing ? '#888' : computeMsg.startsWith('!') ? '#ef4444' : '#3dffa0', padding: '2px 0' }}>{computeMsg}</div>
            )}
          </div>

          {/* ─── Contrôles filtre + iso ────────────────────────────── */}
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, fontSize: 9, color: '#555' }}>
              MIN : <span style={{ color: '#ccc' }}>{minScore}</span>
            </div>
            <input type="range" min={0} max={80} value={minScore}
              onChange={e => setMinScore(Number(e.target.value))}
              style={{ flex: 2, accentColor: 'var(--brand-teal)', cursor: 'pointer' }} />
            <button
              onClick={() => { const next = !isoVisible; setIsoVisible(next); if (next && isoData.length === 0) loadIsochrones(); }}
              style={{ background: isoVisible ? 'var(--bg-level-2)' : 'var(--bg-surface)', border: `1px solid ${isoVisible ? 'var(--brand-teal)' : 'var(--border-default)'}`, color: isoVisible ? 'var(--brand-teal)' : 'var(--text-tertiary)', padding: '3px 6px', borderRadius: 2, cursor: 'pointer', fontSize: 9, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif", transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)' }}>
              ISO
            </button>
          </div>

          {/* ─── Stats + légende ──────────────────────────────────── */}
          <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border-subtle)', fontSize: 9, color: '#444', display: 'flex', gap: 8 }}>
            <span><span style={{ color: '#ccc' }}>{filtered.length}</span> panneaux</span>
            {filtered.length > 0 && (
              <span>top : <span style={{ color: scoreColor(filtered[0].score_ooh_final) }}>{filtered[0].score_ooh_final}</span>/{maxScore}</span>
            )}
            {selectedProfile && !selectedProfile.is_template && (
              <span style={{ color: 'var(--brand-teal)' }}>◇ custom</span>
            )}
          </div>
          <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[['100+', '#16a34a'], ['70-99', '#22c55e'], ['50-69', '#eab308'], ['30-49', '#f97316'], ['1-29', '#ef4444']].map(([lbl, col]) => (
              <span key={lbl} style={{ fontSize: 8, color: col, fontWeight: 700, letterSpacing: '.04em' }}>{lbl}</span>
            ))}
          </div>

          {/* ─── Liste panneaux ───────────────────────────────────── */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && <div style={{ padding: 16, textAlign: 'center', color: '#333', fontSize: 10 }}>Chargement...</div>}
            {!loading && filtered.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: '#333', fontSize: 10 }}>
                Aucun panneau (score &gt;= {minScore}).<br />
                <span style={{ color: '#444' }}>Cliquez CALC PROXIMITE pour lancer le scoring.</span>
              </div>
            )}
            {filtered.map((p, idx) => {
              const rank  = idx + 1;
              const color = scoreColor(p.score_ooh_final);
              // Détail dynamique depuis scoring_results ou legacy
              const critDetails = p.scoring_results
                ? Object.entries(p.scoring_results).map(([k, v]) => ({
                    id: k,
                    label: selectedProfile?.profil?.criteres?.find(c => c.id === k)?.label ?? k,
                    score: v.score,
                    poids: v.poids,
                  }))
                : [
                    { id: 'lycee',     label: 'L', score: p.score_proximite_lycee,  poids: 30 },
                    { id: 'cirfa',     label: 'C', score: p.score_proximite_cirfa,  poids: 20 },
                    { id: 'transport', label: 'T', score: p.score_transport,        poids: 20 },
                    { id: 'demo',      label: 'D', score: p.score_demo,             poids: 30 },
                  ];
              return (
                <div key={p.id} onClick={() => onFlyTo(p.lat, p.lng, 16)}
                  style={{ padding: '5px 10px', cursor: 'pointer', borderBottom: '1px solid var(--bg-level-2)', display: 'flex', alignItems: 'center', gap: 8 }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-level-2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff', fontSize: 9, fontWeight: 700 }}>
                    {rank <= 20 ? rank : ''}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#ccc', fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.reference_panneau ?? 'Panneau'} {p.regie ? `· ${p.regie}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                      <div style={{ flex: 1, background: 'var(--border-subtle)', borderRadius: 2, height: 3, position: 'relative', marginTop: 4 }}>
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, background: color, borderRadius: 2, width: `${pct(p.score_ooh_final, maxScore)}%` }} />
                      </div>
                      <div style={{ color, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{p.score_ooh_final}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                      {critDetails.map(cd => (
                        <span key={cd.id} style={{ fontSize: 8, color: '#888' }}>
                          {cd.label.substring(0, 1).toUpperCase()}:<span style={{ color: '#ccc' }}>{cd.score}</span>
                        </span>
                      ))}
                      {p.bonus_isochrone > 0 && <span style={{ fontSize: 8, color: 'var(--success)' }}>+{p.bonus_isochrone}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
