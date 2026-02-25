'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import AISearchInput from '@/app/components/AISearchInput';

// Import dynamique : maplibre-gl a besoin du DOM (pas de SSR)
const MapContainer = dynamic(() => import('@/components/map/MapContainer'), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a' }}>
      <p style={{ color: '#888', fontFamily: 'Inter, sans-serif' }}>Chargement de la carte...</p>
    </div>
  ),
});

interface POI {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  categorie: string;
  sous_categorie?: string;
  adresse?: string;
  ville?: string;
  region?: string;
  departement?: string;
  code_departement?: string;
  code_postal?: string;
  date_import?: string;
  organization_id?: string;
  data_source_id?: string;
  metadata?: any;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/** Lit la valeur d'un champ POI — colonnes directes ET champs metadata */
function getPoiFieldValue(poi: POI, field: string): string | null {
  const nf = normalize(field);

  // Colonnes directes — cherche avec normalization
  const directCols = ['nom', 'adresse', 'ville', 'code_postal', 'departement', 'region', 'code_departement', 'sous_categorie', 'categorie'];
  const directMatch = directCols.find(c => normalize(c) === nf);
  if (directMatch) {
    const v = (poi as any)[directMatch];
    return v != null ? String(v) : null;
  }

  // Champ metadata — correspondance exacte puis normalisée
  if (!poi.metadata) return null;
  try {
    const meta = typeof poi.metadata === 'string' ? JSON.parse(poi.metadata) : poi.metadata;
    if (!meta || typeof meta !== 'object') return null;
    if (meta[field] != null && meta[field] !== '') return String(meta[field]);
    const metaKey = Object.keys(meta).find(k => normalize(k) === nf);
    if (metaKey) return String(meta[metaKey]);
  } catch { /* ignore */ }
  return null;
}

/** Formate un nom de colonne brut en label lisible : LIBELLE_REGION → Libelle Region */
function formatLabel(field: string): string {
  return field.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Filtres auto-découverts depuis poisRaw ────────────────────────────────────

const DIRECT_FILTER_COLS = [
  { field: 'region',        label: 'Région',         maxValues: 30 },
  { field: 'departement',   label: 'Département',    maxValues: 100 },
  { field: 'sous_categorie',label: 'Sous-catégorie', maxValues: 50 },
];

function computeAvailableFilters(
  poisRaw: POI[]
): Record<string, { label: string; values: string[] }> {
  if (poisRaw.length === 0) return {};
  const result: Record<string, { label: string; values: string[] }> = {};

  // 1. Colonnes directes
  for (const { field, label, maxValues } of DIRECT_FILTER_COLS) {
    const vals = new Set<string>();
    for (const p of poisRaw) {
      const v = (p as any)[field];
      if (v && String(v).trim()) vals.add(String(v).trim());
    }
    if (vals.size >= 2 && vals.size <= maxValues) {
      result[field] = { label, values: [...vals].sort() };
    }
  }

  // 2. Champs metadata — auto-découverte
  const metaVals: Record<string, Set<string>> = {};
  for (const p of poisRaw) {
    if (!p.metadata) continue;
    try {
      const meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
      if (!meta || typeof meta !== 'object') continue;
      for (const [key, val] of Object.entries(meta as Record<string, any>)) {
        if (val == null || String(val).trim() === '') continue;
        if (!metaVals[key]) metaVals[key] = new Set();
        metaVals[key].add(String(val).trim());
      }
    } catch { /* ignore */ }
  }

  for (const [key, vals] of Object.entries(metaVals)) {
    // Exclure les champs qui sont déjà couverts par les colonnes directes
    if (DIRECT_FILTER_COLS.some(c => normalize(c.field) === normalize(key))) continue;
    // Garder les champs catégoriels (2–50 valeurs distinctes)
    if (vals.size >= 2 && vals.size <= 50) {
      result[key] = { label: formatLabel(key), values: [...vals].sort() };
    }
  }

  return result;
}

// ─── Composant principal ───────────────────────────────────────────────────────

export default function MapPage() {
  const [poisRaw, setPoisRaw] = useState<POI[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [poiCategories, setPoiCategories] = useState<Record<string, boolean>>({});
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  // Un seul état pour tous les filtres actifs : field → valeur sélectionnée
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  // Diagnostic coordonnées
  const handleCoordsInfo = useCallback((_valid: number, _total: number) => {}, []);

  // ─── Filtres disponibles — calculés depuis les données ──────────────────────
  const availableFilters = useMemo(() => computeAvailableFilters(poisRaw), [poisRaw]);

  // ─── POIs filtrés — dérivés de poisRaw + activeFilters ──────────────────────
  const pois = useMemo(() => {
    if (poisRaw.length === 0) return [];
    const hasActive = Object.values(activeFilters).some(v => v !== '');
    if (!hasActive) return poisRaw;

    return poisRaw.filter(poi =>
      Object.entries(activeFilters).every(([field, value]) => {
        if (!value) return true;
        const poiVal = getPoiFieldValue(poi, field);
        if (!poiVal) return false;
        return normalize(poiVal) === normalize(value);
      })
    );
  }, [poisRaw, activeFilters]);

  // ─── Chargement des catégories ──────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/search-poi/categories')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const cats: string[] = data.categories || [];
          setAvailableCategories(cats);
          const init: Record<string, boolean> = {};
          cats.forEach(c => { init[c] = cats.length === 1; });
          setPoiCategories(init);
        }
      })
      .catch(err => console.error('[MapPage] categories:', err));
  }, []);

  // ─── Chargement des POIs quand catégories changent ──────────────────────────
  useEffect(() => {
    const selectedCats = Object.keys(poiCategories).filter(c => poiCategories[c]);
    if (selectedCats.length === 0) { setPoisRaw([]); return; }

    setIsLoading(true);
    // Reset filtres quand on change de catégories
    setActiveFilters({});

    fetch('/api/search-poi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: selectedCats, limit: 5000 }),
    })
      .then(r => r.json())
      .then(data => { if (data.pois) setPoisRaw(data.pois); })
      .catch(err => console.error('[MapPage] search-poi:', err))
      .finally(() => setIsLoading(false));
  }, [poiCategories]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const toggleCategory = (cat: string) => {
    setPoiCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleFilterChange = (field: string, value: string) => {
    setActiveFilters(prev => ({ ...prev, [field]: value }));
  };

  const clearAllFilters = () => setActiveFilters({});

  // ─── Recherche IA ────────────────────────────────────────────────────────────
  const handleAISearch = (categories: string[], filters: Record<string, string | string[]>) => {
    console.log('[MapPage] AI Search:', { categories, filters });

    // Mise à jour des catégories
    setPoiCategories(prev => {
      const updated = Object.fromEntries(Object.keys(prev).map(k => [k, false]));
      if (categories.length === 0) {
        return Object.fromEntries(Object.keys(prev).map(k => [k, true]));
      }
      categories.forEach(cat => {
        const match = Object.keys(updated).find(k => normalize(k) === normalize(cat));
        if (match) updated[match] = true;
        else updated[cat] = true;
      });
      return updated;
    });

    // Conversion filtres IA → activeFilters avec correspondance normalisée
    if (Object.keys(filters).length === 0) {
      setActiveFilters({});
      return;
    }

    const newFilters: Record<string, string> = {};
    Object.entries(filters).forEach(([fieldName, fieldValue]) => {
      const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue as string];
      const nfn = normalize(fieldName);

      // Cherche le champ correspondant dans availableFilters
      const matchedKey = Object.keys(availableFilters).find(k => {
        const nk = normalize(k);
        return nk === nfn || nk.includes(nfn) || nfn.includes(nk);
      });

      if (matchedKey) {
        const vals = availableFilters[matchedKey]?.values || [];
        for (const fv of values) {
          const nfv = normalize(fv);
          const best = vals.find(v => normalize(v) === nfv)
            ?? vals.find(v => normalize(v).includes(nfv) || nfv.includes(normalize(v)));
          if (best) { newFilters[matchedKey] = best; break; }
        }
      } else {
        // Pas encore dans availableFilters (données pas encore chargées) — applique directement
        const fv = values[0];
        if (fv) newFilters[fieldName] = fv;
      }
    });

    setActiveFilters(newFilters);
  };

  // ─── Données pour AISearchInput ─────────────────────────────────────────────
  const allFilterValues: Record<string, string[]> = useMemo(() => {
    const out: Record<string, string[]> = {};
    Object.entries(availableFilters).forEach(([f, { values }]) => { out[f] = values; });
    return out;
  }, [availableFilters]);

  const selectedCount = Object.values(poiCategories).filter(Boolean).length;
  const activeFilterCount = Object.values(activeFilters).filter(v => v !== '').length;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0a0a0a' }}>

      {/* ── Sidebar ── */}
      <div style={{
        width: sidebarCollapsed ? '40px' : '280px',
        transition: 'width 0.3s ease',
        background: '#111118',
        borderRight: '1px solid rgba(99, 102, 241, 0.15)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {/* Collapse button */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          style={{
            background: 'transparent', border: 'none', color: '#a5b4fc',
            cursor: 'pointer', padding: '12px', fontSize: '16px',
            textAlign: sidebarCollapsed ? 'center' : 'right',
          }}
        >
          {sidebarCollapsed ? '▸' : '◂'}
        </button>

        {!sidebarCollapsed && (
          <div style={{ padding: '0 16px 16px', overflow: 'auto', flex: 1 }}>

            {/* Header filtres */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h3 style={{
                fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1.5px',
                color: '#64748b', fontFamily: 'Inter, sans-serif', margin: 0,
              }}>
                FILTRES {activeFilterCount > 0 && (
                  <span style={{ color: '#6366f1', marginLeft: 4 }}>({activeFilterCount} actif{activeFilterCount > 1 ? 's' : ''})</span>
                )}
              </h3>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  style={{
                    background: 'none', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#ef4444', cursor: 'pointer', padding: '2px 6px',
                    fontSize: '10px', borderRadius: '4px', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  Effacer
                </button>
              )}
            </div>

            {/* Catégories */}
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{
                fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px',
                color: '#94a3b8', marginBottom: '8px', fontFamily: 'Inter, sans-serif',
              }}>
                Type d&apos;établissement
              </h4>
              {availableCategories.length === 0 && (
                <div style={{ fontSize: '11px', color: '#475569', fontStyle: 'italic' }}>
                  Aucune catégorie en base
                </div>
              )}
              {availableCategories.map(cat => (
                <label key={cat} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 0', cursor: 'pointer', color: '#e2e8f0',
                  fontSize: '13px', fontFamily: 'Inter, sans-serif',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={poiCategories[cat] || false}
                      onChange={() => toggleCategory(cat)}
                      style={{ accentColor: '#6366f1' }}
                    />
                    {cat.toUpperCase()}
                  </span>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>
                    {poiCategories[cat] ? pois.filter(p => p.categorie === cat).length : ''}
                  </span>
                </label>
              ))}
            </div>

            {/* Filtres dynamiques — auto-découverts depuis les données */}
            {Object.keys(availableFilters).length > 0 && (
              <div>
                <h4 style={{
                  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px',
                  color: '#94a3b8', marginBottom: '10px', fontFamily: 'Inter, sans-serif',
                  borderLeft: '2px solid #6366f1', paddingLeft: '8px',
                }}>
                  Affiner
                </h4>
                {Object.entries(availableFilters).map(([field, { label, values }]) => (
                  <div key={field} style={{ marginBottom: '10px' }}>
                    <label style={{
                      display: 'block', fontSize: '10px', color: '#64748b',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                      marginBottom: '4px', fontFamily: 'Inter, sans-serif',
                    }}>
                      {label}
                    </label>
                    <select
                      value={activeFilters[field] || ''}
                      onChange={e => handleFilterChange(field, e.target.value)}
                      style={{
                        width: '100%', padding: '6px 8px',
                        background: activeFilters[field] ? '#1e1e3a' : '#1a1a2e',
                        border: `1px solid ${activeFilters[field] ? 'rgba(99,102,241,0.5)' : 'rgba(99,102,241,0.2)'}`,
                        borderRadius: '6px', color: '#e2e8f0',
                        fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none',
                      }}
                    >
                      <option value="">— Tous ({values.length}) —</option>
                      {values.map(val => (
                        <option key={val} value={val}>{val}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {/* Message si pas encore de données */}
            {poisRaw.length === 0 && selectedCount === 0 && (
              <div style={{ fontSize: '11px', color: '#475569', fontStyle: 'italic', marginTop: '8px' }}>
                Sélectionnez une catégorie pour charger les données
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Main content : search bar + map ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* AI Search */}
        <AISearchInput
          onSearch={handleAISearch}
          availableCategories={availableCategories}
          availableFilterValues={allFilterValues}
          isLoading={isLoading}
        />

        {/* Status bar */}
        <div style={{
          padding: '4px 16px',
          background: '#0f172a',
          borderBottom: '1px solid rgba(99, 102, 241, 0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: '11px', color: '#64748b', fontFamily: 'monospace',
        }}>
          <span>
            {pois.length} POI{pois.length !== 1 ? 's' : ''} affichés
            {poisRaw.length !== pois.length && (
              <span style={{ color: '#94a3b8', marginLeft: '6px' }}>
                (filtré depuis {poisRaw.length})
              </span>
            )}
            {' '}• {selectedCount} catégorie{selectedCount !== 1 ? 's' : ''}
            {pois.length > 0 && (() => {
              const validCount = pois.filter(p =>
                p.lat != null && p.lng != null && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng))
              ).length;
              if (validCount === 0) return (
                <span style={{ color: '#ef4444', marginLeft: '12px', fontWeight: 'bold' }}>
                  ⚠ lat/lng NULL en base — réimporter !
                </span>
              );
              if (validCount < pois.length) return (
                <span style={{ color: '#f59e0b', marginLeft: '12px' }}>
                  ⚠ {validCount}/{pois.length} coordonnées valides
                </span>
              );
              return (
                <span style={{ color: '#10b981', marginLeft: '12px' }}>
                  ✓ {validCount} coordonnées valides
                </span>
              );
            })()}
          </span>
          {isLoading && <span style={{ color: '#f59e0b' }}>⟳ Chargement...</span>}
        </div>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer pois={pois} onCoordsInfo={handleCoordsInfo} />
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
