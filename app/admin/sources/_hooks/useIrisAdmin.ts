'use client';

/**
 * MAGELIAN — etat et actions de l'administration IRIS.
 *
 * Regroupe les 15 etats et 5 actions qui pilotaient l'onglet IRIS depuis
 * app/admin/sources/page.tsx (refactor du 31/08/2026), afin que le panneau
 * ne recoive qu'une seule prop au lieu de vingt et une.
 *
 * ⛔ A appeler depuis le composant PARENT de l'onglet, jamais depuis le
 * panneau lui-meme : le panneau est demonte a chaque changement d'onglet.
 * Si l'etat vivait dedans, `irisStats` repartirait a `null` et les stats
 * seraient refetchees a chaque visite — exactement le gaspillage d'I/O que
 * les contraintes Supabase Nano interdisent. Ici l'etat survit au demontage
 * et le garde `!irisStats` ne laisse passer qu'un seul chargement.
 */
import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { IrisStats, IrisDept, IrisSource, IrisSyncReport } from '../_lib/types';

export interface IrisAdmin {
  irisStats: IrisStats | null;
  irisDepts: IrisDept[];
  irisSource: IrisSource | null;
  irisLoading: boolean;

  irisAnnee: string;
  setIrisAnnee: React.Dispatch<React.SetStateAction<string>>;
  irisAnneeSaving: boolean;
  irisAnneeSaved: boolean;
  saveIrisAnnee: (annee: string) => Promise<void>;

  irisPmtilesLoading: boolean;
  irisPmtilesMsg: string | null;
  triggerIrisPmtiles: () => Promise<void>;

  irisDeleteConfirm: boolean;
  setIrisDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  irisDeleteLoading: boolean;
  irisDeleteMsg: string | null;
  deleteAllIris: () => Promise<void>;

  irisSyncReport: IrisSyncReport | null;
  irisSyncLoading: boolean;
  irisSyncError: string | null;
  runIrisSync: () => Promise<void>;
}

/**
 * @param active `true` quand l'onglet IRIS est affiche. Declenche le
 *   chargement paresseux des stats, une seule fois.
 */
export function useIrisAdmin(active: boolean): IrisAdmin {
  // Stats
  const [irisStats,   setIrisStats]   = useState<IrisStats | null>(null);
  const [irisDepts,   setIrisDepts]   = useState<IrisDept[]>([]);
  const [irisSource,  setIrisSource]  = useState<IrisSource | null>(null);
  const [irisLoading, setIrisLoading] = useState(false);

  // Metadata (annee du millesime)
  const [irisAnnee,       setIrisAnnee]       = useState('2025');
  const [irisAnneeSaving, setIrisAnneeSaving] = useState(false);
  const [irisAnneeSaved,  setIrisAnneeSaved]  = useState(false);

  // Generation PMTiles
  const [irisPmtilesLoading, setIrisPmtilesLoading] = useState(false);
  const [irisPmtilesMsg,     setIrisPmtilesMsg]     = useState<string | null>(null);

  // Suppression
  const [irisDeleteConfirm, setIrisDeleteConfirm] = useState(false);
  const [irisDeleteLoading, setIrisDeleteLoading] = useState(false);
  const [irisDeleteMsg,     setIrisDeleteMsg]     = useState<string | null>(null);

  // Rapport de synchronisation
  const [irisSyncReport,  setIrisSyncReport]  = useState<IrisSyncReport | null>(null);
  const [irisSyncLoading, setIrisSyncLoading] = useState(false);
  const [irisSyncError,   setIrisSyncError]   = useState<string | null>(null);

  const fetchIrisStats = useCallback(async () => {
    setIrisLoading(true);
    try {
      const [res, metaRes] = await Promise.all([
        adminFetch('/api/admin/iris/stats'),
        adminFetch('/api/admin/iris/metadata'),
      ]);
      const data = await res.json();
      const meta = await metaRes.json();
      if (meta.annee) setIrisAnnee(meta.annee);
      if (data.success) {
        setIrisStats(data.stats);
        setIrisDepts(data.top_depts || []);
        setIrisSource(data.source || null);
      } else console.error('[iris/stats]', data.error);
    } catch (e: unknown) { console.error('[iris/stats] fetch error:', e); }
    setIrisLoading(false);
  }, []);

  const runIrisSync = useCallback(async () => {
    setIrisSyncLoading(true);
    setIrisSyncError(null);
    try {
      const res = await adminFetch('/api/admin/sync-iris-system', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erreur');
      setIrisSyncReport(data as IrisSyncReport);
    } catch (e: unknown) {
      setIrisSyncError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setIrisSyncLoading(false);
    }
  }, []);

  const saveIrisAnnee = useCallback(async (annee: string) => {
    setIrisAnneeSaving(true);
    await adminFetch('/api/admin/iris/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annee }) });
    setIrisAnneeSaving(false);
    setIrisAnneeSaved(true);
    setTimeout(() => setIrisAnneeSaved(false), 2000);
  }, []);

  const triggerIrisPmtiles = useCallback(async () => {
    setIrisPmtilesLoading(true);
    setIrisPmtilesMsg(null);
    try {
      const res = await adminFetch('/api/admin/trigger-pmtiles', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setIrisPmtilesMsg(`✓ Workflow lancé — durée estimée 5-8 min. Suivi : ${data.workflow_url}`);
      } else {
        setIrisPmtilesMsg(`! Erreur : ${data.error}`);
      }
    } catch (e: unknown) {
      setIrisPmtilesMsg(`! Erreur réseau : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIrisPmtilesLoading(false);
    }
  }, []);

  const deleteAllIris = useCallback(async () => {
    setIrisDeleteLoading(true);
    setIrisDeleteMsg(null);
    try {
      const res = await adminFetch('/api/admin/iris/delete', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setIrisDeleteMsg(`✓ ${data.deleted ?? 0} IRIS supprimés`);
        setIrisStats(null);
      } else {
        setIrisDeleteMsg(`! Erreur: ${data.error}`);
      }
    } catch (e: unknown) {
      setIrisDeleteMsg(`! ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally {
      setIrisDeleteLoading(false);
      setIrisDeleteConfirm(false);
    }
  }, []);

  // Chargement paresseux : une seule fois, a l'ouverture de l'onglet.
  useEffect(() => {
    if (active && !irisStats && !irisLoading) fetchIrisStats();
  }, [active, irisStats, irisLoading, fetchIrisStats]);

  return {
    irisStats, irisDepts, irisSource, irisLoading,
    irisAnnee, setIrisAnnee, irisAnneeSaving, irisAnneeSaved, saveIrisAnnee,
    irisPmtilesLoading, irisPmtilesMsg, triggerIrisPmtiles,
    irisDeleteConfirm, setIrisDeleteConfirm, irisDeleteLoading, irisDeleteMsg, deleteAllIris,
    irisSyncReport, irisSyncLoading, irisSyncError, runIrisSync,
  };
}
