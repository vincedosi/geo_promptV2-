'use client'

/**
 * DetailTechnique — bloc technique REPLIÉ PAR DÉFAUT du cockpit Suivi V2
 * (Tâche 14, Step 5). `<details>` natif, PAS d'état React pour ouvert/fermé
 * — le navigateur porte cet état seul. Deux blocs :
 *  - budget cumulé RÉEL contre la trajectoire IDÉALE (linéaire dans le
 *    temps), depuis `GET /api/digital/[campaignId]/suivi` (route KEPT,
 *    `pacing.total_budget` + `daily` — RPC `get_campaign_suivi`, sql/108) ;
 *  - réconciliation DSP contre ad server, en réutilisant TEL QUEL
 *    `ReconciliationPanel` (`components/campaign/suivi/`) — props-driven,
 *    déjà testé, pas de deuxième table réécrite pour le même besoin.
 *
 * SEUL composant de `suivi-v2/` à s'auto-fetcher (interface Tâche 14 :
 * `<DetailTechnique campaignId={string} />`, aucune autre prop) : c'est ce
 * qui permet au repli de servir à quelque chose — un bloc replié qui
 * recevrait ses données déjà chargées par le parent aurait payé le coût I/O
 * (budget Nano, CLAUDE.md) d'un écran que l'utilisateur ne déplie peut-être
 * jamais. Le chargement est donc déclenché au PREMIER dépli
 * (`onToggle` natif), jamais au montage — même règle que le lien « Voir les
 * N … » de `TableauDeregles`.
 *
 * Le bilan exécutif Gemini (`FinalReport`), monté ici pour une stratégie
 * `completed`, a été retiré le 2026-10-12 (suppression de toute l'IA) avec la
 * lecture de `GET /api/bidding/strategies` qui ne servait qu'à lui.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFetch } from '@/lib/admin-fetch'
import { formaterNombreAbrege } from '@/lib/format/nombre'
import type { SuiviDaily, SuiviPayload } from '@/lib/campaigns/suivi-metrics'
import type { ReconciliationPayload } from '@/lib/campaigns/reconciliation-metrics'
import { ReconciliationPanel } from '@/components/campaign/suivi/ReconciliationPanel'
import { avecSemaphore } from './avec-semaphore'

const fInter = "'Inter', system-ui, sans-serif"
const fMono = "'JetBrains Mono', monospace"

export interface PointBudget {
  date: string
  /** Cumul idéal si le budget se consommait linéairement entre `start_date` et `end_date`. */
  ideal: number
  /** Cumul réellement dépensé jusqu'à cette date. */
  reel: number
}

/**
 * Budget cumulé réel contre la trajectoire idéale, jour par jour.
 *
 * `null` sans budget total positif, sans période exploitable (`start_date`/
 * `end_date`) ou sans donnée quotidienne — pas de trajectoire à tracer sans
 * dénominateur. La trajectoire idéale est LINÉAIRE dans le temps (aucune
 * saisonnalité de plan connue côté client) : `budget × part de la période
 * écoulée`, bornée à la période `[start_date, end_date]`.
 */
export function trajectoireBudget(
  daily: Pick<SuiviDaily, 'date' | 'spend'>[],
  totalBudget: number | null,
  startDate: string | null,
  endDate: string | null,
): PointBudget[] | null {
  if (totalBudget == null || totalBudget <= 0) return null
  if (!startDate || !endDate || daily.length === 0) return null

  const debut = new Date(startDate).getTime()
  const fin = new Date(endDate).getTime()
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return null
  const dureeMs = fin - debut

  const tries = [...daily].sort((a, b) => a.date.localeCompare(b.date))
  let cumul = 0
  return tries.map((j) => {
    cumul += j.spend
    const t = new Date(j.date).getTime()
    const ratioTemps = Number.isFinite(t) ? Math.min(1, Math.max(0, (t - debut) / dureeMs)) : 0
    return { date: j.date, ideal: totalBudget * ratioTemps, reel: cumul }
  })
}

/** « 12 avril » — jour + mois, sans année (registre de la note sous le graphe). */
function formaterJourMois(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/**
 * Premier jour où le réel dépasse l'idéal d'au moins 2 % du budget — sert la
 * note « L'écart se creuse depuis le … ». `null` si l'écart ne dépasse
 * jamais ce seuil (trajectoire globalement tenue).
 */
export function premierJourDecrochage(points: PointBudget[], totalBudget: number): string | null {
  const seuil = totalBudget * 0.02
  for (const p of points) {
    if (Math.abs(p.reel - p.ideal) >= seuil) return p.date
  }
  return null
}

function GraphiqueBudget({ points, totalBudget }: { points: PointBudget[]; totalBudget: number }) {
  const W = 480
  const H = 190
  const pad = { l: 50, r: 8, t: 10, b: 24 }
  const maxVal = Math.max(totalBudget, ...points.map((p) => Math.max(p.ideal, p.reel)), 1)

  const x = (i: number) => pad.l + (points.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (points.length - 1))
  const y = (v: number) => H - pad.b - (v / maxVal) * (H - pad.t - pad.b)

  const chemin = (cle: 'ideal' | 'reel') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p[cle]).toFixed(1)}`).join(' ')

  const paliers = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxVal * f))
  const decrochage = premierJourDecrochage(points, totalBudget)
  const decrochageLisible = decrochage ? formaterJourMois(decrochage) : null

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Budget cumulé réel comparé à la trajectoire idéale"
        style={{ width: '100%', height: 'auto' }}
      >
        {paliers.map((v) => (
          <g key={v}>
            <line x1={pad.l} y1={y(v)} x2={W - pad.r} y2={y(v)} stroke="var(--border-subtle)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-tertiary)">
              {formaterNombreAbrege(v)} €
            </text>
          </g>
        ))}
        <path d={chemin('ideal')} fill="none" stroke="var(--text-tertiary)" strokeWidth={1.5} strokeDasharray="5 4" />
        <path d={chemin('reel')} fill="none" stroke="var(--brand-teal)" strokeWidth={2.2} />
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
          <i aria-hidden style={{ width: 14, height: 0, borderTop: '2px dashed var(--text-tertiary)' }} />
          Trajectoire idéale
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
          <i aria-hidden style={{ width: 14, height: 2, background: 'var(--brand-teal)' }} />
          Budget réel
        </span>
      </div>
      {decrochageLisible && (
        <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 8 }}>
          L&rsquo;écart se creuse depuis le {decrochageLisible}.
        </p>
      )}
    </div>
  )
}

export function DetailTechnique({ campaignId }: { campaignId: string }) {
  const [suivi, setSuivi] = useState<SuiviPayload | null>(null)
  const [recon, setRecon] = useState<ReconciliationPayload | null>(null)
  const [charge, setCharge] = useState(false)
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)
  const dejaDeclenche = useRef(false)

  // `dejaDeclenche` est un verrou « une seule fois », pas « une seule fois par
  // campagne » : sans cette remise à zéro, ouvrir le détail sur la campagne A,
  // le replier, changer de campagne dans la barre de contexte puis le rouvrir
  // affichait la réconciliation DSP et la trajectoire budget de A sous le
  // titre de B. Le composant est monté SANS `key` par `SuiviV2` — on ne
  // compte donc pas sur un remount pour remettre l'état à plat.
  useEffect(() => {
    dejaDeclenche.current = false
    setSuivi(null)
    setRecon(null)
    setCharge(false)
    setChargement(false)
    setErreur(null)
  }, [campaignId])

  const chargerRecon = useCallback(async () => {
    try {
      const res = await avecSemaphore(
        () => adminFetch(`/api/digital/${campaignId}/reconcile`, { cache: 'no-store' }),
      )
      if (res.ok) setRecon((await res.json()) as ReconciliationPayload)
    } catch { /* le panneau affiche l'état vide */ }
  }, [campaignId])

  const chargerTout = useCallback(async () => {
    if (dejaDeclenche.current) return
    dejaDeclenche.current = true
    setChargement(true)
    setErreur(null)
    try {
      // Sémaphore PARTAGÉ de l'écran de suivi (budget CLAUDE.md : 3 appels
      // Supabase simultanés) — le cœur de `SuiviV2` en a déjà trois en vol au
      // même instant.
      const rSuivi = await avecSemaphore(
        () => adminFetch(`/api/digital/${campaignId}/suivi`, { cache: 'no-store' }),
      )
      if (rSuivi.ok) setSuivi((await rSuivi.json()) as SuiviPayload)
      await chargerRecon()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setChargement(false)
      setCharge(true)
    }
  }, [campaignId, chargerRecon])

  const handlePull = useCallback(async () => {
    if (pulling) return
    setPulling(true)
    try {
      await adminFetch(`/api/digital/${campaignId}/reconcile/pull`, { method: 'POST' })
      await chargerRecon()
    } finally {
      setPulling(false)
    }
  }, [campaignId, pulling, chargerRecon])

  const points = suivi
    ? trajectoireBudget(suivi.daily, suivi.pacing.total_budget, suivi.start_date, suivi.end_date)
    : null

  return (
    <details
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void chargerTout()
      }}
    >
      <summary style={{
        cursor: 'pointer', fontFamily: fInter, fontSize: 13.5, fontWeight: 500,
        color: 'var(--text-primary)', padding: '10px 0', userSelect: 'none',
      }}>
        Détail technique
      </summary>

      <div style={{ paddingTop: 16, paddingBottom: 24 }}>
        {!charge && chargement && (
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Chargement…</p>
        )}

        {erreur && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>{erreur}</p>
        )}

        {charge && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 28 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 10px' }}>
                Budget cumulé contre trajectoire idéale
              </h3>
              {points && suivi?.pacing.total_budget != null ? (
                <GraphiqueBudget points={points} totalBudget={suivi.pacing.total_budget} />
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                  Pas assez de données pour tracer une trajectoire.
                </p>
              )}
            </div>

            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 10px' }}>
                Réconciliation DSP et ad server
              </h3>
              <ReconciliationPanel
                payload={recon}
                onPull={() => { void handlePull() }}
                pulling={pulling}
                canPull
              />
            </div>
          </div>
        )}
      </div>
    </details>
  )
}
