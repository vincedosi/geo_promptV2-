/**
 * @file filter-panel/use-filter-sections.ts — sections repliables du panneau
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Gere la recherche de filtre et
 * l'etat ouvert/ferme de chaque section, persiste dans localStorage.
 *
 * Deux regles non evidentes, conservees telles quelles :
 *   - en mode overlay, seules les sections territoriales sont ouvertes et rien
 *     n'est persiste — l'utilisateur doit filtrer la zone AVANT d'afficher les
 *     POI, sinon la carte charge toute la France (budget I/O Supabase Nano) ;
 *   - la section Sante environnementale s'auto-deploie au premier IRIS
 *     selectionne de la session, une seule fois : si l'utilisateur la referme
 *     ensuite, le ref bloque les ouvertures suivantes.
 */
import { useEffect, useRef, useState } from 'react';

/**
 * Sections repliables du panneau, dans l'ordre d'apparition.
 *
 * Réordonné à la Tâche 6 (2026-09-12) pour suivre l'ordre des groupes du
 * panneau Calques (`PanneauCalques.tsx`) : POI et mobilité (poi, transport,
 * tmja) → Médias offline (ooh, radio) → Environnement (civicHealth, meteo).
 * `perimetre`/`regions`/`departements`/`recherche` restent en tête : ce sont
 * les clés de `PanneauFiltre` (widget territorial), sans rapport avec les
 * groupes Calques. Même ensemble de clés qu'avant ce réordonnancement — aucun
 * ajout, aucun retrait.
 */
export const SECTION_KEYS = [
  'perimetre', 'regions', 'departements', 'recherche',
  'poi', 'transport', 'tmja', 'ooh', 'radio', 'civicHealth', 'meteo',
] as const;

/** Sections fermees au premier rendu (zone-specifiques). */
const DEFAULT_CLOSED = new Set<string>(['civicHealth']);

/** Sections ouvertes par defaut en mode overlay. */
const TERRITORY_OPEN = new Set<string>(['perimetre', 'regions', 'departements']);

const STORAGE_KEY = 'magelian-filter-sections';

export interface FilterSections {
  filterSearch: string;
  setFilterSearch: (v: string) => void;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
}

export function useFilterSections(
  isOverlayMode: boolean,
  selectedIrisCommuneCode?: string | null,
): FilterSections {
  const [filterSearch, setFilterSearch] = useState('');

  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>(() => {
    if (isOverlayMode) {
      return Object.fromEntries(SECTION_KEYS.map(k => [k, TERRITORY_OPEN.has(k)]));
    }
    const allOpen = (): Record<string, boolean> =>
      Object.fromEntries(SECTION_KEYS.map(k => [k, !DEFAULT_CLOSED.has(k)]));
    if (typeof window === 'undefined') return allOpen();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        // Garantit que les nouvelles sections ajoutees plus tard ont une valeur coherente.
        for (const k of SECTION_KEYS) {
          if (!(k in parsed)) parsed[k] = !DEFAULT_CLOSED.has(k);
        }
        return parsed;
      }
    } catch { /* ignore */ }
    return allOpen();
  });

  const civicHealthAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (selectedIrisCommuneCode && !civicHealthAutoOpenedRef.current) {
      civicHealthAutoOpenedRef.current = true;
      setSectionsOpen(prev => (prev.civicHealth ? prev : { ...prev, civicHealth: true }));
    }
  }, [selectedIrisCommuneCode]);

  const persist = (next: Record<string, boolean>) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const toggleSection = (key: string) => {
    setSectionsOpen(prev => {
      const next = { ...prev, [key]: !prev[key] };
      // Pas de persistance en mode overlay pour ne pas polluer l'etat full-panel
      if (!isOverlayMode) persist(next);
      return next;
    });
  };

  const setAll = (open: boolean) => {
    const next = Object.fromEntries(SECTION_KEYS.map(k => [k, open]));
    setSectionsOpen(next);
    persist(next);
  };

  return {
    filterSearch, setFilterSearch, sectionsOpen, toggleSection,
    collapseAll: () => setAll(false),
    expandAll:   () => setAll(true),
  };
}
