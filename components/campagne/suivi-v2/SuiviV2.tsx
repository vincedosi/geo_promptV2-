'use client';

/**
 * SuiviV2 — assemblage de l'écran de suivi (Tâche 15, spec §2). Orchestre les
 * onze blocs livrés par les Tâches 9 à 14 (tous props-drivés, aucun ne fetch
 * pour lui-même) dans l'ordre EXACT de la spec :
 *
 *   BarreContexteCampagne → BarreMaille → rangée 1 (ScoreAlignement |
 *   BandeauAvancement) → rangée 2 (GraphiqueEcart | TrioCartes) →
 *   TroisComposantes → ConstatsCorrection → CoutEtRythme → TableauDeregles →
 *   QuiADiffuse → DetailTechnique.
 *
 * ── Au plus 3 appels Supabase en parallèle (CLAUDE.md) ──────────────────────
 * `alignement`, `alignement/maille` et `/suivi` (route KEPT) partent
 * ENSEMBLE au montage et à chaque changement de maille/parent — exactement 3,
 * un seul `Promise.all`. Tout le reste part APRÈS et SEULEMENT quand visible
 * (IntersectionObserver, `useEnVue` ci-dessous), jamais au montage :
 *  - `alignement/maille/map` + `/api/cibles/indicators` (TrioCartes) — gagnés
 *    par la visibilité de la rangée 2 ;
 *  - `alignement/dispersion` (GraphiqueEcart en maille CP uniquement) — même
 *    déclencheur ;
 *  - `alignement/constats` (ConstatsCorrection) — sa propre section ;
 *  - `/actors` (QuiADiffuse) — sa propre section.
 * `reconcile` n'est PAS refetché ici : `DetailTechnique` s'auto-fetch déjà
 * (repli `<details onToggle>`, Tâche 14) — un second appel ferait double
 * emploi avec un composant qui gère déjà sa propre paresse, plus stricte
 * (ouverture explicite) que la visibilité seule.
 *
 * ── Chargement sans écran blanc ──────────────────────────────────────────
 * Tant qu'aucune donnée n'a jamais été chargée, un message de chargement
 * s'affiche (rien à estomper). Une fois une première charge réussie, tout
 * rechargement (changement de maille, drill-down, actualisation périodique)
 * baisse l'opacité du corps à 0,55 et affiche « Actualisation… » — les
 * chiffres restent VISIBLES et corrects jusqu'à l'arrivée des nouveaux.
 * Un échec de rechargement (campagne toujours là, réseau capricieux) laisse
 * les données précédentes en place avec une note discrète ; seul un échec au
 * TOUT PREMIER chargement bascule vers l'état "campagne indisponible".
 *
 * ── Deux coutures signalées par les tâches précédentes ───────────────────
 * 1. `session.campaignId` n'avait aucun écrivain avant cette tâche : le
 *    sélecteur de `BarreContexteCampagne` l'est désormais. Ce composant ne
 *    fait que SEMER la session depuis son prop `campaignId` (compat avec le
 *    sélecteur historique de `MagelianOverlay`, encore utilisé par l'onglet
 *    Aperçu) puis lit `session.campaignId` comme source de vérité — un
 *    changement de campagne depuis la barre met donc à jour tout l'écran
 *    sans jamais nécessiter un remount.
 * 2. `code`/`nom` sont `string | null` côté `alignement/maille` mais typés
 *    non-nullables par `TableauDeregles` (relecture Tâche 14) : coercés à la
 *    frontière (`?? ''`), jamais en élargissant le contrat du composant.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useCampagneSession } from '@/lib/campagne/CampagneSessionContext';
import { useMagelianOverlay } from '@/components/magelian/MagelianOverlayContext';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { formaterNombre } from '@/lib/format/nombre';
import { BarreContexteCampagne } from '../BarreContexteCampagne';
import { BarreMaille } from './BarreMaille';
import { ScoreAlignement, type ReponseAlignement } from './ScoreAlignement';
import { BandeauAvancement, type DonneesAvancement } from './BandeauAvancement';
import { GraphiqueEcart } from './GraphiqueEcart';
import { TrioCartes, type IndicateurOption, type VariableActive } from './TrioCartes';
import { TroisComposantes } from './TroisComposantes';
import { ConstatsCorrection } from './ConstatsCorrection';
import { CoutEtRythme, type DonneesCoutEtRythme } from './CoutEtRythme';
import { TableauDeregles, type UniteMaille as UniteAffichee } from './TableauDeregles';
import { QuiADiffuse } from './QuiADiffuse';
import { DetailTechnique } from './DetailTechnique';
import type { Constat } from '@/lib/campagne/constats';
import type { ActorRow } from '@/lib/campaigns/actor-metrics';
import type { UniteAlignement, TrancheDispersion } from '@/lib/campagne/graphique-ecart';
import type { FeatureAlignementGeo, ReponseAlignementMailleGeo } from '@/lib/campagne/vignette-carte';
import type { SuiviPayload } from '@/lib/campaigns/suivi-metrics';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

/** Déclenche `visible=true` une fois l'élément entré dans le viewport (+200px
 *  de marge) puis se désactive — jamais de re-fetch en boucle au scroll. */
function useEnVue<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);
  return [ref, visible];
}

function EtatVide({ titre, message }: { titre: string; message: string }) {
  return (
    <div style={{
      background: 'var(--bg-level-1)', border: '0.5px solid var(--border-subtle)',
      borderRadius: 8, padding: '32px 24px', textAlign: 'center', marginTop: 16,
    }}>
      <p style={{ fontFamily: fInter, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 6px' }}>
        {titre}
      </p>
      <p style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.5 }}>
        {message}
      </p>
    </div>
  );
}

function Section({ innerRef, children }: { innerRef?: RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  return (
    <section ref={innerRef} style={{ paddingTop: 22, borderTop: '0.5px solid var(--border-subtle)' }}>
      {children}
    </section>
  );
}

async function corpsErreur(res: Response): Promise<string | null> {
  try { return ((await res.json()) as { error?: string })?.error ?? null; } catch { return null; }
}

export function SuiviV2({ campaignId: campaignIdProp }: { campaignId: string }) {
  const { session, majSession, basculerVue } = useCampagneSession();
  const { open: overlayOpen, requestClose } = useMagelianOverlay();
  const { theme } = useTheme();

  // Sème la session au premier montage si elle ne porte encore aucune
  // campagne (prop = sélection historique de l'overlay, Tâche 9) — ensuite
  // `session.campaignId` fait autorité (BarreContexteCampagne = seul écrivain).
  useEffect(() => {
    if (!session.campaignId && campaignIdProp) majSession({ campaignId: campaignIdProp });
  }, [campaignIdProp, session.campaignId, majSession]);

  const campaignId = session.campaignId ?? campaignIdProp;

  // ── Vague 1 : alignement + alignement/maille + suivi (≤3 en parallèle) ──
  const [alignement, setAlignement] = useState<ReponseAlignement | null>(null);
  const [maille, setMaille] = useState<{ unites: UniteAlignement[]; nTotal: number } | null>(null);
  const [suivi, setSuivi] = useState<SuiviPayload | null>(null);
  const [chargement, setChargement] = useState(false);
  const [chargeUneFois, setChargeUneFois] = useState(false);
  const [erreurEcran, setErreurEcran] = useState<string | null>(null);
  const nomsConnusRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!campaignId) return;
    let annule = false;
    setChargement(true);
    (async () => {
      const qs = new URLSearchParams({ maille: session.maille });
      if (session.parent) qs.set('parent', session.parent);
      try {
        const [rAlign, rMaille, rSuivi] = await Promise.all([
          adminFetch(`/api/campaigns/${campaignId}/alignement`, { cache: 'no-store' }),
          adminFetch(`/api/campaigns/${campaignId}/alignement/maille?${qs}`, { cache: 'no-store' }),
          adminFetch(`/api/digital/${campaignId}/suivi`, { cache: 'no-store' }),
        ]);
        if (annule) return;
        const echec = [rAlign, rMaille, rSuivi].find((r) => !r.ok);
        if (echec) {
          setErreurEcran((await corpsErreur(echec)) ?? 'Cette campagne n’est pas consultable pour le moment.');
          return; // les données déjà en place (le cas échéant) restent affichées
        }
        const [dAlign, dMaille, dSuivi] = await Promise.all([
          rAlign.json() as Promise<ReponseAlignement>,
          rMaille.json() as Promise<{ unites?: UniteAlignement[]; n_total?: number }>,
          rSuivi.json() as Promise<SuiviPayload>,
        ]);
        if (annule) return;
        for (const u of dMaille.unites ?? []) {
          if (u.code && u.nom) nomsConnusRef.current.set(u.code, u.nom);
        }
        setAlignement(dAlign);
        setMaille({ unites: dMaille.unites ?? [], nTotal: dMaille.n_total ?? 0 });
        setSuivi(dSuivi);
        setErreurEcran(null);
      } catch (e) {
        if (!annule) setErreurEcran(e instanceof Error ? e.message : 'Erreur réseau.');
      } finally {
        if (!annule) { setChargement(false); setChargeUneFois(true); }
      }
    })();
    return () => { annule = true; };
  }, [campaignId, session.maille, session.parent]);

  // ── Rangée 2 : TrioCartes (alignement/maille/map + indicateurs) ─────────
  const [row2Ref, row2Visible] = useEnVue<HTMLDivElement>();
  const [mapFeatures, setMapFeatures] = useState<FeatureAlignementGeo[]>([]);
  const [mapVariableCode, setMapVariableCode] = useState<string | null>(null);
  const [indicateurChoisi, setIndicateurChoisi] = useState<string | null>(null);
  const [indicateurs, setIndicateurs] = useState<IndicateurOption[]>([]);
  const [mapChargement, setMapChargement] = useState(false);
  const [mapChargeUneFois, setMapChargeUneFois] = useState(false);
  const [mapErreur, setMapErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!row2Visible || !campaignId) return;
    let annule = false;
    setMapChargement(true);
    (async () => {
      const qs = new URLSearchParams({ maille: session.maille });
      if (session.parent) qs.set('parent', session.parent);
      if (indicateurChoisi) qs.set('variable', indicateurChoisi);
      const appels: Promise<Response>[] = [
        adminFetch(`/api/campaigns/${campaignId}/alignement/maille/map?${qs}`, { cache: 'no-store' }),
      ];
      if (indicateurs.length === 0) appels.push(adminFetch('/api/cibles/indicators', { cache: 'no-store' }));
      try {
        const [rMap, rInd] = await Promise.all(appels);
        if (annule) return;
        if (rMap.ok) {
          const d = await rMap.json() as ReponseAlignementMailleGeo;
          setMapFeatures(d.features ?? []);
          setMapVariableCode(d.variable_code ?? null);
          setMapErreur(null);
        } else {
          setMapErreur((await corpsErreur(rMap)) ?? 'Impossible de charger les cartes.');
        }
        if (rInd?.ok) {
          const d = await rInd.json() as { indicators?: { indicator_code: string; label: string }[] };
          setIndicateurs((d.indicators ?? []).map((i) => ({ indicator_code: i.indicator_code, label: i.label })));
        }
      } catch {
        if (!annule) setMapErreur('Erreur réseau.');
      } finally {
        if (!annule) { setMapChargement(false); setMapChargeUneFois(true); }
      }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `indicateurs.length` sert de garde « déjà chargé », pas une dépendance de re-fetch
  }, [row2Visible, campaignId, session.maille, session.parent, indicateurChoisi]);

  const variableActive: VariableActive = useMemo(() => {
    const code = mapVariableCode ?? indicateurChoisi ?? '';
    const label = indicateurs.find((i) => i.indicator_code === code)?.label ?? code;
    return { code, label };
  }, [mapVariableCode, indicateurChoisi, indicateurs]);

  // ── Dispersion (maille CP uniquement) — même déclencheur que la rangée 2 ─
  const [tranches, setTranches] = useState<TrancheDispersion[] | null>(null);
  useEffect(() => {
    if (!row2Visible || !campaignId || session.maille !== 'cp') return;
    let annule = false;
    (async () => {
      const qs = new URLSearchParams();
      if (session.parent) qs.set('parent', session.parent);
      try {
        const res = await adminFetch(`/api/campaigns/${campaignId}/alignement/dispersion?${qs}`, { cache: 'no-store' });
        if (res.ok && !annule) {
          const d = await res.json() as { tranches?: TrancheDispersion[] };
          setTranches(d.tranches ?? []);
        }
      } catch { /* la dispersion précédente (le cas échéant) reste affichée */ }
    })();
    return () => { annule = true; };
  }, [row2Visible, campaignId, session.maille, session.parent]);

  // ── Ce qu'il faut corriger ────────────────────────────────────────────
  const [constatsRef, constatsVisible] = useEnVue<HTMLDivElement>();
  const [constats, setConstats] = useState<Constat[]>([]);
  useEffect(() => {
    if (!constatsVisible || !campaignId) return;
    let annule = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/campaigns/${campaignId}/alignement/constats`, { cache: 'no-store' });
        if (res.ok && !annule) {
          const d = await res.json() as { constats?: Constat[] };
          setConstats(d.constats ?? []);
        }
      } catch { /* les constats précédents (le cas échéant) restent affichés */ }
    })();
    return () => { annule = true; };
  }, [constatsVisible, campaignId]);

  // ── Qui a diffusé ─────────────────────────────────────────────────────
  const [actorsRef, actorsVisible] = useEnVue<HTMLDivElement>();
  const [canaux, setCanaux] = useState<ActorRow[]>([]);
  useEffect(() => {
    if (!actorsVisible || !campaignId) return;
    let annule = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/digital/${campaignId}/actors`, { cache: 'no-store' });
        if (res.ok && !annule) {
          const d = await res.json() as { actors?: ActorRow[] };
          setCanaux(d.actors ?? []);
        }
      } catch { /* les canaux précédents (le cas échéant) restent affichés */ }
    })();
    return () => { annule = true; };
  }, [actorsVisible, campaignId]);

  // ── « Voir tout » du tableau déréglés — chargé à la demande (Tâche 14) ──
  const [uniteEtendues, setUniteEtendues] = useState<UniteAlignement[] | null>(null);
  const [etenduChargement, setEtenduChargement] = useState(false);
  const handleVoirTout = useCallback(() => {
    if (!campaignId) return;
    setEtenduChargement(true);
    (async () => {
      const qs = new URLSearchParams({ maille: session.maille, limite: '500' });
      if (session.parent) qs.set('parent', session.parent);
      try {
        const res = await adminFetch(`/api/campaigns/${campaignId}/alignement/maille?${qs}`, { cache: 'no-store' });
        if (res.ok) {
          const d = await res.json() as { unites?: UniteAlignement[] };
          setUniteEtendues(d.unites ?? []);
        }
      } finally {
        setEtenduChargement(false);
      }
    })();
  }, [campaignId, session.maille, session.parent]);
  // Une nouvelle maille/un nouveau drill-down invalide la liste étendue —
  // sans quoi « Voir tout » resterait ouvert sur le grain précédent.
  useEffect(() => { setUniteEtendues(null); }, [session.maille, session.parent, campaignId]);

  // ── Bascule vue + fermeture de l'overlay (même raisonnement que
  //    BarreContexteCampagne : changer `vue` sans fermer l'overlay laisse la
  //    carte cachée derrière le panneau plein écran) ───────────────────────
  const irVersCarte = useCallback((uniteCode?: string | null) => {
    if (uniteCode) majSession({ uniteSelectionnee: uniteCode });
    if (session.vue !== 'carte') basculerVue();
    if (overlayOpen) requestClose();
  }, [session.vue, majSession, basculerVue, overlayOpen, requestClose]);

  const handleActionConstat = useCallback((c: Constat) => {
    if (c.id === 'canal_cher') {
      actorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    irVersCarte(c.cible);
  }, [irVersCarte, actorsRef]);

  const unitesAffichees: UniteAffichee[] = useMemo(() => (maille?.unites ?? []).map((u) => ({
    code: u.code ?? '',
    nom: u.nom ?? u.code ?? '',
    ecart_pct: u.ecart_pct,
    impressions: u.impressions,
    cpm: u.cpm,
    spend: u.spend ?? 0,
    plan: u.plan,
    hors_plan: u.hors_plan,
  })), [maille]);

  const donneesAvancement: DonneesAvancement | null = useMemo(() => (
    suivi ? { as_of: suivi.as_of, end_date: suivi.end_date, pacing: suivi.pacing, objective: suivi.objective } : null
  ), [suivi]);

  const donneesCoutEtRythme: DonneesCoutEtRythme | null = useMemo(() => (
    suivi && alignement
      ? {
          pacing: { total_budget: suivi.pacing.total_budget, time_pct: suivi.pacing.time_pct },
          cpm: suivi.cpm, objective: suivi.objective, sur_pression_eur: alignement.sur_pression_eur,
        }
      : null
  ), [suivi, alignement]);

  const nomParent = session.parent ? (nomsConnusRef.current.get(session.parent) ?? session.parent) : null;

  // ── États d'écran ────────────────────────────────────────────────────
  if (!campaignId) {
    return (
      <div>
        <BarreContexteCampagne />
        <EtatVide
          titre="Aucune campagne sélectionnée"
          message="Choisis une campagne dans la barre ci-dessus pour afficher son suivi."
        />
      </div>
    );
  }

  if (erreurEcran && !alignement) {
    return (
      <div>
        <BarreContexteCampagne />
        <EtatVide titre="Cette campagne n’est pas consultable" message={`${erreurEcran} Choisis-en une autre dans la barre ci-dessus.`} />
      </div>
    );
  }

  return (
    <div>
      <BarreContexteCampagne />

      {!chargeUneFois ? (
        <p style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
          Chargement du suivi…
        </p>
      ) : (
        <div style={{ position: 'relative' }}>
          {chargement && (
            <span
              aria-live="polite"
              style={{
                position: 'absolute', top: -20, right: 0, fontFamily: fMono, fontSize: 11,
                color: 'var(--text-tertiary)',
              }}
            >
              Actualisation…
            </span>
          )}
          {erreurEcran && (
            <p role="alert" style={{ fontFamily: fInter, fontSize: 12, color: 'var(--warning)', margin: '0 0 10px' }}>
              La dernière actualisation a échoué — les chiffres affichés datent d’avant.
            </p>
          )}

          <div style={{ opacity: chargement ? 0.55 : 1, transition: 'opacity 0.15s', display: 'flex', flexDirection: 'column', gap: 22 }}>
            <BarreMaille nUnites={maille?.unites.length ?? 0} nTotal={maille?.nTotal ?? 0} nomParent={nomParent} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
              <div style={{ flex: '1 1 380px', minWidth: 300 }}>
                {alignement ? <ScoreAlignement data={alignement} /> : null}
              </div>
              <div style={{ flex: '1 1 420px', minWidth: 300 }}>
                {donneesAvancement ? <BandeauAvancement data={donneesAvancement} /> : null}
              </div>
            </div>

            <div ref={row2Ref} style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
              <div style={{ flex: '2 1 480px', minWidth: 300 }}>
                <GraphiqueEcart maille={session.maille} unites={maille?.unites ?? null} tranches={tranches} />
              </div>
              <div style={{ flex: '1 1 320px', minWidth: 260 }}>
                {/* Monté seulement après la PREMIÈRE résolution du fetch
                    (succès ou échec) — jamais avec `features=[]` au tout
                    premier rendu : `bornesQuantiles([], …)` rend un tableau
                    de bornes VIDE, et `expressionEtapes` construit alors un
                    `step` MapLibre à 0 palier, que MapLibre rejette
                    (« Expected at least 4 arguments, but found only 2 »,
                    constaté à l'écran). Défaut latent de
                    `lib/campagne/vignette-carte.ts` (Tâche 13), jamais
                    exercé avant cet assemblage — contourné ici côté appelant
                    plutôt que corrigé dans un fichier hors périmètre de
                    cette tâche ; signalé au rapport. */}
                {mapChargeUneFois ? (
                  <TrioCartes
                    features={mapFeatures}
                    theme={theme}
                    chargement={mapChargement}
                    erreur={mapErreur}
                    variableActive={variableActive}
                    indicateursDisponibles={indicateurs}
                    onChangeIndicateur={setIndicateurChoisi}
                    onOuvrir={() => irVersCarte(null)}
                  />
                ) : (
                  <p style={{ fontFamily: fInter, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                    Chargement des cartes…
                  </p>
                )}
              </div>
            </div>

            {alignement && <TroisComposantes data={alignement} />}

            <Section innerRef={constatsRef}>
              <ConstatsCorrection constats={constats} onAction={handleActionConstat} />
            </Section>

            {donneesCoutEtRythme && (
              <Section>
                <CoutEtRythme data={donneesCoutEtRythme} />
              </Section>
            )}

            <Section>
              <TableauDeregles unites={unitesAffichees} nTotal={maille?.nTotal} onVoirTout={handleVoirTout} />
              {etenduChargement && (
                <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>Chargement…</p>
              )}
              {uniteEtendues && (
                <div style={{
                  marginTop: 12, maxHeight: 320, overflowY: 'auto',
                  border: '0.5px solid var(--border-subtle)', borderRadius: 8,
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {[...uniteEtendues]
                        .sort((a, b) => Math.abs(b.impressions - (b.plan ?? 0)) - Math.abs(a.impressions - (a.plan ?? 0)))
                        .map((u) => (
                          <tr key={u.code ?? u.nom} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '7px 10px', fontFamily: fInter, fontSize: 12.5, color: 'var(--text-primary)' }}>
                              <b style={{ fontWeight: 500 }}>{u.code ?? '—'}</b>{' '}
                              <span style={{ color: 'var(--text-tertiary)' }}>{u.nom ?? ''}</span>
                            </td>
                            <td style={{ padding: '7px 10px', fontFamily: fMono, fontSize: 12, textAlign: 'right', color: 'var(--text-secondary)' }}>
                              {u.hors_plan || u.ecart_pct == null ? 'hors plan' : `${u.ecart_pct > 0 ? '+' : ''}${formaterNombre(u.ecart_pct)} %`}
                            </td>
                            <td style={{ padding: '7px 10px', fontFamily: fMono, fontSize: 12, textAlign: 'right', color: 'var(--text-secondary)' }}>
                              {formaterNombre(u.impressions)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section innerRef={actorsRef}>
              <QuiADiffuse canaux={canaux} cpmMoyen={suivi?.cpm.real ?? null} />
            </Section>

            <Section>
              <DetailTechnique campaignId={campaignId} />
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
