'use client';
import { useEffect, useState } from 'react';
import { demoAuthHeader } from '../_lib/authHeader';
import type { CampaignReport } from '@/lib/report/types';
import { ConvergenceChart } from './ConvergenceChart';
import { ZoneBeforeAfterTable } from './ZoneBeforeAfterTable';
import { BudgetCard } from './BudgetCard';
import { KpiStrip } from './KpiStrip';

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--elevated)', borderTop: '1px solid var(--border-subtle)', padding: '10px 14px' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</span>
    </div>
  );
}

const info = (msg: string, color = 'var(--text-tertiary)') =>
  <div style={{ padding: 24, color, fontSize: 13 }}>{msg}</div>;

export function BilanPanel() {
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch('/api/demo/report', { headers: demoAuthHeader() });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'report_failed');
        if (alive) setReport(json.report ?? null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'report_failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return info('Chargement du bilan…');
  if (error) return info(`Erreur : ${error}`, 'var(--danger)');
  if (!report) return info('Lance d’abord le pilotage dans l’onglet Pilotage.');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
      <div style={{ padding: '16px 14px 0' }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)' }}>{report.header.campaign_name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {report.header.zone_name} · {report.header.dsp} · {report.header.period_start} → {report.header.period_end}
        </div>
      </div>
      <div style={{ padding: '0 14px' }}><KpiStrip kpis={report.kpis} /></div>
      <div>
        <SectionHeader title="Courbe de conformité" />
        <div style={{ padding: '12px 14px' }}><ConvergenceChart points={report.convergence} /></div>
      </div>
      <div>
        <SectionHeader title="Zone par zone — avant / après" />
        <div style={{ padding: '12px 14px' }}><ZoneBeforeAfterTable zones={report.zones} /></div>
      </div>
      <div>
        <SectionHeader title="Budget planifié vs dépensé" />
        <div style={{ padding: '12px 14px' }}><BudgetCard budget={report.budget} /></div>
      </div>
    </div>
  );
}
