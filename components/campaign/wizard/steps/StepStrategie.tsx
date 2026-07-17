'use client';

/**
 * Étape 4/5 — Stratégie : le « comment ». Objectif d'optimisation (catalogue
 * bidding_objectives), KPI cible optionnel, capping fréquence optionnel
 * (imps + jours requis ensemble), rythme de dépense, et autonomie de l'agent
 * ML. Écrit `objective`, `kpiTarget`, `freqCapImps/Days`, `pacing`,
 * `execution_mode` dans le brouillon — persistés au Lancement.
 */
import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ExecutionMode, StepProps } from './types';
import { EXECUTION_MODE_META, PACING_META } from './types';
import { B, C, FieldBlock, Lead, NumberField, OptionRow, OptsList, Row2, StandardFooter, StepShell, fInter } from './ui';

const MODES: ExecutionMode[] = ['monitor_only', 'suggest', 'auto'];
const PACINGS = ['even', 'front_loaded', 'back_loaded'] as const;

interface Objective {
  code: string;
  display_name: string;
  display_name_fr: string | null;
  description: string | null;
  unit: string | null;
}

export function StepStrategie({ draft, setDraft, onPrev, onNext }: StepProps & { onPrev: () => void; onNext: () => void }) {
  const [objectives, setObjectives] = useState<Objective[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch('/api/bidding/objectives', { cache: 'no-store' });
        const d = res.ok ? await res.json() : null;
        if (!cancelled) setObjectives(d?.objectives ?? []);
      } catch { if (!cancelled) setObjectives([]); }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedObjective = objectives?.find((o) => o.code === draft.objective) ?? null;

  return (
    <StepShell
      title="Stratégie"
      stepNumber={4}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>La cible dit <B>où</B> viser ; la stratégie dit <B>quoi optimiser</B> et <B>de combien</B> pousser l&apos;enchère jour après jour.</>,
          <>En automatique, l&apos;agent redéploie les impressions vers les zones-cibles et rend compte de ses décisions.</>,
        ],
        tip: 'Tu peux démarrer en suggestion puis passer en auto quand tu as confiance.',
        mini: [4, 2, 4],
      }}
      footer={<StandardFooter onPrev={onPrev} nextLabel="Continuer →" onNext={onNext} />}
    >
      <Lead>
        Le <B>« comment »</B> : ce que l&apos;algorithme optimise et comment l&apos;enchère bouge chaque jour
        pour tenir la cible sans dépasser le budget.
      </Lead>

      <FieldBlock label="Objectif d'optimisation">
        {objectives === null && (
          <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Chargement…</div>
        )}
        {objectives !== null && (
          <OptsList>
            {objectives.map((o) => (
              <OptionRow
                key={o.code}
                selected={draft.objective === o.code}
                onClick={() => setDraft((prev) => ({ ...prev, objective: o.code }))}
                title={o.display_name_fr ?? o.display_name}
                sub={o.description ?? ''}
              />
            ))}
            {objectives.length === 0 && (
              <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>
                Catalogue d&apos;objectifs indisponible — l&apos;objectif par défaut sera utilisé.
              </div>
            )}
          </OptsList>
        )}
      </FieldBlock>

      <FieldBlock label="KPI cible (optionnel)">
        <NumberField
          label="Valeur cible dans l'unité de l'objectif"
          value={draft.kpiTarget}
          onChange={(v) => setDraft((prev) => ({ ...prev, kpiTarget: v }))}
          suffix={selectedObjective?.unit ?? undefined}
          placeholder="Aucune cible chiffrée"
          min={0}
        />
      </FieldBlock>

      <FieldBlock label="Capping fréquence (optionnel)">
        <Row2>
          <NumberField
            label="Impressions max par personne"
            value={draft.freqCapImps}
            onChange={(v) => setDraft((prev) => ({ ...prev, freqCapImps: v }))}
            placeholder="ex. 3"
            min={1}
          />
          <NumberField
            label="Par période (jours)"
            value={draft.freqCapDays}
            onChange={(v) => setDraft((prev) => ({ ...prev, freqCapDays: v }))}
            placeholder="ex. 7"
            min={1}
          />
        </Row2>
        {((draft.freqCapImps != null) !== (draft.freqCapDays != null)) && (
          <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginTop: 6 }}>
            Renseigne les deux champs pour activer le capping — sinon il est ignoré.
          </div>
        )}
      </FieldBlock>

      <FieldBlock label="Rythme de dépense">
        <OptsList>
          {PACINGS.map((p) => (
            <OptionRow
              key={p}
              selected={draft.pacing === p}
              onClick={() => setDraft((prev) => ({ ...prev, pacing: p }))}
              title={PACING_META[p].title}
              sub={PACING_META[p].sub}
            />
          ))}
        </OptsList>
      </FieldBlock>

      <FieldBlock label="Autonomie de l'agent">
        <OptsList>
          {MODES.map((m) => (
            <OptionRow
              key={m}
              selected={draft.executionMode === m}
              onClick={() => setDraft((prev) => ({ ...prev, executionMode: m }))}
              title={EXECUTION_MODE_META[m].title}
              sub={EXECUTION_MODE_META[m].sub}
            />
          ))}
        </OptsList>
      </FieldBlock>
    </StepShell>
  );
}
