'use client';

import type { AudienceStats } from '@/types/custom-geo';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  stats: AudienceStats | Record<string, never>;
  computedAt: string | null;
}

function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('fr-FR');
}

function pct(part: number | undefined, total: number | undefined): string {
  if (!part || !total) return '—';
  return `${Math.round((part / total) * 100)}%`;
}

/**
 * Section "Audience capturée" du panel détail. Présente les agrégats
 * démographiques exploitables pour bidding DSP : volume, profil âge,
 * typologie ménages, logements, revenu médian.
 */
export function ZoneAudienceStats({ stats, computedAt }: Props) {
  // Zone sans stats calculées (ancienne capture, ou erreur)
  if (!('population' in stats) && !('skipped' in stats)) {
    return (
      <div style={{ padding: 12, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: fInter, textAlign: 'center', background: 'var(--bg-level-2)', borderRadius: 6 }}>
        Stats audience non calculées pour cette zone
      </div>
    );
  }

  // Zone trop large : skip cap I/O
  if ('skipped' in stats && stats.skipped) {
    return (
      <div style={{ padding: 12, fontSize: 11, color: 'var(--warning)', fontFamily: fInter, background: 'rgba(247,183,49,0.08)', border: '0.5px solid rgba(247,183,49,0.2)', borderRadius: 6 }}>
        Zone trop large ({stats.area_km2} km²) — calcul désactivé au-delà de 5000 km².
      </div>
    );
  }

  const pop = stats.population;
  const men = stats.menages;
  const log = stats.logements;
  const popTotal = pop?.total ?? 0;
  const menTotal = men?.total ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* KPIs principaux (3 chiffres bidding-ready) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <Kpi label="Population" value={fmt(popTotal)} accent />
        <Kpi label="Ménages" value={fmt(menTotal)} />
        <Kpi label="hab/km²" value={fmt(pop?.density_per_km2)} />
      </div>

      {/* Profil par âge (DSP audience targeting) */}
      {pop && (
        <Section title="Profil par âge">
          <Row label="0-17 ans"   value={fmt(pop.by_age['0_17'])}    sub={pct(pop.by_age['0_17'], popTotal)} />
          <Row label="18-24 ans"  value={fmt(pop.by_age['18_24'])}   sub={pct(pop.by_age['18_24'], popTotal)} />
          <Row label="25-39 ans"  value={fmt(pop.by_age['25_39'])}   sub={pct(pop.by_age['25_39'], popTotal)} />
          <Row label="40-54 ans"  value={fmt(pop.by_age['40_54'])}   sub={pct(pop.by_age['40_54'], popTotal)} />
          <Row label="55-64 ans"  value={fmt(pop.by_age['55_64'])}   sub={pct(pop.by_age['55_64'], popTotal)} />
          <Row label="65-79 ans"  value={fmt(pop.by_age['65_79'])}   sub={pct(pop.by_age['65_79'], popTotal)} />
          <Row label="80+ ans"    value={fmt(pop.by_age['80_plus'])} sub={pct(pop.by_age['80_plus'], popTotal)} />
        </Section>
      )}

      {/* Typologie ménages (CSP / cibles) */}
      {men && (
        <Section title="Typologie ménages">
          <Row label="Personne seule"   value={fmt(men['1_personne'])}     sub={pct(men['1_personne'], menTotal)} />
          <Row label="Familles 5+"      value={fmt(men['5_plus'])}         sub={pct(men['5_plus'], menTotal)} />
          <Row label="Propriétaires"    value={fmt(men.proprietaires)}     sub={pct(men.proprietaires, menTotal)} />
          <Row label="Monoparentales"   value={fmt(men.monoparentales)}    sub={pct(men.monoparentales, menTotal)} />
          <Row label="Sous seuil pauvreté" value={fmt(men.pauvres)}        sub={pct(men.pauvres, menTotal)} />
        </Section>
      )}

      {/* Logements (typologie habitat) */}
      {log && (
        <Section title="Logements">
          <Row label="Maisons individuelles" value={fmt(log.maisons)}    sub={pct(log.maisons, menTotal)} />
          <Row label="Collectifs"            value={fmt(log.collectifs)} sub={pct(log.collectifs, menTotal)} />
          <Row label="Logements sociaux"     value={fmt(log.sociaux)}    sub={pct(log.sociaux, menTotal)} />
          <Row label="Surface moyenne"       value={`${fmt(log.surface_moyenne_m2)} m²`} />
        </Section>
      )}

      {/* Revenu */}
      {stats.revenu_median_par_uc !== undefined && stats.revenu_median_par_uc > 0 && (
        <Section title="Revenu">
          <Row label="Médian par UC" value={`${fmt(stats.revenu_median_par_uc)} €`} accent />
        </Section>
      )}

      {/* Footer : freshness */}
      {computedAt && (
        <div style={{ fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)', textAlign: 'right' }}>
          Calculé le {new Date(computedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ padding: 10, background: 'var(--bg-level-2)', borderRadius: 6, border: accent ? '0.5px solid var(--brand-teal-30, rgba(78,205,196,0.3))' : '0.5px solid var(--border-subtle)' }}>
      <div style={{ fontFamily: fInter, fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: fMono, fontSize: 14, fontWeight: 500, color: accent ? 'var(--brand-teal)' : 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <tr>
      <td style={{ padding: '4px 0', color: 'var(--text-tertiary)', fontFamily: fInter }}>{label}</td>
      <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: fMono, color: accent ? 'var(--brand-teal)' : 'var(--text-primary)' }}>
        {value}
        {sub && <span style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontSize: 10 }}>({sub})</span>}
      </td>
    </tr>
  );
}
