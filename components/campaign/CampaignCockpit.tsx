'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import type { CampaignDetail } from '@/types/campaign';
import { FilAriane, type FilArianeStep } from '@/components/campaign/wizard/FilAriane';
import { StepCible } from '@/components/campaign/wizard/steps/StepCible';
import { StepCanaux } from '@/components/campaign/wizard/steps/StepCanaux';
import { StepBudget } from '@/components/campaign/wizard/steps/StepBudget';
import { StepStrategie } from '@/components/campaign/wizard/steps/StepStrategie';
import { StepLancement } from '@/components/campaign/wizard/steps/StepLancement';
import { DEFAULT_PROG_DRAFT, inferIntensity, type ProgDraft } from '@/components/campaign/wizard/steps/types';
import { CampaignOverview } from './CampaignOverview';
import { C, fInter } from './_shared';

// ── Fil d'Ariane cockpit — étapes "programmer" ───────────────────────────────────
const COCKPIT_STEPS: FilArianeStep[] = [
  { key: 'cible', label: 'Cible' },
  { key: 'canaux', label: 'Canaux' },
  { key: 'budget', label: 'Budget' },
  { key: 'strategie', label: 'Stratégie' },
  { key: 'lancement', label: 'Lancement' },
];
const COCKPIT_STEP_KEYS = new Set(COCKPIT_STEPS.map((s) => s.key));

type CockpitView = 'overview' | 'prog';
type ProgStepKey = 'cible' | 'canaux' | 'budget' | 'strategie' | 'lancement';
const PROG_STEP_ORDER: ProgStepKey[] = ['cible', 'canaux', 'budget', 'strategie', 'lancement'];

// ═══════════════════════════════════════════════════════════════════════════════
export function CampaignCockpit({
  campaignId, initialView, wizardOnly, onDeleted,
}: { campaignId: string; initialView?: CockpitView; wizardOnly?: boolean; onDeleted?: () => void }) {
  const id = campaignId;
  const searchParams = useSearchParams();

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [strategyLoaded, setStrategyLoaded] = useState(false);
  const [view, setView] = useState<CockpitView>(initialView ?? 'overview');

  // Brouillon Programmer (Cible/Budget/Stratégie/Lancement) — un seul
  // objet local, préservé tant que la page n'est pas rechargée.
  const [progStep, setProgStep] = useState<ProgStepKey>('cible');
  const [draft, setDraft] = useState<ProgDraft>(DEFAULT_PROG_DRAFT);

  // Stratégie de bidding rattachée à cette campagne (si elle existe).
  const fetchStrategy = useCallback(async () => {
    try {
      const r = await adminFetch('/api/bidding/strategies', { cache: 'no-store' });
      const d = r.ok ? await r.json() : { strategies: [] };
      const match = (d.strategies ?? []).find(
        (s: { campaign_id: string; status?: string }) => s.campaign_id === id,
      );
      setStrategyId(match?.id ?? null);
      setStrategyStatus(match?.status ?? null);
    } catch { /* ignore */ }
    setStrategyLoaded(true);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchStrategy();
  }, [id, fetchStrategy]);

  // Préremplit les dates du brouillon depuis la campagne (une fois, si non renseignées).
  useEffect(() => {
    const camp = detail?.campaign;
    if (!camp) return;
    setDraft((prev) => (prev.startDate || prev.endDate) ? prev : {
      ...prev,
      startDate: camp.date_start ? camp.date_start.slice(0, 10) : prev.startDate,
      endDate: camp.date_end ? camp.date_end.slice(0, 10) : prev.endDate,
    });
  }, [detail]);

  // Préremplissage best-effort depuis une stratégie déjà existante (édition/re-programmation).
  const strategyPrefillRef = useRef<string | null>(null);
  useEffect(() => {
    if (!strategyId || strategyPrefillRef.current === strategyId) return;
    strategyPrefillRef.current = strategyId;
    (async () => {
      try {
        const r = await adminFetch(`/api/bidding/strategies/${strategyId}`, { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        const s = d.strategy ?? {};
        setDraft((prev) => ({
          ...prev,
          intensity: inferIntensity(s.in_zone_weights) ?? prev.intensity,
          cibles: s.zone_id ? [{ id: s.zone_id, name: s.zone_name ?? 'Zone de la stratégie', sourceType: 'custom' }] : [],
          forecastCpm: s.forecast_cpm ?? prev.forecastCpm,
          startDate: s.start_date ? String(s.start_date).slice(0, 10) : prev.startDate,
          endDate: s.end_date ? String(s.end_date).slice(0, 10) : prev.endDate,
          executionMode: s.execution_mode ?? prev.executionMode,
        }));
      } catch { /* best-effort */ }
    })();
  }, [strategyId]);

  const currentStepIndex = strategyId ? 4 : 0;
  const filArianeActiveKey = view === 'prog' ? progStep : '';

  // Deep-link initial : ?view=prog (pilotage/bilan supprimés → repli silencieux
  // sur overview). Appliqué une seule fois, au montage.
  const viewParamAppliedRef = useRef(false);
  useEffect(() => {
    if (viewParamAppliedRef.current || !strategyLoaded) return;
    viewParamAppliedRef.current = true;
    if (searchParams.get('view') === 'prog') setView('prog');
  }, [strategyLoaded, searchParams]);

  const handleFilArianeSelect = useCallback((key: string) => {
    if (COCKPIT_STEP_KEYS.has(key)) { setProgStep(key as ProgStepKey); setView('prog'); }
  }, []);

  const progIndex = PROG_STEP_ORDER.indexOf(progStep);
  const goProgPrev = useCallback(() => setProgStep(PROG_STEP_ORDER[Math.max(0, progIndex - 1)]), [progIndex]);
  const goProgNext = useCallback(() => setProgStep(PROG_STEP_ORDER[Math.min(PROG_STEP_ORDER.length - 1, progIndex + 1)]), [progIndex]);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${id}?page=1`);
      if (res.ok) {
        const data: CampaignDetail = await res.json();
        setDetail(data);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  if (loading && !detail) {
    return (
      <div style={{ background: 'transparent', minHeight: 0, padding: 24 }}>
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim }}>Chargement…</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div style={{ background: 'transparent', minHeight: 0, padding: 24 }}>
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim, marginBottom: 12 }}>
          Impossible de charger la campagne. Vérifie que le serveur répond, puis réessaie.
        </div>
        <button
          onClick={() => fetchDetail()}
          style={{
            background: 'transparent', border: '0.5px solid var(--brand-teal)',
            color: 'var(--brand-teal)', borderRadius: 6, padding: '8px 16px',
            fontFamily: fInter, fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  const { campaign: camp } = detail;

  return (
    <div style={{ background: 'transparent', minHeight: 0, padding: 0 }}>
      {/* Fil d'Ariane cockpit — toujours visible */}
      <div style={{ marginBottom: 20 }}>
        {!wizardOnly && view !== 'overview' && (
          <button
            onClick={() => setView('overview')}
            style={{
              background: 'transparent', border: 'none', color: C.textDim,
              fontFamily: fInter, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            ← Aperçu <span style={{ color: C.textSec }}>{camp.name}</span>
          </button>
        )}
        <FilAriane
          steps={COCKPIT_STEPS}
          activeKey={filArianeActiveKey}
          currentStepIndex={currentStepIndex}
          onSelect={handleFilArianeSelect}
        />
      </div>

      {view === 'overview' && (
        <CampaignOverview campaignId={id} onDeleted={onDeleted} />
      )}

      {view === 'prog' && (
        <>
          {progStep === 'cible' && (
            <StepCible draft={draft} setDraft={setDraft} campaignId={id} onNext={goProgNext} />
          )}
          {progStep === 'canaux' && (
            <StepCanaux draft={draft} setDraft={setDraft} campaignId={id} onPrev={goProgPrev} onNext={goProgNext} />
          )}
          {progStep === 'budget' && (
            <StepBudget draft={draft} setDraft={setDraft} campaignId={id} onPrev={goProgPrev} onNext={goProgNext} />
          )}
          {progStep === 'strategie' && (
            <StepStrategie draft={draft} setDraft={setDraft} onPrev={goProgPrev} onNext={goProgNext} />
          )}
          {progStep === 'lancement' && (
            <StepLancement
              draft={draft}
              setDraft={setDraft}
              campaignId={id}
              campaignName={camp.name}
              existingStrategyId={strategyId}
              onPrev={goProgPrev}
              onCompleted={() => { fetchStrategy(); setView('overview'); }}
            />
          )}
        </>
      )}
    </div>
  );
}
