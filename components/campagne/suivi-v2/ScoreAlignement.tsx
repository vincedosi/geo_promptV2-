/**
 * Le score d'alignement géographique — indicateur signature de MAGELIAN.
 *
 * TOUJOURS calculé au code postal (voir la mention affichée sous le score) :
 * agréger avant de comparer lisserait les écarts internes et ferait monter le
 * score mécaniquement quand l'utilisateur dézoome vers une maille plus large.
 * Jumeau SQL : `calculer_alignement_geo` (sql/165).
 *
 * Quand `plan_divergent` est vrai, le plan diverge entre acteurs sur au moins
 * un code postal (`campaign_cp_rollup.planned_share` n'est plus une propriété
 * du CP) : le score n'est pas calculable de façon fiable, et le bandeau
 * d'avertissement remplace le nombre — jamais un nombre avec une réserve à
 * côté.
 */
import { formaterNombre } from '@/lib/format/nombre'

/** Payload de `GET /api/campaigns/[campaignId]/alignement` (Tâche 5). */
export interface ReponseAlignement {
  score: number
  score_prev_7j: number
  variation_7j: number | null
  conformes_pct: number
  n_cp: number
  maille_calcul: 'cp'
  sous_pression_pct: number
  sous_pression_imps: number
  sur_pression_pct: number
  sur_pression_imps: number
  sur_pression_eur: number
  tolerance_pct: number
  overpressure_weight: number
  plan_divergent: boolean
  impressions_totales: number
  depense_totale: number
  etalon: { score_median: number; n_campagnes: number; tolerance_pct: number } | null
}

/**
 * Résume une variation à 7 jours en texte + sens. Logique pure, testée sans
 * DOM. `diff` est `score - score_prev_7j` (déjà arrondi côté serveur).
 */
export function libelleVariation(
  diff: number,
): { texte: string; sens: 'hausse' | 'baisse' | 'stable' } {
  if (diff === 0) return { texte: 'Stable sur 7 jours', sens: 'stable' }
  const n = Math.abs(diff)
  const points = n === 1 ? 'point' : 'points'
  if (diff > 0) return { texte: `${n} ${points} en 7 jours`, sens: 'hausse' }
  return { texte: `${n} ${points} perdus en 7 jours`, sens: 'baisse' }
}

/**
 * Position sur l'échelle 0-100, bornée. La RPC ne devrait jamais rendre un
 * score hors de [0,100], mais une position hors barre serait un rendu cassé
 * plutôt qu'un score faux — mieux vaut le borner ici.
 */
export function positionEchelle(valeur: number): number {
  if (!Number.isFinite(valeur)) return 0
  return Math.min(100, Math.max(0, valeur))
}

/**
 * L'étalon secteur à afficher, ou `null`. Ruling T10-1 : `etalon.score_median`
 * est une convention amorcée en base (Tâche 3), pas une vraie médiane, tant
 * que `n_campagnes` vaut 0 — l'afficher comme une moyenne du secteur mettrait
 * un nombre fabriqué au centre d'un écran dont l'argument entier est
 * l'exactitude. Se lit sur la donnée, jamais en dur.
 */
export function etalonAffichable(
  etalon: { score_median: number; n_campagnes: number } | null | undefined,
): number | null {
  if (!etalon || etalon.n_campagnes <= 0) return null
  return etalon.score_median
}

function Variation({ valeur }: { valeur: number | null }) {
  if (valeur == null) return null
  const { texte, sens } = libelleVariation(valeur)
  const couleur =
    sens === 'hausse' ? 'var(--brand-teal)' : sens === 'baisse' ? 'var(--danger)' : 'var(--text-tertiary)'
  const fond =
    sens === 'hausse' ? 'var(--brand-teal-10)' : sens === 'baisse' ? 'rgba(255,87,87,0.08)' : 'var(--bg-level-2)'

  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14,
        fontWeight: 500, fontSize: 13, color: couleur, background: fond,
        padding: '4px 10px', borderRadius: 999,
      }}
    >
      {sens !== 'stable' && (
        <svg
          width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ transform: sens === 'baisse' ? 'rotate(180deg)' : undefined }}
        >
          <path d="m6 15 6-6 6 6" />
        </svg>
      )}
      {texte}
    </div>
  )
}

/**
 * Échelle de positionnement 0-100. N'affiche le repère et la phrase de
 * l'étalon secteur QUE si `etalon` n'est pas `null` — voir `etalonAffichable`.
 */
function Echelle({ score, etalon }: { score: number; etalon: number | null }) {
  const pos = positionEchelle(score)

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          height: 6, borderRadius: 3, position: 'relative',
          background:
            'linear-gradient(90deg, var(--diverge-sous-2) 0%, var(--diverge-sous-1) 32%, var(--diverge-sur-1) 62%, var(--diverge-sur-2) 100%)',
        }}
      >
        <i
          aria-hidden="true"
          style={{
            position: 'absolute', top: -5, left: `${pos}%`, width: 3, height: 16,
            borderRadius: 2, background: 'var(--text-primary)',
          }}
        />
        {etalon != null && (
          <i
            aria-hidden="true"
            style={{
              position: 'absolute', top: -2, left: `${positionEchelle(etalon)}%`, width: 2, height: 10,
              borderRadius: 1, background: 'var(--text-tertiary)',
            }}
          />
        )}
      </div>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 7,
          fontSize: 12, color: 'var(--text-tertiary)',
        }}
      >
        <span>0</span>
        {etalon != null && <span>Moyenne du secteur : {formaterNombre(etalon)}</span>}
        <span>100</span>
      </div>
    </div>
  )
}

export function ScoreAlignement({ data }: { data: ReponseAlignement }) {
  return (
    <div>
      {data.plan_divergent ? (
        <div
          role="alert"
          style={{
            background: 'rgba(247,183,49,0.1)', border: '0.5px solid rgba(247,183,49,0.2)',
            color: 'var(--warning)', borderRadius: 6, padding: 12, fontSize: 13,
          }}
        >
          Le plan diverge entre acteurs sur au moins un code postal. Le score n'est pas
          calculable de façon fiable tant que ce n'est pas tranché.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
            Alignement géographique
          </div>
          <div
            style={{
              fontSize: 104, lineHeight: 0.88, letterSpacing: '-0.05em', fontWeight: 700,
              color: 'var(--brand-teal)', display: 'flex', alignItems: 'baseline', gap: 6,
            }}
          >
            {data.score}
            <span style={{ fontSize: 26, fontWeight: 500, color: 'var(--text-tertiary)' }}>/100</span>
          </div>
          <Variation valeur={data.variation_7j} />
          <Echelle score={data.score} etalon={etalonAffichable(data.etalon)} />
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10 }}>
            Toujours calculé au code postal, quelle que soit la maille affichée.
          </p>
        </>
      )}
    </div>
  )
}
