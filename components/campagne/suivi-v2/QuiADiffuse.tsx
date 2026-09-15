'use client'

/**
 * QuiADiffuse — « Qui a diffusé » du cockpit Suivi V2 (Tâche 14, Step 4).
 * Barres compactes par partenaire : volume livré et coût par canal. Composant
 * PROPS-DRIVÉ, comme le reste de `suivi-v2/` — `canaux` vient de
 * `GET /api/digital/[campaignId]/actors` (route KEPT), `cpmMoyen` du CPM
 * réel global déjà calculé ailleurs (`get_campaign_suivi.cpm.real`, le même
 * nombre que « CPM moyen » de `CoutEtRythme`) — pas recalculé ici à partir
 * des canaux, une seule source pour le même chiffre.
 *
 * Seuil de CPM « nettement plus cher » : `SEUIL_CPM_CHER` (`lib/campagne/
 * constats.ts`, importé et non recopié — c'est le même seuil que le constat
 * « canal le plus cher » de la Tâche 11). Le prédicat lui-même
 * (`cpm > référence × seuil`) est EXACTEMENT `cpmHorsPrevu` de
 * `CoutEtRythme.tsx` : réutilisé plutôt que réécrit une seconde fois — ce
 * projet comptait quinze copies de `fmtNum` avant leur unification, on ne
 * recommence pas avec un prédicat de seuil.
 *
 * Ruling T14-1 : `ActorRow` et `actorKindLabel` (« DSP »/« Social »/« Régie »)
 * viennent de `lib/campaigns/actor-metrics.ts` — TROIS autres composants
 * consomment déjà la même route `/actors` avec ces mêmes types. La première
 * version de ce fichier redéclarait `CanalRow` champ pour champ à l'identique
 * et réimplémentait le même mapping de libellés ; rien ne l'a fait échouer
 * (les deux formes sont structurellement compatibles, `tsc` ne voit aucune
 * duplication), c'est exactement le patron des quinze `fmtNum`.
 */
import { cpmHorsPrevu } from './CoutEtRythme'
import { formaterNombre, formaterNombreAbrege } from '@/lib/format/nombre'
import { actorKindLabel, type ActorRow } from '@/lib/campaigns/actor-metrics'

const fInter = "'Inter', system-ui, sans-serif"
const fMono = "'JetBrains Mono', monospace"

/**
 * Largeur de barre relative au canal le plus gros du lot — jamais une
 * échelle 0-100 fixe, sans quoi un seul acteur dominant écraserait tous les
 * autres à des largeurs indiscernables. Bornée par un plancher non nul pour
 * ne jamais diviser par zéro sur un lot où toutes les parts seraient à 0.
 */
export function largeurBarreCanal(sharePct: number | null, maxSharePct: number): number {
  if (sharePct == null || sharePct <= 0) return 0
  const max = Math.max(maxSharePct, 0.0001)
  return Math.min(100, (sharePct / max) * 100)
}

export function QuiADiffuse({ canaux, cpmMoyen }: { canaux: ActorRow[]; cpmMoyen: number | null }) {
  if (canaux.length === 0) {
    return (
      <div>
        <Titre />
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Aucun partenaire n&rsquo;a encore diffusé.</p>
      </div>
    )
  }

  const maxShare = Math.max(...canaux.map((c) => c.share_pct ?? 0))

  return (
    <div>
      <Titre />
      <div>
        {canaux.map((c) => {
          const cher = cpmHorsPrevu(c.cpm, cpmMoyen)
          return (
            <div
              key={c.actor}
              style={{
                display: 'grid', gridTemplateColumns: '180px minmax(0,1fr) 92px 92px', gap: 16,
                alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.actor}
                <span style={{
                  fontSize: 11, color: 'var(--text-tertiary)', border: '0.5px solid var(--border-default)',
                  borderRadius: 5, padding: '1px 6px', marginLeft: 7,
                }}>
                  {actorKindLabel(c.kind)}
                </span>
              </div>
              <div style={{ height: 10, borderRadius: 3, background: 'var(--bg-level-3)' }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  background: c.kind === 'dsp' ? 'var(--brand-teal)' : 'var(--brand-teal-30)',
                  width: `${largeurBarreCanal(c.share_pct, maxShare)}%`,
                }} />
              </div>
              <div style={{ textAlign: 'right', fontFamily: fMono, fontSize: 13, color: 'var(--text-secondary)' }}>
                {formaterNombreAbrege(c.impressions)}
              </div>
              <div style={{
                textAlign: 'right', fontFamily: fMono, fontSize: 13,
                color: cher ? 'var(--danger)' : 'var(--text-secondary)',
                fontWeight: cher ? 500 : 400,
              }}>
                {c.cpm == null ? '—' : `${formaterNombre(c.cpm)} €`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Titre() {
  return (
    <div style={{ marginBottom: 10 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Qui a diffusé</h2>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>Volume livré et coût par partenaire.</p>
    </div>
  )
}
