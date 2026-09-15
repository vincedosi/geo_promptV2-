'use client'

/**
 * TableauDeregles — « Départements déréglés » (le titre suit la maille) du
 * cockpit Suivi V2 (Tâche 14, task-14-brief.md). Barre DIVERGENTE centrée sur
 * le plan : le sens se lit par le CÔTÉ de la barre, pas seulement par la
 * teinte — c'est ce qui la rend lisible pour un daltonien (spec Tâche 14,
 * point 1). Sept lignes maximum (`LIGNES_MAX`) ; au-delà, le lien « Voir les
 * N … » charge la table complète À LA DEMANDE (callback `onVoirTout`,
 * orchestré par Tâche 15 — ce composant ne fetch jamais lui-même).
 *
 * Composant PROPS-DRIVÉ comme le reste de `suivi-v2/` : `unites` vient de
 * `GET /api/campaigns/[campaignId]/alignement/maille` (Tâche 6, sql/165).
 * Seule la bascule sous-pression/sur-pression est un état LOCAL (purement
 * présentationnel, ne change pas les données reçues) ; le fil d'Ariane et la
 * sélection carte passent par `useCampagneSession()` (Tâche 2), comme
 * `BarreMaille`.
 *
 * ── Unités hors plan (constrainte 2 du brief) ───────────────────────────
 * 400 CP sur 2 041 (19,6 %, mesuré le 2026-09-14) ont reçu des impressions
 * avec un plan NUL — `ecart_pct` y est `null`, aucun pourcentage n'y est
 * définissable, et `hors_plan` le signale (route `alignement/maille`,
 * sql/165). Ce sont la sur-pression la plus pure qui soit : TOUT leur volume
 * est en trop. `trierDeregles` les inclut explicitement en bascule
 * sur-pression (jamais en sous-pression) plutôt que de les laisser
 * disparaître d'un filtre naïf sur `ecart_pct < 0 / > 0` (qui vaudrait
 * `false` des deux côtés pour un `null` — la ligne vide que ce fichier
 * doit éviter). Le rendu les affiche comme « hors plan », jamais comme une
 * cellule blanche.
 *
 * ── Clé de tri ───────────────────────────────────────────────────────────
 * Le volume MAL PLACÉ (`|impressions − plan|`), jamais le ratio : c'est
 * EXACTEMENT `volume_deplace` côté serveur (sql/165, ruling T6-3) —
 * `ecart_pct` est `null` sur les unités hors plan et PostgreSQL trierait ces
 * `NULL` en tête d'un tri `DESC`. Recalculé ici depuis `impressions`/`plan`
 * plutôt que de dépendre d'un champ `volume_deplace` séparé : la formule
 * serveur EST `abs(reel − plan_estime)`, donc `impressions − plan` suffit —
 * pas une deuxième source de vérité, la même lue autrement.
 */
import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { useCampagneSession } from '@/lib/campagne/CampagneSessionContext'
import type { Maille } from '@/lib/campagne/session-types'
import { LIBELLES_MAILLE } from './BarreMaille'
import { formaterNombre } from '@/lib/format/nombre'
import { RAMPE_CSS, trancheDivergente } from '@/lib/campagne/palette-divergente'

const fInter = "'Inter', system-ui, sans-serif"
const fMono = "'JetBrains Mono', monospace"

export interface UniteMaille {
  code: string
  nom: string
  ecart_pct: number | null
  impressions: number
  cpm: number | null
  spend: number
  plan: number | null
  /** Plan nul, impressions réelles — voir la note de fichier ci-dessus. Optionnel : `undefined` se comporte comme `false`. */
  hors_plan?: boolean
}

export type SensDereglement = 'sous' | 'sur'

/** Sept lignes maximum : au-delà, la liste cesse d'être lisible d'un coup d'œil. */
export const LIGNES_MAX = 7

/** Titre pluriel — le pluriel de « code postal » est irrégulier, pas mécanique : ne se déduit pas de `LIBELLES_MAILLE` (singulier, `BarreMaille.tsx`), qui reste la SEULE source des libellés singuliers. */
const LIBELLES_MAILLE_PLURIEL: Record<Maille, string> = {
  region: 'Régions', departement: 'Départements', cp: 'Codes postaux',
}

/** Niveau immédiatement inférieur, ou `null` sur la feuille (CP) — pas de drill-down possible depuis un CP. */
const MAILLE_SUIVANTE: Record<Maille, Maille | null> = {
  region: 'departement', departement: 'cp', cp: null,
}

/** Volume mal placé, en impressions — même clé que `volume_deplace` côté serveur (sql/165). Définie PARTOUT, y compris à plan nul. */
function volumeDeregle(u: UniteMaille): number {
  return Math.abs(u.impressions - (u.plan ?? 0))
}

/**
 * Filtre + trie les unités déréglées dans un sens donné.
 *
 * Une unité `hors_plan` compte TOUJOURS en sur-pression (jamais en
 * sous-pression, jamais absente des deux) : c'est la seule façon de ne pas
 * la faire disparaître quand `ecart_pct` est `null`.
 */
export function trierDeregles(unites: UniteMaille[], sens: SensDereglement): UniteMaille[] {
  const candidats = unites.filter((u) => {
    if (u.hors_plan) return sens === 'sur'
    if (u.ecart_pct == null) return false
    return sens === 'sous' ? u.ecart_pct < 0 : u.ecart_pct > 0
  })
  return candidats.sort((a, b) => volumeDeregle(b) - volumeDeregle(a)).slice(0, LIGNES_MAX)
}

/**
 * Barre divergente centrée sur le plan. Le sens se lit par le CÔTÉ, pas
 * seulement par la teinte — c'est ce qui la rend lisible pour un daltonien.
 * `pct` est à interpréter comme un pourcentage de la MOITIÉ de la barre (le
 * conteneur visuel réserve 50 % de sa largeur à chaque côté) : bornée à
 * 100 %, une unité à -95 % remplit exactement sa moitié sans déborder.
 */
export function largeurBarre(ecartPct: number): { cote: 'gauche' | 'droite'; pct: number } {
  return {
    cote: ecartPct < 0 ? 'gauche' : 'droite',
    pct: Math.min(100, Math.abs(ecartPct)),
  }
}

/**
 * Indice de gravité (0-6) sur l'échelle divergente PARTAGÉE
 * (`trancheDivergente`/`BORNES_DIVERGENTES`, `lib/campagne/
 * palette-divergente.ts`) — la MÊME échelle, sur le MÊME champ `ecart_pct`,
 * que `GraphiqueEcart.tsx`, `CarteVignette.tsx` et `DiffusionMapLayer.tsx`.
 *
 * Ruling T14-2 : ce fichier avait sa propre échelle de gravité, asymétrique
 * à trois teintes (`--danger`/`--warning`/`--info`), où toute sur-livraison
 * — même à +900 % — restait `--info`, la teinte la plus calme de
 * l'application, alors que le score d'alignement pénalise les deux sens à
 * égalité. `graviteEcart` délègue entièrement à `trancheDivergente` : aucune
 * seconde marche de seuils écrite ici.
 *
 * Une unité `hors_plan` (`ecart_pct` non définissable, plan nul) vaut
 * TOUJOURS l'indice le plus extrême côté sur-pression (6) — même convention
 * que `trierDeregles` ci-dessus et `constats.ts` (ruling T11-2, « la
 * sur-pression la plus pure qui soit ») : validée sans réserve à la relecture
 * précédente, non modifiée ici.
 */
export function graviteEcart(ecartPct: number | null, horsPlan?: boolean): number {
  if (ecartPct == null || horsPlan) return RAMPE_CSS.length - 1
  return trancheDivergente(ecartPct)
}

function BarreDivergente({ ecartPct, horsPlan }: { ecartPct: number | null; horsPlan?: boolean }) {
  const socle = (
    <span
      aria-hidden="true"
      style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'var(--border-default)' }}
    />
  )
  const couleur = RAMPE_CSS[graviteEcart(ecartPct, horsPlan)]

  if (ecartPct == null || horsPlan) {
    // Hors plan : la sur-pression la plus pure — la barre remplit toute la
    // moitié droite plutôt que de rester vide (aucune cellule blanche).
    return (
      <div style={{ position: 'relative', height: 18, background: 'var(--bg-level-3)', borderRadius: 4 }}>
        {socle}
        <i
          aria-hidden="true"
          style={{
            position: 'absolute', top: 4, height: 10, borderRadius: 2,
            left: '50%', width: '50%', background: couleur,
          }}
        />
      </div>
    )
  }

  const { cote, pct } = largeurBarre(ecartPct)
  return (
    <div style={{ position: 'relative', height: 18, background: 'var(--bg-level-3)', borderRadius: 4 }}>
      {socle}
      <i
        aria-hidden="true"
        style={{
          position: 'absolute', top: 4, height: 10, borderRadius: 2,
          background: couleur,
          ...(cote === 'gauche' ? { right: '50%', width: `${pct / 2}%` } : { left: '50%', width: `${pct / 2}%` }),
        }}
      />
    </div>
  )
}

/**
 * Étiquette d'écart.
 *
 * La rampe divergente sert de PASTILLE, jamais de couleur de texte (constat 13
 * de la relecture d'interface) : ces jetons sont conçus comme couleurs de
 * REMPLISSAGE (carte, barre). Peints en texte sur `--bg-level-3`,
 * `--diverge-neutre` donnait #4a4a4a sur #181818 en sombre (~2,1:1) et
 * #c6d2cf sur #e2e2e2 en clair (~1,2:1) — un pourcentage illisible pour toute
 * unité proche du plan, dans les deux thèmes, c'est-à-dire pour la majorité
 * des lignes. Le chiffre passe en `--text-primary` ; la teinte reste présente
 * et lisible dans la pastille, et le sens continue de se lire par le CÔTÉ de
 * la barre juste au-dessus.
 */
export function EcartTag({ ecartPct, horsPlan: horsPlanBrut }: { ecartPct: number | null; horsPlan?: boolean }) {
  const couleur = RAMPE_CSS[graviteEcart(ecartPct, horsPlanBrut)]
  const horsPlan = ecartPct == null || horsPlanBrut
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500,
      padding: '2px 8px', borderRadius: 6,
      background: 'var(--bg-level-3)', color: 'var(--text-primary)',
    }}>
      <i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: couleur, flexShrink: 0 }} />
      {horsPlan ? 'hors plan' : `${ecartPct! > 0 ? '+' : ''}${formaterNombre(ecartPct!)} %`}
    </span>
  )
}

const cellStyle = {
  padding: '9px 10px', fontFamily: fMono, fontSize: 12.5, color: 'var(--text-secondary)',
  textAlign: 'right' as const, whiteSpace: 'nowrap' as const,
}
const headStyle = {
  padding: '8px 10px', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
  textAlign: 'right' as const, fontWeight: 500,
}

export function TableauDeregles({ unites, nTotal, onVoirTout }: {
  unites: UniteMaille[]
  /** `n_total` de la route `.../alignement/maille` — sert le lien « Voir les N ... ». */
  nTotal?: number
  /** Charge la table complète À LA DEMANDE (jamais au montage) — Tâche 15 orchestre le fetch. */
  onVoirTout?: () => void
}) {
  const { session, majSession } = useCampagneSession()
  const [sens, setSens] = useState<SensDereglement>('sous')
  const maille = session.maille
  const niveauSuivant = MAILLE_SUIVANTE[maille]

  const lignes = trierDeregles(unites, sens)
  const libellePluriel = LIBELLES_MAILLE_PLURIEL[maille]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            {libellePluriel} déréglés
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Écart entre la pression réelle et la pression prévue. {maille === 'cp'
              ? 'Maille d’achat du DSP.'
              : 'Cliquer une ligne pour descendre d’un niveau.'}
          </p>
        </div>
        <div role="group" aria-label="Trier les unités déréglées" style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            aria-pressed={sens === 'sous'}
            onClick={() => setSens('sous')}
            style={{
              border: '0.5px solid ' + (sens === 'sous' ? 'var(--brand-teal)' : 'var(--border-default)'),
              background: sens === 'sous' ? 'var(--brand-teal-10)' : 'transparent',
              color: sens === 'sous' ? 'var(--brand-teal)' : 'var(--text-secondary)',
              borderRadius: 6, padding: '6px 12px', fontSize: 12.5, fontFamily: fInter, cursor: 'pointer',
            }}
          >
            Sous-pression
          </button>
          <button
            type="button"
            aria-pressed={sens === 'sur'}
            onClick={() => setSens('sur')}
            style={{
              border: '0.5px solid ' + (sens === 'sur' ? 'var(--brand-teal)' : 'var(--border-default)'),
              background: sens === 'sur' ? 'var(--brand-teal-10)' : 'transparent',
              color: sens === 'sur' ? 'var(--brand-teal)' : 'var(--text-secondary)',
              borderRadius: 6, padding: '6px 12px', fontSize: 12.5, fontFamily: fInter, cursor: 'pointer',
            }}
          >
            Sur-pression
          </button>
        </div>
      </div>

      {lignes.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          Aucune unité en {sens === 'sous' ? 'sous-pression' : 'sur-pression'}.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', border: '0.5px solid var(--border-subtle)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ ...headStyle, textAlign: 'left' }}>{LIBELLES_MAILLE[maille]}</th>
                <th style={{ ...headStyle, minWidth: 140 }}>Écart au plan</th>
                <th style={headStyle}>Impressions</th>
                <th style={headStyle}>CPM</th>
                <th style={headStyle}>Dépense</th>
                <th style={headStyle} aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {lignes.map((u) => (
                <tr
                  key={u.code}
                  onClick={niveauSuivant ? () => majSession({ parent: u.code, maille: niveauSuivant }) : undefined}
                  style={{ borderBottom: '1px solid var(--border-subtle)', cursor: niveauSuivant ? 'pointer' : 'default' }}
                >
                  <td style={{ padding: '9px 10px', fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)' }}>
                    {/* Le drill-down était porté par le seul `onClick` de la
                        ligne : sans `tabIndex`, sans rôle et sans gestionnaire
                        clavier, descendre d'une région vers ses départements
                        était impossible au clavier, alors que le seul élément
                        focusable de la ligne (« Voir sur la carte ») fait
                        autre chose. Un vrai `<button>` porte l'action ; le
                        `onClick` de la ligne reste un raccourci souris.
                        `stopPropagation` évite le double déclenchement. */}
                    {niveauSuivant ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); majSession({ parent: u.code, maille: niveauSuivant }) }}
                        aria-label={`${u.code} ${u.nom} — voir le détail par ${LIBELLES_MAILLE[niveauSuivant].toLowerCase()}`}
                        style={{
                          border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
                          fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)', textAlign: 'left',
                        }}
                      >
                        <b style={{ fontWeight: 500 }}>{u.code}</b>{' '}
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 12.5 }}>{u.nom}</span>
                      </button>
                    ) : (
                      <>
                        <b style={{ fontWeight: 500 }}>{u.code}</b>{' '}
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 12.5 }}>{u.nom}</span>
                      </>
                    )}
                  </td>
                  <td style={{ ...cellStyle, minWidth: 140 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch' }}>
                      <BarreDivergente ecartPct={u.ecart_pct} horsPlan={u.hors_plan} />
                      <div style={{ textAlign: 'right' }}><EcartTag ecartPct={u.ecart_pct} horsPlan={u.hors_plan} /></div>
                    </div>
                  </td>
                  <td style={cellStyle}>{formaterNombre(u.impressions)}</td>
                  <td style={cellStyle}>{u.cpm == null ? '—' : `${formaterNombre(u.cpm)} €`}</td>
                  <td style={cellStyle}>{formaterNombre(Math.round(u.spend))} €</td>
                  <td style={{ ...cellStyle, padding: '6px 8px' }}>
                    <button
                      type="button"
                      aria-label="Voir sur la carte"
                      onClick={(e) => { e.stopPropagation(); majSession({ vue: 'carte', uniteSelectionnee: u.code }) }}
                      style={{
                        border: '0.5px solid var(--border-default)', background: 'var(--bg-level-1)',
                        borderRadius: 6, width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <MapPin size={14} strokeWidth={1.8} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {onVoirTout != null && nTotal != null && nTotal > 0 && (
        <p style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={onVoirTout}
            style={{
              border: 0, background: 'none', padding: 0, cursor: 'pointer',
              color: 'var(--brand-teal)', fontSize: 13, textDecoration: 'underline', textUnderlineOffset: 3,
            }}
          >
            Voir les {formaterNombre(nTotal)} {libellePluriel.toLowerCase()}
          </button>
        </p>
      )}
    </div>
  )
}
