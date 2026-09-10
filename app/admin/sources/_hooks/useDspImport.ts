'use client';

/**
 * MAGELIAN — etat et actions de l'onglet DSP du back-office Data Sources.
 *
 * Liste des campagnes, import SSE streaming (evenements + rapport final) et
 * suppression. Extrait de app/admin/sources/page.tsx (refactor du
 * 31/08/2026), ou ces 11 etats et 4 actions vivaient en vrac.
 *
 * ⚠️ Contrairement a useIrisAdmin, la liste est RECHARGEE a chaque visite de
 * l'onglet — pas de garde de cache. C'est le comportement d'origine, conserve
 * a l'identique : une campagne peut etre creee ou importee entre deux
 * visites, un cache afficherait une liste perimee. Le cout reste une seule
 * requete sur une table de campagnes, sans rapport avec les volumes IRIS.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import type { CampaignListItem, CampaignImportEvent, CampaignImportReport } from '@/types/campaign';

export interface DspImport {
  dspCampaigns: CampaignListItem[];
  dspLoading: boolean;

  dspImportOpen: boolean;
  setDspImportOpen: React.Dispatch<React.SetStateAction<boolean>>;
  dspImporting: boolean;
  dspFile: File | null;
  setDspFile: React.Dispatch<React.SetStateAction<File | null>>;
  dspSource: string;
  setDspSource: React.Dispatch<React.SetStateAction<string>>;
  dspCampaignName: string;
  setDspCampaignName: React.Dispatch<React.SetStateAction<string>>;
  dspFileRef: React.RefObject<HTMLInputElement | null>;
  dspEvents: CampaignImportEvent[];
  dspReport: CampaignImportReport | null;
  handleDspImport: () => Promise<void>;
  resetDspModal: () => void;

  dspDeleteConfirm: string | null;
  setDspDeleteConfirm: React.Dispatch<React.SetStateAction<string | null>>;
  dspDeleting: boolean;
  handleDspDelete: (id: string) => Promise<void>;
}

/** @param active `true` quand l'onglet DSP est affiche. */
export function useDspImport(active: boolean): DspImport {
  const { toast: toastApi } = useToast();

  const [dspCampaigns, setDspCampaigns] = useState<CampaignListItem[]>([]);
  const [dspLoading, setDspLoading] = useState(false);
  const [dspImportOpen, setDspImportOpen] = useState(false);
  const [dspImporting, setDspImporting] = useState(false);
  const [dspFile, setDspFile] = useState<File | null>(null);
  const [dspSource, setDspSource] = useState('adform');
  const [dspCampaignName, setDspCampaignName] = useState('');
  const [dspEvents, setDspEvents] = useState<CampaignImportEvent[]>([]);
  const [dspReport, setDspReport] = useState<CampaignImportReport | null>(null);
  const [dspDeleteConfirm, setDspDeleteConfirm] = useState<string | null>(null);
  const [dspDeleting, setDspDeleting] = useState(false);
  const dspFileRef = useRef<HTMLInputElement>(null);

  const fetchDspCampaigns = useCallback(async () => {
    setDspLoading(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setDspCampaigns(Array.isArray(data) ? data : []);
      } else {
        console.error('[fetchDspCampaigns] HTTP', res.status);
      }
    } catch (err: unknown) {
      console.error('[fetchDspCampaigns] error:', err);
    }
    setDspLoading(false);
  }, []);

  const handleDspImport = useCallback(async () => {
    if (!dspFile) return;
    setDspImporting(true);
    setDspEvents([]);
    setDspReport(null);
    const form = new FormData();
    form.append('file', dspFile);
    form.append('dsp_source', dspSource);
    if (dspCampaignName.trim()) form.append('campaign_name', dspCampaignName.trim());
    try {
      const res = await adminFetch('/api/admin/campaigns/import', { method: 'POST', body: form });
      if (!res.ok || !res.body) { toastApi.error('Import échoué', `HTTP ${res.status}`); setDspImporting(false); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const evt: CampaignImportEvent = JSON.parse(trimmed.slice(6));
            setDspEvents((prev) => [...prev, evt]);
            if (evt.type === 'complete') { setDspReport(evt.report); toastApi.success('Import terminé', `${evt.report.total_rows} lignes`); fetchDspCampaigns(); }
            if (evt.type === 'error') toastApi.error('Erreur', evt.message);
          } catch { /* skip */ }
        }
      }
    } catch (err: unknown) { toastApi.error('Erreur réseau', String(err)); }
    setDspImporting(false);
  }, [dspFile, dspSource, dspCampaignName, toastApi, fetchDspCampaigns]);

  const handleDspDelete = useCallback(async (id: string) => {
    setDspDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toastApi.success('Campagne supprimée');
        // Force state update then re-fetch
        setDspCampaigns(prev => prev.filter(c => c.id !== id));
        fetchDspCampaigns();
      } else {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toastApi.error('Erreur', body.error || 'Suppression échouée');
      }
    } catch (err: unknown) {
      console.error('[dsp-delete] error:', err);
      toastApi.error('Erreur réseau', String(err));
    }
    setDspDeleting(false);
    setDspDeleteConfirm(null);
  }, [toastApi, fetchDspCampaigns]);

  const resetDspModal = useCallback(() => {
    setDspFile(null); setDspCampaignName(''); setDspSource('adform');
    setDspEvents([]); setDspReport(null); setDspImporting(false);
  }, []);

  useEffect(() => {
    if (active) fetchDspCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return {
    dspCampaigns, dspLoading,
    dspImportOpen, setDspImportOpen, dspImporting,
    dspFile, setDspFile, dspSource, setDspSource,
    dspCampaignName, setDspCampaignName, dspFileRef,
    dspEvents, dspReport, handleDspImport, resetDspModal,
    dspDeleteConfirm, setDspDeleteConfirm, dspDeleting, handleDspDelete,
  };
}
