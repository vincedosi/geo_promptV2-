/**
 * MAGELIAN — panneau « Carreaux » du back-office Data Sources.
 *
 * Fiche descriptive de la table carreaux_filosofi (INSEE Filosofi 200m) et
 * son volume. Purement presentationnel : aucun fetch, aucun etat propre.
 *
 * Extrait de app/admin/sources/page.tsx (refactor du 31/08/2026).
 */
import type { SourcesStats } from '../_lib/types';
import { C, fontMono, fontInter } from '../_lib/theme';
import { Spinner } from './ui';

interface CarreauxPanelProps {
  /** Stats consolidees ; `null` tant que le chargement n'a pas abouti. */
  stats: SourcesStats | null;
  loading: boolean;
}

export function CarreauxPanel({ stats, loading }: CarreauxPanelProps) {
  if (!stats) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
      {loading ? <><Spinner size={18} /> Chargement...</> : 'Aucune donnée.'}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>
      <div style={{ background: C.greenDim, border: `0.5px solid ${C.green}44`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: C.green, letterSpacing: 1, marginBottom: 6 }}>Carreaux INSEE Filosofi 200m</div>
          <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
            <span style={{ color: C.textSec }}>Source: </span>INSEE Filosofi<br />
            <span style={{ color: C.textSec }}>Résolution: </span>200m × 200m<br />
            <span style={{ color: C.textSec }}>Couverture: </span>France métropolitaine<br />
            <span style={{ color: C.textSec }}>Données: </span>population, revenus, âge, densité<br />
            <span style={{ color: C.textSec }}>Table: </span><span style={{ color: C.accent }}>carreaux_filosofi</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: C.green, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
            {(stats.carreaux.total / 1_000_000).toFixed(2)}M
          </div>
          <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>carreaux</div>
        </div>
      </div>
      <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px', fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 1.8 }}>
        <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textSec, display: 'block', marginBottom: 6 }}>// utilisation</span>
        Jointure spatiale avec <span style={{ color: C.green }}>public.iris</span> via <span style={{ color: '#06b6d4' }}>ST_Intersects(iris.geom, carreaux.geom)</span>.<br />
        Agrégation démographique par isochrone ou zone de chalandise.
      </div>
    </div>
  );
}
