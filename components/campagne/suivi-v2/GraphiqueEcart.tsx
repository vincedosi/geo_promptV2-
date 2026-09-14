'use client'

/**
 * GraphiqueEcart — le graphique qui explique le score d'alignement (Tâche 12).
 *
 * DEUX FORMES, un seul composant, décidées par la maille — pas seulement une
 * échelle qui change :
 *  - Région / Département : courbe du plan (pointillés) contre le réel
 *    (plein), avec deux aires colorées entre les deux (sous-pression /
 *    sur-pression). Seules les unités les plus déréglées sont annotées.
 *  - Code postal : une courbe de ~2 000 points ne raconte rien — remplacée
 *    par un HISTOGRAMME de la dispersion des écarts, tranche conforme au
 *    centre, couleurs divergentes de part et d'autre.
 *
 * Données : props (pas de fetch ici), même patron que les autres composants
 * de ce dossier (`ScoreAlignement`, `BandeauAvancement`, `CoutEtRythme`) —
 * `unites` vient de `GET .../alignement/maille` (région/département),
 * `tranches` de `GET .../alignement/dispersion` (CP). Le composant appelant
 * choisit lequel fetcher selon `session.maille`.
 *
 * PIÈGE : Recharts prend des couleurs littérales, pas des `var()`, pour tout
 * ce qui vient de l'échelle divergente (elle existe déjà en hex littéraux
 * PAR THÈME pour MapLibre — `RAMPE_MAPLIBRE`). Le composant appelle
 * `useTheme()` et relit `RAMPE_MAPLIBRE[theme]` à CHAQUE rendu (valeur
 * dérivée de l'état React, jamais lue une fois via `getComputedStyle` à la
 * création puis figée — le défaut déjà documenté sur `SuiviMapLayer.tsx` et
 * `CivicHealthMapLayer.tsx`). Tout le reste (axes, légende, conteneurs) est
 * du DOM ordinaire et utilise `var(--token)` normalement, comme le fait déjà
 * `SuiviCharts.tsx` pour ses propres lignes Recharts.
 */
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTheme } from '@/lib/theme/ThemeProvider'
import { RAMPE_MAPLIBRE } from '@/lib/campagne/palette-divergente'
import { formaterNombre, formaterNombreAbrege } from '@/lib/format/nombre'
import {
  construireSeriesCourbe, selectionnerAnnotations, preparerDispersion, formaterPlageTranche,
  type UniteAlignement, type TrancheDispersion, type PointCourbe, type BarreDispersion,
} from '@/lib/campagne/graphique-ecart'

const fInter = "'Inter', system-ui, sans-serif"
const fMono = "'JetBrains Mono', monospace"

const tooltipStyle = {
  background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
  borderRadius: 6, fontFamily: fMono, fontSize: 11,
} as const

const axisProps = {
  stroke: 'var(--text-tertiary)',
  tick: { fontFamily: fMono, fontSize: 10, fill: 'var(--text-tertiary)' },
  tickLine: false, axisLine: false,
} as const

function Titre({ enfant, sousTitre }: { enfant: string; sousTitre: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{enfant}</span>
      </div>
      <p style={{ margin: '4px 0 0 14px', fontSize: 12, color: 'var(--text-tertiary)' }}>{sousTitre}</p>
    </div>
  )
}

function LegendeItem({ couleur, trait, libelle }: { couleur: string; trait?: 'plein' | 'pointille'; libelle: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
      {trait ? (
        <i aria-hidden style={{
          width: 14, height: 0, borderTop: `2px ${trait === 'pointille' ? 'dashed' : 'solid'} ${couleur}`,
        }} />
      ) : (
        <i aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: couleur }} />
      )}
      {libelle}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Région / Département — courbe plan vs réel
// ---------------------------------------------------------------------------

function CourbePlanReel({ unites, maille }: { unites: UniteAlignement[] | null; maille: 'region' | 'departement' }) {
  const { theme } = useTheme()
  const rampe = RAMPE_MAPLIBRE[theme]
  // Sous-pression : sous-2 (index 1). Sur-pression : sur-2 (index 5) — le
  // symétrique dans l'échelle à 7 tons. Les tons les plus extrêmes
  // (index 0 / 6) marquent les annotations, pas l'aire entière.
  const couleurAireSous = rampe[1]
  const couleurAireSur = rampe[5]
  const couleurPointSous = rampe[0]
  const couleurPointSur = rampe[6]

  if (!unites || unites.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Aucune donnée pour cette maille.</p>
  }

  const serie = construireSeriesCourbe(unites, maille)
  const annotees = new Set(selectionnerAnnotations(serie).map((p) => p.code))

  const pointReel = (props: { cx?: number; cy?: number; payload?: PointCourbe }) => {
    const { cx, cy, payload } = props
    if (cx == null || cy == null || !payload || !annotees.has(payload.code)) {
      return <g key={`vide-${payload?.code ?? cx}`} />
    }
    const sous = (payload.ecart_pct ?? 0) < 0
    const couleur = sous ? couleurPointSous : couleurPointSur
    return (
      <g key={`pt-${payload.code}`}>
        <circle cx={cx} cy={cy} r={4} fill={couleur} stroke="var(--bg-level-1)" strokeWidth={1.5} />
        <text
          x={cx} y={sous ? cy + 17 : cy - 10} textAnchor="middle"
          style={{ fontFamily: fMono, fontSize: 11, fontWeight: 600, fill: couleur }}
        >
          {payload.code}
        </text>
      </g>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <Titre
          enfant="Pression prévue, pression réelle"
          sousTitre={`Impressions par ${maille === 'region' ? 'région' : 'département'}, du plus lourd au plus léger dans le plan.`}
        />
        <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
          <LegendeItem couleur="var(--text-tertiary)" trait="pointille" libelle="Plan" />
          <LegendeItem couleur="var(--brand-teal)" trait="plein" libelle="Réel" />
          <LegendeItem couleur={couleurAireSous} libelle="Sous-pression" />
          <LegendeItem couleur={couleurAireSur} libelle="Sur-pression" />
        </div>
      </div>

      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={serie} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="code" {...axisProps} interval={0} angle={-35} textAnchor="end" height={44} />
            <YAxis width={54} tickFormatter={(v: number) => formaterNombreAbrege(v)} {...axisProps} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(_, entries) => (entries?.[0]?.payload as PointCourbe | undefined)?.nom ?? ''}
              formatter={(value, name) => {
                if (name === 'plan') return [`${formaterNombre(Number(value))} imp.`, 'plan']
                if (name === 'reel') return [`${formaterNombre(Number(value))} imp.`, 'réel']
                return [null, null]
              }}
            />
            {/* Aire empilée transparente jusqu'au minimum, puis bande colorée jusqu'au plan
                (sous-pression) ou jusqu'au réel (sur-pression) — la surface EXACTE entre les
                deux courbes, jamais un dégradé approximatif. */}
            <Area dataKey="min" stackId="ecart" stroke="none" fill="transparent" legendType="none" name=" " isAnimationActive={false} />
            <Area dataKey="gapSous" stackId="ecart" stroke="none" fill={couleurAireSous} fillOpacity={0.35} legendType="none" name=" " isAnimationActive={false} />
            <Area dataKey="gapSur" stackId="ecart" stroke="none" fill={couleurAireSur} fillOpacity={0.35} legendType="none" name=" " isAnimationActive={false} />
            <Line dataKey="plan" stroke="var(--text-tertiary)" strokeDasharray="5 4" dot={false} strokeWidth={1.4} isAnimationActive={false} />
            <Line dataKey="reel" stroke="var(--brand-teal)" dot={pointReel} strokeWidth={2.2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
        Le volume en sur-pression au-dessus du plan est exactement celui qui manque en sous-pression ailleurs.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Code postal — histogramme de dispersion
// ---------------------------------------------------------------------------

function HistogrammeDispersion({ tranches }: { tranches: TrancheDispersion[] | null }) {
  const { theme } = useTheme()
  const rampe = RAMPE_MAPLIBRE[theme]

  if (!tranches || tranches.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Aucune donnée pour cette maille.</p>
  }

  const { barres, horsPlan } = preparerDispersion(tranches)

  return (
    <div>
      <Titre
        enfant="Dispersion des écarts au plan"
        sousTitre="Nombre de codes postaux par tranche d'écart au plan. À cette maille, la courbe n'a plus de sens : ce qui compte est la répartition autour du plan."
      />

      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barres} margin={{ top: 16, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="libelle" {...axisProps}
              interval={0} angle={-20} textAnchor="end" height={52}
            />
            <YAxis width={44} tickFormatter={(v: number) => formaterNombreAbrege(v)} {...axisProps} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name, entry) => {
                const payload = entry?.payload as BarreDispersion | undefined
                if (name !== 'n_cp' || !payload) return [null, null]
                return [
                  `${formaterNombre(Number(value))} CP (${formaterNombre(payload.impressions)} imp.)`,
                  formaterPlageTranche(payload.borne_basse, payload.borne_haute),
                ]
              }}
            />
            <Bar dataKey="n_cp" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {barres.map((b) => <Cell key={b.index} fill={rampe[b.index]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {horsPlan && (
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
          {formaterNombre(horsPlan.n_cp)} codes postaux sans plan défini ({formaterNombre(horsPlan.impressions)} impressions
          reçues) — aucun écart n&rsquo;y est définissable, non représentés ci-dessus.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bascule sur la maille — la décision de forme
// ---------------------------------------------------------------------------

export function GraphiqueEcart({
  maille, unites, tranches,
}: {
  /** Maille d'affichage courante (`useCampagneSession().session.maille`). */
  maille: 'region' | 'departement' | 'cp'
  /** Payload de `GET .../alignement/maille` — utilisé en région/département, `null` sinon. */
  unites: UniteAlignement[] | null
  /** Payload de `GET .../alignement/dispersion` — utilisé en CP, `null` sinon. */
  tranches: TrancheDispersion[] | null
}) {
  // En maille CP, une courbe de ~2 000 points ne raconte rien : on change de
  // FORME, pas seulement d'échelle (spec Tâche 12).
  return maille === 'cp'
    ? <HistogrammeDispersion tranches={tranches} />
    : <CourbePlanReel unites={unites} maille={maille} />
}
