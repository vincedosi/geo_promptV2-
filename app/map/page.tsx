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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h4 style={{
                  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px',
                  color: '#94a3b8', margin: 0, fontFamily: 'Inter, sans-serif',
                }}>
                  Type d&apos;établissement
                </h4>
                {availableCategories.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={selectAllCategories} style={{ background: 'none', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', cursor: 'pointer', padding: '2px 6px', fontSize: '10px', borderRadius: '4px', fontFamily: 'Inter, sans-serif' }}>Tout</button>
                    <button onClick={deselectAllCategories} style={{ background: 'none', border: '1px solid rgba(100,116,139,0.3)', color: '#64748b', cursor: 'pointer', padding: '2px 6px', fontSize: '10px', borderRadius: '4px', fontFamily: 'Inter, sans-serif' }}>Aucun</button>
                  </div>
                )}
              </div>
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

            {/* ── Couches carreaux ── */}
            {carreauxSources.length > 0 && (
              <div style={{ marginTop: '20px', borderTop: '1px solid rgba(99,102,241,0.15)', paddingTop: '16px' }}>
                <h4 style={{
                  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px',
                  color: '#94a3b8', marginBottom: '10px', fontFamily: 'Inter, sans-serif',
                  borderLeft: '2px solid #2171b5', paddingLeft: '8px',
                }}>
                  Couches de données
                </h4>

                {carreauxSources.map(src => (
                  <div key={src.tableName}>
                    <label style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 0', cursor: 'pointer', color: '#e2e8f0',
                      fontSize: '12px', fontFamily: 'Inter, sans-serif',
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={selectedCarreau === src.tableName}
                          onChange={() => toggleCarreauxSource(src.tableName)}
                          style={{ accentColor: '#2171b5' }}
                        />
                        <span style={{ fontSize: '11px' }}>
                          {src.name.replace(/_/g, ' ').slice(0, 35)}
                        </span>
                      </span>
                      <span style={{ color: '#64748b', fontSize: '11px' }}>
                        {selectedCarreau === src.tableName && filteredCarreauxGeoJSON
                          ? filteredCarreauxGeoJSON.features.length : src.count}
                      </span>
                    </label>
                  </div>
                ))}

                {/* Options carreaux quand actif */}
                {selectedCarreau && carreauxGeoJSON && (
                  <div style={{ marginTop: '8px', paddingLeft: '4px' }}>

                    {/* Toggle visibilité */}
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      fontSize: '11px', color: '#94a3b8', cursor: 'pointer', marginBottom: '10px',
                    }}>
                      <input
                        type="checkbox"
                        checked={carreauxVisible}
                        onChange={() => setCarreauxVisible(v => !v)}
                        style={{ accentColor: '#2171b5' }}
                      />
                      Afficher sur la carte
                    </label>

                    {/* Sélecteur de métrique */}
                    {carreauxAnalysis.numericFields.length > 0 && (
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{
                          display: 'block', fontSize: '10px', color: '#64748b',
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                          marginBottom: '4px', fontFamily: 'Inter, sans-serif',
                        }}>
                          Indicateur (couleur)
                        </label>
                        <select
                          value={carreauxMetric}
                          onChange={e => setCarreauxMetric(e.target.value)}
                          style={{
                            width: '100%', padding: '5px 8px',
                            background: '#1a1a2e',
                            border: '1px solid rgba(33,113,181,0.3)',
                            borderRadius: '6px', color: '#e2e8f0',
                            fontSize: '11px', fontFamily: 'Inter, sans-serif', outline: 'none',
                          }}
                        >
                          {carreauxAnalysis.numericFields.slice(0, 40).map(f => (
                            <option key={f} value={f}>
                              {formatLabel(f)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Légende gradient — couleurs identiques à CHORO_COLORS dans MapContainer */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '12px',
                      fontSize: '10px', color: '#64748b', fontFamily: 'monospace',
                    }}>
                      <span>Min</span>
                      <div style={{
                        flex: 1, height: '8px', borderRadius: '4px',
                        background: 'linear-gradient(to right, #c6dbef, #9ecae1, #4292c6, #2171b5, #08306b)',
                      }} />
                      <span>Max</span>
                    </div>

                    {/* Bouton re-centrage */}
                    <button
                      onClick={() => setCarreauxFlyTrigger(t => t + 1)}
                      title="Recentrer la carte sur les carreaux"
                      style={{
                        width: '100%', padding: '5px 8px',
                        background: 'rgba(33,113,181,0.12)',
                        border: '1px solid rgba(33,113,181,0.35)',
                        borderRadius: '5px', color: '#9ecae1',
                        fontSize: '11px', fontFamily: 'Inter, sans-serif',
                        cursor: 'pointer', marginBottom: '10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(33,113,181,0.22)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(33,113,181,0.12)')}
                    >
                      ⊙ Localiser sur la carte
                    </button>

                    {/* Filtres carreaux */}
                    {Object.keys(carreauxAnalysis.categoricalFilters).length > 0 && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{
                            fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px',
                            color: '#64748b', fontFamily: 'Inter, sans-serif',
                          }}>
                            Filtrer carreaux
                          </span>
                          {Object.values(carreauxFilters).some(v => v !== '') && (
                            <button
                              onClick={clearCarreauxFilters}
                              style={{
                                background: 'none', border: '1px solid rgba(239,68,68,0.3)',
                                color: '#ef4444', cursor: 'pointer', padding: '1px 5px',
                                fontSize: '9px', borderRadius: '3px',
                              }}
                            >
                              Effacer
                            </button>
                          )}
                        </div>
                        {Object.entries(carreauxAnalysis.categoricalFilters).map(([field, { label, values }]) => (
                          <div key={field} style={{ marginBottom: '8px' }}>
                            <label style={{
                              display: 'block', fontSize: '10px', color: '#536882',
                              marginBottom: '3px', fontFamily: 'Inter, sans-serif',
                            }}>
                              {label}
                            </label>
                            <select
                              value={carreauxFilters[field] || ''}
                              onChange={e => handleCarreauxFilterChange(field, e.target.value)}
                              style={{
                                width: '100%', padding: '4px 6px',
                                background: carreauxFilters[field] ? '#1a2040' : '#1a1a2e',
                                border: `1px solid ${carreauxFilters[field] ? 'rgba(33,113,181,0.5)' : 'rgba(33,113,181,0.15)'}`,
                                borderRadius: '5px', color: '#e2e8f0',
                                fontSize: '11px', fontFamily: 'Inter, sans-serif', outline: 'none',
                              }}
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
                      <div style={{ fontSize: '11px', color: '#f59e0b', fontStyle: 'italic' }}>
                        ⟳ Chargement des carreaux...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          {/* ── Zones de Recrutement ── */}
          <div style={{ marginTop: 24, borderTop: '1px solid rgba(239,68,68,0.15)', paddingTop: 16 }}>
            <h4 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#94a3b8', marginBottom: 12, fontFamily: 'Inter, sans-serif', borderLeft: '2px solid #ef4444', paddingLeft: 8, margin: '0 0 12px' }}>
              Zones de Recrutement
            </h4>

            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'rgba(239,68,68,0.06)', borderRadius: 8, padding: 4 }}>
              {(['battle', 'isochrone'] as const).map(m => (
                <button key={m} onClick={() => setBattleMode(m)} style={{ flex: 1, padding: '5px 0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: 600, background: battleMode === m ? '#ef4444' : 'transparent', color: battleMode === m ? '#fff' : '#94a3b8', transition: 'all 0.2s' }}>
                  {m === 'battle' ? '⚔ Bataille' : '⏱ Isochrone'}
                </button>
              ))}
            </div>

            {/* Catégorie */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Catégorie</label>
              <select value={battleCategory} onChange={e => setBattleCategory(e.target.value)} style={{ width: '100%', background: '#1e293b', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: 12, fontFamily: 'Inter, sans-serif', outline: 'none' }}>
                <option value="">— Choisir —</option>
                {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Transport */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Transport</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {([['drive','🚗','Voiture'],['walk','🚶','Marche'],['bike','🚲','Vélo']] as [string,string,string][]).map(([t,icon,label]) => (
                  <button key={t} onClick={() => setBattleTransport(t as 'drive'|'walk'|'bike')} title={label} style={{ flex: 1, padding: '6px 0', border: `1px solid ${battleTransport === t ? '#ef4444' : 'rgba(255,255,255,0.1)'}`, borderRadius: 6, cursor: 'pointer', fontSize: 14, background: battleTransport === t ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)', color: battleTransport === t ? '#fff' : '#94a3b8', transition: 'all 0.2s' }}>{icon}</button>
                ))}
              </div>
            </div>

            {/* Durée max */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>
                Durée max <span style={{ color: '#ef4444', fontWeight: 700 }}>{battleMaxMin} min</span>
              </label>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {[60,90,120,150,180].map(m => (
                  <button key={m} onClick={() => setBattleMaxMin(m)} style={{ padding: '4px 9px', border: `1px solid ${battleMaxMin === m ? '#ef4444' : 'rgba(255,255,255,0.1)'}`, borderRadius: 5, cursor: 'pointer', fontSize: 11, fontFamily: 'monospace', background: battleMaxMin === m ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.04)', color: battleMaxMin === m ? '#fff' : '#64748b', fontWeight: battleMaxMin === m ? 700 : 400, transition: 'all 0.15s' }}>{m}m</button>
                ))}
              </div>
            </div>

            {/* Filtres région / département */}
            <div style={{ marginBottom: 14, display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Région</label>
                <input value={battleRegion} onChange={e => setBattleRegion(e.target.value)} placeholder="ex : Bretagne" style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, color: '#e2e8f0', padding: '5px 7px', fontSize: 11, fontFamily: 'Inter, sans-serif', outline: 'none' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Dept.</label>
                <input value={battleDept} onChange={e => setBattleDept(e.target.value)} placeholder="ex : 29" style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, color: '#e2e8f0', padding: '5px 7px', fontSize: 11, fontFamily: 'Inter, sans-serif', outline: 'none' }} />
              </div>
            </div>

            {/* Bouton lancement */}
            <button onClick={launchBattle} disabled={!battleCategory || battleLoading} style={{ width: '100%', padding: '10px 0', background: !battleCategory || battleLoading ? 'rgba(239,68,68,0.2)' : '#dc2626', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 8, cursor: !battleCategory || battleLoading ? 'not-allowed' : 'pointer', color: '#fff', fontSize: 13, fontFamily: 'Inter, sans-serif', fontWeight: 700, letterSpacing: 0.3, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {battleLoading ? '⏳ Calcul en cours…' : battleMode === 'battle' ? '⚔ Lancer la Bataille' : '⏱ Calculer Isochrone'}
            </button>

            {/* Erreur */}
            {battleError && (
              <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, fontSize: 11, color: '#fca5a5', fontFamily: 'monospace', wordBreak: 'break-word' }}>❌ {battleError}</div>
            )}

            {/* Légende résultats */}
            {battleCirfas.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(239,68,68,0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{battleCirfas.length} territoires · {battleMaxMin}min max</span>
                  <button onClick={() => { setBattleRings(null); setBattleBorders(null); setBattleCirfas([]); setBattleError(null); }} style={{ fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px' }}>✕</button>
                </div>
                {/* Gradient paliers */}
                <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                  {[10,30,60,90,120,150,180].filter(p => p <= battleMaxMin).map((p,i,arr) => {
                    const ops = [0.65,0.50,0.38,0.28,0.18,0.11,0.08];
                    return (
                      <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                        <span style={{ display: 'inline-block', width: 13, height: 7, background: `rgba(239,68,68,${ops[i]??0.08})`, borderRadius: 2, border: '1px solid rgba(0,0,0,0.2)' }} />
                        <span style={{ fontSize: 7, color: '#64748b' }}>{p}m</span>
                      </div>
                    );
                  })}
                </div>
                {/* Liste CIRFA */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 130, overflowY: 'auto' }}>
                  {battleCirfas.map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'inline-block', width: 9, height: 9, background: c.color + '55', borderRadius: 2, border: `1.5px solid ${c.color}`, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nom}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

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
            {selectedCarreau && filteredCarreauxGeoJSON && (
              <span style={{ color: '#2171b5', marginLeft: '8px' }}>
                ■ {filteredCarreauxGeoJSON.features.length} carreaux
              </span>
            )}
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

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
