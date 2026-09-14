/**
 * Bandeau d'avancement : trois barres sur la MÊME échelle (temps écoulé,
 * budget consommé, volume livré) avec un repère vertical marquant où en est
 * le temps sur les deux barres du bas — c'est ce repère qui rend un retard
 * visible d'un coup d'œil, plutôt qu'un calcul à faire dans sa tête. Une
 * phrase chiffre ce que l'écart implique en fin de campagne.
 *
 * Données : `GET /api/digital/[campaignId]/suivi` (route KEPT), `pacing` +
 * `objective`. « Volume livré » n'est PAS `objective.pct` (qui compare le
 * réalisé à la cible proratisée au temps écoulé, donc peut dépasser 100 dès
 * le premier jour) : c'est `pourcentageVolumeLivre` (`lib/campagne/
 * avancement.ts`, partagé avec `CoutEtRythme`), le réalisé rapporté à la
 * cible TOTALE de la campagne — seule façon de le mettre sur la même échelle
 * que `budget_pct` et `time_pct`.
 */
import { formaterNombre } from '@/lib/format/nombre'
import {
  pourcentageVolumeLivre,
  type ObjectifCampagne,
  type Pacing,
} from '@/lib/campagne/avancement'

export interface DonneesAvancement {
  as_of: string | null
  end_date: string | null
  pacing: Pacing
  objective: ObjectifCampagne
}

/** Largeur de piste bornée à [0,100]. Une donnée dégradée ne doit jamais casser le rendu. */
export function largeurPiste(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return 0
  return Math.min(100, Math.max(0, pct))
}

/**
 * Écart entre le temps écoulé et le budget consommé, en points entiers
 * (même formule que le titre d'alerte `pacing` de `get_campaign_suivi`,
 * sql/113 : `ROUND(time_pct - budget_pct)`). `null` si l'une des deux parts
 * manque — pas de repère à afficher sans donnée.
 */
export function ecartRythme(
  timePct: number | null,
  budgetPct: number | null,
): { points: number; sens: 'retard' | 'avance' | 'aligne' } | null {
  if (timePct == null || budgetPct == null) return null
  const diff = Math.round(timePct - budgetPct)
  if (diff === 0) return { points: 0, sens: 'aligne' }
  return { points: Math.abs(diff), sens: diff > 0 ? 'retard' : 'avance' }
}

/**
 * Projection linéaire : à consommation constante depuis le début de
 * campagne, ce qu'il resterait du budget au terme. Positif = sous-consommé,
 * négatif = dépassement projeté. `null` sans temps écoulé positif — on ne
 * peut pas extrapoler un rythme depuis zéro.
 */
export function projectionResteBudget(
  spend: number,
  timePct: number | null,
  totalBudget: number | null,
): number | null {
  if (timePct == null || timePct <= 0 || totalBudget == null) return null
  const projete = spend / (timePct / 100)
  return totalBudget - projete
}

/** « 30 avril » — jour + mois en toutes lettres, sans année (registre de la phrase du bandeau). */
export function formaterJourMois(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

function Ligne({ label, pct, couleurBarre, repere }: {
  label: string
  pct: number | null
  couleurBarre: string
  /** Position en % du repère de temps, ou `null` pour ne pas en afficher (ligne « temps écoulé » elle-même). */
  repere: number | null
}) {
  const largeur = largeurPiste(pct)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '128px minmax(0,1fr) 62px', gap: 14, alignItems: 'center' }}>
      <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{label}</span>
      <div style={{ position: 'relative', height: 10, borderRadius: 5, background: 'var(--bg-level-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 5, background: couleurBarre, width: `${largeur}%` }} />
        {repere != null && (
          <i
            aria-hidden="true"
            style={{
              position: 'absolute', top: -3, bottom: -3, width: 2, left: `${largeurPiste(repere)}%`,
              background: 'var(--text-primary)',
            }}
          />
        )}
      </div>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 14, textAlign: 'right', color: 'var(--text-primary)' }}>
        {pct == null ? '—' : `${formaterNombre(pct)} %`}
      </span>
    </div>
  )
}

function phraseAvancement(data: DonneesAvancement, ecart: { points: number; sens: 'retard' | 'avance' | 'aligne' }): string | null {
  const { spend, total_budget, time_pct } = data.pacing
  if (total_budget == null) return null

  const auJour = formaterJourMois(data.as_of)
  const finCampagne = formaterJourMois(data.end_date)
  const debut = `${formaterNombre(spend)} € sur ${formaterNombre(total_budget)} €${auJour ? `, au ${auJour}` : ''}.`

  const reste = projectionResteBudget(spend, time_pct, total_budget)
  if (reste == null || finCampagne == null) return debut

  if (Math.abs(reste) < total_budget * SEUIL_PROJECTION_EXACTE_PCT) {
    return `${debut} Le budget devrait être consommé intégralement d'ici le ${finCampagne}.`
  }
  if (reste > 0) {
    return `${debut} Sans rattrapage, ${formaterNombre(Math.round(reste))} € resteront non dépensés le ${finCampagne}.`
  }
  return `${debut} À ce rythme, le budget sera dépassé de ${formaterNombre(Math.round(-reste))} € avant le ${finCampagne}.`
}

/** En dessous de ce seuil (part du budget total), la projection est jugée « pile ». */
const SEUIL_PROJECTION_EXACTE_PCT = 0.005

const LIBELLES_SENS: Record<'retard' | 'avance' | 'aligne', (points: number) => string> = {
  retard: (n) => `${n} ${n === 1 ? 'point' : 'points'} de retard`,
  avance: (n) => `${n} ${n === 1 ? 'point' : 'points'} d'avance`,
  aligne: () => 'Rythme aligné sur le temps',
}

export function BandeauAvancement({ data }: { data: DonneesAvancement }) {
  const { time_pct, budget_pct } = data.pacing
  const volumePct = pourcentageVolumeLivre(data.objective, time_pct)
  const ecart = ecartRythme(time_pct, budget_pct)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 268px', gap: 30, alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Ligne label="Temps écoulé" pct={time_pct} couleurBarre="var(--text-tertiary)" repere={null} />
        <Ligne label="Budget consommé" pct={budget_pct} couleurBarre="var(--brand-teal)" repere={time_pct} />
        <Ligne label="Volume livré" pct={volumePct} couleurBarre="var(--brand-teal)" repere={time_pct} />
      </div>

      {ecart && (
        <div style={{ borderLeft: `2px solid ${ecart.sens === 'retard' ? 'var(--warning)' : 'var(--brand-teal)'}`, paddingLeft: 16 }}>
          <b style={{ display: 'block', fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
            {LIBELLES_SENS[ecart.sens](ecart.points)}
          </b>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            {phraseAvancement(data, ecart)}
          </span>
        </div>
      )}
    </div>
  )
}
