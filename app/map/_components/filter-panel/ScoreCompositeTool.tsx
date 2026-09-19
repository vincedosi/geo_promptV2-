'use client';

/**
 * @file ScoreCompositeTool — outil « Score composite » du panneau Analyse
 * (Tâche 12, 2026-09-13).
 *
 * Répond à « où faut-il acheter ? » par un seul nombre 0-100 par code postal,
 * agrégeant plusieurs indicateurs INSEE de poids et de sens différents.
 *
 * **Le catalogue d'indicateurs vient de la base**, jamais d'une liste en dur :
 * `GET /api/cibles/indicators` lit `cible_indicator_registry`. C'est le
 * registre que `materialize_indicator_cp_values` consulte — le plan désignait
 * `iris_indicator_registry`, dont les codes auraient fait LEVER la
 * matérialisation.
 *
 * **Chargé au premier dépliage, jamais au montage** (cache `useRef`) : un
 * préchargement au chargement de /map est ce que CLAUDE.md interdit.
 *
 * Le lancement passe par `verifierPerimetre()` comme les cinq autres outils du
 * panneau — un score sans périmètre, c'est la France entière (6 187 CP).
 */
import { useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useSession } from '@/lib/auth-client';
import { C, fInter, fMono } from './tokens';
import { labelStyle, pill } from './styles';
import { formaterNombre } from '@/lib/format/nombre';
import type { FiltreActif } from '@/lib/carte/filtre';
import { SCORE_MAP_EVENT, type ScoreCP } from '../ScoreMapLayer';

/** Miroir de la réponse de `GET /api/cibles/indicators`. */
interface IndicateurRegistre {
  indicator_code: string;
  label: string;
  famille: string | null;
  unit: string | null;
}

/** Un indicateur retenu, avec son poids et son sens de lecture. */
interface IndicateurChoisi {
  code: string;
  label: string;
  poids: number;
  sens: 'croissant' | 'decroissant';
}

interface ResultatScore {
  scores: ScoreCP[];
  indicateurs: { code: string; label: string; calcule_le: string | null }[];
  perimetre: { n_codes_postaux: number; n_scores: number; n_complets: number };
}

const MAX_INDICATEURS = 6;

export interface ScoreCompositeToolProps {
  filtre: FiltreActif | null;
  /** Garde de périmètre du panneau Analyse (spec §5) — rend `false` si bloqué. */
  verifierPerimetre: () => boolean;
}

export function ScoreCompositeTool({ filtre, verifierPerimetre }: ScoreCompositeToolProps) {
  const { session } = useSession();
  const orgId = session?.user?.organizationId ?? '';

  const [ouvert, setOuvert] = useState(false);
  const [catalogue, setCatalogue] = useState<IndicateurRegistre[]>([]);
  const catalogueRef = useRef(false);
  const [chargementCatalogue, setChargementCatalogue] = useState(false);

  const [choisis, setChoisis] = useState<IndicateurChoisi[]>([]);
  const [calcul, setCalcul] = useState(false);
  const [resultat, setResultat] = useState<ResultatScore | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  /**
   * L'enregistrement dans « Mes analyses » est OPT-IN (défaut : non).
   *
   * La route enregistre par défaut, ce qui est le bon contrat côté API. Mais
   * cet outil se relance à chaque glissement de curseur : enregistrer chaque
   * fois remplissait la liste — bornée à 50 — en quelques minutes
   * d'exploration, chaque ligne portant jusqu'à 3 000 codes postaux en jsonb.
   * L'utilisateur dit donc explicitement quel lancement mérite d'être gardé.
   */
  const [enregistrer, setEnregistrer] = useState(false);

  const [seuil, setSeuil] = useState(70);
  const [creationZone, setCreationZone] = useState(false);
  const [messageZone, setMessageZone] = useState<string | null>(null);

  // ── Catalogue : au premier dépliage seulement ──────────────────────────
  const basculerOuvert = () => {
    const prochain = !ouvert;
    setOuvert(prochain);
    if (!prochain || catalogueRef.current) return;
    catalogueRef.current = true;
    setChargementCatalogue(true);
    adminFetch('/api/cibles/indicators')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setCatalogue(Array.isArray(data.indicators) ? data.indicators : []);
      })
      .catch(() => {
        setErreur('Catalogue d’indicateurs indisponible.');
        catalogueRef.current = false; // un nouveau dépliage retentera
      })
      .finally(() => setChargementCatalogue(false));
  };

  /**
   * Tout changement de paramètres PÉRIME le résultat affiché.
   *
   * Sans cela (défaut trouvé en relecture, 2026-09-13), l'écran affichait
   * « 42 codes postaux retenus » calculés avec les ANCIENS poids, pendant que
   * « Créer la zone » renvoyait au serveur les NOUVEAUX : la zone créée
   * n'était pas celle annoncée. Pire à l'ajout d'un indicateur — la zone
   * repartait de `resultat.scores`, donc d'un périmètre déjà restreint aux CP
   * du calcul précédent, et les bornes du nouvel indicateur se calculaient
   * sur ce sous-ensemble.
   */
  const perimerResultat = () => {
    setResultat(null);
    setMessageZone(null);
    // La carte ne doit pas continuer à peindre un score qui n'est plus celui
    // des réglages à l'écran.
    window.dispatchEvent(new CustomEvent(SCORE_MAP_EVENT, {
      detail: { scores: [], libelle: '', nIndicateurs: 0 },
    }));
  };

  const ajouter = (code: string) => {
    const meta = catalogue.find((i) => i.indicator_code === code);
    if (!meta || choisis.some((c) => c.code === code) || choisis.length >= MAX_INDICATEURS) return;
    setChoisis((prev) => [...prev, { code, label: meta.label, poids: 1, sens: 'croissant' }]);
    perimerResultat();
  };

  const retirer = (code: string) => {
    setChoisis((prev) => prev.filter((c) => c.code !== code));
    perimerResultat();
  };

  const modifier = (code: string, champ: Partial<IndicateurChoisi>) => {
    setChoisis((prev) => prev.map((c) => (c.code === code ? { ...c, ...champ } : c)));
    perimerResultat();
  };

  // ── Lancement ──────────────────────────────────────────────────────────
  const lancer = async () => {
    if (!choisis.length || calcul) return;
    if (!verifierPerimetre()) return;
    if (!filtre) return; // déjà couvert par la garde, mais le type l'exige

    setCalcul(true);
    setErreur(null);
    setMessageZone(null);
    try {
      const res = await adminFetch('/api/analyses/score', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indicateurs: choisis.map((c) => ({ code: c.code, poids: c.poids, sens: c.sens })),
          perimetre: { type: filtre.type, code: filtre.code },
          enregistrer,
          nom: `Score composite — ${filtre.label}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setResultat(data);

      // Allume la choroplèthe. L'exclusivité des dégradés est appliquée par
      // page.tsx, qui écoute le même événement (lib/carte/degrades.ts).
      window.dispatchEvent(new CustomEvent(SCORE_MAP_EVENT, {
        detail: {
          scores: data.scores,
          libelle: choisis.map((c) => c.label).join(' × '),
          nIndicateurs: choisis.length,
        },
      }));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setCalcul(false);
    }
  };

  // ── Zone au-dessus d'un seuil ──────────────────────────────────────────
  // NE PASSE PAS par /api/custom-geo/source/indicator-threshold (ce que le plan
  // prévoyait) : cette route-là sélectionne sur UN indicateur du registre et ne
  // sait pas exprimer « score composite ≥ 70 » — elle aurait construit une zone
  // sur un critère différent de celui affiché. Route sœur dédiée, qui recalcule
  // le score côté serveur plutôt que de faire confiance à une liste de CP
  // remontée par le client.
  const creerZone = async () => {
    if (!resultat || creationZone || !orgId) return;
    setCreationZone(true);
    setMessageZone(null);
    try {
      const geoRes = await adminFetch('/api/custom-geo/source/score', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indicateurs: choisis.map((c) => ({ code: c.code, poids: c.poids, sens: c.sens })),
          codes_postaux: resultat.scores.map((s) => s.code),
          seuil,
        }),
      });
      const geo = await geoRes.json();
      if (!geoRes.ok) {
        throw new Error(
          geo.error === 'empty_selection' ? 'Aucun code postal ne passe ce seuil.'
          : geo.error === 'selection_too_large' ? `Sélection trop large (${formaterNombre(geo.count)} CP). Remontez le seuil.`
          : `Erreur (${geoRes.status})`,
        );
      }
      const nom = `Score ≥ ${seuil} — ${choisis.map((c) => c.label).join(' × ')}`;
      const saveRes = await adminFetch('/api/custom-geo/save', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nom.slice(0, 200),
          source_type: 'score_composite',
          source_metadata: {
            indicateurs: choisis.map((c) => ({ code: c.code, poids: c.poids, sens: c.sens })),
            seuil,
            n_codes_postaux: geo.count,
          },
          geometry: geo.geometry,
          org_id: orgId,
        }),
      });
      if (!saveRes.ok) throw new Error('Sauvegarde de la zone échouée.');
      setMessageZone(`Zone créée — ${formaterNombre(geo.count)} codes postaux.`);
    } catch (e) {
      setMessageZone(e instanceof Error ? e.message : String(e));
    } finally {
      setCreationZone(false);
    }
  };

  const disponibles = catalogue.filter((i) => !choisis.some((c) => c.code === i.indicator_code));
  const auDessusDuSeuil = resultat?.scores.filter((s) => s.score >= seuil).length ?? 0;

  return (
    <div>
      <button
        onClick={basculerOuvert}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: 'var(--bg-level-2)',
          border: 'none', borderTop: '1px solid var(--border-subtle)',
          borderLeft: '2px solid rgba(78,205,196,0.25)',
          borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer',
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
          Score composite
        </span>
        <span style={{ color: C.textDim, fontSize: 10 }}>{ouvert ? '▲' : '▼'}</span>
      </button>

      {ouvert && (
        <div style={{ padding: 16, borderBottom: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>
            Combine plusieurs indicateurs en une note de 0 à 100 par code postal,
            sur le périmètre du filtre actif.
          </div>

          {/* Ajout d'un indicateur — catalogue lu en base */}
          <div>
            <div style={labelStyle}>Indicateurs ({choisis.length}/{MAX_INDICATEURS})</div>
            {chargementCatalogue ? (
              <div style={{ fontFamily: fMono, fontSize: 11, color: C.textDim }}>Chargement du catalogue…</div>
            ) : (
              <select
                value=""
                onChange={(e) => ajouter(e.target.value)}
                disabled={choisis.length >= MAX_INDICATEURS || !disponibles.length}
                style={{
                  width: '100%', background: C.bgInput, border: `0.5px solid ${C.border}`,
                  borderRadius: 6, padding: '8px 10px', fontFamily: fInter, fontSize: 12,
                  color: C.text, cursor: 'pointer',
                }}
              >
                <option value="">
                  {choisis.length >= MAX_INDICATEURS ? 'Maximum atteint' : 'Ajouter un indicateur…'}
                </option>
                {disponibles.map((i) => (
                  <option key={i.indicator_code} value={i.indicator_code}>
                    {i.famille ? `${i.famille} — ` : ''}{i.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Poids et sens de chaque indicateur retenu */}
          {choisis.map((c) => (
            <div key={c.code} style={{ background: C.bgInput, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: fInter, fontSize: 12, color: C.text, flex: 1 }}>{c.label}</span>
                <button
                  onClick={() => retirer(c.code)}
                  style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                  aria-label={`Retirer ${c.label}`}
                >×</button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, width: 42 }}>Poids</span>
                <input
                  type="range" min={0.1} max={3} step={0.1} value={c.poids}
                  onChange={(e) => modifier(c.code, { poids: Number(e.target.value) })}
                  style={{ flex: 1, accentColor: 'var(--brand-teal)' }}
                />
                <span style={{ fontFamily: fMono, fontSize: 11, color: C.textSec, width: 28, textAlign: 'right' }}>
                  {c.poids.toFixed(1)}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 5 }}>
                <button
                  style={{ ...pill(c.sens === 'croissant', 'var(--text-primary)'), flex: 1, textAlign: 'center' }}
                  onClick={() => modifier(c.code, { sens: 'croissant' })}
                >Haut = mieux</button>
                <button
                  style={{ ...pill(c.sens === 'decroissant', 'var(--text-primary)'), flex: 1, textAlign: 'center' }}
                  onClick={() => modifier(c.code, { sens: 'decroissant' })}
                >Bas = mieux</button>
              </div>
            </div>
          ))}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enregistrer}
              onChange={(e) => setEnregistrer(e.target.checked)}
              style={{ accentColor: 'var(--brand-teal)' }}
            />
            <span style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>
              Enregistrer dans « Mes analyses »
            </span>
          </label>

          <button
            onClick={lancer}
            disabled={!choisis.length || calcul}
            style={{
              background: 'transparent', border: '0.5px solid var(--brand-teal)',
              color: 'var(--brand-teal)', borderRadius: 6, padding: '8px 16px',
              fontFamily: fInter, fontSize: 12, fontWeight: 500,
              cursor: !choisis.length || calcul ? 'not-allowed' : 'pointer',
              opacity: !choisis.length || calcul ? 0.4 : 1,
            }}
          >
            {calcul ? 'Calcul…' : 'Calculer le score'}
          </button>

          {erreur && (
            <div style={{
              padding: '8px 10px', borderRadius: 4, background: C.redDim,
              border: `0.5px solid ${C.redBorder}`, color: C.red,
              fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
            }}>{erreur}</div>
          )}

          {resultat && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: fMono, fontSize: 11, color: C.textSec, lineHeight: 1.6 }}>
                {formaterNombre(resultat.perimetre.n_scores)} codes postaux scorés sur{' '}
                {formaterNombre(resultat.perimetre.n_codes_postaux)}
                {/* Un score calculé sur un sous-ensemble des indicateurs
                    demandés n'est pas comparable à un score complet. */}
                {resultat.perimetre.n_complets < resultat.perimetre.n_scores && (
                  <>
                    <br />
                    <span style={{ color: C.amber }}>
                      {formaterNombre(resultat.perimetre.n_scores - resultat.perimetre.n_complets)} partiels
                      {' '}(indicateur manquant sur ces CP)
                    </span>
                  </>
                )}
              </div>

              {/* Date de calcul des indicateurs — matérialisés à la demande,
                  ils peuvent dater de plusieurs semaines. */}
              <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, lineHeight: 1.6 }}>
                {resultat.indicateurs.map((i) => (
                  <div key={i.code}>
                    {i.label} · {i.calcule_le ? new Date(i.calcule_le).toLocaleDateString('fr-FR') : '—'}
                  </div>
                ))}
              </div>

              <div>
                <div style={labelStyle}>Créer une zone au-dessus d’un seuil</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input
                    type="range" min={0} max={100} step={5} value={seuil}
                    onChange={(e) => setSeuil(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--brand-teal)' }}
                  />
                  <span style={{ fontFamily: fMono, fontSize: 11, color: C.textSec, width: 28, textAlign: 'right' }}>
                    {seuil}
                  </span>
                </div>
                <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, marginBottom: 8 }}>
                  {formaterNombre(auDessusDuSeuil)} code{auDessusDuSeuil > 1 ? 's' : ''} postal{auDessusDuSeuil > 1 ? 'ux' : ''} retenu{auDessusDuSeuil > 1 ? 's' : ''}
                </div>
                <button
                  onClick={creerZone}
                  disabled={creationZone || !auDessusDuSeuil || !orgId}
                  style={{
                    width: '100%', background: 'transparent', border: `0.5px solid ${C.border}`,
                    color: C.textSec, borderRadius: 6, padding: '8px 16px',
                    fontFamily: fInter, fontSize: 12,
                    cursor: creationZone || !auDessusDuSeuil || !orgId ? 'not-allowed' : 'pointer',
                    opacity: creationZone || !auDessusDuSeuil || !orgId ? 0.4 : 1,
                  }}
                >
                  {creationZone ? 'Création…' : 'Créer la zone'}
                </button>
                {messageZone && (
                  <div style={{ marginTop: 8, fontFamily: fInter, fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>
                    {messageZone}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
