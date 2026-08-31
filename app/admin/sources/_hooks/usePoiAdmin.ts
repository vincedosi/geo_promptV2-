'use client';

/**
 * MAGELIAN — etat et actions de l'administration POI.
 *
 * Regroupe les 10 etats et 6 actions qui pilotaient l'onglet POI depuis
 * app/admin/sources/page.tsx (refactor du 31/08/2026) : selection de
 * categorie, echantillons pagines, modale creation/edition, suppressions
 * unitaire et en masse.
 *
 * ⛔ A appeler depuis le composant PARENT de l'onglet, jamais depuis le
 * panneau : celui-ci est demonte a chaque changement d'onglet, et l'etat
 * (notamment les echantillons deja pagines) serait perdu puis refetche.
 * Meme raison que useIrisAdmin — contraintes Supabase Nano.
 */
import { useState, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { PoiRow } from '../_lib/types';

/** Formulaire vierge de la modale POI. */
export const emptyPoiForm = {
  nom: '', categorie: '', sous_categorie: '', lat: '', lng: '',
  adresse: '', ville: '', departement: '', code_postal: '', source: '',
};

export type PoiForm = typeof emptyPoiForm;

export interface PoiModalState {
  open: boolean;
  mode: 'create' | 'edit';
  data: PoiForm & { id?: string };
}

export interface PoiAdmin {
  selectedPoiCat: string | null;
  setSelectedPoiCat: React.Dispatch<React.SetStateAction<string | null>>;

  poiSamples: PoiRow[];
  setPoiSamples: React.Dispatch<React.SetStateAction<PoiRow[]>>;
  poiSamplesTotal: number;
  poiSamplesOffset: number;
  setPoiSamplesOffset: React.Dispatch<React.SetStateAction<number>>;
  poiSamplesLoading: boolean;
  fetchPoiSamples: (cat: string, offset?: number) => Promise<void>;

  poiModal: PoiModalState;
  setPoiModal: React.Dispatch<React.SetStateAction<PoiModalState>>;
  poiModalSaving: boolean;
  poiModalError: string;
  emptyForm: PoiForm;
  openCreatePoi: (cat: string) => void;
  openEditPoi: (row: PoiRow) => void;
  savePoi: () => Promise<void>;

  confirmDeleteCat: string | null;
  setConfirmDeleteCat: React.Dispatch<React.SetStateAction<string | null>>;
  bulkDeleting: boolean;
  deletePoi: (id: string) => Promise<void>;
  deletePoisBulk: (cat: string) => Promise<void>;
}

/**
 * @param refreshStats Rafraichissement SILENCIEUX des stats consolidees du
 *   parent, appele apres chaque mutation. Silencieux au sens : il ne doit pas
 *   remettre l'ecran en etat de chargement, sinon le tableau des echantillons
 *   clignoterait a chaque suppression.
 */
export function usePoiAdmin(refreshStats: () => void | Promise<void>): PoiAdmin {
  const [selectedPoiCat, setSelectedPoiCat] = useState<string | null>(null);
  const [poiSamples, setPoiSamples] = useState<PoiRow[]>([]);
  const [poiSamplesTotal, setPoiSamplesTotal] = useState(0);
  const [poiSamplesOffset, setPoiSamplesOffset] = useState(0);
  const [poiSamplesLoading, setPoiSamplesLoading] = useState(false);

  const [poiModal, setPoiModal] = useState<PoiModalState>({ open: false, mode: 'create', data: emptyPoiForm });
  const [poiModalSaving, setPoiModalSaving] = useState(false);
  const [poiModalError, setPoiModalError] = useState('');

  const [confirmDeleteCat, setConfirmDeleteCat] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchPoiSamples = useCallback(async (cat: string, offset = 0) => {
    setPoiSamplesLoading(true);
    try {
      const res = await adminFetch(`/api/admin/poi-samples?cat=${cat}&limit=50&offset=${offset}`);
      const data = await res.json();
      if (data.success) {
        setPoiSamples(offset === 0 ? (data.samples ?? []) : (prev) => [...prev, ...(data.samples ?? [])]);
        setPoiSamplesTotal(data.total ?? 0);
        setPoiSamplesOffset(offset + (data.samples?.length ?? 0));
      }
    } catch { /* ignore */ }
    setPoiSamplesLoading(false);
  }, []);

  const openCreatePoi = useCallback((cat: string) => {
    setPoiModal({ open: true, mode: 'create', data: { ...emptyPoiForm, categorie: cat === 'lycee' ? 'lycee' : cat === 'cirfa' ? 'cirfa' : '' } });
    setPoiModalError('');
  }, []);

  const openEditPoi = useCallback((row: PoiRow) => {
    setPoiModal({ open: true, mode: 'edit', data: { id: row.id, nom: row.nom ?? '', categorie: row.categorie, sous_categorie: row.sous_categorie ?? '', lat: String(row.lat), lng: String(row.lng), adresse: row.adresse ?? '', ville: row.ville ?? '', departement: row.departement ?? '', code_postal: row.code_postal ?? '', source: row.source ?? '' } });
    setPoiModalError('');
  }, []);

  const savePoi = useCallback(async () => {
    setPoiModalSaving(true);
    setPoiModalError('');
    try {
      const isEdit = poiModal.mode === 'edit';
      const res = await adminFetch('/api/admin/poi-manage', { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(poiModal.data) });
      const data = await res.json();
      if (!data.success) { setPoiModalError(data.error ?? 'Erreur'); setPoiModalSaving(false); return; }
      setPoiModal({ open: false, mode: 'create', data: emptyPoiForm });
      if (selectedPoiCat) { fetchPoiSamples(selectedPoiCat, 0); }
      refreshStats();
    } catch (e: unknown) { setPoiModalError(String(e)); }
    setPoiModalSaving(false);
  }, [poiModal, selectedPoiCat, fetchPoiSamples, refreshStats]);

  const deletePoi = useCallback(async (id: string) => {
    try {
      await adminFetch(`/api/admin/poi-manage?id=${id}`, { method: 'DELETE' });
      setPoiSamples((prev) => prev.filter((p) => p.id !== id));
      setPoiSamplesTotal((t) => t - 1);
      refreshStats();
    } catch { /* ignore */ }
  }, [refreshStats]);

  const deletePoisBulk = useCallback(async (cat: string) => {
    setBulkDeleting(true);
    try {
      await adminFetch(`/api/admin/poi-manage?cat=${cat}`, { method: 'DELETE' });
      setConfirmDeleteCat(null);
      if (selectedPoiCat === cat) { setPoiSamples([]); setPoiSamplesTotal(0); setSelectedPoiCat(null); }
      refreshStats();
    } catch { /* ignore */ }
    setBulkDeleting(false);
  }, [selectedPoiCat, refreshStats]);

  return {
    selectedPoiCat, setSelectedPoiCat,
    poiSamples, setPoiSamples, poiSamplesTotal, poiSamplesOffset, setPoiSamplesOffset,
    poiSamplesLoading, fetchPoiSamples,
    poiModal, setPoiModal, poiModalSaving, poiModalError, emptyForm: emptyPoiForm,
    openCreatePoi, openEditPoi, savePoi,
    confirmDeleteCat, setConfirmDeleteCat, bulkDeleting, deletePoi, deletePoisBulk,
  };
}
