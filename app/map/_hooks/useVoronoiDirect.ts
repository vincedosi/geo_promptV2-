'use client';

/**
 * Le Voronoï du panneau Analyse par la route directe `GET /api/voronoi`
 * (2026-10-12, chantier « suppression de toute l'IA », lot 4).
 *
 * Remplace l'aller-retour par le chat : le panneau écrivait une phrase,
 * le modèle appelait l'outil `voronoi_analysis`, `useToolProcessor` affichait.
 * La traduction territoire → paramètres et l'affichage du résultat vivent
 * dans `lib/carte/voronoi-direct.ts` (pur, testé) ; ce hook ne fait que le
 * `fetch` et porte l'état de chargement qui désactive le bouton — le rôle
 * que tenait `isLoading` du chat.
 */
import { useCallback, useState } from 'react';
import type { VoronoiData, ZoneData } from '@/types/spatial';
import { appliquerResultatVoronoi, type ResultatVoronoi } from '@/lib/carte/voronoi-direct';
import { adminFetch } from '@/lib/admin-fetch';

/**
 * Délai du `fetch` : la route se donne 60 s (`maxDuration`) ; les lycées de
 * métropole en prennent 14 (mesuré le 2026-10-10).
 */
const DELAI_MS = 60_000;

export function useVoronoiDirect(
  applyVoronoi: (data: VoronoiData) => void,
  setZoneData: (data: ZoneData | null) => void,
  setError: (message: string | null) => void,
) {
  const [voronoiChargement, setVoronoiChargement] = useState(false);

  /** @param requete - la chaîne de `requeteVoronoi` (sans le `?`). */
  const lancerVoronoi = useCallback(async (requete: string) => {
    setError(null);
    setVoronoiChargement(true);
    try {
      // `adminFetch` et non `fetch` nu : la route exige l'en-tête `Authorization`
      // (elle est hors du matcher de middleware.ts, qui lit le cookie).
      const res = await adminFetch(`/api/voronoi?${requete}`, { signal: AbortSignal.timeout(DELAI_MS) });
      const corps = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as ResultatVoronoi;
      appliquerResultatVoronoi(
        !res.ok && !corps.error ? { error: `HTTP ${res.status}` } : corps,
        { applyVoronoi, setZoneData, setError },
      );
    } catch (e: unknown) {
      const delai = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      setError(`⬡ Voronoï — Erreur : ${delai ? 'délai dépassé' : e instanceof Error ? e.message : 'erreur réseau'}`);
    } finally {
      setVoronoiChargement(false);
    }
  }, [applyVoronoi, setZoneData, setError]);

  return { lancerVoronoi, voronoiChargement };
}
