/**
 * @file filter-panel/use-analyses.ts — liste « Mes analyses » (Tâche 11, 2026-09-12)
 *
 * Branche le groupe « Mes analyses » de `PanneauCalques.tsx` (Tâche 6, qui le
 * laissait volontairement vide) sur `GET /api/analyses` (sql/145).
 *
 * Garde I/O Nano : `fetchedRef` empêche tout refetch au simple repliage/
 * dépliage du groupe — le composant qui monte les enfants de `GroupeCalques`
 * est démonté à la fermeture (`{ouvert && <div>{children}</div>}`), donc un
 * état local à ces enfants serait perdu à chaque toggle ; ce hook vit un cran
 * plus haut, dans `PanneauCalques`. `demanderChargement` est appelé au premier
 * dépliage du groupe, jamais au montage du panneau (pas de prefetch — CLAUDE.md).
 *
 * **Portée exacte de ce cache, corrigée le 2026-09-13** (relecture de la tâche
 * 11) : il vaut le temps d'UNE ouverture du panneau Calques, pas la session.
 * `page.tsx` ne monte le panneau actif que tant qu'il est ouvert
 * (`{entreeActive && … PANNEAUX[entreeActive]?.()}`), donc fermer Calques ou
 * basculer vers Filtre/Analyse/Zones démonte ce hook et vide `fetchedRef`. La
 * première version de ce commentaire affirmait que `PanneauCalques` « ne
 * démonte jamais » — c'était faux, et une garantie de performance écrite et
 * fausse coûte plus cher qu'une garantie absente. Le coût réel reste bas : une
 * requête indexée, 50 lignes, aucune colonne jsonb.
 */
import { useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

/** Forme légère rendue par `GET /api/analyses` — pas les jsonb lourds (voir la route). */
export interface AnalyseListItem {
  id: string;
  type: string;
  nom: string;
  maillage: string | null;
  statut: string;
  created_at: string;
  updated_at: string;
}

export interface AnalysesState {
  analyses: AnalyseListItem[];
  loading: boolean;
  error: string | null;
  /** Charge la liste si elle ne l'a pas déjà été (cache `useRef`) — no-op sinon. */
  demanderChargement: () => void;
}

export function useAnalyses(): AnalysesState {
  const [analyses, setAnalyses] = useState<AnalyseListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const demanderChargement = () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(null);
    adminFetch('/api/analyses')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setAnalyses(Array.isArray(data.analyses) ? data.analyses : []);
      })
      .catch(() => {
        setError('Impossible de charger les analyses enregistrées.');
        // Un échec réseau ne doit pas condamner le groupe à rester vide pour
        // toujours : un nouveau dépliage retentera le chargement.
        fetchedRef.current = false;
      })
      .finally(() => setLoading(false));
  };

  return { analyses, loading, error, demanderChargement };
}
