'use client';

/**
 * Forecast en direct (étapes Canaux + Lancement) : impressions estimées
 * (budget ÷ CPM × 1000), audience de la cible (populations capturées à la
 * matérialisation des zones), % France (total national — RPC cachée 24h côté
 * serveur, 1 fetch par montage gardé par ref).
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ProgDraft } from './types';
import { draftTotalBudget } from './types';
import { C, fInter, fMono } from './ui';

export function computeForecast(
  budget: number | null,
  cpm: number | null,
  ciblePops: number[],
): { impressions: number | null; audience: number | null; costPerThousandPeople: number | null } {
  const impressions = budget && cpm && cpm > 0 ? Math.round((budget / cpm) * 1000) : null;
  const audience = ciblePops.length > 0 ? ciblePops.reduce((s, v) => s + v, 0) : null;
  const costPerThousandPeople = budget && audience ? Math.round((budget / audience) * 1000 * 100) / 100 : null;
  return { impressions, audience, costPerThousandPeople };
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textDim }}>{label}</div>
      <div style={{ fontFamily: fMono, fontSize: 14, color: C.text }}>{value}</div>
    </div>
  );
}

export function ForecastStrip({ draft }: { draft: ProgDraft }) {
  const [nationalPop, setNationalPop] = useState<number | null>(null);
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const res = await adminFetch('/api/custom-geo/national-totals', { cache: 'no-store' });
        const d = res.ok ? await res.json() : null;
        const total = Number(d?.totals?.total ?? NaN);
        if (Number.isFinite(total) && total > 0) setNationalPop(total);
      } catch { /* % France omis */ }
    })();
  }, []);

  const pops = draft.cibles.map((c) => c.population).filter((p): p is number => typeof p === 'number' && p > 0);
  const audienceIsPartial = draft.cibles.length > 0 && pops.length < draft.cibles.length;
  const { impressions, costPerThousandPeople: costTargeted, audience } = computeForecast(
    draftTotalBudget(draft), draft.forecastCpm, pops,
  );
  // Panier vide = diffusion nationale : l'audience est la France entière.
  const effAudience = draft.cibles.length === 0 ? nationalPop : audience;
  const budget = draftTotalBudget(draft);
  const costPerThousandPeople = draft.cibles.length === 0
    ? (budget && effAudience ? Math.round((budget / effAudience) * 1000 * 100) / 100 : null)
    : costTargeted;
  const pctFrance = effAudience && nationalPop ? Math.min(100, Math.round((effAudience / nationalPop) * 1000) / 10) : null;

  if (impressions == null && effAudience == null) return null;
  const fmtInt = (n: number) => n.toLocaleString('fr-FR');
  return (
    <div style={{ display: 'flex', gap: 14, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', margin: '0 0 18px' }}>
      <Cell label="Impressions estimées" value={impressions != null ? fmtInt(impressions) : '—'} />
      <Cell label={`Audience cible${audienceIsPartial ? ' (partielle)' : ''}`} value={effAudience != null ? `${fmtInt(effAudience)} hab.` : '—'} />
      <Cell label="% France" value={pctFrance != null ? `${pctFrance.toLocaleString('fr-FR')} %` : '—'} />
      <Cell label="€ / 1000 hab." value={costPerThousandPeople != null ? costPerThousandPeople.toLocaleString('fr-FR') : '—'} />
    </div>
  );
}
