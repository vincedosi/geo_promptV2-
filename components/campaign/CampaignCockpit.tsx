'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import type { CampaignDetail } from '@/types/campaign';
import { FilAriane, type FilArianeStep } from '@/app/campaigns/[id]/_components/FilAriane';
import { StepCible } from '@/app/campaigns/[id]/_components/steps/StepCible';
import { StepBudget } from '@/app/campaigns/[id]/_components/steps/StepBudget';
import { StepStrategie } from '@/app/campaigns/[id]/_components/steps/StepStrategie';
import { StepLancement } from '@/app/campaigns/[id]/_components/steps/StepLancement';
import { DEFAULT_PROG_DRAFT, inferIntensity, type ProgDraft } from '@/app/campaigns/[id]/_components/steps/types';
import { CampaignOverview } from './CampaignOverview';
import { C, fInter } from './_shared';

// ── Fil d'Ariane cockpit — étapes "programmer" ───────────────────────────────────
const COCKPIT_STEPS: FilArianeStep[] = [
  { key: 'cible', label: 'Cible' },
  { key: 'budget', label: 'Budget' },
  { key: 'strategie', label: 'Stratégie' },
  { key: 'lancement', label: 'Lancement' },
];
const COCKPIT_STEP_KEYS = new Set(COCKPIT_STEPS.map((s) => s.key));

type CockpitView = 'overview' | 'prog';
type ProgStepKey = 'cible' | 'budget' | 'strategie' | 'lancement';
const PROG_STEP_ORDER: ProgStepKey[] = ['cible', 'budget', 'strategie', 'lancement'];

// ═══════════════════════════════════════════════════════════════════════════════
export function CampaignCockpit({
  campaignId, embedded, initialView, wizardOnly,
}: { campaignId: string; embedded?: boolean; initialView?: CockpitView; wizardOnly?: boolean }) {
  const id = campaignId;
  const router = useRouter();
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
          totalBudget: s.total_budget ?? prev.totalBudget,
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
      <div style={{ background: embedded ? 'transparent' : C.bg, minHeight: embedded ? 0 : '100vh', padding: 24 }}>
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim }}>Chargement…</div>
      </div>
    );
  }

  if (!detail) return null;

  const { campaign: camp } = detail;

  return (
    <div style={{ background: embedded ? 'transparent' : C.bg, minHeight: embedded ? 0 : '100vh', padding: embedded ? 0 : 24 }}>
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
        <CampaignOverview campaignId={id} embedded={embedded} onDeleted={() => router.push('/campaigns')} />
      )}

      {view === 'prog' && (
        <>
          {progStep === 'cible' && (
            <StepCible draft={draft} setDraft={setDraft} campaignId={id} onNext={goProgNext} />
          )}
          {progStep === 'budget' && (
            <StepBudget draft={draft} setDraft={setDraft} onPrev={goProgPrev} onNext={goProgNext} />
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
