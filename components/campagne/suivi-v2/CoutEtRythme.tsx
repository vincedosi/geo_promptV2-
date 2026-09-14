/**
 * « Coût et rythme » — les trois chiffres que suit l'acheteur média : CPM
 * moyen (réel vs prévu), impressions livrées (réalisé vs cible TOTALE de
 * campagne) et coût du déséquilibre (le `sur_pression_eur` du score
 * d'alignement, déjà calculé par `calculer_alignement_geo` — pas recalculé
 * ici, seulement rapporté au budget total pour le sous-texte).
 *
 * `pourcentageVolumeLivre`/`volumeCibleTotal` viennent de `lib/campagne/
 * avancement.ts`, partagés avec `BandeauAvancement` : c'est la MÊME
 * métrique (« 40,1 % du plan »), affichée sous deux formes — une seule
 * formule, pas deux qui pourraient diverger.
 */
import { formaterNombre, formaterNombreAbrege } from '@/lib/format/nombre'
import {
  volumeCibleTotal,
  pourcentageVolumeLivre,
  type ObjectifCampagne,
} from '@/lib/campagne/avancement'
import { SEUIL_CPM_CHER } from '@/lib/campagne/constats'

export interface DonneesCoutEtRythme {
  pacing: { total_budget: number | null; time_pct: number | null }
  cpm: { real: number | null; forecast: number | null; delta_pct: number | null }
  objective: ObjectifCampagne
  /** `sur_pression_eur` du payload `/api/campaigns/[campaignId]/alignement`. */
  sur_pression_eur: number
}

/** Part d'un montant dans le budget total. `null` sans budget renseigné — jamais une division par zéro muette. */
export function pourcentageDuBudget(montant: number, totalBudget: number | null): number | null {
  if (totalBudget == null || totalBudget <= 0) return null
  return Math.round((montant / totalBudget) * 1000) / 10
}

/**
 * Le CPM réel est-il notablement au-dessus du prévu ? Même seuil que le
 * canal le plus cher (`SEUIL_CPM_CHER`, `lib/campagne/constats.ts`) — la
 * question posée est la même (« ce prix est-il sorti de l'ordinaire ? »),
 * juste sur une autre paire de nombres.
 */
export function cpmHorsPrevu(real: number | null, forecast: number | null): boolean {
  if (real == null || forecast == null || forecast <= 0) return false
  return real > forecast * SEUIL_CPM_CHER
}

function Figure({ titre, valeur, tag, tagCouleur, tagFond, note, bordure }: {
  titre: string
  valeur: string
  tag: string | null
  tagCouleur: string
  tagFond: string
  note: string
  bordure: boolean
}) {
  return (
    <div style={{ padding: '0 26px', borderLeft: bordure ? '0.5px solid var(--border-subtle)' : 'none' }}>
      <h3 style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-secondary)', margin: '0 0 8px' }}>{titre}</h3>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 30, lineHeight: 1.05, color: 'var(--text-primary)' }}>
        {valeur}
      </div>
      <div style={{ marginTop: 7, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {tag != null && (
          <span style={{
            display: 'inline-flex', fontSize: 12, fontWeight: 500, padding: '2px 8px',
            borderRadius: 6, background: tagFond, color: tagCouleur,
          }}>
            {tag}
          </span>
        )}
        {note}
      </div>
    </div>
  )
}

export function CoutEtRythme({ data }: { data: DonneesCoutEtRythme }) {
  const { real, forecast, delta_pct } = data.cpm
  const cher = cpmHorsPrevu(real, forecast)

  const cibleTotale = volumeCibleTotal(data.objective, data.pacing.time_pct)
  const volumePct = pourcentageVolumeLivre(data.objective, data.pacing.time_pct)

  const pctBudgetDeplacable = pourcentageDuBudget(data.sur_pression_eur, data.pacing.total_budget)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
      <Figure
        titre="CPM moyen"
        valeur={real == null ? '—' : `${formaterNombre(real)} €`}
        tag={delta_pct == null ? null : `${delta_pct >= 0 ? '+' : ''}${formaterNombre(delta_pct)} % vs plan`}
        tagCouleur={cher ? 'var(--danger)' : 'var(--brand-teal)'}
        tagFond={cher ? 'rgba(255,87,87,0.1)' : 'var(--brand-teal-10)'}
        note={forecast == null ? '' : `plan à ${formaterNombre(forecast)} €`}
        bordure={false}
      />
      <Figure
        titre="Impressions livrées"
        valeur={formaterNombreAbrege(data.objective.realized)}
        tag={volumePct == null ? null : `${formaterNombre(volumePct)} % du plan`}
        tagCouleur="var(--text-secondary)"
        tagFond="var(--bg-level-3)"
        note={cibleTotale == null ? '' : `sur ${formaterNombreAbrege(cibleTotale)} prévues`}
        bordure
      />
      <Figure
        titre="Coût du déséquilibre"
        valeur={`${formaterNombre(Math.round(data.sur_pression_eur))} €`}
        tag={pctBudgetDeplacable == null ? null : `${formaterNombre(pctBudgetDeplacable)} % du budget`}
        tagCouleur="var(--info)"
        tagFond="rgba(91,155,213,0.1)"
        note="à déplacer vers les zones en retard"
        bordure
      />
    </div>
  )
}
