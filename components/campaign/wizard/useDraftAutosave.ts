'use client';

/**
 * Autosave du brouillon Programmer vers bidding_strategy_drafts (routes du
 * chantier A4.7, jamais câblées jusqu'ici) : debounce 1 s, clé (user, campagne),
 * restauration au montage, discard explicite. Purgé au Lancement réussi.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { DEFAULT_PROG_DRAFT, type ProgDraft } from './steps/types';

export function serializeDraft(d: ProgDraft): Record<string, unknown> {
  return { v: 1, draft: d };
}

export function deserializeDraft(raw: unknown): ProgDraft | null {
  const data = raw as { v?: number; draft?: Record<string, unknown> } | null;
  if (!data || data.v !== 1 || !data.draft || typeof data.draft !== 'object') return null;
  // Merge sur le défaut : les champs ajoutés depuis la sauvegarde gardent leur défaut.
  return { ...DEFAULT_PROG_DRAFT, ...(data.draft as Partial<ProgDraft>) };
}

export function useDraftAutosave(
  campaignId: string,
  draft: ProgDraft,
  step: number,
  enabled: boolean,
) {
  const [restored, setRestored] = useState<{ draft: ProgDraft; step: number; savedAt: string } | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(true); // ne pas re-sauver l'état qu'on vient de restaurer

  // Restauration (une fois par campagne)
  useEffect(() => {
    loadedRef.current = false;
    skipNextSaveRef.current = true;
    setRestored(null);
    setDraftId(null);
  }, [campaignId]);
  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const res = await adminFetch(`/api/bidding/strategies/drafts?campaign_id=${campaignId}`, { cache: 'no-store' });
        const d = res.ok ? await res.json() : null;
        const row = d?.drafts?.[0];
        if (!row) return;
        const parsed = deserializeDraft(row.draft_data);
        if (parsed) {
          setDraftId(row.id);
          setRestored({ draft: parsed, step: row.current_step ?? 1, savedAt: row.last_saved_at });
        }
      } catch { /* pas de restauration */ }
    })();
  }, [campaignId, enabled]);

  // Autosave debounce 1 s
  useEffect(() => {
    if (!enabled) return;
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await adminFetch('/api/bidding/strategies/drafts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaign_id: campaignId, current_step: step, draft_data: serializeDraft(draft) }),
        });
        const d = res.ok ? await res.json() : null;
        if (d?.draft?.id) setDraftId(d.draft.id);
      } catch { /* best-effort */ }
    }, 1000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [campaignId, draft, step, enabled]);

  const discard = useCallback(async () => {
    setRestored(null);
    // La remise à zéro du brouillon qui suit ne doit pas se re-sauver aussitôt.
    skipNextSaveRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!draftId) return;
    try { await adminFetch(`/api/bidding/strategies/drafts/${draftId}`, { method: 'DELETE' }); } catch { /* best-effort */ }
    setDraftId(null);
  }, [draftId]);

  return { restored, draftId, discard };
}
