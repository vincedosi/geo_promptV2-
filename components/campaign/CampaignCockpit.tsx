'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import type { CampaignDetail } from '@/types/campaign';
import { FilAriane, type FilArianeStep } from '@/components/campaign/wizard/FilAriane';
import { StepCible } from '@/components/campaign/wizard/steps/StepCible';
import { StepCanaux } from '@/components/campaign/wizard/steps/StepCanaux';
import { StepPression } from '@/components/campaign/wizard/steps/StepPression';
import { StepStrategie } from '@/components/campaign/wizard/steps/StepStrategie';
import { StepLancement } from '@/components/campaign/wizard/steps/StepLancement';
import { DEFAULT_PROG_DRAFT, pressureFromCurve, type ProgDraft } from '@/components/campaign/wizard/steps/types';
import { useDraftAutosave } from '@/components/campaign/wizard/useDraftAutosave';
import { CampaignOverview } from './CampaignOverview';
import { C, fInter } from './_shared';

// ── Fil d'Ariane cockpit — étapes "programmer" ───────────────────────────────────
const COCKPIT_STEPS: FilArianeStep[] = [
  { key: 'cible', label: 'Cible' },
  { key: 'canaux', label: 'Canaux' },
  { key: 'pression', label: 'Pression' },
  { key: 'strategie', label: 'Stratégie' },
  { key: 'lancement', label: 'Lancement' },
];
const COCKPIT_STEP_KEYS = new Set(COCKPIT_STEPS.map((s) => s.key));

type CockpitView = 'overview' | 'prog';
type ProgStepKey = 'cible' | 'canaux' | 'pression' | 'strategie' | 'lancement';
const PROG_STEP_ORDER: ProgStepKey[] = ['cible', 'canaux', 'pression', 'strategie', 'lancement'];

// ═══════════════════════════════════════════════════════════════════════════════
export function CampaignCockpit({
  campaignId, initialView, wizardOnly, onDeleted, onRenamed,
}: { campaignId: string; initialView?: CockpitView; wizardOnly?: boolean; onDeleted?: () => void; onRenamed?: (name: string) => void }) {
  const id = campaignId;
  const searchParams = useSearchParams();

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [strategyLoaded, setStrategyLoaded] = useState(false);
  const [view, setView] = useState<CockpitView>(initialView ?? 'overview');

  // Brouillon Programmer (Cible/Budget/Stratégie/Lancement) — un seul
  // objet local, autosauvé côté serveur (bidding_strategy_drafts) et
  // restauré au retour sur le wizard.
  const [progStep, setProgStep] = useState<ProgStepKey>('cible');
  const [draft, setDraft] = useState<ProgDraft>(DEFAULT_PROG_DRAFT);
  const [draftBanner, setDraftBanner] = useState<{ savedAt: string } | null>(null);
  // true dès qu'un brouillon serveur a été appliqué — le préremplissage depuis
  // une stratégie existante ne doit alors plus écraser les champs restaurés.
  const restoredAppliedRef = useRef(false);
  const { restored, discard } = useDraftAutosave(
    id, draft, PROG_STEP_ORDER.indexOf(progStep) + 1, view === 'prog',
  );

  useEffect(() => { restoredAppliedRef.current = false; setDraftBanner(null); }, [id]);
  useEffect(() => {
    if (!restored || restoredAppliedRef.current) return;
    restoredAppliedRef.current = true;
    setDraft(restored.draft);
    const stepKey = PROG_STEP_ORDER[Math.min(PROG_STEP_ORDER.length, Math.max(1, restored.step)) - 1];
    setProgStep(stepKey);
    setDraftBanner({ savedAt: restored.savedAt });
  }, [restored]);

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

  // Préremplit nom + annonceur/produit + dates du brouillon depuis la campagne (si non renseignés).
  useEffect(() => {
    const camp = detail?.campaign;
    if (!camp) return;
    setDraft((prev) => ({
      ...prev,
      name: prev.name || camp.name || '',
      advertiser: prev.advertiser || camp.advertiser || '',
      product: prev.product || camp.product || '',
      startDate: prev.startDate || (camp.date_start ? camp.date_start.slice(0, 10) : ''),
      endDate: prev.endDate || (camp.date_end ? camp.date_end.slice(0, 10) : ''),
    }));
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
        // Un brouillon restauré (plus récent que la stratégie) a priorité.
        if (restoredAppliedRef.current) return;
        setDraft((prev) => ({
          ...prev,
          pressure: pressureFromCurve(s.in_zone_weights) ?? prev.pressure,
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

  // « Repartir de zéro » : jette le brouillon serveur et repart du défaut
  // pré-rempli depuis la campagne (nom/annonceur/produit/dates).
  const handleDiscardDraft = useCallback(async () => {
    await discard();
    setDraftBanner(null);
    const camp = detail?.campaign;
    setDraft({
      ...DEFAULT_PROG_DRAFT,
      name: camp?.name ?? '',
      advertiser: camp?.advertiser ?? '',
      product: camp?.product ?? '',
      startDate: camp?.date_start ? camp.date_start.slice(0, 10) : '',
      endDate: camp?.date_end ? camp.date_end.slice(0, 10) : '',
    });
    setProgStep('cible');
  }, [discard, detail]);

  // Lancement réussi → le brouillon n'a plus lieu d'être.
  const handleLaunched = useCallback(() => {
    setDraftBanner(null);
    void discard();
  }, [discard]);

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
          {draftBanner && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', border: '0.5px solid var(--border-subtle)', borderRadius: 6, margin: '0 0 10px', fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>
              Brouillon restauré ({new Date(draftBanner.savedAt).toLocaleString('fr-FR')})
              <button type="button" onClick={() => { void handleDiscardDraft(); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--brand-teal)', fontFamily: fInter, fontSize: 12, cursor: 'pointer', padding: 0 }}>
                Repartir de zéro
              </button>
            </div>
          )}
          {progStep === 'cible' && (
            <StepCible draft={draft} setDraft={setDraft} campaignId={id} onNext={goProgNext} />
          )}
          {progStep === 'canaux' && (
            <StepCanaux draft={draft} setDraft={setDraft} campaignId={id} onPrev={goProgPrev} onNext={goProgNext} />
          )}
          {progStep === 'pression' && (
            <StepPression draft={draft} setDraft={setDraft} onPrev={goProgPrev} onNext={goProgNext} />
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
              campaignAdvertiser={camp.advertiser ?? ''}
              campaignProduct={camp.product ?? ''}
              existingStrategyId={strategyId}
              existingStrategyActive={strategyStatus === 'active'}
              onPrev={goProgPrev}
              onRenamed={onRenamed}
              onLaunched={handleLaunched}
              onCompleted={() => { fetchDetail(); fetchStrategy(); setView('overview'); }}
            />
          )}
        </>
      )}
    </div>
  );
}
