'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import * as XLSX from 'xlsx';
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
  metadata?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/** Lit la valeur d'un champ POI — colonnes directes ET champs metadata */
function getPoiFieldValue(poi: POI, field: string): string | null {
  const nf = normalize(field);

  // Colonnes directes
  const directCols = ['nom', 'adresse', 'ville', 'code_postal', 'departement', 'region', 'code_departement', 'sous_categorie', 'categorie'];
  const directMatch = directCols.find(c => normalize(c) === nf);
  if (directMatch) {
    const v = (poi as unknown as Record<string, unknown>)[directMatch];
    return v != null ? String(v) : null;
  }

  // Champ metadata
  if (!poi.metadata) return null;
  try {
    const meta = typeof poi.metadata === 'string' ? JSON.parse(poi.metadata) : poi.metadata;
    if (!meta || typeof meta !== 'object') return null;
    const m = meta as Record<string, unknown>;
    if (m[field] != null && m[field] !== '') return String(m[field]);
    const metaKey = Object.keys(m).find(k => normalize(k) === nf);
    if (metaKey) return String(m[metaKey]);
  } catch { /* ignore */ }
  return null;
}

function formatLabel(field: string): string {
  return field.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Filtres auto-découverts depuis poisRaw ────────────────────────────────────

const DIRECT_FILTER_COLS = [
  { field: 'region',         label: 'Région',         maxValues: 30 },
  { field: 'departement',    label: 'Département',    maxValues: 100 },
  { field: 'sous_categorie', label: 'Sous-catégorie', maxValues: 50 },
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
      const v = (p as unknown as Record<string, unknown>)[field];
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
      for (const [key, val] of Object.entries(meta as Record<string, unknown>)) {
        if (val == null || String(val).trim() === '') continue;
        if (!metaVals[key]) metaVals[key] = new Set();
        metaVals[key].add(String(val).trim());
      }
    } catch { /* ignore */ }
  }

  for (const [key, vals] of Object.entries(metaVals)) {
    if (DIRECT_FILTER_COLS.some(c => normalize(c.field) === normalize(key))) continue;
    if (vals.size >= 2 && vals.size <= 50) {
      result[key] = { label: formatLabel(key), values: [...vals].sort() };
    }
  }

  return result;
}

// ─── Export Excel ─────────────────────────────────────────────────────────────

function exportToExcel(pois: POI[], fileLabel: string) {
  if (pois.length === 0) return;

  // Collecter toutes les clés metadata présentes
  const metaKeys = new Set<string>();
  pois.forEach(p => {
    if (!p.metadata) return;
    try {
      const meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
      if (meta && typeof meta === 'object') Object.keys(meta as object).forEach(k => metaKeys.add(k));
    } catch { /* ignore */ }
  });

  const rows = pois.map(p => {
    let meta: Record<string, unknown> = {};
    if (p.metadata) {
      try { meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : (p.metadata as Record<string, unknown>); }
      catch { /* ignore */ }
    }

    const row: Record<string, unknown> = {
      'Nom': p.nom || '',
      'Catégorie': p.categorie || '',
      'Sous-catégorie': p.sous_categorie || '',
      'Adresse': p.adresse || '',
      'Ville': p.ville || '',
      'Code postal': p.code_postal || '',
      'Département': p.departement || '',
      'Région': p.region || '',
      'Latitude': p.lat,
      'Longitude': p.lng,
    };

    metaKeys.forEach(k => { row[k] = meta[k] ?? ''; });
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export POI');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `geo_export_${fileLabel}_${date}.xlsx`);
}

// ─── Composant principal ───────────────────────────────────────────────────────

export default function MapPage() {
  const [poisRaw, setPoisRaw] = useState<POI[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [poiCategories, setPoiCategories] = useState<Record<string, boolean>>({});
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  // Filtres actifs : string = valeur unique (dropdown), string[] = OR multi-valeur (IA)
  const [activeFilters, setActiveFilters] = useState<Record<string, string | string[]>>({});

  const handleCoordsInfo = useCallback((_valid: number, _total: number) => {}, []);

  // Ref pour les filtres IA — stockés ici avant le rechargement de données
  // pour éviter que setActiveFilters({}) dans l'useEffect ne les écrase
  const pendingAIFilters = useRef<Record<string, string | string[]> | null>(null);

  // ─── Filtres disponibles — calculés depuis les données ──────────────────────
  const availableFilters = useMemo(() => computeAvailableFilters(poisRaw), [poisRaw]);

  // ─── POIs filtrés — logique OR pour les tableaux multi-valeur ───────────────
  const pois = useMemo(() => {
    if (poisRaw.length === 0) return [];
    const entries = Object.entries(activeFilters).filter(
      ([, v]) => v !== '' && (!Array.isArray(v) || v.length > 0)
    );
    if (entries.length === 0) return poisRaw;

    return poisRaw.filter(poi =>
      entries.every(([field, value]) => {
        const poiVal = getPoiFieldValue(poi, field);
        if (!poiVal) return false;
        if (Array.isArray(value)) {
          // OR : le POI match si sa valeur correspond à AU MOINS UNE des valeurs demandées
          return value.some(v => normalize(poiVal) === normalize(v));
        }
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
    if (selectedCats.length === 0) { setPoisRaw([]); setActiveFilters({}); return; }

    setIsLoading(true);
    // Ne pas réinitialiser les filtres maintenant si l'IA en a défini (pendingAIFilters)
    // On les appliquera après le chargement des données
    if (!pendingAIFilters.current) {
      setActiveFilters({});
    }

    fetch('/api/search-poi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: selectedCats, limit: 20000 }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.pois) setPoisRaw(data.pois);
        // Appliquer les filtres IA en attente APRÈS le chargement des données
        if (pendingAIFilters.current) {
          setActiveFilters(pendingAIFilters.current);
          pendingAIFilters.current = null;
        }
      })
      .catch(err => console.error('[MapPage] search-poi:', err))
      .finally(() => setIsLoading(false));
  }, [poiCategories]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const toggleCategory = (cat: string) => {
    setPoiCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  // Dropdown — toujours valeur unique
  const handleFilterChange = (field: string, value: string) => {
    setActiveFilters(prev => ({ ...prev, [field]: value }));
  };

  // Retirer une valeur d'un filtre multi-valeur (IA)
  const removeFilterValue = (field: string, valueToRemove: string) => {
    setActiveFilters(prev => {
      const current = prev[field];
      if (Array.isArray(current)) {
        const remaining = current.filter(v => v !== valueToRemove);
        if (remaining.length === 0) {
          const { [field]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [field]: remaining.length === 1 ? remaining[0] : remaining };
      }
      const { [field]: _, ...rest } = prev;
      return rest;
    });
  };

  const clearAllFilters = () => setActiveFilters({});

  // ─── Recherche IA — supporte multi-valeurs ────────────────────────────────────
  const handleAISearch = (categories: string[], filters: Record<string, string | string[]>) => {
    console.log('[MapPage] AI Search:', { categories, filters });

    // Mise à jour des catégories cochées
    setPoiCategories(prev => {
      const updated = Object.fromEntries(Object.keys(prev).map(k => [k, false]));
      if (categories.length === 0) {
        // Pas de catégorie précisée → tout cocher
        return Object.fromEntries(Object.keys(prev).map(k => [k, true]));
      }
      categories.forEach(cat => {
        const match = Object.keys(updated).find(k => normalize(k) === normalize(cat));
        if (match) updated[match] = true;
        else updated[cat] = true;
      });
      return updated;
    });

    // Conversion filtres IA → newFilters avec résolution des valeurs
    if (Object.keys(filters).length === 0) {
      // Pas de filtre : on réinitialise via le ref (la useEffect le vidra proprement)
      pendingAIFilters.current = null;
      return;
    }

    const newFilters: Record<string, string | string[]> = {};
    Object.entries(filters).forEach(([fieldName, fieldValue]) => {
      const rawValues = Array.isArray(fieldValue) ? fieldValue : [fieldValue as string];
      const nfn = normalize(fieldName);

      // Cherche le champ correspondant dans availableFilters (normalisé)
      // Note: availableFilters peut être vide si les données ne sont pas encore chargées
      // On stocke quand même les valeurs brutes — elles seront appliquées telles quelles
      const matchedKey =
        Object.keys(availableFilters).find(k => {
          const nk = normalize(k);
          return nk === nfn || nk.includes(nfn) || nfn.includes(nk);
        }) || fieldName;

      const availVals = availableFilters[matchedKey]?.values || [];

      const resolved: string[] = rawValues
        .map(fv => {
          if (availVals.length === 0) return fv; // pas encore de données — garder la valeur brute
          const nfv = normalize(fv);
          return (
            availVals.find(v => normalize(v) === nfv) ??
            availVals.find(v => normalize(v).includes(nfv) || nfv.includes(normalize(v))) ??
            fv
          );
        })
        .filter(Boolean);

      if (resolved.length > 0) {
        newFilters[matchedKey] = resolved.length === 1 ? resolved[0] : resolved;
      }
    });

    // Stocker dans le ref — sera appliqué après le chargement des données par l'useEffect
    // Cela évite que setActiveFilters({}) dans l'useEffect n'écrase les filtres IA
    pendingAIFilters.current = newFilters;
  };

  // ─── Données pour AISearchInput ─────────────────────────────────────────────
  const allFilterValues: Record<string, string[]> = useMemo(() => {
    const out: Record<string, string[]> = {};
    Object.entries(availableFilters).forEach(([f, { values }]) => { out[f] = values; });
    return out;
  }, [availableFilters]);

  const selectedCount = Object.values(poiCategories).filter(Boolean).length;
  const activeFilterCount = Object.values(activeFilters).filter(
    v => v !== '' && (!Array.isArray(v) || v.length > 0)
  ).length;

  // Label pour le nom du fichier Excel
  const exportLabel = [
    Object.keys(poiCategories).filter(c => poiCategories[c]).join('-'),
    ...Object.entries(activeFilters)
      .filter(([, v]) => v !== '' && (!Array.isArray(v) || v.length > 0))
      .map(([, v]) => (Array.isArray(v) ? v.slice(0, 2).join('-') : v as string))
      .slice(0, 2),
  ]
    .filter(Boolean)
    .join('_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40) || 'export';

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
                  <span style={{ color: '#6366f1', marginLeft: 4 }}>
                    ({activeFilterCount} actif{activeFilterCount > 1 ? 's' : ''})
                  </span>
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
                {Object.entries(availableFilters).map(([field, { label, values }]) => {
                  const currentVal = activeFilters[field];
                  const isMulti = Array.isArray(currentVal) && currentVal.length > 1;
                  const hasValue = currentVal !== undefined && currentVal !== '' &&
                    (!Array.isArray(currentVal) || currentVal.length > 0);

                  return (
                    <div key={field} style={{ marginBottom: '12px' }}>
                      <label style={{
                        display: 'block', fontSize: '10px', color: '#64748b',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                        marginBottom: '4px', fontFamily: 'Inter, sans-serif',
                      }}>
                        {label}
                      </label>

                      {/* Tags multi-valeur (définis par IA) */}
                      {isMulti && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 5 }}>
                          {(currentVal as string[]).map(v => (
                            <span
                              key={v}
                              title="Cliquer pour retirer"
                              onClick={() => removeFilterValue(field, v)}
                              style={{
                                fontSize: 10, background: 'rgba(99,102,241,0.2)',
                                color: '#a5b4fc', padding: '2px 6px', borderRadius: 3,
                                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
                                border: '1px solid rgba(99,102,241,0.3)',
                              }}
                            >
                              {v}
                              <span style={{ color: '#ef4444', fontSize: 9, fontWeight: 700 }}>✕</span>
                            </span>
                          ))}
                        </div>
                      )}

                      <select
                        value={isMulti ? '' : ((currentVal as string) || '')}
                        onChange={e => handleFilterChange(field, e.target.value)}
                        style={{
                          width: '100%', padding: '6px 8px',
                          background: hasValue ? '#1e1e3a' : '#1a1a2e',
                          border: `1px solid ${hasValue ? 'rgba(99,102,241,0.5)' : 'rgba(99,102,241,0.2)'}`,
                          borderRadius: '6px', color: '#e2e8f0',
                          fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none',
                        }}
                      >
                        <option value="">
                          {isMulti
                            ? `${(currentVal as string[]).length} valeurs (IA) —`
                            : `— Tous (${values.length}) —`}
                        </option>
                        {values.map(val => (
                          <option key={val} value={val}>{val}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}

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
                  ⚠ lat/lng NULL — réimporter !
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isLoading && <span style={{ color: '#f59e0b' }}>⟳ Chargement...</span>}
            {pois.length > 0 && (
              <button
                onClick={() => exportToExcel(pois, exportLabel)}
                title={`Exporter ${pois.length} POIs vers Excel`}
                style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#10b981', cursor: 'pointer', padding: '3px 10px',
                  fontSize: '11px', borderRadius: '4px', fontFamily: 'monospace',
                  display: 'flex', alignItems: 'center', gap: 4,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)')}
              >
                ↓ Excel ({pois.length})
              </button>
            )}
          </div>
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
