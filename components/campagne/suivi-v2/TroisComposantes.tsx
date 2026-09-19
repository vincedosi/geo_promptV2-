/**
 * Les trois composantes du score d'alignement géographique : la part de codes
 * postaux conformes au plan, et les deux sens de l'écart qui pénalisent le
 * score — sous-pression (volume manquant) et sur-pression (volume en trop,
 * chiffré en euros déplaçables). Textes repris de `docs/DOC INTERFACE/
 * magelian-suivi.html`, à une exception : la tolérance (« à 10 % près ») y
 * est écrite en dur alors que `tolerance_pct` est un réglage par campagne
 * (Tâche 3) déjà présent dans la réponse — elle est donc interpolée ici
 * plutôt que recopiée (règle « jamais de valeur en dur »).
 */
import { formaterNombre } from '@/lib/format/nombre'
import type { ReponseAlignement } from './ScoreAlignement'

/**
 * Largeur de piste bornée à [0,100]. Logique pure, testée sans DOM — une
 * valeur hors bornes (donnée dégradée) ne doit jamais casser le rendu.
 */
export function largeurBarre(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return 0
  return Math.min(100, Math.max(0, pct))
}

function Composante({ titre, explication, pct, detail, couleurBarre }: {
  titre: string
  explication: string
  pct: number
  detail: string
  couleurBarre: string
}) {
  return (
    <div
      style={{
        background: 'var(--bg-level-1)', border: '0.5px solid var(--border-subtle)',
        borderRadius: 8, padding: 14,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px' }}>
        {titre}
      </h3>
      <p
        style={{
          fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45,
          minHeight: 38, margin: '0 0 10px',
        }}
      >
        {explication}
      </p>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span
          style={{
            fontSize: 20, fontWeight: 600, color: 'var(--text-primary)',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {formaterNombre(pct)} %
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{detail}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-level-3)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%', borderRadius: 3, background: couleurBarre,
            width: `${largeurBarre(pct)}%`,
          }}
        />
      </div>
    </div>
  )
}

export function TroisComposantes({ data }: { data: ReponseAlignement }) {
  // Le nombre de CP conformes n'est pas rendu par la RPC (seul le pourcentage
  // l'est) : dérivé ici de conformes_pct × n_cp, jamais recompté côté client.
  const nConformes = Math.round((data.conformes_pct / 100) * data.n_cp)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
      <Composante
        titre="Zones conformes"
        explication={`Codes postaux qui reçoivent la pression prévue, à ${formaterNombre(data.tolerance_pct)} % près.`}
        pct={data.conformes_pct}
        detail={`${formaterNombre(nConformes)} CP`}
        couleurBarre="var(--brand-teal)"
      />
      <Composante
        titre="Sous-pression"
        explication="Volume qui manque aux zones servies en dessous du plan."
        pct={data.sous_pression_pct}
        detail={`${formaterNombre(data.sous_pression_imps)} impressions`}
        couleurBarre="var(--diverge-sous-2)"
      />
      <Composante
        titre="Sur-pression"
        explication="Volume en trop ailleurs, qui aurait dû aller aux zones en retard."
        pct={data.sur_pression_pct}
        detail={`${formaterNombre(Math.round(data.sur_pression_eur))} € déplaçables`}
        couleurBarre="var(--diverge-sur-2)"
      />
    </div>
  )
}
