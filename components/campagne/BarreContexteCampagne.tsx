'use client';

/**
 * BarreContexteCampagne — la barre de contexte COMMUNE aux deux vues de
 * Suivi V2 (Tâche 15, spec §2) : campagne, DSP, période, score d'alignement,
 * bascule. Montée à deux endroits distincts avec le MÊME composant :
 *  - `app/map/page.tsx`, en vue carte (`session.vue === 'carte'`) — seule
 *    présence de la barre quand l'overlay MAGELIAN est fermé ;
 *  - `SuiviV2.tsx`, en tête de l'écran de suivi (overlay ouvert, onglet Suivi).
 *
 * Le sélecteur de campagne EST le premier écrivain de `session.campaignId`
 * (lacune signalée par la Tâche 13B) : `appliquerChangementCampagne`
 * (`lib/campagne/transitions.ts`, testée) conserve la vue et la maille mais
 * efface le fil d'Ariane et la sélection, qui désignent des codes sans
 * garantie d'exister dans la nouvelle campagne.
 *
 * Interface volontairement SANS PROPS (contrat Tâche 15 : `<BarreContexteCampagne />`)
 * — la barre lit `useCampagneSession()` directement et se fetch elle-même :
 *  - la liste des campagnes (`/api/digital/campaigns`, scope org, léger —
 *    PAS `/api/admin/campaigns`, réservé au super_admin alors que Suivi V2
 *    est ouvert à tous les rôles sur leur propre org) ;
 *  - le score d'alignement de la campagne courante (`/api/campaigns/[id]/alignement`).
 *
 * Duplication ASSUMÉE avec `SuiviV2` : quand la barre est montée à l'intérieur
 * de l'écran de suivi, celui-ci fetch aussi `/alignement` pour ses propres
 * panneaux (ScoreAlignement, TroisComposantes). Deux appels concurrents à la
 * même route plutôt qu'un fil de props à faire traverser un composant qui,
 * par contrat, n'en prend aucun — `calculer_alignement_geo` n'est pas un scan
 * de table volumineuse (contrairement aux RPC carreaux/IRIS visées par la
 * règle des 3 appels parallèles, qui borne l'orchestration PROPRE de
 * `SuiviV2`). Signalé au rapport de la Tâche 15, pas contourné par une
 * dépendance croisée entre les deux composants.
 *
 * Chargement sans écran blanc : le score affiché reste visible (opacité
 * réduite + indicateur discret) pendant un rechargement — jamais remplacé
 * par un tiret le temps de la requête suivante.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useCampagneSession } from '@/lib/campagne/CampagneSessionContext';
import { useMagelianOverlay } from '@/components/magelian/MagelianOverlayContext';
import { appliquerChangementCampagne } from '@/lib/campagne/transitions';
import type { VueCampagne } from '@/lib/campagne/session-types';
import type { ReponseAlignement } from './suivi-v2/ScoreAlignement';
import { formaterNombre } from '@/lib/format/nombre';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface CampagneListItem {
  id: string;
  name: string;
  dsp_source: string | null;
  date_start: string | null;
  date_end: string | null;
}

/** « 1 avril – 30 avril 2026 » — `null` sans aucune borne exploitable. Logique
 *  pure, testable sans DOM (pas de test dédié demandé par le brief). */
export function libellePeriode(debut: string | null, fin: string | null): string | null {
  const fmt = (iso: string): string | null => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  };
  const d1 = debut ? fmt(debut) : null;
  const d2 = fin ? fmt(fin) : null;
  if (d1 && d2) return `${d1} – ${d2}`;
  return d1 ?? d2;
}

const boutonVueStyle = (actif: boolean): CSSProperties => ({
  border: 0, background: actif ? 'var(--bg-level-1)' : 'transparent',
  color: actif ? 'var(--text-primary)' : 'var(--text-tertiary)',
  borderRadius: 6, padding: '6px 12px', fontFamily: fInter, fontWeight: 500, fontSize: 12.5,
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
  boxShadow: actif ? '0 1px 2px rgba(0,0,0,0.15)' : 'none',
});

export function BarreContexteCampagne() {
  const { session, majSession, basculerVue } = useCampagneSession();
  const { open: overlayOpen, openOverlay, requestClose } = useMagelianOverlay();

  const [campagnes, setCampagnes] = useState<CampagneListItem[] | null>(null);

  // Un seul fetch, au montage — SANS garde « déjà chargé » combinée à
  // l'annulation par nettoyage : sous React Strict Mode (dev), l'effet est
  // monté-démonté-remonté ; une garde posée par le PREMIER passage empêche
  // le SECOND (celui qui survit) de refetcher, alors que le résultat du
  // premier est justement annulé par son propre nettoyage — `campagnes`
  // resterait bloqué sur « Chargement… » indéfiniment (constaté à l'écran).
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await adminFetch('/api/digital/campaigns', { cache: 'no-store' });
        const data = res.ok ? await res.json() : [];
        if (!annule) setCampagnes(Array.isArray(data) ? data as CampagneListItem[] : []);
      } catch {
        if (!annule) setCampagnes([]);
      }
    })();
    return () => { annule = true; };
  }, []);

  const [score, setScore] = useState<ReponseAlignement | null>(null);
  const [scoreChargement, setScoreChargement] = useState(false);

  useEffect(() => {
    const id = session.campaignId;
    if (!id) { setScore(null); return; }
    let annule = false;
    setScoreChargement(true);
    (async () => {
      try {
        const res = await adminFetch(`/api/campaigns/${id}/alignement`, { cache: 'no-store' });
        // Sur échec, le score précédent reste affiché (dimmed) — jamais
        // effacé par une requête qui rate : voir l'en-tête du fichier.
        if (res.ok && !annule) setScore(await res.json() as ReponseAlignement);
      } catch { /* le score précédent reste affiché */ }
      finally { if (!annule) setScoreChargement(false); }
    })();
    return () => { annule = true; };
  }, [session.campaignId]);

  const handleChangeCampagne = useCallback((id: string) => {
    if (!id || id === session.campaignId) return;
    majSession(appliquerChangementCampagne(session, id));
  }, [session, majSession]);

  // La bascule change TOUJOURS la vue (session, testée par transitions.ts) ;
  // elle pilote EN PLUS la visibilité de l'overlay MAGELIAN, seul moyen de
  // faire correspondre ce que l'utilisateur voit à la vue choisie — sans ça,
  // choisir « Diffusion » depuis l'intérieur de l'overlay change `vue` sans
  // jamais révéler la carte, restée cachée derrière le panneau (z-index
  // supérieur). Toujours `requestClose` (jamais `closeOverlay`), même chemin
  // animé qu'Échap et le bouton Fermer (round de correction 1, MagelianOverlay).
  const handleToggleVue = useCallback((cible: VueCampagne) => {
    if (session.vue === cible) return;
    basculerVue();
    if (cible === 'carte' && overlayOpen) requestClose();
    else if (cible === 'suivi' && !overlayOpen) {
      openOverlay({ campaignId: session.campaignId ?? undefined, tab: 'suivi' });
    }
  }, [session.vue, session.campaignId, basculerVue, overlayOpen, requestClose, openOverlay]);

  const courante = campagnes?.find((c) => c.id === session.campaignId) ?? null;
  const introuvable = campagnes !== null && session.campaignId !== null && !courante;
  const periode = courante ? libellePeriode(courante.date_start, courante.date_end) : null;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        padding: '10px 16px', background: 'var(--bg-level-2)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 320px' }}>
        <label htmlFor="barre-contexte-campagne" style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>
          Campagne
        </label>
        <select
          id="barre-contexte-campagne"
          value={session.campaignId ?? ''}
          onChange={(e) => handleChangeCampagne(e.target.value)}
          disabled={campagnes === null || campagnes.length === 0}
          style={{
            background: 'var(--bg-level-1)', border: '0.5px solid var(--border-subtle)',
            borderRadius: 6, padding: '7px 10px', fontFamily: fInter, fontSize: 13,
            color: 'var(--text-primary)', minWidth: 200, maxWidth: 320,
          }}
        >
          {campagnes === null && <option value="">Chargement…</option>}
          {campagnes !== null && campagnes.length === 0 && <option value="">Aucune campagne</option>}
          {campagnes !== null && campagnes.length > 0 && !session.campaignId && (
            <option value="">Choisir une campagne</option>
          )}
          {campagnes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {courante && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden' }}>
            {courante.dsp_source && (
              <span style={{
                fontFamily: fMono, fontSize: 10.5, color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '2px 7px',
                flexShrink: 0,
              }}>
                {courante.dsp_source}
              </span>
            )}
            {periode && (
              <span style={{ fontFamily: fInter, fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {periode}
              </span>
            )}
          </div>
        )}

        {introuvable && (
          <span role="alert" style={{ fontFamily: fInter, fontSize: 12, color: 'var(--danger)' }}>
            Cette campagne n&rsquo;est plus disponible — choisis-en une autre.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0, marginLeft: 'auto' }}>
        <div
          style={{
            display: 'flex', alignItems: 'baseline', gap: 6,
            opacity: scoreChargement ? 0.55 : 1, transition: 'opacity 0.15s',
          }}
        >
          <span style={{ fontFamily: fInter, fontSize: 11.5, color: 'var(--text-tertiary)' }}>Alignement</span>
          <b style={{ fontFamily: fMono, fontWeight: 600, fontSize: 16, color: 'var(--brand-teal)' }}>
            {score ? `${formaterNombre(score.score)}/100` : '—'}
          </b>
          {scoreChargement && (
            <span aria-hidden="true" style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
              actualisation…
            </span>
          )}
        </div>

        <div role="group" aria-label="Changer de vue" style={{
          display: 'flex', gap: 2, background: 'var(--bg-level-3)', borderRadius: 8, padding: 3,
        }}>
          <button type="button" aria-pressed={session.vue === 'suivi'} onClick={() => handleToggleVue('suivi')} style={boutonVueStyle(session.vue === 'suivi')}>
            Suivi
          </button>
          <button type="button" aria-pressed={session.vue === 'carte'} onClick={() => handleToggleVue('carte')} style={boutonVueStyle(session.vue === 'carte')}>
            Diffusion
          </button>
        </div>
      </div>
    </div>
  );
}
