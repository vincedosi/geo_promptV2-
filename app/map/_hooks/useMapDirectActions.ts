'use client';

/**
 * MAGELIAN — actions directes du panneau de filtres (POI, OOH, isochrones,
 * bataille) et etat de bataille associe.
 *
 * Regroupe les 6 handlers et les 4 etats qui vivaient dans app/map/page.tsx
 * (refactor du 31/08/2026) :
 *   - handleDirectOOH            : panneaux OOH bornes par bboxDuFiltre(filtre)
 *   - handleDirectSearch         : recherche POI directe, bornee de meme
 *   - handleDirectBattle         : isochrones multi-POI (v1, streaming)
 *   - handleFillIsochroneCache   : prechauffage du cache ORS
 *   - handleApplyBattle          : decoupe des territoires (ST_Difference)
 *   - handleDirectBattleV2       : isochrones multi-POI (v2)
 *
 * ⛔ Deplacement a l'identique : ces handlers pilotent /api/isochrone-battle*,
 * code metier protege. Ne rien reordonner, ne rien "optimiser" ici — les
 * appels sont sequentiels et bornes par bbox par respect des contraintes I/O.
 *
 * Tache 4 (2026-09-12, corrigee round 1) : `handleDirectOOH`/`handleDirectSearch`
 * envoient `bbox: bboxDuFiltre(filtre)` a `/api/map/ooh` et `/api/map/pois`
 * UNIQUEMENT SI un filtre est actif. Un premier essai l'envoyait toujours
 * (repli sur BBOX_METRO sans filtre) : ca masquait 339 POI d'outre-mer et
 * rendait le pill « France + DROM » inerte. Sans filtre, comportement
 * inchange : aucune bbox, scope/regions/depts/ville seuls decident (comme
 * avant cette tache).
 *
 * ⛔ A appeler APRES useMapInit et useMapLayers.
 */
import { useState, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { logger } from '@/lib/logger';
import type { useMapLayers } from '@/app/map/_hooks/useMapLayers';
import type {
  DirectPOISearchParams,
  DirectBattleParams,
  DirectBattleV2Params,
  FillIsochroneCacheParams,
} from '@/app/map/_components/filter-panel/types';
import type { ZoneData, BattleResult } from '@/types/spatial';
import type { POI } from '@/types/poi';
import type { FiltreActif } from '@/lib/carte/filtre';
import { bboxPourRequete } from '@/lib/carte/bbox-requete';

export function useMapDirectActions(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapLayers: ReturnType<typeof useMapLayers>,
  setZoneData: React.Dispatch<React.SetStateAction<ZoneData | null>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  filtre: FiltreActif | null,
) {
  const [battleFeatures,      setBattleFeatures]      = useState<GeoJSON.Feature[]>([]);
  const [battlePois,          setBattlePois]          = useState<POI[]>([]);
  const [battleCacheKey,      setBattleCacheKey]      = useState<string | null>(null);

  // Stocke le résultat de bataille pré-calculé (PostGIS) — appliqué uniquement sur clic "BATAILLE"
  const pendingBattleRef = useRef<{
    geoJSON: GeoJSON.FeatureCollection;
    borders: GeoJSON.FeatureCollection;
    category?: string;
    poisForMap?: POI[];
  } | null>(null);


  const handleDirectOOH = async (regies?: string[]) => {
    setError(null);
    setZoneData(null);
    try {
      const bbox = bboxPourRequete(filtre);
      const res = await fetch('/api/map/ooh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regies: regies ?? [], ...(bbox ? { bbox } : {}) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(err.error ?? `Erreur ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.error) setError(data.error);
      else setZoneData(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur réseau');
    }
  };

  const handleDirectSearch = async (params: DirectPOISearchParams) => {
    setError(null);
    setZoneData(null);
    try {
      const bbox = bboxPourRequete(filtre);
      const res = await fetch('/api/map/pois', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, ...(bbox ? { bbox } : {}) }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(err.error ?? `Erreur ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.error) setError(data.error);
      else if (!data.pois?.length) setError(`Aucun POI trouvé pour "${params.poi_types.join(', ')}"`);
      else setZoneData(data);
    } catch (e: unknown) {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        setError('Base de données lente — réessayez dans quelques instants');
      } else {
        setError(e instanceof Error ? e.message : 'Erreur réseau');
      }
    }
  };

  const handleDirectBattle = async (
    params: DirectBattleParams,
    onProgress?: (msg: string, pct?: number) => void,
  ): Promise<{ geometry: string; nb_pois: number; poiGroups: { id: string; nom: string; geometries: string[] }[]; battleRings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[] }> => {
    setError(null);
    pendingBattleRef.current = null;
    mapLayers.clearBattlePartialRings();
    let battleData: BattleResult | null = null;
    try {
      const res = await fetch('/api/isochrone-battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:           params.category,
          mode:               params.mode,
          max_minutes:        params.max_minutes,
          durations:          params.durations,
          filtre_ville:       params.filtre_ville    ?? null,
          filtre_regions:     params.filtre_regions  ?? null,
          filtre_depts:       params.filtre_depts    ?? null,
          metropolitaine:     params.metropolitaine,
          force_recalculate:  params.force_recalculate ?? false,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { type: string; message?: string; data?: BattleResult; rings?: unknown[]; total?: number; completed?: number; err?: number; status?: string } | null = null;
          try { evt = JSON.parse(line); } catch { continue; }
          if (!evt) continue;
          if (evt.type === 'error') {
            const raw = String(evt.message ?? 'Erreur inconnue');
            throw new Error(raw.startsWith('<') ? 'Service temporairement indisponible (503/521)' : raw.slice(0, 200));
          }
          if (evt.type === 'result') { battleData = evt.data ?? null; continue; }
          if (evt.type === 'partial_rings' && (evt.rings?.length ?? 0) > 0) {
            // Afficher les anneaux bruts dès qu'ils arrivent (avant ST_Difference)
            mapLayers.addBattlePartialRings(evt.rings! as Parameters<typeof mapLayers.addBattlePartialRings>[0]);
            onProgress?.(`> ◆ +${evt.rings!.length} isochrones sur la carte`);
          } else if (evt.type === 'pois_loaded') {
            onProgress?.(`> ${evt.total ?? '?'} POIs trouvés — démarrage ORS...`);
          } else if (evt.type === 'progress') {
            if (evt.status === 'bataille_postgis') {
              onProgress?.('> [BATAILLE] ST_Difference en cours (PostGIS)...');
            } else {
              const completed = evt.completed ?? 0;
              const total = evt.total ?? 0;
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
              const errInfo = (evt.err ?? 0) > 0 ? ` (${evt.err} erreurs ORS)` : '';
              onProgress?.(`> ${completed}/${total} POIs traités — ${pct}%${errInfo}`);
            }
          }
        }
      }
      reader.releaseLock();
      if (!battleData) throw new Error('Réponse incomplète');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur réseau';
      setError(`Isochrones — ${msg}`);
      throw new Error(msg);
    }
    if (battleData!.error) {
      // Tronquer les erreurs HTML (ex: page 521 Supabase/Cloudflare)
      const rawErr: string = String(battleData!.error);
      const cleanErr = rawErr.startsWith('<') ? 'Service temporairement indisponible (503/521)' : rawErr.slice(0, 200);
      setError(`Isochrones — ${cleanErr}`);
      throw new Error(battleData!.error);
    }
    // Afficher les isochrones bruts (rings) — couvre cache hit et ORS path.
    // La bataille (ST_Difference) n'est déclenchée que sur clic du bouton BATAILLE.
    if (battleData!.battleGeoJSON?.features?.length > 0) {
      const rawRings = (battleData!.battleGeoJSON.features as GeoJSON.Feature[])
        .filter((f) => !!f?.geometry)
        .map((f) => {
          const props = (f.properties ?? {}) as Record<string, unknown>;
          return {
            cirfa_id: String(props.cirfa_id ?? props.id ?? ''),
            nom:      String(props.nom ?? ''),
            lat:      Number(props.lat ?? 0),
            lng:      Number(props.lng ?? 0),
            palier:   Number(props.palier ?? 0),
            geojson:  f.geometry as object,
          };
        });
      mapLayers.clearBattlePartialRings();
      mapLayers.addBattlePartialRings(rawRings);
      setBattleFeatures(battleData!.battleGeoJSON.features);
    }
    // poisForMap peut être absent des anciens caches v3 — fallback depuis les ring features
    let poisForMap: { id: string; nom: string; lat: number; lng: number; categorie?: string; adresse?: string; ville?: string }[] = battleData!.poisForMap ?? [];
    if (poisForMap.length === 0 && battleData!.battleGeoJSON?.features?.length > 0) {
      const poisSeen = new Set<string>();
      for (const f of battleData!.battleGeoJSON.features as GeoJSON.Feature[]) {
        const p = (f?.properties ?? {}) as Record<string, unknown>;
        const cid = String(p.cirfa_id ?? p.id ?? '');
        const lat = Number(p.lat), lng = Number(p.lng);
        if (cid && !poisSeen.has(cid) && !isNaN(lat) && !isNaN(lng) && lat && lng) {
          poisSeen.add(cid);
          poisForMap.push({ id: cid, nom: String(p.nom ?? ''), lat, lng, categorie: params.category, adresse: String(p.adresse ?? ''), ville: String(p.ville ?? '') });
        }
      }
    }
    if (battleData!.battleCacheKey) setBattleCacheKey(battleData!.battleCacheKey);
    if (poisForMap.length > 0) {
      const poisAsPOI: POI[] = poisForMap.map(p => ({ ...p, categorie: p.categorie ?? params.category }));
      setBattlePois(poisAsPOI);
      setZoneData({
        coordonnees: { lat: poisForMap[0].lat, lng: poisForMap[0].lng },
        pois: poisAsPOI,
        nb_pois: poisForMap.length,
        categories: { [params.category]: poisForMap.length },
        couleur_overrides: {},
        ville: params.filtre_ville ?? '',
        rayon_metres: null,
        rayon_poi_metres: null,
      });
    }
    // Fusionner tous les rings en un seul MultiPolygon simplifié (client-side, pas de Turf)
    const allPolygons: number[][][][] = [];
    // Grouper les géométries par cirfa_id pour le calcul couverture par POI
    const groupMap = new Map<string, { nom: string; geoms: string[] }>();
    for (const f of battleData!.battleGeoJSON?.features ?? []) {
      if (f.properties?.feature_type !== 'ring') continue;
      const geom = f.geometry;
      if (!geom) continue;
      if (geom.type === 'Polygon')      allPolygons.push(geom.coordinates);
      else if (geom.type === 'MultiPolygon') allPolygons.push(...geom.coordinates);
      const cid = String(f.properties?.cirfa_id ?? f.properties?.id ?? '');
      const nom = String(f.properties?.nom ?? '');
      if (cid) {
        if (!groupMap.has(cid)) groupMap.set(cid, { nom, geoms: [] });
        groupMap.get(cid)!.geoms.push(JSON.stringify(geom));
      }
    }
    // Réduire à 3 décimales (~111m) pour alléger le payload (~10× moins de bytes)
    const multiPoly = { type: 'MultiPolygon', coordinates: allPolygons };
    const simplified = JSON.parse(JSON.stringify(multiPoly, (_, v) =>
      typeof v === 'number' ? Math.round(v * 1000) / 1000 : v
    ));
    const geometry  = allPolygons.length > 0 ? JSON.stringify(simplified) : '';
    const poiGroups = [...groupMap.entries()].map(([id, { nom, geoms }]) => ({ id, nom, geometries: geoms }));
    // Convertir les ring features en RingEntry pour le bouton BATAILLE (Phase 2)
    const battleRings = ((battleData!.battleGeoJSON?.features ?? []) as GeoJSON.Feature[])
      .filter((f) => {
        const ft = (f?.properties as Record<string, unknown> | null)?.feature_type;
        return ft === 'ring' && !!f?.geometry;
      })
      .map((f) => {
        const props = (f.properties ?? {}) as Record<string, unknown>;
        return {
          cirfa_id: String(props.cirfa_id ?? props.id ?? ''),
          nom:      String(props.nom ?? ''),
          lat:      Number(props.lat ?? 0),
          lng:      Number(props.lng ?? 0),
          palier:   Number(props.palier ?? 0),
          geojson:  JSON.stringify(f.geometry),
        };
      });
    return { geometry, nb_pois: battleData!.nb_pois ?? 0, poiGroups, battleRings };
  };

  // Remplit le cache ORS sans écraser les POIs affichés sur la carte
  const handleFillIsochroneCache = async (
    params: FillIsochroneCacheParams,
    onProgress?: (msg: string) => void,
  ): Promise<void> => {
    mapLayers.clearBattlePartialRings();
    try {
      const res = await fetch('/api/isochrone-battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:          params.category,
          mode:              params.mode,
          max_minutes:       params.max_minutes,
          durations:         params.durations,
          filtre_ville:      params.filtre_ville   ?? null,
          filtre_regions:    params.filtre_regions ?? null,
          filtre_depts:      params.filtre_depts   ?? null,
          metropolitaine:    params.metropolitaine,
          force_recalculate: false,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          if (evt.type === 'error') throw new Error(String(evt.message ?? 'Erreur inconnue').slice(0, 200));
          if (evt.type === 'partial_rings' && Array.isArray(evt.rings) && evt.rings.length > 0) {
            mapLayers.addBattlePartialRings(evt.rings as Parameters<typeof mapLayers.addBattlePartialRings>[0]);
            onProgress?.(`> ◆ +${(evt.rings as unknown[]).length} isochrones sur la carte`);
          } else if (evt.type === 'pois_loaded') {
            onProgress?.(`> ${evt.total} POIs trouvés — démarrage ORS...`);
          } else if (evt.type === 'progress') {
            if (evt.status === 'bataille_postgis') {
              onProgress?.('> [BATAILLE] ST_Difference en cours (PostGIS)...');
            } else {
              const completed = Number(evt.completed ?? 0);
              const total = Number(evt.total ?? 1);
              const pct    = Math.round((completed / total) * 100);
              const errCount = Number(evt.err ?? 0);
              const errInfo = errCount > 0 ? ` (${errCount} erreurs ORS)` : '';
              onProgress?.(`> ${completed}/${total} POIs traités — ${pct}%${errInfo}`);
            }
          }
          // result: on affiche juste les rings finaux si disponibles (pas de setZoneData)
          const evtData = evt.data as { battleGeoJSON?: { features?: GeoJSON.Feature[] } } | undefined;
          if (evt.type === 'result' && evtData?.battleGeoJSON?.features && evtData.battleGeoJSON.features.length > 0) {
            const rawRings = (evtData.battleGeoJSON.features as GeoJSON.Feature[])
              .filter((f) => !!f?.geometry)
              .map((f) => {
                const props = (f.properties ?? {}) as Record<string, unknown>;
                return {
                  cirfa_id: String(props.cirfa_id ?? props.id ?? ''),
                  nom:      String(props.nom ?? ''),
                  lat:      Number(props.lat ?? 0),
                  lng:      Number(props.lng ?? 0),
                  palier:   Number(props.palier ?? 0),
                  geojson:  f.geometry as object,
                };
              });
            mapLayers.clearBattlePartialRings();
            mapLayers.addBattlePartialRings(rawRings);
          }
        }
      }
      reader.releaseLock();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur réseau';
      setError(`Cache fill — ${msg}`);
      throw new Error(msg);
    }
  };

  const handleApplyBattle = async (
    rings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: string }[],
    category?: string,
    poisForMap?: { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[],
    onProgress?: (msg: string, pct: number) => void,
  ): Promise<void> => {
    setError(null);
    // Priorité : utiliser le résultat pré-calculé (déjà fait par la route en Phase 5)
    if (pendingBattleRef.current) {
      const { geoJSON, borders, category: cat, poisForMap: pois } = pendingBattleRef.current;
      mapLayers.applyIsochroneBattle(geoJSON, borders, cat ?? category, pois ?? poisForMap);
      return;
    }
    // Stream NDJSON depuis apply-battle
    const res = await fetch('/api/isochrone-battle/apply-battle', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ rings }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setError(`Bataille — ${err.error ?? `HTTP ${res.status}`}`);
      return;
    }
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const PCT: Record<string, number> = { clip: 15, clip_done: 45, battle: 50, done: 85 };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: Record<string, unknown>;
        try { evt = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        if (evt.type === 'error') {
          setError(`Bataille — ${evt.message}`);
          throw new Error(String(evt.message ?? 'Erreur inconnue'));
        }
        if (evt.type === 'progress') {
          onProgress?.(String(evt.message ?? ''), PCT[String(evt.step ?? '')] ?? 50);
        }
        if (evt.type === 'result') {
          const battleGeo = evt.battleGeoJSON as { features?: GeoJSON.Feature[] } | undefined;
          logger.debug('handleApplyBattle', `result received — nb_rings ${evt.nb_rings} | features: ${battleGeo?.features?.length}`);
          onProgress?.(`${evt.nb_rings} zones, ${evt.nb_borders} bordures`, 95);
          if (battleGeo?.features && battleGeo.features.length > 0) {
            mapLayers.applyIsochroneBattle(battleGeo as { type: string; features: GeoJSON.Feature[] }, (evt.battleBorders as { type: string; features: GeoJSON.Feature[] } | null) ?? null, category, poisForMap);
            setBattleFeatures(battleGeo.features);
          }
        }
      }
    }
    reader.releaseLock();
  };

  const handleDirectBattleV2 = async (
    params: DirectBattleV2Params,
    onProgress?: (msg: string) => void,
  ): Promise<void> => {
    setError(null);
    mapLayers.clearBattlePartialRings();
    try {
      const res = await fetch('/api/isochrone-battle-v2', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      type BattleV2Result = {
        error?: string;
        battleGeoJSON?: { type: string; features: GeoJSON.Feature[] };
        poisForMap?: POI[];
      };
      let data: BattleV2Result | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          if (evt.type === 'error') throw new Error(String(evt.message ?? 'Erreur inconnue'));
          if (evt.type === 'result') { data = evt.data as BattleV2Result; continue; }
          if (evt.type === 'warning') onProgress?.(`> ! ${evt.message}`);
          else if (evt.type === 'pois_loaded')  onProgress?.(`> ${evt.total} POIs chargés`);
          else if (evt.type === 'rings_loaded') onProgress?.(`> ${evt.count} anneaux en cache (${evt.missing} manquants)`);
          else if (evt.type === 'computing')    onProgress?.(`> ${evt.message}`);
        }
      }
      reader.releaseLock();
      if (!data) throw new Error('Réponse incomplète');
      if (data.error) throw new Error(data.error);

      // Afficher le résultat sur la carte
      if (data.battleGeoJSON?.features && data.battleGeoJSON.features.length > 0) {
        mapLayers.applyIsochroneBattle(data.battleGeoJSON, null, params.category, data.poisForMap);
        setBattleFeatures(data.battleGeoJSON.features);
      }

      // Mettre à jour les POIs sur la carte
      const poisForMap = data.poisForMap ?? [];
      if (poisForMap.length > 0) {
        setBattlePois(poisForMap);
        setZoneData({
          coordonnees: { lat: poisForMap[0].lat, lng: poisForMap[0].lng },
          pois: poisForMap,
          nb_pois: poisForMap.length,
          categories: { [params.category]: poisForMap.length },
          couleur_overrides: {},
          ville: params.filtre_ville ?? '',
          rayon_metres: null,
          rayon_poi_metres: null,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur réseau';
      setError(`Bataille v2 — ${msg}`);
      throw new Error(msg);
    }
  };

  return {
    battleFeatures, setBattleFeatures,
    battlePois, setBattlePois,
    battleCacheKey, setBattleCacheKey,
    pendingBattleRef,
    handleDirectOOH,
    handleDirectSearch,
    handleDirectBattle,
    handleFillIsochroneCache,
    handleApplyBattle,
    handleDirectBattleV2,
  };
}
