/**
 * @file filter-panel/use-poi-catalog.ts — catalogue POI charge depuis la base
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Deux referentiels dynamiques :
 *   - les CATEGORIES de POI (`/api/map/categories`), chargees une fois au
 *     montage — jamais codees en dur, elles viennent d'un DISTINCT en base ;
 *   - les NATURES par categorie (`metadata->>'libelle_nature'`), chargees a la
 *     demande quand une categorie est selectionnee.
 *
 * Deux gardes I/O a ne pas retirer (budget Supabase Nano) :
 *   - `fetchedNaturesRef` memorise les categories deja demandees : une nature
 *     n'est jamais refetchee, meme apres deselection/reselection ;
 *   - l'effet de montage a une liste de dependances VIDE. Ajouter
 *     `fetchCategories` la rejouerait a chaque render (la fonction est
 *     recreee a chaque fois), soit un fetch par render.
 *
 * Le retry unique a 800 ms couvre le cas HMR/restart en dev, ou le premier
 * appel part avant que le serveur Next soit pret.
 */
import { useEffect, useRef, useState } from 'react';

export interface PoiType { id: string; label: string }

export interface PoiCatalog {
  poiTypes: PoiType[];
  catsLoading: boolean;
  catsError: string | null;
  /** `forceRefresh` rejoue le DISTINCT cote serveur au lieu de lire son cache. */
  fetchCategories: (forceRefresh?: boolean, isRetry?: boolean) => void;
  poiNatures: Record<string, string[]>;
  /** Charge les natures d'une categorie — no-op si deja demandee. */
  fetchPoiNatures: (poiType: string) => Promise<void>;
  selectedPoiNatures: Record<string, string[]>;
  setSelectedPoiNatures: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}

export function usePoiCatalog(): PoiCatalog {
  // ── POI types dynamiques (chargés depuis la DB) ───────────────────────────
  const [poiTypes, setPoiTypes] = useState<{ id: string; label: string }[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState<string | null>(null);

  // ── POI natures (metadata->>'libelle_nature' par categorie) ───────────────
  const [poiNatures, setPoiNatures] = useState<Record<string, string[]>>({});
  const [selectedPoiNatures, setSelectedPoiNatures] = useState<Record<string, string[]>>({});
  const fetchedNaturesRef = useRef<Set<string>>(new Set());

  const fetchPoiNatures = async (poiType: string) => {
    if (fetchedNaturesRef.current.has(poiType)) return;
    fetchedNaturesRef.current.add(poiType);
    try {
      const res = await fetch(`/api/map/poi-natures?categorie=${encodeURIComponent(poiType)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.natures) && data.natures.length > 0) {
        setPoiNatures(prev => ({ ...prev, [poiType]: data.natures }));
      }
    } catch { /* ignore */ }
  };
  // Fetch catégories avec retry auto (1 retry après 800ms) — couvre le cas
  // HMR/restart dev où le 1er appel arrive avant que le serveur soit prêt.
  // cache: 'no-store' évite que Next.js dev serve une réponse cachée stale.
  const fetchCategories = (forceRefresh = false, isRetry = false) => {
    setCatsLoading(true);
    setCatsError(null);
    fetch(
      forceRefresh ? '/api/map/categories?refresh=1' : '/api/map/categories',
      { cache: 'no-store' },
    )
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (Array.isArray(data.categories)) {
          setPoiTypes(data.categories.map((c: { id: string; label: string } | string) =>
            typeof c === 'string'
              ? { id: c, label: c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ') }
              : c
          ));
          setCatsError(null);
        } else {
          setCatsError(data.error ?? 'Réponse inattendue');
        }
      })
      .catch((err: Error) => {
        // Retry automatique 1 fois après 800ms si pas déjà un retry
        if (!isRetry) {
          setTimeout(() => fetchCategories(forceRefresh, true), 800);
          return;
        }
        setCatsError(err.message);
      })
      .finally(() => setCatsLoading(false));
  };
  // Chargement unique au montage. NE PAS ajouter `fetchCategories` en
  // dependance : la fonction est recreee a chaque render, l'effet
  // rejouerait donc un fetch a chaque render — budget I/O Supabase Nano.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- voir ci-dessus
  useEffect(() => { fetchCategories(); }, []);

  return {
    poiTypes, catsLoading, catsError, fetchCategories,
    poiNatures, fetchPoiNatures, selectedPoiNatures, setSelectedPoiNatures,
  };
}
