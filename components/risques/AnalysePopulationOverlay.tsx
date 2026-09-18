'use client';

/**
 * Overlay « Analyser la population à risque ».
 *
 * Un tableau croisé à trois axes, dans la grammaire de MAGELIAN :
 *
 *     CIBLE (qui je compte) × DIMENSION (où je regarde) × FILTRES (quel risque)
 *
 * La question qu'il permet de poser : « combien de 18-24 ans vivent en zone à
 * risque toxique dans le Rhône ? »
 *
 * ── TROIS NOMBRES QUI NE SE COMPORTENT PAS PAREIL ─────────────────────────
 *
 * L'écran les affiche côte à côte, et il doit dire lequel s'additionne :
 *
 *   population exposée  la somme des lignes ÉGALE le total. Un carreau de
 *                       200 m appartient à une seule unité.
 *   nombre de sites     NE s'additionne PAS. Un site dont la zone déborde sur
 *                       deux départements compte dans les deux.
 *   dont indicatifs     combien reposent sur un rayon CHOISI plutôt que sur
 *                       une servitude publiée par l'État.
 *
 * ── POURQUOI LE RAYON EST AFFICHÉ EN PERMANENCE ──────────────────────────
 *
 * Parce que tous les chiffres des sites sans PPRT en dépendent. Il est déduit
 * des 664 périmètres réels (moyenne de leurs rayons équivalents, 532 m), et
 * reste ajustable. Un rayon changé sans que l'écran le montre rendrait deux
 * lectures incomparables sans qu'on sache pourquoi.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre } from '@/lib/format/nombre';
import { empiler, depiler } from '@/lib/carte/pile-echap';
import { librellesDuType } from '@/lib/carte/palette-risques';
import type { TypeRisque } from '@/lib/carte/palette-risques';
import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from '@/lib/import/georisques/familles';
import { CarteMiniFrance, type ZoneGeo } from './CarteMiniFrance';
import { CARREAUX_PALETTES } from '@/lib/carreaux/catalogue';

type Dimension = 'region' | 'departement' | 'code_postal' | 'commune';
type Encodage = 'part' | 'densite' | 'exposee';

/**
 * `zones` dit quels contours la mini-carte peut dessiner — `null` quand il n'y
 * en a pas.
 *
 * La commune n'en a pas, et c'est délibéré : 34 921 polygones sur une carte de
 * 300 px donneraient une bouillie de traits, pour un poids de plusieurs Mo.
 * Le classement, lui, reste parfaitement lisible — c'est justement ce qui est
 * demandé à cette maille (« les 100 plus grandes communes exposées »).
 */
const DIMENSIONS: Array<{ id: Dimension; label: string; zones: 'region' | 'departement' | 'cp' | null }> = [
  { id: 'region', label: 'Région', zones: 'region' },
  { id: 'departement', label: 'Département', zones: 'departement' },
  { id: 'commune', label: 'Commune', zones: null },
  { id: 'code_postal', label: 'Code postal', zones: 'cp' },
];

/**
 * Les trois encodages de la carte. Ils ne disent PAS la même chose, et chacun
 * porte son propre libellé : basculer sans changer la légende ferait lire des
 * pourcentages comme des habitants.
 */
const ENCODAGES: Array<{ id: Encodage; label: string; aide: string }> = [
  { id: 'part', label: 'Part %', aide: "Part des habitants de l'unité qui vivent en zone à risque" },
  { id: 'densite', label: 'Densité', aide: "Habitants exposés par km² d'unité" },
  { id: 'exposee', label: 'Effectif', aide: "Nombre d'habitants exposés — un grand territoire paraît plus intense" },
];

/**
 * Les deux natures de zone. C'est le filtre le plus important de l'écran :
 * `pprt` ne retient que les sites dont la zone est une servitude PUBLIÉE par
 * l'État, `buffer` ceux dont la zone est un rayon que nous avons choisi.
 * Les décocher séparément permet de répondre à « et si je ne garde que ce qui
 * est opposable ? », qui est la question d'une recommandation client.
 */
const MODES_ZONE: Array<{ id: string; label: string; aide: string }> = [
  { id: 'pprt', label: 'Périmètre PPRT', aide: "Servitude publiée par l'État, opposable" },
  { id: 'buffer', label: 'Rayon calculé', aide: 'Rayon choisi ci-dessus — aucune valeur réglementaire' },
];

/** Niveaux réglementaires, du plus grave au moins. Miroir du panneau Calques. */
const NIVEAUX: Array<{ id: string; label: string }> = [
  { id: 'seveso_haut', label: 'Seveso haut' },
  { id: 'seveso_bas', label: 'Seveso bas' },
  { id: 'ied', label: 'IED' },
  { id: 'autorisation', label: 'Autorisation' },
  { id: 'enregistrement', label: 'Enregistrement' },
  { id: 'autre', label: 'Autre' },
];

interface UniteRef { code: string; nom: string }

interface Ligne {
  cle: string;
  nom: string;
  exposee: number;
  n_sites: number;
  n_indicatifs: number;
  carreaux: number;
  pop_totale: number | null;
  surface_km2: number | null;
  part_pct: number | null;
  densite: number | null;
}

interface Agregat {
  dimension: Dimension;
  cible: string;
  rayon_m: number;
  rayon_deduit: boolean;
  n_unites: number;
  total_exposee: number;
  total_sites: number;
  total_indicatifs: number;
  tronquee: boolean;
  /** Carreaux qu'on n'a pas su rattacher à une unité — exclus du total. */
  carreaux_non_attribues?: number;
  /** Le cercle a-t-il été imposé à TOUS les sites, périmètres PPRT compris ? */
  rayon_force?: boolean;
  /**
   * Résultat servi depuis `exposition_cache` plutôt que recalculé.
   *
   * Remonte jusqu'ici à dessein : une valeur rendue instantanément doit
   * pouvoir dire de quand elle date, sinon elle se fait passer pour un calcul
   * frais. `duree_ms` reste celle du calcul D'ORIGINE — « ce résultat a coûté
   * 43 s à produire » est l'information utile, pas « 0 ms à relire ».
   */
  du_cache?: boolean;
  duree_ms?: number;
  lignes: Ligne[];
  calcule_le: string;
}

interface Cible {
  code: string;
  libelle: string;
  famille: string;
}

interface Props {
  /**
   * Le parent MONTE ce composant quand il veut l'ouvrir et le DÉMONTE pour le
   * fermer — il n'y a pas de prop `ouvert`.
   *
   * Ce n'est pas un détail de style. `empiler()` doit vivre dans un `useEffect`
   * à dépendances VIDES (règle verrouillée par
   * `tests/unit/carte/pile-echap-usage.test.ts`) : un effet qui se ré-exécute
   * repousse son entrée au sommet de la pile Échap, et Échap ferme alors la
   * mauvaise chose. Garder le composant monté avec un booléen imposait
   * `[ouvert]` en dépendances. Le démontage règle le problème à la racine, et
   * libère au passage l'état et les requêtes en cours.
   */
  onFermer: () => void;
  /** Filtres hérités du panneau : on ne redemande pas ce qui vient d'être répondu. */
  gravites: string[];
  /**
   * TYPES de risque (toxique, inflammable…), tels que le panneau les coche.
   *
   * La RPC attend des LIBELLÉS DE NATURE, pas des types. La conversion se fait
   * ici par `librellesDuType`, la MÊME fonction que la couche carte : c'est ce
   * qui garantit qu'un site compté « toxique » dans ce tableau est bien celui
   * que la carte peint en toxique. Passer les types tels quels ne filtrerait
   * RIEN, silencieusement.
   */
  typesRisque: string[];
}

const fInter = 'Inter, system-ui, sans-serif';
const fMono = "'JetBrains Mono', monospace";

export function AnalysePopulationOverlay({ onFermer, gravites, typesRisque }: Props) {
  const [dimension, setDimension] = useState<Dimension>('departement');
  const [cible, setCible] = useState('ind');
  const [encodage, setEncodage] = useState<Encodage>('part');
  const [rayon, setRayon] = useState<number | null>(null);   // null = rayon déduit
  const [cibles, setCibles] = useState<Cible[]>([]);
  const [agregat, setAgregat] = useState<Agregat | null>(null);
  const [zones, setZones] = useState<ZoneGeo[]>([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [actif, setActif] = useState<string | null>(null);
  const [modes, setModes] = useState<string[]>(['pprt', 'buffer']);
  const [niveaux, setNiveaux] = useState<string[]>(gravites.length > 0 ? gravites : ['seveso_haut', 'seveso_bas']);
  /**
   * Le perimetre d'etude est UN seul etat, et c'est un correctif (2026-09-18).
   *
   * Il etait porte par deux : `perimNiveau` ('region' | 'departement') et
   * `perimCodes`. Le premier ne changeait QUE la liste offerte par le second —
   * il ne touchait jamais la requete tant qu'aucun code n'etait choisi, et il
   * figurait pourtant dans les dependances du calcul. Cliquer « Region » ou
   * « Departement » relançait donc les ~9 s de calcul pour rendre EXACTEMENT
   * le meme resultat : six requetes rigoureusement identiques relevees dans le
   * journal du serveur. De l'exterieur, ce bouton ne faisait rien — sinon
   * faire patienter.
   *
   * Il portait en plus les mots « Region » et « Departement » a cote du
   * selecteur « Dimension », qui offre les MEMES mots pour une autre question
   * (la maille du tableau, pas le territoire etudie). Deux commandes, meme
   * vocabulaire, sens differents : c'est la confusion qui a ete signalee.
   */
  const [perim, setPerim] = useState<{ niveau: 'region' | 'departement'; code: string } | null>(null);

  /**
   * Cercle IMPOSE a tous les sites.
   *
   * `rayon` seul ne touchait que les sites SANS perimetre PPRT : demander
   * « 5 km autour de chaque site » etait impossible, un site couvert par une
   * servitude gardant toujours la geometrie de l'Etat. Les deux questions sont
   * legitimes et differentes :
   *   - decoche : la zone officielle quand elle existe, le cercle sinon ;
   *   - cochee  : le meme cercle partout, et AUCUN chiffre ne vient alors
   *               d'une zone publiee — l'ecran doit le dire.
   */
  const [forcerRayon, setForcerRayon] = useState(false);

  /**
   * Palette de la mini-carte, prise dans le catalogue DEJA utilise par les
   * carreaux et les IRIS (`lib/carreaux/catalogue.ts`) plutot que redefinie
   * ici : c'est la meme question posee au meme utilisateur, et deux catalogues
   * auraient diverge.
   */
  const [palette, setPalette] = useState<string>('turbo');
  const [refGeo, setRefGeo] = useState<{ regions: UniteRef[]; departements: UniteRef[] }>({ regions: [], departements: [] });

  // Cache des géométries par dimension : elles ne changent jamais, et les
  // recharger à chaque bascule de dimension paierait un aller-retour pour rien.
  const cacheZones = useRef<Map<string, ZoneGeo[]>>(new Map());

  // Échap ferme l'overlay, par la pile partagée — quatre écouteurs concurrents
  // sur `keydown` ne garantiraient pas l'ordre (lib/carte/pile-echap.ts).
  const fermerRef = useRef(onFermer);
  fermerRef.current = onFermer;
  useEffect(() => {
    const id = 'analyse-population-risque';
    empiler(id, () => fermerRef.current());
    return () => depiler(id);
  }, []);

  // Le catalogue des cibles vient de la BASE, jamais d'une liste écrite en dur.
  useEffect(() => {
    if (cibles.length > 0) return;
    void (async () => {
      try {
        const r = await adminFetch('/api/risques/exposition/cibles');
        if (r.ok) setCibles(((await r.json()) as { cibles?: Cible[] }).cibles ?? []);
      } catch { /* le menu reste sur la cible par défaut */ }
    })();
  }, [cibles.length]);

  // Le referentiel geographique vient de la BASE (`/api/ref/geo`), jamais d'une
  // liste ecrite en dur : c'est la regle du projet, et une liste figee
  // divergerait au premier redecoupage administratif.
  useEffect(() => {
    void (async () => {
      try {
        const r = await adminFetch('/api/ref/geo');
        if (!r.ok) return;
        // La route rend les départements IMBRIQUÉS dans leur région : on les
        // aplatit ici plutôt que d'ajouter une seconde route pour la même
        // donnée, déjà en cache CDN une heure.
        const j = (await r.json()) as {
          regions?: Array<{
            code_region: string;
            nom_region: string;
            depts?: Array<{ code_dept: string; nom_dept: string }>;
          }>;
        };
        const regions = (j.regions ?? []).map((x) => ({ code: x.code_region, nom: x.nom_region }));
        const departements = (j.regions ?? []).flatMap((x) =>
          (x.depts ?? []).map((d) => ({ code: d.code_dept, nom: d.nom_dept })),
        );
        setRefGeo({ regions, departements });
      } catch { /* le sélecteur reste sur France entière */ }
    })();
  }, []);

  const dimCourante = DIMENSIONS.find((d) => d.id === dimension) ?? DIMENSIONS[1];

  // Les géométries de la dimension courante.
  useEffect(() => {
    const cle = dimCourante.zones;
    // Pas de contours a cette maille (commune) : on vide plutot que d'appeler
    // une route avec `scale=null`, qui repondrait 400.
    if (cle === null) { setZones([]); return; }
    const enCache = cacheZones.current.get(cle);
    if (enCache) { setZones(enCache); return; }
    void (async () => {
      try {
        const r = await adminFetch(`/api/meteo-geo/zones?scale=${cle}`);
        if (!r.ok) return;
        const fc = (await r.json()) as { features?: ZoneGeo[] };
        const f = fc.features ?? [];
        cacheZones.current.set(cle, f);
        setZones(f);
      } catch { /* la carte reste vide, le tableau fonctionne */ }
    })();
  }, [dimCourante.zones]);

  // Le calcul.
  // Types → libellés de nature. Mémoïsé : sans ça, le tableau se recalculerait
  // à chaque rendu, ce tableau étant une nouvelle référence à chaque fois.
  const natures = useMemo(() => {
    const n = typesRisque.flatMap((t) => librellesDuType(t as TypeRisque, FAMILLES_ICPE_SEED));
    // « Risque non précisé » n'a pas de libellé de famille : c'est l'absence de
    // rubrique exploitable, et il se demande par son propre libellé.
    if (typesRisque.includes('non_precise')) n.push(NATURE_NON_PRECISEE);
    return n;
  }, [typesRisque]);

  /**
   * Le détail par code postal sur la France entière dépasse le temps de calcul
   * (mesuré en production : délai dépassé, alors que la même dimension sur une
   * région répond). On le dit AVANT de lancer plutôt que de laisser tourner un
   * appel qui n'aboutira pas — une attente sans fin se lit comme une panne.
   */
  /*
   * Ne vise QUE le code postal. La commune, elle, est calculable sur la France
   * entiere — elle ne fait aucun croisement geometrique (sql/194).
   */
  const tropLarge = dimension === 'code_postal' && perim === null;

  const calculer = useCallback(async () => {
    if (tropLarge) {
      setAgregat(null);
      setErreur(
        'À l’échelle nationale, le détail par code postal dépasse le temps de calcul : ' +
        'il exige un point-dans-polygone contre les 6 187 contours postaux, carreau par carreau. ' +
        'Deux sorties — passer à la maille « Commune », qui répond à la même question ' +
        'sans ce croisement, ou choisir un territoire dans « Territoire étudié ».',
      );
      return;
    }
    setChargement(true);
    setErreur(null);
    try {
      const p = new URLSearchParams({ dimension, cible });
      if (niveaux.length > 0) p.set('gravites', niveaux.join(','));
      if (natures.length > 0) p.set('natures', natures.join(','));
      if (modes.length > 0 && modes.length < MODES_ZONE.length) p.set('modes', modes.join(','));
      if (perim) {
        p.set('perim_niveau', perim.niveau);
        p.set('perim_codes', perim.code);
      }
      if (rayon !== null) p.set('rayon_m', String(rayon));
      if (forcerRayon) p.set('forcer_rayon', '1');
      if (dimension === 'code_postal') p.set('limite', '500');
      // 100 communes : c'est le classement demande, et au-dela la liste cesse
      // d'etre lisible. Le TOTAL, lui, compte toujours toutes les unites.
      if (dimension === 'commune') p.set('limite', '100');
      const r = await adminFetch(`/api/risques/exposition/agregats?${p}`);
      const j = await r.json();
      if (!r.ok) { setErreur(j?.error ?? 'Calcul indisponible.'); setAgregat(null); return; }
      setAgregat(j as Agregat);
    } catch {
      setErreur('Calcul indisponible.');
      setAgregat(null);
    } finally {
      setChargement(false);
    }
  }, [dimension, cible, niveaux, natures, modes, perim, rayon, forcerRayon, tropLarge]);

  useEffect(() => {
    void calculer();
  }, [calculer]);

  const valeurs = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of agregat?.lignes ?? []) {
      const v = encodage === 'part' ? l.part_pct : encodage === 'densite' ? l.densite : l.exposee;
      if (v !== null && Number.isFinite(v)) m.set(l.cle, v);
    }
    return m;
  }, [agregat, encodage]);

  /**
   * Au palier code postal, la part et la densité sont NULLES : aucun
   * dénominateur fiable n'existe à cette maille (`ref_codes_postaux.pop_total`
   * rend 110,5 % de la France réelle, `carreaux_cp_population` le même chiffre,
   * et aucun indicateur de population n'est matérialisé par code postal —
   * mesuré le 18/09/2026).
   *
   * Plutôt que de peindre une carte vide, on bascule sur l'effectif ET on le
   * dit. Un encodage silencieusement inopérant se lirait comme « aucune
   * exposition ».
   */
  const encodageIndisponible =
    (encodage === 'part' || encodage === 'densite') &&
    (agregat?.lignes.length ?? 0) > 0 &&
    valeurs.size === 0;
  const encodageEffectif: Encodage = encodageIndisponible ? 'exposee' : encodage;

  const valeursCarte = useMemo(() => {
    if (!encodageIndisponible) return valeurs;
    const m = new Map<string, number>();
    for (const l of agregat?.lignes ?? []) m.set(l.cle, l.exposee);
    return m;
  }, [encodageIndisponible, valeurs, agregat]);

  const encCourant = ENCODAGES.find((e) => e.id === encodageEffectif) ?? ENCODAGES[0];
  const formaterValeur = useCallback(
    (v: number) =>
      encodageEffectif === 'part' ? `${formaterNombre(v)} %`
      : encodageEffectif === 'densite' ? `${formaterNombre(v)} hab/km²`
      : formaterNombre(v),
    [encodageEffectif],
  );

  const libelleCible = cibles.find((c) => c.code === cible)?.libelle ?? 'Population totale';

  // Les cibles groupées par famille, pour un menu lisible.
  const familles = [...new Set(cibles.map((c) => c.famille))];

  return (
    <div
      role="dialog"
      aria-label="Analyser la population à risque"
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'var(--bg-primary)',
        display: 'flex', flexDirection: 'column',
        animation: 'fadeIn 200ms var(--ease-out) both',
      }}
    >
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px',
          borderBottom: '0.5px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
        }}
      >
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <h2 style={{ margin: 0, fontFamily: fInter, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>
          Population à risque industriel
        </h2>
        <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>
          {libelleCible} · {dimCourante.label.toLowerCase()}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          disabled
          title="Export Excel — prochaine étape"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: '0.5px solid var(--border-default)',
            borderRadius: 6, padding: '6px 12px', cursor: 'not-allowed',
            fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)',
          }}
        >
          <Download size={13} /> Export Excel
        </button>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer"
          style={{
            display: 'flex', background: 'transparent', border: 'none',
            padding: 6, cursor: 'pointer', color: 'var(--text-secondary)',
          }}
        >
          <X size={18} />
        </button>
      </header>

      {/* ── Barre de contrôles ──────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap',
          padding: '12px 20px',
          borderBottom: '0.5px solid var(--border-subtle)',
        }}
      >
        <Champ label="Cible">
          <select
            value={cible}
            onChange={(e) => setCible(e.target.value)}
            style={styleSelect}
          >
            {familles.length === 0 && <option value="ind">Population totale</option>}
            {familles.map((f) => (
              <optgroup key={f} label={f}>
                {cibles.filter((c) => c.famille === f).map((c) => (
                  <option key={c.code} value={c.code}>{c.libelle}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Champ>

        <Champ label="Dimension">
          <div style={{ display: 'flex', gap: 4 }}>
            {DIMENSIONS.map((d) => (
              <Pastille key={d.id} actif={dimension === d.id} onClick={() => setDimension(d.id)}>
                {d.label}
              </Pastille>
            ))}
          </div>
        </Champ>

        {/* Le rayon se saisit en KILOMETRES : c'est l'unite dans laquelle un
            media planner raisonne (« 2 km autour de l'usine »), et 532 m
            s'ecrit 0,5 km sans rien perdre. La base, elle, continue de
            travailler en metres — la conversion vit ici et nulle part ailleurs. */}
        <Champ label="Cercle autour de chaque site">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min={0.1}
              max={20}
              step={0.1}
              value={((rayon ?? agregat?.rayon_m ?? 532) / 1000).toFixed(1)}
              onChange={(e) => {
                const km = Number(e.target.value);
                setRayon(Number.isFinite(km) && km > 0 ? Math.round(km * 1000) : null);
              }}
              style={{ ...styleSelect, width: 76, fontFamily: fMono }}
            />
            <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>km</span>

            <label
              title="Applique le cercle à TOUS les sites, y compris ceux couverts par un périmètre PPRT publié."
              style={{
                display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                fontFamily: fInter, fontSize: 11,
                color: forcerRayon ? 'var(--brand-teal)' : 'var(--text-secondary)',
              }}
            >
              <input
                type="checkbox"
                checked={forcerRayon}
                onChange={(e) => setForcerRayon(e.target.checked)}
                style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
              />
              imposer à tous les sites
            </label>

            {/* Deux mentions EXCLUSIVES, jamais les deux : la seconde annule la
                premiere. Le rayon deduit ne veut plus rien dire des qu'on
                impose une valeur choisie. */}
            {forcerRayon ? (
              <span
                title="Aucun chiffre ne vient alors d'une zone publiée par l'État : tout est calculé sur ce cercle."
                style={{ fontFamily: fInter, fontSize: 10, color: 'var(--warning)' }}
              >
                périmètres PPRT ignorés — tout est indicatif
              </span>
            ) : agregat?.rayon_deduit ? (
              <span
                title="Moyenne des rayons équivalents des 664 périmètres PPRT publiés"
                style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}
              >
                déduit des périmètres réels
              </span>
            ) : null}

            {rayon !== null && (
              <button type="button" onClick={() => setRayon(null)} style={styleLien}>
                rétablir
              </button>
            )}
          </div>
        </Champ>
      </div>

      {/* ── Filtres ─────────────────────────────────────────────────────
          Séparés des contrôles du haut à dessein : au-dessus on choisit CE
          QU'ON REGARDE (cible, dimension, rayon), ici on choisit CE QU'ON
          RETIENT. Mélanger les deux oblige à relire toute la barre pour
          savoir d'où vient un chiffre. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
          padding: '10px 20px',
          borderBottom: '0.5px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
        }}
      >
        <Champ label="Nature de la zone">
          <div style={{ display: 'flex', gap: 4 }}>
            {MODES_ZONE.map((m) => (
              <Pastille
                key={m.id}
                actif={modes.includes(m.id)}
                titre={m.aide}
                onClick={() =>
                  setModes((v) => {
                    const suivant = v.includes(m.id) ? v.filter((x) => x !== m.id) : [...v, m.id];
                    // Tout décocher ne rendrait rien : on garde au moins une
                    // nature, plutôt qu'un écran vide sans explication.
                    return suivant.length === 0 ? v : suivant;
                  })
                }
              >
                {m.label}
              </Pastille>
            ))}
          </div>
        </Champ>

        <Champ label="Niveau réglementaire">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {NIVEAUX.map((n) => (
              <Pastille
                key={n.id}
                actif={niveaux.includes(n.id)}
                onClick={() =>
                  setNiveaux((v) => {
                    const suivant = v.includes(n.id) ? v.filter((x) => x !== n.id) : [...v, n.id];
                    return suivant.length === 0 ? v : suivant;
                  })
                }
              >
                {n.label}
              </Pastille>
            ))}
          </div>
        </Champ>

        {/* UN seul menu, et deux `optgroup` plutot que deux menus en cascade :
            le premier menu ne servait qu'a decider ce que le second afficherait,
            ne changeait RIEN a l'ecran tant qu'aucun territoire n'etait choisi,
            et relançait pourtant le calcul entier. Ici, tout choix a un effet,
            et l'intitule dit « Territoire » : « Perimetre d'etude » proposait
            « Region » et « Departement » juste a cote du selecteur Dimension,
            qui offre les memes mots pour la maille du TABLEAU. */}
        <Champ label="Territoire étudié">
          <select
            value={perim ? `${perim.niveau}:${perim.code}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) { setPerim(null); return; }
              const [niveau, code] = v.split(':');
              setPerim({ niveau: niveau as 'region' | 'departement', code });
            }}
            style={{ ...styleSelect, minWidth: 210 }}
          >
            <option value="">France entière</option>
            {refGeo.regions.length > 0 && (
              <optgroup label="Régions">
                {refGeo.regions.map((u) => (
                  <option key={`r-${u.code}`} value={`region:${u.code}`}>{u.nom}</option>
                ))}
              </optgroup>
            )}
            {refGeo.departements.length > 0 && (
              <optgroup label="Départements">
                {refGeo.departements.map((u) => (
                  <option key={`d-${u.code}`} value={`departement:${u.code}`}>{u.code} — {u.nom}</option>
                ))}
              </optgroup>
            )}
          </select>
        </Champ>

        {/* Le rappel de ce qui a été hérité du panneau, pour que l'utilisateur
            sache d'où vient un filtre qu'il n'a pas posé ici. */}
        {typesRisque.length > 0 && (
          <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', alignSelf: 'flex-end', paddingBottom: 7 }}>
            Types de risque filtrés depuis le panneau Calques ({typesRisque.length})
          </span>
        )}
      </div>

      {/* ── Corps ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Tableau */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', minWidth: 0 }}>
          {erreur && (
            <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--danger)' }}>{erreur}</p>
          )}

          {agregat && (
            <>
              <div style={{ display: 'flex', gap: 28, marginBottom: 16, flexWrap: 'wrap' }}>
                <Kpi
                  valeur={formaterNombre(agregat.total_exposee)}
                  libelle={libelleCible.toLowerCase()}
                  note="la somme des lignes égale ce total"
                  accent
                />
                <Kpi
                  valeur={formaterNombre(agregat.total_sites)}
                  libelle="sites classés"
                  note="ne s’additionne pas entre lignes"
                />
                <Kpi
                  valeur={formaterNombre(agregat.total_indicatifs)}
                  libelle="sur un rayon choisi"
                  note={`soit ${Math.round((agregat.total_indicatifs / Math.max(1, agregat.total_sites)) * 100)} % des sites`}
                />
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                    <Th align="left">{dimCourante.label}</Th>
                    <Th>{libelleCible}</Th>
                    <Th>Part</Th>
                    <Th>Densité</Th>
                    <Th>Sites</Th>
                    <Th>dont indicatifs</Th>
                  </tr>
                </thead>
                <tbody>
                  {agregat.lignes.map((l) => (
                    <tr
                      key={l.cle}
                      onMouseEnter={() => setActif(l.cle)}
                      onMouseLeave={() => setActif(null)}
                      style={{
                        borderBottom: '0.5px solid var(--border-subtle)',
                        background: actif === l.cle ? 'var(--brand-teal-10)' : 'transparent',
                        transition: 'background-color 150ms var(--ease-out)',
                      }}
                    >
                      <td style={{ padding: '7px 8px', color: 'var(--text-primary)' }}>
                        <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginRight: 7 }}>
                          {l.cle}
                        </span>
                        {l.nom}
                      </td>
                      <Td fort>{formaterNombre(l.exposee)}</Td>
                      <Td>{l.part_pct !== null ? `${formaterNombre(l.part_pct)} %` : '—'}</Td>
                      <Td>{l.densite !== null ? formaterNombre(l.densite) : '—'}</Td>
                      <Td>{formaterNombre(l.n_sites)}</Td>
                      <Td dim>{l.n_indicatifs > 0 ? formaterNombre(l.n_indicatifs) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {agregat.lignes.length === 0 && !chargement && (
                <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}>
                  Aucune population exposée pour ces filtres.
                </p>
              )}

              {/* Un chiffre amputé en silence est pire qu'un chiffre absent :
                  si des carreaux n'ont pas pu être rattachés, on le dit. */}
              {(agregat.carreaux_non_attribues ?? 0) > 0 && (
                <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--warning)', marginTop: 10 }}>
                  {formaterNombre(agregat.carreaux_non_attribues as number)} carreau(x) n’ont pas pu
                  être rattachés à une unité et sont exclus du total.
                </p>
              )}

              {agregat.tronquee && (
                <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--warning)', marginTop: 10 }}>
                  Liste tronquée : {formaterNombre(agregat.n_unites)} unités exposées, les plus
                  peuplées seulement sont affichées. Le total ci-dessus les compte toutes.
                </p>
              )}

              {/* D'où vient ce chiffre et de quand il date.
                  Un résultat servi depuis le cache arrive instantanément : sans
                  cette ligne il se ferait passer pour un calcul frais, et
                  personne ne saurait qu'un import l'a peut-être périmé.
                  `duree_ms` est celle du calcul D'ORIGINE — « ce résultat a
                  coûté 43 s » est l'information utile, pas « 0 ms à relire ». */}
              <p
                style={{
                  fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)',
                  marginTop: 14, borderTop: '0.5px solid var(--border-subtle)', paddingTop: 8,
                }}
              >
                {agregat.du_cache ? 'résultat mémorisé' : 'calculé à l’instant'}
                {' · '}
                {new Date(agregat.calcule_le).toLocaleString('fr-FR', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
                {typeof agregat.duree_ms === 'number' && (
                  <> · {formaterNombre(Math.round(agregat.duree_ms))} ms de calcul</>
                )}
              </p>

              {/* L'avertissement qui empêche la mauvaise lecture la plus probable. */}
              <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', marginTop: 14, lineHeight: 1.5 }}>
                Un carreau INSEE de 200 m appartient à une seule unité : la somme de la colonne
                population <strong style={{ fontWeight: 500 }}>égale</strong> le total. La colonne
                « sites », elle, ne s’additionne pas — un site dont la zone déborde sur deux unités
                compte dans les deux. Les sites sans périmètre PPRT reposent sur un rayon de{' '}
                {formaterNombre(agregat.rayon_m)} m que vous choisissez, et non sur une servitude
                publiée par l’État.
              </p>
            </>
          )}

          {chargement && !agregat && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontFamily: fInter, fontSize: 12 }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Calcul en cours…
            </div>
          )}
        </div>

        {/* Mini-carte */}
        <aside
          style={{
            width: 340, flexShrink: 0,
            borderLeft: '0.5px solid var(--border-subtle)',
            padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: 12,
            overflow: 'auto',
          }}
        >
          <div style={{ display: 'flex', gap: 4 }}>
            {ENCODAGES.map((e) => (
              <Pastille key={e.id} actif={encodage === e.id} onClick={() => setEncodage(e.id)} titre={e.aide}>
                {e.label}
              </Pastille>
            ))}
          </div>

          {zones.length > 0 ? (
            /* Fragment : la carte ET son sélecteur de palette sont deux enfants
               de la même branche de ternaire. */
            <>
            <CarteMiniFrance
              zones={zones}
              valeurs={valeursCarte}
              libelleValeur={encCourant.label}
              formater={formaterValeur}
              stops={(CARREAUX_PALETTES.find((p) => p.id === palette) ?? CARREAUX_PALETTES[0]).stops}
              codeActif={actif}
              onSurvol={setActif}
            />

            {/* Selecteur de palette, repris TEL QUEL du panneau Carreaux
                (`CarreauxSection.tsx`) : memes pastilles, meme catalogue, meme
                geste. Une seconde facon de choisir une palette dans le meme
                produit aurait ete un dialecte de plus a apprendre. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
                Palette
              </span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {CARREAUX_PALETTES.map((pal) => (
                  <button
                    key={pal.id}
                    type="button"
                    onClick={() => setPalette(pal.id)}
                    title={pal.label}
                    aria-pressed={palette === pal.id}
                    style={{
                      border: `1.5px solid ${palette === pal.id ? 'var(--text-primary)' : 'transparent'}`,
                      borderRadius: 3, padding: 0, cursor: 'pointer', background: 'none',
                      display: 'flex', overflow: 'hidden', width: 28, height: 12,
                    }}
                  >
                    {pal.stops.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
                  </button>
                ))}
              </div>
            </div>
            </>
          ) : dimCourante.zones === null ? (
            /* Pas d'attente ici : il n'y a RIEN a charger a cette maille, et
               laisser « Chargement des contours… » tourner indefiniment se
               lirait comme une panne. On dit pourquoi, et ce qu'on gagne. */
            <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Pas de carte à la maille commune : 34 921 polygones sur 300 px
              donneraient une bouillie de traits. Le classement ci-contre reste
              lisible, lui — c’est ce qu’on vient chercher ici.
            </p>
          ) : (
            <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
              Chargement des contours…
            </p>
          )}

          {encodageIndisponible && (
            <p style={{ fontFamily: fInter, fontSize: 10, color: 'var(--warning)', lineHeight: 1.5, margin: 0 }}>
              Part et densité ne sont pas disponibles au code postal : aucun
              référentiel de population n’y est fiable — celui de La Poste
              recense 110,5 % de la population française. La carte affiche
              l’effectif.
            </p>
          )}

          <p style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: 0 }}>
            {encCourant.aide}. Le gris signale une unité <strong style={{ fontWeight: 500 }}>sans
            aucune exposition</strong> — pas une valeur faible. Métropole uniquement : les DROM ne
            sont pas dessinés, mais ils comptent dans le tableau et dans le total.
          </p>
        </aside>
      </div>
    </div>
  );
}

/* ── Briques locales ─────────────────────────────────────────────────────── */

const styleSelect: React.CSSProperties = {
  background: 'var(--bg-level-2)',
  border: '0.5px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '6px 10px',
  fontFamily: fInter,
  fontSize: 12,
  color: 'var(--text-primary)',
};

const styleLien: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontFamily: fInter, fontSize: 10, color: 'var(--brand-teal)',
};

function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}

function Pastille({
  actif, onClick, children, titre,
}: { actif: boolean; onClick: () => void; children: React.ReactNode; titre?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titre}
      aria-pressed={actif}
      style={{
        background: actif ? 'var(--brand-teal-10)' : 'transparent',
        border: `0.5px solid ${actif ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
        color: actif ? 'var(--brand-teal)' : 'var(--text-secondary)',
        borderRadius: 6, padding: '6px 11px', cursor: 'pointer',
        fontFamily: fInter, fontSize: 12,
        transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out)',
      }}
    >
      {children}
    </button>
  );
}

function Kpi({
  valeur, libelle, note, accent,
}: { valeur: string; libelle: string; note: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span
        style={{
          fontFamily: fMono, fontSize: 24, lineHeight: 1.1,
          color: accent ? 'var(--brand-teal)' : 'var(--text-primary)',
        }}
      >
        {valeur}
      </span>
      <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>{libelle}</span>
      <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>{note}</span>
    </div>
  );
}

function Th({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align, padding: '6px 8px', fontWeight: 400,
        fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, fort, dim }: { children: React.ReactNode; fort?: boolean; dim?: boolean }) {
  return (
    <td
      style={{
        textAlign: 'right', padding: '7px 8px',
        fontFamily: fMono, fontSize: 11,
        color: fort ? 'var(--text-primary)' : dim ? 'var(--text-tertiary)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </td>
  );
}
