'use client';

/**
 * Étape 3/5 — Budget : UNE ligne de budget par canal (DSP + réseaux sociaux
 * sélectionnés à l'étape Canaux), budget global = somme en lecture seule,
 * CPM cible et période. Écrit `channelBudgets`, `forecastCpm`, `startDate`,
 * `endDate` dans le brouillon. Labels des canaux : GET /channels (catalog),
 * qui pré-remplit aussi les lignes depuis geo_strategy.channels.budgets
 * (reprogrammation) quand le brouillon est vide.
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ChannelRow, StoredChannels } from '@/lib/campaigns/channels';
import type { StepProps } from './types';
import { draftTotalBudget, fmtEUR } from './types';
import { B, C, DateField, FieldBlock, Lead, NumberField, Row2, StandardFooter, StepShell, fInter, fMono } from './ui';

export function StepBudget({
  draft, setDraft, campaignId, onPrev, onNext,
}: StepProps & { campaignId: string; onPrev: () => void; onNext: () => void }) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const prefilledRef = useRef(false);

  // Labels du catalogue + pré-remplissage des lignes depuis le stockage (une fois).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch(`/api/campaigns/${campaignId}/channels`, { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const d = await r.json() as { catalog: ChannelRow[]; selected: StoredChannels };
        setLabels(Object.fromEntries((d.catalog ?? []).map((c) => [c.code, c.label])));
        if (!prefilledRef.current) {
          prefilledRef.current = true;
          const stored = d.selected?.budgets ?? {};
          setDraft((prev) => Object.keys(prev.channelBudgets).length > 0 ? prev
            : { ...prev, channelBudgets: stored });
        }
      } catch { /* best-effort : labels = codes */ }
    })();
    return () => { cancelled = true; };
  }, [campaignId, setDraft]);

  const lines = [...draft.channels.dsps, ...draft.channels.socials];
  const total = draftTotalBudget(draft);
  const nextDisabled = !total || !draft.startDate || !draft.endDate;

  return (
    <StepShell
      title="Budget"
      stepNumber={3}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>Le budget se fixe <B>par canal</B> : une ligne par DSP et par réseau. Le global n&apos;est que la somme.</>,
          <>Le pacing répartit la dépense de chaque canal sur la période pour éviter les à-coups.</>,
        ],
        tip: 'CPM cible = point de départ ; l’algo l’ajuste ensuite par zone.',
        mini: [3, 2, 4],
      }}
      footer={<StandardFooter onPrev={onPrev} nextLabel="Continuer →" onNext={onNext} nextDisabled={nextDisabled} />}
    >
      <Lead>
        Combien sur chaque canal, à quel prix, sur quelle période. MAGELIAN pace la dépense pour ne jamais dépasser.
      </Lead>

      <FieldBlock label="Budget par canal">
        {lines.length === 0 ? (
          <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>
            Sélectionne d&apos;abord tes canaux à l&apos;étape Canaux — chaque canal aura sa ligne de budget.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {lines.map((code) => (
              <NumberField
                key={code}
                label={labels[code] ?? code}
                value={draft.channelBudgets[code] ?? null}
                onChange={(v) => setDraft((prev) => {
                  const next = { ...prev.channelBudgets };
                  if (v == null) delete next[code]; else next[code] = v;
                  return { ...prev, channelBudgets: next };
                })}
                suffix="€"
                placeholder="ex. 30000"
                step={100}
                min={0}
              />
            ))}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderTop: `0.5px solid ${C.border}`, paddingTop: 10,
            }}>
              <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>Budget global (somme)</span>
              <span style={{ fontFamily: fMono, fontSize: 15, color: C.text }}>{fmtEUR(total)}</span>
            </div>
          </div>
        )}
      </FieldBlock>

      <FieldBlock label="Enveloppe">
        <Row2>
          <NumberField
            label="CPM cible"
            value={draft.forecastCpm}
            onChange={(v) => setDraft((prev) => ({ ...prev, forecastCpm: v }))}
            suffix="€"
            placeholder="ex. 6.20"
            step={0.1}
            min={0}
          />
          <div />
        </Row2>
      </FieldBlock>

      <FieldBlock label="Période">
        <Row2>
          <DateField label="Début" value={draft.startDate} onChange={(v) => setDraft((prev) => ({ ...prev, startDate: v }))} />
          <DateField label="Fin" value={draft.endDate} onChange={(v) => setDraft((prev) => ({ ...prev, endDate: v }))} />
        </Row2>
      </FieldBlock>
    </StepShell>
  );
}
