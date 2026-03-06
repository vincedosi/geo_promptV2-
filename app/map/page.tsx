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

import type { POI } from '@/types/poi';

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

// ─── Carreaux types ─────────────────────────────────────────────────────────

interface CarreauxSource {
  id: string;
  name: string;
  tableName: string;
  count: number;
}

// Métriques numériques prioritaires pour le carreau (triées en premier)
const PRIORITY_METRICS = [
  // Filosofi / carroyage INSEE (ind_c = individus, men = ménages, etc.)
  'ind_c', 'men', 'ind_r', 'ind_srf', 'ind_a15', 'ind_a15_25',
  'ind_age6', 'ind_age7', 'men_coll', 'men_1ind', 'men_prop', 'men_basr',
  // IRIS / données génériques
  'population', 'menage', 'logements', 'pop_femme', 'pop_homme',
  'pop_0_14_ans', 'pop_15_29_ans', 'pop_30_44_ans', 'pop_45_59_ans',
  'pop_60_74_ans', 'pop_75_ans_ou_plus', 'chomeur_15_64_ans',
  'actifs_occupes_15_64_ans', 'familles', 'appartements', 'maisons',
];

/** Découvre les champs numériques et catégoriels d'un GeoJSON carreaux */
function analyzeCarreauxFields(geojson: GeoJSON.FeatureCollection): {
  numericFields: string[];
  categoricalFilters: Record<string, { label: string; values: string[] }>;
} {
  if (!geojson.features.length) return { numericFields: [], categoricalFilters: {} };

  const SKIP = new Set(['idcar', 'gml_id', 'objectid', 'shape_len', 'shape_area', 'iris', 'triiris', 'comexcde', 'zoneexcde', 'modif_iris', 'code_insee', 'x', 'y']);
  const sample = geojson.features.slice(0, 50);
  const allKeys = new Set<string>();
  sample.forEach(f => { if (f.properties) Object.keys(f.properties).forEach(k => allKeys.add(k)); });

  const numericFields: string[] = [];
  const categoricalFilters: Record<string, { label: string; values: string[] }> = {};

  for (const key of allKeys) {
    if (SKIP.has(key)) continue;
    const vals = sample.map(f => (f.properties as Record<string, unknown>)?.[key]).filter(v => v != null);
    if (vals.length === 0) continue;

    const numCount = vals.filter(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '')).length;
    if (numCount > vals.length * 0.8) {
      numericFields.push(key);
    } else {
      // Catégoriel : 2-80 valeurs distinctes max
      const uniq = [...new Set(geojson.features.map(f => String((f.properties as Record<string, unknown>)?.[key] ?? '')).filter(Boolean))];
      if (uniq.length >= 2 && uniq.length <= 80) {
        categoricalFilters[key] = { label: formatLabel(key), values: uniq.sort() };
      }
    }
  }

  // Trier : métriques prioritaires d'abord
  const priority = new Map(PRIORITY_METRICS.map((m, i) => [m, i]));
  numericFields.sort((a, b) => (priority.get(a) ?? 999) - (priority.get(b) ?? 999));

  return { numericFields, categoricalFilters };
}

export default function MapPage() {
  const [poisRaw, setPoisRaw] = useState<POI[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [poiCategories, setPoiCategories] = useState<Record<string, boolean>>({});
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  // Filtres actifs : string = valeur unique (dropdown), string[] = OR multi-valeur (IA)
  const [activeFilters, setActiveFilters] = useState<Record<string, string | string[]>>({});

  // ─── État carreaux ────────────────────────────────────────────────────────
  const [carreauxSources, setCarreauxSources] = useState<CarreauxSource[]>([]);
  const [selectedCarreau, setSelectedCarreau] = useState<string | null>(null); // tableName
  const [carreauxGeoJSON, setCarreauxGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [carreauxMetric, setCarreauxMetric] = useState('ind');
  const [carreauxVisible, setCarreauxVisible] = useState(true);
  const [carreauxFilters, setCarreauxFilters] = useState<Record<string, string>>({});
  const [carreauxLoading, setCarreauxLoading] = useState(false);
  const [carreauxFlyTrigger, setCarreauxFlyTrigger] = useState(0);
  const mapBboxRef = useRef<[number, number, number, number] | null>(null);
  const bboxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [carreauxRevision, setCarreauxRevision] = useState(0);

  // ─── État Zones de Recrutement (Bataille d'Isochrones) ────────────────────
  const [battleMode,      setBattleMode]      = useState<'battle' | 'isochrone'>('battle');
  const [battleCategory,  setBattleCategory]  = useState('');
  const [battleTransport, setBattleTransport] = useState<'drive' | 'walk' | 'bike'>('drive');
  const [battleMaxMin,    setBattleMaxMin]    = useState(120);
  const [battleRegion,    setBattleRegion]    = useState('');
  const [battleDept,      setBattleDept]      = useState('');
  const [battleLoading,   setBattleLoading]   = useState(false);
  const [battleError,     setBattleError]     = useState<string | null>(null);
  const [battleRings,     setBattleRings]     = useState<GeoJSON.FeatureCollection | null>(null);
  const [battleBorders,   setBattleBorders]   = useState<GeoJSON.FeatureCollection | null>(null);
  const [battleCirfas,    setBattleCirfas]    = useState<{ id: string; nom: string; color: string }[]>([]);

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
          cats.forEach(c => { init[c] = true; }); // Tout cocher par défaut
          setPoiCategories(init);
        }
      })
      .catch(err => console.error('[MapPage] categories:', err));
  }, []);

  // ─── Chargement des sources carreaux ──────────────────────────────────────
  useEffect(() => {
    fetch('/api/carreaux')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.sources?.length > 0) {
          setCarreauxSources(data.sources);
          // Auto-activer la première source
          setSelectedCarreau(data.sources[0].tableName);
        }
      })
      .catch(err => console.error('[MapPage] carreaux sources:', err));
  }, []);

  // ─── Charger le GeoJSON carreaux quand une source est sélectionnée ────────
  useEffect(() => {
    if (!selectedCarreau) { setCarreauxGeoJSON(null); return; }
    if (!mapBboxRef.current) return; // attendre que la carte soit prête
    const controller = new AbortController();
    setCarreauxLoading(true);
    setCarreauxFilters({});
    const t0 = performance.now();
    const bbox = mapBboxRef.current;
    console.log(`[MapPage] === FETCH CARREAUX START === table=${selectedCarreau} bbox=${JSON.stringify(bbox)}`);
    fetch('/api/carreaux', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName: selectedCarreau, bbox }),
      signal: controller.signal,
    })
      .then(r => {
        console.log(`[MapPage] Carreaux response status: ${r.status} (${(performance.now() - t0).toFixed(0)}ms)`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        const elapsed = (performance.now() - t0).toFixed(0);
        console.log(`[MapPage] Carreaux JSON parsed (${elapsed}ms)`);
        console.log(`[MapPage]   features count: ${data.features?.length ?? 'undefined'}`);
        console.log(`[MapPage]   _meta:`, data._meta);
        if (data.features && data.features.length > 0) {
          console.log(`[MapPage]   Feature[0] geom type: ${data.features[0]?.geometry?.type}`);
          console.log(`[MapPage]   Feature[0] coords[0][0]: ${JSON.stringify(data.features[0]?.geometry?.coordinates?.[0]?.[0])}`);
          console.log(`[MapPage]   Feature[0] properties keys: ${Object.keys(data.features[0]?.properties || {}).slice(0, 10)}`);
          // Strip _meta — pass only standard GeoJSON to MapContainer
          const cleanFC: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: data.features,
          };
          setCarreauxGeoJSON(cleanFC);
          console.log(`[MapPage] ✅ setCarreauxGeoJSON called with ${cleanFC.features.length} features (clean, no _meta)`);
        } else if (data.error) {
          console.error('[MapPage] ❌ carreaux API error:', data.error);
        } else {
          console.warn('[MapPage] ⚠ carreaux: 0 features in response', data);
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error(`[MapPage] ❌ carreaux fetch FAILED (${(performance.now() - t0).toFixed(0)}ms):`, err);
        } else {
          console.log('[MapPage] carreaux fetch aborted');
        }
      })
      .finally(() => { if (!controller.signal.aborted) setCarreauxLoading(false); });
    return () => controller.abort();
  }, [selectedCarreau, carreauxRevision]);

  // ─── Analyse des champs carreaux ──────────────────────────────────────────
  const carreauxAnalysis = useMemo(() => {
    if (!carreauxGeoJSON) return { numericFields: [] as string[], categoricalFilters: {} as Record<string, { label: string; values: string[] }> };
    return analyzeCarreauxFields(carreauxGeoJSON);
  }, [carreauxGeoJSON]);

  // ─── Auto-sélection de la première métrique valide ────────────────────────
  useEffect(() => {
    const fields = carreauxAnalysis.numericFields;
    if (fields.length > 0 && !fields.includes(carreauxMetric)) {
      console.log(`[MapPage] Auto-selecting metric: ${fields[0]} (was: ${carreauxMetric})`);
      setCarreauxMetric(fields[0]);
    }
  }, [carreauxAnalysis.numericFields]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── GeoJSON carreaux filtré ──────────────────────────────────────────────
  const filteredCarreauxGeoJSON = useMemo(() => {
    if (!carreauxGeoJSON) return null;
    const entries = Object.entries(carreauxFilters).filter(([, v]) => v !== '');
    if (entries.length === 0) return carreauxGeoJSON;
    return {
      ...carreauxGeoJSON,
      features: carreauxGeoJSON.features.filter(f => {
        const props = f.properties as Record<string, unknown>;
        return entries.every(([field, value]) => {
          const v = props[field];
          return v != null && normalize(String(v)) === normalize(value);
        });
      }),
    };
  }, [carreauxGeoJSON, carreauxFilters]);

  // ─── Chargement des POIs quand catégories changent ──────────────────────────
  useEffect(() => {
    const selectedCats = Object.keys(poiCategories).filter(c => poiCategories[c]);
    if (selectedCats.length === 0) { setPoisRaw([]); setActiveFilters({}); return; }

    // AbortController : annule le fetch précédent si les catégories changent avant qu'il finisse
    const controller = new AbortController();

    setIsLoading(true);
    // Ne pas réinitialiser les filtres maintenant si l'IA en a défini (pendingAIFilters)
    // On les appliquera après le chargement des données
    if (!pendingAIFilters.current) {
      setActiveFilters({});
    }

    // Capturer les filtres IA au moment du fetch (évite qu'un fetch périmé les consomme)
    const aiFiltersSnapshot = pendingAIFilters.current;

    fetch('/api/search-poi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: selectedCats, limit: 20000 }),
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(data => {
        if (data.pois) setPoisRaw(data.pois);
        // Appliquer les filtres IA en attente APRÈS le chargement des données
        // Utilise le snapshot capturé au début — un fetch périmé ne touchera pas aux filtres
        if (aiFiltersSnapshot) {
          setActiveFilters(aiFiltersSnapshot);
          // Ne nettoyer le ref que si c'est toujours la même valeur (pas remplacé par un nouveau search)
          if (pendingAIFilters.current === aiFiltersSnapshot) {
            pendingAIFilters.current = null;
          }
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') console.error('[MapPage] search-poi:', err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [poiCategories]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const toggleCategory = (cat: string) => {
    setPoiCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const selectAllCategories = () => {
    setPoiCategories(prev => Object.fromEntries(Object.keys(prev).map(k => [k, true])));
  };

  const deselectAllCategories = () => {
    setPoiCategories(prev => Object.fromEntries(Object.keys(prev).map(k => [k, false])));
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

  // ─── Handlers carreaux ─────────────────────────────────────────────────────
  const toggleCarreauxSource = (tableName: string) => {
    setSelectedCarreau(prev => prev === tableName ? null : tableName);
  };

  const handleBoundsChange = useCallback((bbox: [number, number, number, number]) => {
    mapBboxRef.current = bbox;
    if (bboxTimerRef.current) clearTimeout(bboxTimerRef.current);
    bboxTimerRef.current = setTimeout(() => setCarreauxRevision(r => r + 1), 400);
  }, []);

  const handleCarreauxFilterChange = (field: string, value: string) => {
    setCarreauxFilters(prev => ({ ...prev, [field]: value }));
  };

  const clearCarreauxFilters = () => setCarreauxFilters({});

  // ─── Lancer la Bataille d'Isochrones ──────────────────────────────────────
  const launchBattle = async () => {
    if (!battleCategory || battleLoading) return;
    setBattleLoading(true);
    setBattleError(null);
    try {
      const res = await fetch('/api/isochrone-battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:           battleCategory,
          mode:               battleTransport,
          max_minutes:        battleMaxMin,
          metropolitaine:     true,
          filtre_region:      battleRegion || null,
          filtre_departement: battleDept   || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setBattleError(data.error ?? 'Erreur inconnue'); return; }
      setBattleRings(data.battleGeoJSON   ?? null);
      setBattleBorders(data.battleBorders ?? null);
    } catch (e: any) {
      setBattleError(e.message);
    } finally {
      setBattleLoading(false);
    }
  };


  // ─── Recherche IA — supporte multi-valeurs ────────────────────────────────────
  const handleAISearch = (categories: string[], filters: Record<string, string | string[]>) => {
    console.log('[MapPage] AI Search:', { categories, filters });

    if (categories.length === 0) {
      console.warn('[MapPage] AI returned empty categories — showing ALL categories');
    }

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
    <div className="flex h-screen overflow-hidden bg-background-dark">

      {/* ── Sidebar ── */}
      <aside
        className="flex flex-col flex-shrink-0 border-r border-border-accent bg-terminal-gray/80 backdrop-blur-md transition-all duration-300 overflow-hidden"
        style={{ width: sidebarCollapsed ? 40 : 300 }}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="quantum-nav p-3 text-primary/70 hover:text-primary transition-colors text-xs"
          style={{ textAlign: sidebarCollapsed ? 'center' : 'right' }}
        >
          {sidebarCollapsed ? '▸' : '◂'}
        </button>

        {!sidebarCollapsed && (
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">

            {/* ── Filters header ── */}
            <div className="flex items-center justify-between">
              <h3 className="quantum-nav text-[10px] tracking-[0.2em] text-slate-500">
                FILTRES
                {activeFilterCount > 0 && (
                  <span className="text-primary ml-2">
                    ({activeFilterCount} actif{activeFilterCount > 1 ? 's' : ''})
                  </span>
                )}
              </h3>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="quantum-nav text-[9px] px-2 py-0.5 border border-red-500/30 text-red-400 rounded hover:bg-red-500/10 transition-colors"
                >
                  Effacer
                </button>
              )}
            </div>

            {/* ── Catégories ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="geometric-accent text-[10px] text-slate-400 uppercase">
                  Type d&apos;établissement
                </h4>
                {availableCategories.length > 0 && (
                  <div className="flex gap-1">
                    <button onClick={selectAllCategories} className="quantum-nav text-[9px] px-2 py-0.5 border border-primary/30 text-primary/80 rounded hover:bg-primary/10 transition-colors">Tout</button>
                    <button onClick={deselectAllCategories} className="quantum-nav text-[9px] px-2 py-0.5 border border-slate-700 text-slate-500 rounded hover:bg-slate-800 transition-colors">Aucun</button>
                  </div>
                )}
              </div>

              {availableCategories.length === 0 && (
                <p className="text-[11px] text-slate-600 italic">Aucune catégorie en base</p>
              )}

              {availableCategories.map(cat => (
                <label key={cat} className="flex items-center justify-between py-1.5 cursor-pointer group">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={poiCategories[cat] || false}
                      onChange={() => toggleCategory(cat)}
                      className="accent-primary w-3.5 h-3.5"
                    />
                    <span className="text-[12px] text-slate-200 font-light group-hover:text-primary transition-colors">
                      {cat.toUpperCase()}
                    </span>
                  </span>
                  <span className="text-[11px] text-slate-600 font-mono">
                    {poiCategories[cat] ? pois.filter(p => p.categorie === cat).length : ''}
                  </span>
                </label>
              ))}
            </div>

            {/* ── Dynamic filters ── */}
            {Object.keys(availableFilters).length > 0 && (
              <div className="pt-4 border-t border-border-accent/50">
                <h4 className="geometric-accent text-[10px] text-slate-400 uppercase mb-3 pl-2 border-l-2 border-primary">
                  Affiner
                </h4>

                {Object.entries(availableFilters).map(([field, { label, values }]) => {
                  const currentVal = activeFilters[field];
                  const isMulti = Array.isArray(currentVal) && currentVal.length > 1;
                  const hasValue = currentVal !== undefined && currentVal !== '' &&
                    (!Array.isArray(currentVal) || currentVal.length > 0);

                  return (
                    <div key={field} className="mb-3">
                      <label className="block text-[9px] text-slate-500 uppercase tracking-wider mb-1 font-sans">
                        {label}
                      </label>

                      {isMulti && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {(currentVal as string[]).map(v => (
                            <span
                              key={v}
                              title="Cliquer pour retirer"
                              onClick={() => removeFilterValue(field, v)}
                              className="text-[10px] bg-primary/15 text-primary/90 px-2 py-0.5 rounded border border-primary/25 cursor-pointer hover:bg-primary/25 transition-colors flex items-center gap-1"
                            >
                              {v}
                              <span className="text-red-400 text-[9px] font-bold">✕</span>
                            </span>
                          ))}
                        </div>
                      )}

                      <select
                        value={isMulti ? '' : ((currentVal as string) || '')}
                        onChange={e => handleFilterChange(field, e.target.value)}
                        className={`w-full px-2 py-1.5 rounded text-slate-200 text-[12px] font-sans outline-none transition-colors ${
                          hasValue
                            ? 'bg-primary/10 border border-primary/40'
                            : 'bg-terminal-gray border border-border-accent hover:border-primary/30'
                        }`}
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
              <p className="text-[11px] text-slate-600 italic">
                Sélectionnez une catégorie pour charger les données
              </p>
            )}

            {/* ── Couches carreaux ── */}
            {carreauxSources.length > 0 && (
              <div className="pt-4 border-t border-border-accent/50">
                <h4 className="geometric-accent text-[10px] text-slate-400 uppercase mb-3 pl-2 border-l-2 border-blue-600">
                  Couches de données
                </h4>

                {carreauxSources.map(src => (
                  <label key={src.tableName} className="flex items-center justify-between py-1.5 cursor-pointer group">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedCarreau === src.tableName}
                        onChange={() => toggleCarreauxSource(src.tableName)}
                        className="accent-blue-500 w-3.5 h-3.5"
                      />
                      <span className="text-[11px] text-slate-300 font-light group-hover:text-blue-400 transition-colors">
                        {src.name.replace(/_/g, ' ').slice(0, 35)}
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-600 font-mono">
                      {selectedCarreau === src.tableName && filteredCarreauxGeoJSON
                        ? filteredCarreauxGeoJSON.features.length : src.count}
                    </span>
                  </label>
                ))}

                {/* Carreaux options */}
                {selectedCarreau && carreauxGeoJSON && (
                  <div className="mt-2 pl-1 space-y-3">
                    {/* Visibility toggle */}
                    <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={carreauxVisible}
                        onChange={() => setCarreauxVisible(v => !v)}
                        className="accent-blue-500"
                      />
                      Afficher sur la carte
                    </label>

                    {/* Metric selector */}
                    {carreauxAnalysis.numericFields.length > 0 && (
                      <div>
                        <label className="block text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                          Indicateur (couleur)
                        </label>
                        <select
                          value={carreauxMetric}
                          onChange={e => setCarreauxMetric(e.target.value)}
                          className="w-full px-2 py-1.5 bg-terminal-gray border border-blue-600/25 rounded text-slate-200 text-[11px] font-sans outline-none hover:border-blue-500/40 transition-colors"
                        >
                          {carreauxAnalysis.numericFields.slice(0, 40).map(f => (
                            <option key={f} value={f}>{formatLabel(f)}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Gradient legend */}
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-600 font-mono">
                      <span>Min</span>
                      <div className="flex-1 h-2 rounded-full" style={{ background: 'linear-gradient(to right, #c6dbef, #9ecae1, #4292c6, #2171b5, #08306b)' }} />
                      <span>Max</span>
                    </div>

                    {/* Locate button */}
                    <button
                      onClick={() => setCarreauxFlyTrigger(t => t + 1)}
                      title="Recentrer la carte sur les carreaux"
                      className="w-full py-1.5 bg-blue-600/10 border border-blue-500/30 rounded text-blue-300 text-[11px] font-sans cursor-pointer hover:bg-blue-600/20 transition-colors flex items-center justify-center gap-1.5"
                    >
                      ⊙ Localiser sur la carte
                    </button>

                    {/* Carreaux filters */}
                    {Object.keys(carreauxAnalysis.categoricalFilters).length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[9px] text-slate-500 uppercase tracking-wider">Filtrer carreaux</span>
                          {Object.values(carreauxFilters).some(v => v !== '') && (
                            <button
                              onClick={clearCarreauxFilters}
                              className="text-[9px] px-1.5 py-0.5 border border-red-500/30 text-red-400 rounded hover:bg-red-500/10 transition-colors"
                            >
                              Effacer
                            </button>
                          )}
                        </div>
                        {Object.entries(carreauxAnalysis.categoricalFilters).map(([field, { label, values }]) => (
                          <div key={field} className="mb-2">
                            <label className="block text-[10px] text-slate-600 mb-1">{label}</label>
                            <select
                              value={carreauxFilters[field] || ''}
                              onChange={e => handleCarreauxFilterChange(field, e.target.value)}
                              className={`w-full px-2 py-1 rounded text-slate-200 text-[11px] font-sans outline-none transition-colors ${
                                carreauxFilters[field]
                                  ? 'bg-blue-900/20 border border-blue-500/40'
                                  : 'bg-terminal-gray border border-blue-600/15 hover:border-blue-500/30'
                              }`}
                            >
                              <option value="">— Tous ({values.length}) —</option>
                              {values.map(v => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {carreauxLoading && (
                      <p className="text-[11px] text-amber-400 italic">⟳ Chargement des carreaux...</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Zones de Recrutement ── */}
            <div className="pt-4 border-t border-red-500/15">
              <h4 className="geometric-accent text-[10px] text-slate-400 uppercase mb-3 pl-2 border-l-2 border-red-500">
                Zones de Recrutement
              </h4>

              {/* Mode toggle */}
              <div className="flex gap-1 mb-3.5 bg-red-500/5 rounded-lg p-1">
                {(['battle', 'isochrone'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setBattleMode(m)}
                    className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                      battleMode === m
                        ? 'bg-red-500 text-white terminal-glow'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {m === 'battle' ? '⚔ Bataille' : '⏱ Isochrone'}
                  </button>
                ))}
              </div>

              {/* Category */}
              <div className="mb-3">
                <label className="block text-[9px] text-slate-500 uppercase tracking-wider mb-1">Catégorie</label>
                <select
                  value={battleCategory}
                  onChange={e => setBattleCategory(e.target.value)}
                  className="w-full px-2 py-1.5 bg-terminal-gray border border-red-500/20 rounded text-slate-200 text-[12px] font-sans outline-none hover:border-red-500/40 transition-colors"
                >
                  <option value="">— Choisir —</option>
                  {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Transport */}
              <div className="mb-3">
                <label className="block text-[9px] text-slate-500 uppercase tracking-wider mb-1.5">Transport</label>
                <div className="flex gap-1">
                  {([['drive','🚗','Voiture'],['walk','🚶','Marche'],['bike','🚲','Vélo']] as [string,string,string][]).map(([t,icon,label]) => (
                    <button
                      key={t}
                      onClick={() => setBattleTransport(t as 'drive'|'walk'|'bike')}
                      title={label}
                      className={`flex-1 py-1.5 rounded-md text-sm transition-all ${
                        battleTransport === t
                          ? 'bg-red-500/15 border border-red-500 text-white'
                          : 'bg-white/[0.03] border border-white/10 text-slate-500 hover:border-red-500/30'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div className="mb-3.5">
                <label className="block text-[9px] text-slate-500 uppercase tracking-wider mb-1.5">
                  Durée max <span className="text-red-400 font-bold">{battleMaxMin} min</span>
                </label>
                <div className="flex gap-1 flex-wrap">
                  {[60,90,120,150,180].map(m => (
                    <button
                      key={m}
                      onClick={() => setBattleMaxMin(m)}
                      className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all ${
                        battleMaxMin === m
                          ? 'bg-red-500/20 border border-red-500 text-white font-bold'
                          : 'bg-white/[0.03] border border-white/10 text-slate-600 hover:border-red-500/30'
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Region / Dept */}
              <div className="flex gap-2 mb-3.5">
                <div className="flex-1">
                  <label className="block text-[9px] text-slate-500 mb-1">Région</label>
                  <input
                    value={battleRegion}
                    onChange={e => setBattleRegion(e.target.value)}
                    placeholder="ex : Bretagne"
                    className="w-full px-2 py-1.5 bg-terminal-gray border border-white/[0.06] rounded text-slate-200 text-[11px] font-sans outline-none placeholder:text-slate-700 focus:border-red-500/30 transition-colors"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[9px] text-slate-500 mb-1">Dept.</label>
                  <input
                    value={battleDept}
                    onChange={e => setBattleDept(e.target.value)}
                    placeholder="ex : 29"
                    className="w-full px-2 py-1.5 bg-terminal-gray border border-white/[0.06] rounded text-slate-200 text-[11px] font-sans outline-none placeholder:text-slate-700 focus:border-red-500/30 transition-colors"
                  />
                </div>
              </div>

              {/* Launch button */}
              <button
                onClick={launchBattle}
                disabled={!battleCategory || battleLoading}
                className={`w-full py-2.5 rounded-lg text-[13px] font-bold tracking-wide transition-all flex items-center justify-center gap-2 ${
                  !battleCategory || battleLoading
                    ? 'bg-red-500/15 border border-red-500/30 text-red-300/50 cursor-not-allowed'
                    : 'bg-red-600 border border-red-500/50 text-white cursor-pointer hover:bg-red-500 terminal-glow'
                }`}
              >
                {battleLoading ? '⏳ Calcul en cours…' : battleMode === 'battle' ? '⚔ Lancer la Bataille' : '⏱ Calculer Isochrone'}
              </button>

              {/* Error */}
              {battleError && (
                <div className="mt-2 p-2 bg-red-500/5 border border-red-500/20 rounded text-[11px] text-red-300 font-mono break-words">
                  ❌ {battleError}
                </div>
              )}

              {/* Battle results legend */}
              {battleCirfas.length > 0 && (
                <div className="mt-3.5 pt-3 border-t border-red-500/15">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                      {battleCirfas.length} territoires · {battleMaxMin}min max
                    </span>
                    <button
                      onClick={() => { setBattleRings(null); setBattleBorders(null); setBattleCirfas([]); setBattleError(null); }}
                      className="text-[11px] text-slate-600 hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Gradient steps */}
                  <div className="flex gap-1 mb-2">
                    {[10,30,60,90,120,150,180].filter(p => p <= battleMaxMin).map((p,i) => {
                      const ops = [0.65,0.50,0.38,0.28,0.18,0.11,0.08];
                      return (
                        <div key={p} className="flex flex-col items-center gap-0.5">
                          <span className="w-3.5 h-2 rounded-sm border border-black/20" style={{ background: `rgba(239,68,68,${ops[i]??0.08})` }} />
                          <span className="text-[7px] text-slate-600">{p}m</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* CIRFA list */}
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                    {battleCirfas.map(c => (
                      <div key={c.id} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: c.color + '55', border: `1.5px solid ${c.color}` }} />
                        <span className="text-[10px] text-slate-300 truncate">{c.nom}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* ── Main content : search bar + map ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* AI Search */}
        <AISearchInput
          onSearch={handleAISearch}
          availableCategories={availableCategories}
          availableFilterValues={allFilterValues}
          isLoading={isLoading}
        />

        {/* Status bar */}
        <div className="px-4 py-1 bg-terminal-gray/60 border-b border-border-accent/40 flex items-center justify-between text-[11px] text-slate-500 font-mono backdrop-blur-sm">
          <span>
            <span className="text-slate-300 font-semibold">{pois.length}</span> POI{pois.length !== 1 ? 's' : ''} affichés
            {poisRaw.length !== pois.length && (
              <span className="text-slate-500 ml-1.5">
                (filtré depuis {poisRaw.length})
              </span>
            )}
            {' '}· <span className="text-primary/70">{selectedCount}</span> catégorie{selectedCount !== 1 ? 's' : ''}
            {selectedCarreau && filteredCarreauxGeoJSON && (
              <span className="text-blue-400 ml-2">
                ■ {filteredCarreauxGeoJSON.features.length} carreaux
              </span>
            )}
            {pois.length > 0 && (() => {
              const validCount = pois.filter(p =>
                p.lat != null && p.lng != null && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng))
              ).length;
              if (validCount === 0) return (
                <span className="text-red-400 ml-3 font-bold">
                  ⚠ lat/lng NULL — réimporter !
                </span>
              );
              if (validCount < pois.length) return (
                <span className="text-amber-400 ml-3">
                  ⚠ {validCount}/{pois.length} coordonnées valides
                </span>
              );
              return (
                <span className="text-emerald-400 ml-3">
                  ✓ {validCount} coordonnées valides
                </span>
              );
            })()}
          </span>

          <div className="flex items-center gap-2">
            {isLoading && <span className="text-amber-400">⟳ Chargement...</span>}
            {pois.length > 0 && (
              <button
                onClick={() => exportToExcel(pois, exportLabel)}
                title={`Exporter ${pois.length} POIs vers Excel`}
                className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 px-3 py-0.5 text-[11px] rounded font-mono flex items-center gap-1 hover:bg-emerald-500/20 transition-colors"
              >
                ↓ Excel ({pois.length})
              </button>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <MapContainer
            pois={pois}
            carreauxGeoJSON={filteredCarreauxGeoJSON}
            carreauxMetric={carreauxMetric}
            carreauxVisible={carreauxVisible}
            onCoordsInfo={handleCoordsInfo}
            flyToTrigger={carreauxFlyTrigger}
            onBoundsChange={handleBoundsChange}
            battleRings={battleRings}
            battleBorders={battleBorders}
            onBattleCirfas={setBattleCirfas}
          />
        </div>
      </div>
    </div>
  );
}
