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
import { OngletRayonInfluence } from './OngletRayonInfluence';

type Dimension = 'region' | 'departement' | 'code_postal' | 'commune';

/**
 * Un pas du fil d'Ariane. Le `nom` est porté avec le code parce qu'on ne peut
 * pas le retrouver après coup : une fois descendu dans la Seine-Maritime, la
 * liste affichée est celle de ses communes, et « 76 » n'y figure plus.
 */
interface Segment { niveau: 'region' | 'departement'; code: string; nom: string }
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
/**
 * Les rayons que l'on peut NOMMER. Un média planner dit « 500 m », « 2 km » —
 * jamais « 1,7 km ». Le curseur reste là pour l'entre-deux, mais les paliers
 * portent l'usage courant et évitent de viser au pixel.
 *
 * 200 m est le plancher : c'est le côté du carreau INSEE, donc la plus petite
 * distance qui puisse encore changer un résultat.
 */
const PALIERS_RAYON = [500, 1000, 2000, 5000];

const DIMENSIONS: Array<{ id: Dimension; label: string; zones: 'region' | 'departement' | 'cp' | null }> = [
  { id: 'region', label: 'Région', zones: 'region' },
  { id: 'departement', label: 'Département', zones: 'departement' },
  { id: 'commune', label: 'Commune', zones: null },
  // Les contours postaux existent, mais on ne les dessine plus : à l'intérieur
  // d'un département, une carte de France entière ne montrerait qu'un confetti.
  { id: 'code_postal', label: 'Code postal', zones: null },
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
  /** Rayon le plus large encore calculable sur ce périmètre (sql/197). */
  rayon_max_m?: number;
  n_sites_retenus?: number;
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
  /**
   * LE FIL D'ARIANE, et non un sélecteur de « maille ».
   *
   * « Dimension » était une abstraction de développeur : personne ne pense
   * « je choisis une maille », on pense France → Normandie → Seine-Maritime.
   * Le chemin porte la descente, et la maille s'en DÉDUIT — on ne peut donc
   * plus être dans un état incohérent (maille commune sans territoire, code
   * postal national qui ne calcule pas).
   *
   * Le patron vient de `BarreMaille` du Suivi V2, à une différence près : il
   * ne garde qu'UN parent, et son propre en-tête signale que le fil disait
   * alors « France entière › 31 » sans jamais dire de quoi 31 était le code.
   * Ici on garde le chemin ENTIER, ce qui supprime le problème.
   */
  const [chemin, setChemin] = useState<Segment[]>([]);
  /**
   * La maille CHOISIE, qui prime sur celle déduite du fil d'Ariane.
   *
   * ⚠ Le fil seul était une RÉGRESSION, et une grave : il rendait le
   * classement national des communes — « les 100 plus grandes communes
   * exposées » — inatteignable, puisqu'il fallait d'abord descendre dans un
   * département. Une navigation ne doit pas retirer une réponse que l'écran
   * savait déjà donner.
   *
   * Les deux sont complémentaires et répondent à deux questions différentes :
   * le fil dit OÙ l'on est, la maille dit CE QU'ON LISTE. `null` = la maille
   * naturelle du niveau courant, c'est-à-dire le comportement d'un drill-down
   * ordinaire.
   */
  const [mailleChoisie, setMailleChoisie] = useState<Dimension | null>(null);
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
   * DEUX états pour le rayon, et c'est le correctif du défaut signalé.
   *
   * Le champ relançait le calcul à CHAQUE frappe, avec un pas de 100 m. Quatre
   * pressions sur la flèche = quatre requêtes de 4 s sur un quota de 20/min,
   * d'où le 429 observé. Et 100 m n'a aucun sens : le carreau INSEE fait
   * 200 m — en dessous, on déplace une frontière À L'INTÉRIEUR d'un carreau et
   * le chiffre ne bouge pas.
   *
   * `rayonSaisi` suit la main, `rayon` suit le calcul. Le second rattrape le
   * premier après un silence de DELAI_RAYON.
   */
  const [rayonSaisi, setRayonSaisi] = useState<number | null>(null);

  /**
   * Palette de la mini-carte, prise dans le catalogue DEJA utilise par les
   * carreaux et les IRIS (`lib/carreaux/catalogue.ts`) plutot que redefinie
   * ici : c'est la meme question posee au meme utilisateur, et deux catalogues
   * auraient diverge.
   */
  /*
   * Défaut : la rampe ROUGE, séquentielle. Turbo a d'abord été retenue parce
   * qu'elle rend chaque unité visible, mais c'est un arc-en-ciel : deux
   * départements de valeurs voisines y prennent des teintes sans rapport, et
   * l'œil ne peut pas lire « plus » ou « moins » sans revenir à la légende.
   * Une échelle d'intensité doit s'ordonner toute seule.
   */
  const [palette, setPalette] = useState<string>('rouge');

  /**
   * Les deux onglets répondent à deux questions distinctes, et partagent les
   * mêmes filtres :
   *   `population` — combien d'habitants dans les zones, et OÙ ;
   *   `rayon`      — quel RAYON retenir, en lisant la courbe entière.
   *
   * Le second n'est pas une variante du premier : il lit une table
   * pré-calculée (sql/198) et ne recalcule rien, là où le premier croise les
   * carreaux à la demande.
   */
  const [onglet, setOnglet] = useState<'population' | 'rayon'>('population');
  /**
   * `deptsParRegion` n'est pas un doublon : la route rend les départements
   * IMBRIQUÉS dans leur région, et on les aplatissait en perdant le
   * rattachement. Sans lui, la carte ne peut pas savoir quels départements
   * dessiner une fois descendu dans une région — elle affichait donc les 104
   * de France, dont cinq colorés et 99 gris.
   */
  const [refGeo, setRefGeo] = useState<{
    regions: UniteRef[]; departements: UniteRef[]; deptsParRegion: Record<string, string[]>;
  }>({ regions: [], departements: [], deptsParRegion: {} });

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
        const deptsParRegion: Record<string, string[]> = {};
        for (const x of j.regions ?? []) {
          deptsParRegion[x.code_region] = (x.depts ?? []).map((d) => d.code_dept);
        }
        setRefGeo({ regions, departements, deptsParRegion });
      } catch { /* le sélecteur reste sur France entière */ }
    })();
  }, []);

  /**
   * La maille affichée est celle des ENFANTS du dernier segment. C'est ce qui
   * rend le code postal calculable : on ne le demande jamais nationalement,
   * seulement à l'intérieur d'un département où l'on est déjà descendu.
   */
  /** La maille NATURELLE du niveau courant — celle d'un drill-down ordinaire. */
  const mailleNaturelle: Dimension =
    chemin.length === 0 ? 'region'
    : chemin.length === 1 ? 'departement'
    : 'commune';

  const dimension: Dimension = mailleChoisie ?? mailleNaturelle;

  /**
   * Le périmètre d'étude est le dernier segment du chemin.
   *
   * ⚠ `useMemo` OBLIGATOIRE, ce n'est pas du confort. Cet objet entre dans les
   * dépendances du `useCallback` de calcul : reconstruit à chaque rendu, il
   * changerait d'identité à chaque rendu, l'effet se rejouerait, le résultat
   * provoquerait un rendu — et le calcul de 4 s tournerait EN BOUCLE sur la
   * production. Le lint l'a signalé ; c'était un vrai défaut, pas un pinaillage.
   */
  const perim = useMemo(
    () => (chemin.length > 0
      ? { niveau: chemin[chemin.length - 1].niveau, code: chemin[chemin.length - 1].code }
      : null),
    [chemin],
  );

  /** Peut-on descendre depuis la maille affichée ? La commune est une feuille. */
  /**
   * Assez long pour absorber une rafale de clics sur le curseur, assez court
   * pour ne pas donner l'impression que l'écran a décroché.
   */
  const DELAI_RAYON = 450;

  useEffect(() => {
    if (rayonSaisi === null) return;
    const t = setTimeout(() => setRayon(rayonSaisi), DELAI_RAYON);
    return () => clearTimeout(t);
  }, [rayonSaisi]);

  /** Le rayon réellement en vigueur — celui du serveur tant qu'on n'a rien choisi. */
  const rayonCourant = rayon ?? agregat?.rayon_m ?? 532;
  /**
   * Le plafond vient de la BASE (sql/197) et jamais d'un calcul local : le
   * seuil de surface vit dans la RPC, le recopier ici serait deux vérités qui
   * divergent au premier réglage.
   */
  const maxRayonM = agregat?.rayon_max_m ?? null;

  /**
   * On ne descend QUE si la maille affichée est la maille naturelle du niveau.
   * Lister les communes de France depuis la racine est légitime, mais cliquer
   * une commune ne mène nulle part — il n'y a pas d'étage en dessous, et
   * pousser un segment « commune » dans le fil produirait un chemin dont la
   * suite serait vide.
   */
  /**
   * Les zones que la carte doit dessiner — celles du TERRITOIRE courant, pas
   * celles de la France entière.
   *
   * Une fois descendu dans une région, la carte montrait toujours les 104
   * départements : cinq colorés, 99 gris, et un cadrage national dans lequel
   * la région tenait dans un timbre-poste. Le cadrage se dérive du contenu
   * (`cadreDe`), donc filtrer suffit à zoomer — aucune coordonnée à calculer.
   *
   * Les unités du territoire SANS exposition restent dessinées, en gris : ce
   * sont des voisines légitimes, et les retirer laisserait des trous dans la
   * silhouette.
   */
  const zonesAffichees = useMemo(() => {
    if (chemin.length === 0) return zones;
    const seg = chemin[chemin.length - 1];

    // Le filtre ne vaut que si la maille DESSINÉE est bien celle des enfants du
    // segment. Forcer « Région » alors qu'on est descendu dans une région
    // demande la carte des RÉGIONS : filtrer par codes de départements n'y
    // aurait aucun sens et viderait le tracé.
    /**
     * ⚠ Le territoire NE SUFFIT PAS à décider ce qu'on dessine.
     *
     * Le périmètre d'étude filtre les SITES, pas les carreaux : un site normand
     * dont la zone déborde de quelques centaines de mètres apporte sa
     * population au département voisin. Descendre dans la Normandie fait donc
     * apparaître au tableau la Somme et la Mayenne — mesuré, 7 lignes pour 5
     * départements normands. C'est le comportement voulu d'une étude locale :
     * on étudie les installations d'un territoire, pas un découpage de la
     * population.
     *
     * La carte doit donc dessiner l'UNION du territoire et de ce que le tableau
     * liste. Ne montrer que le territoire laissait deux lignes sans contrepartie
     * sur la carte ; ne montrer que le tableau laisserait des trous dans la
     * silhouette là où un département n'a aucune exposition.
     */
    const codes = new Set<string>();
    if (seg.niveau === 'region' && dimension === 'departement') {
      for (const c of refGeo.deptsParRegion[seg.code] ?? []) codes.add(c);
    } else if (seg.niveau === 'departement' && dimension === 'departement') {
      codes.add(seg.code);
    }
    for (const l of agregat?.lignes ?? []) codes.add(l.cle);

    // Tant que rien n'est résolu, mieux vaut tout montrer que rien : une carte
    // vide se lirait comme une panne.
    if (codes.size === 0) return zones;
    const filtrees = zones.filter((z) => codes.has(z.properties.code));
    return filtrees.length > 0 ? filtrees : zones;
  }, [zones, chemin, dimension, refGeo.deptsParRegion, agregat]);

  const descendable =
    dimension === mailleNaturelle && (dimension === 'region' || dimension === 'departement');

  /**
   * Descendre d'un cran. `setActif(null)` n'est pas cosmetique : l'unite
   * survolee appartient au niveau qu'on QUITTE, et la laisser ferait
   * surligner sur la nouvelle carte un code qui n'y existe plus — ou pire, un
   * homonyme, les nomenclatures INSEE de region et de departement se
   * recouvrant sur 18 codes (sql/171).
   */
  const descendre = (code: string, nom: string) => {
    if (!descendable) return;
    setChemin((c) => [...c, { niveau: dimension as 'region' | 'departement', code, nom }]);
    // On repasse en maille NATURELLE : descendre d'un cran, c'est demander le
    // niveau d'en dessous. Garder une maille forcée ferait afficher, après un
    // clic sur une région, la liste de ses régions — c'est-à-dire elle-même.
    setMailleChoisie(null);
    setActif(null);
  };

  const dimCourante = DIMENSIONS.find((d) => d.id === dimension) ?? DIMENSIONS[0];

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
        <FilAriane
          chemin={chemin}
          maille={dimCourante.label}
          onRemonter={(n) => { setChemin((c) => c.slice(0, n)); setActif(null); }}
        />
        <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
          {([
            ['population', 'Population exposée'],
            ['rayon', 'Rayon d’influence'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setOnglet(id)}
              aria-pressed={onglet === id}
              style={{
                border: 0, background: 'none', padding: '4px 10px 6px', cursor: 'pointer',
                fontFamily: fInter, fontSize: 12,
                fontWeight: onglet === id ? 500 : 400,
                color: onglet === id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                // Souligné teal : le patron d'onglets du DESIGN_SYSTEM.
                borderBottom: `2px solid ${onglet === id ? 'var(--brand-teal)' : 'transparent'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>
          {libelleCible}
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

        {/* La maille dit CE QU'ON LISTE, le fil d'Ariane dit OÙ. Les deux
            cohabitent : lister les communes de France entière est une question
            légitime — c'est même la demande d'origine, « les 100 plus grandes
            communes exposées » — et la retirer au profit du seul drill-down
            était une régression. */}
        {/* Ces deux contrôles ne valent que pour l'onglet Population : la
            courbe de rayon n'a pas de maille (elle agrège tout le territoire)
            et porte son propre curseur. Les laisser visibles ferait croire
            qu'ils agissent sur ce qu'on regarde. */}
        {onglet === 'population' && (
        <Champ label="Lister par">
          <div style={{ display: 'flex', gap: 4 }}>
            {DIMENSIONS.map((d) => (
              <Pastille
                key={d.id}
                actif={dimension === d.id}
                onClick={() => setMailleChoisie(d.id === mailleNaturelle ? null : d.id)}
                titre={
                  d.id === 'commune'
                    ? 'Regroupe les arrondissements de Paris, Lyon et Marseille sous leur commune.'
                    : d.id === 'code_postal'
                      ? 'Ni part ni densité à cette maille : le seul référentiel de population par code postal surcompte de 10 %.'
                      : undefined
                }
              >
                {d.label}
              </Pastille>
            ))}
          </div>
        </Champ>
        )}

        {/* Le TERRITOIRE reste visible dans les deux onglets : c'est un filtre
            partagé, pas un réglage de la maille. Le masquer obligerait à
            revenir sur l'autre onglet pour changer de périmètre. */}
        {/* Raccourci de territoire. Le fil d'Ariane sert à DESCENDRE pas à pas ;
            ce menu sert à SAUTER directement là où l'on sait déjà aller, sans
            traverser les étages. Il écrit le même état — donc le fil se met à
            jour tout seul, et les deux ne peuvent pas se contredire. */}
        <Champ label="Territoire">
          <select
            value={chemin.length > 0 ? `${chemin[chemin.length - 1].niveau}:${chemin[chemin.length - 1].code}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              setActif(null);
              if (!v) { setChemin([]); return; }
              const [niveau, code] = v.split(':');
              const nom = (niveau === 'region' ? refGeo.regions : refGeo.departements)
                .find((u) => u.code === code)?.nom ?? code;
              setChemin([{ niveau: niveau as 'region' | 'departement', code, nom }]);
            }}
            style={{ ...styleSelect, minWidth: 190 }}
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

        {/* ── LE RAYON ───────────────────────────────────────────────────
            Trois défauts corrigés d'un coup, tous signalés à l'usage :

            - le PAS. 100 m n'a pas de sens : le carreau INSEE fait 200 m, en
              dessous on déplace une frontière à l'intérieur d'un carreau et le
              chiffre ne bouge pas. Les paliers sont les distances qu'un média
              planner nomme réellement.
            - la BORNE. On pouvait saisir 20 km et découvrir le refus après
              coup. `rayon_max_m` vient de la base (sql/197) et borne le
              curseur : on ne peut plus glisser jusqu'à l'échec.
            - le DÉLAI. Chaque frappe relançait 4 s de calcul. */}
        {onglet === 'population' && (
        <Champ label="Cercle autour de chaque site">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 3 }}>
              {PALIERS_RAYON.map((m) => {
                const horsBornes = maxRayonM !== null && m > maxRayonM;
                return (
                  <Pastille
                    key={m}
                    actif={(rayonSaisi ?? rayonCourant) === m}
                    onClick={() => !horsBornes && setRayonSaisi(m)}
                    titre={horsBornes
                      ? `Au-delà de ce que le calcul tient sur ce périmètre (${formaterNombre(maxRayonM as number)} m). Descendez dans un territoire pour l’atteindre.`
                      : undefined}
                  >
                    <span style={{ opacity: horsBornes ? 0.35 : 1 }}>
                      {m < 1000 ? `${m} m` : `${m / 1000} km`}
                    </span>
                  </Pastille>
                );
              })}
            </div>

            <input
              type="range"
              min={200}
              max={maxRayonM ?? 5000}
              step={100}
              value={Math.min(rayonSaisi ?? rayonCourant, maxRayonM ?? 5000)}
              onChange={(e) => setRayonSaisi(Number(e.target.value))}
              aria-label="Rayon en mètres"
              style={{ width: 110, accentColor: 'var(--brand-teal)' }}
            />
            <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)', minWidth: 52 }}>
              {((rayonSaisi ?? rayonCourant) / 1000).toFixed(1).replace('.', ',')} km
            </span>

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

            {/* Mentions EXCLUSIVES : « déduit » n'a plus de sens dès qu'on
                impose une valeur choisie. */}
            {forcerRayon ? (
              <span
                title="Aucun chiffre ne vient alors d'une zone publiée par l'État : tout est calculé sur ce cercle."
                style={{ fontFamily: fInter, fontSize: 10, color: 'var(--warning)' }}
              >
                PPRT ignorés — tout indicatif
              </span>
            ) : agregat?.rayon_deduit ? (
              <span
                title="Moyenne des rayons équivalents des 664 périmètres PPRT publiés"
                style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}
              >
                déduit des périmètres réels
              </span>
            ) : null}

            {rayonSaisi !== null && (
              <button
                type="button"
                onClick={() => { setRayonSaisi(null); setRayon(null); }}
                style={styleLien}
              >
                rétablir
              </button>
            )}
          </div>
        </Champ>
        )}
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


        {/* Le rappel de ce qui a été hérité du panneau, pour que l'utilisateur
            sache d'où vient un filtre qu'il n'a pas posé ici. */}
        {typesRisque.length > 0 && (
          <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', alignSelf: 'flex-end', paddingBottom: 7 }}>
            Types de risque filtrés depuis le panneau Calques ({typesRisque.length})
          </span>
        )}
      </div>

      {/* ── Corps ───────────────────────────────────────────────────────── */}
      {onglet === 'rayon' ? (
        <OngletRayonInfluence
          cible={cible}
          libelleCible={libelleCible}
          niveaux={niveaux}
          natures={natures}
          perim={perim}
          nomPerim={chemin.length > 0 ? chemin[chemin.length - 1].nom : 'France entière'}
        />
      ) : (
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
                    {/* Une commune peut etre tres exposee sans porter le
                        moindre site : Le Petit-Quevilly compte 9 850 exposes
                        pour 0 site, parce que c'est le PPRT du Grand-Quevilly
                        qui deborde chez elle. Sans cette explication, la ligne
                        se lit comme une incoherence. */}
                    <Th titre="Sites implantés dans cette unité. Une unité peut être exposée sans en porter aucun : c'est la zone d'un site voisin qui déborde chez elle. Ce compte ne s'additionne donc pas avec la population.">
                      Sites
                    </Th>
                    <Th titre="Parmi ces sites, ceux dont la zone est un rayon que NOUS avons choisi, faute de périmètre PPRT publié par l'État.">
                      dont indicatifs
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {agregat.lignes.map((l) => (
                    <tr
                      key={l.cle}
                      onMouseEnter={() => setActif(l.cle)}
                      onMouseLeave={() => setActif(null)}
                      onClick={descendable ? () => descendre(l.cle, l.nom) : undefined}
                      title={descendable ? 'Descendre dans ' + l.nom : undefined}
                      style={{
                        borderBottom: '0.5px solid var(--border-subtle)',
                        background: actif === l.cle ? 'var(--brand-teal-10)' : 'transparent',
                        transition: 'background-color 150ms var(--ease-out)',
                        cursor: descendable ? 'pointer' : 'default',
                      }}
                    >
                      <td style={{ padding: '7px 8px', color: 'var(--text-primary)' }}>
                        <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginRight: 7 }}>
                          {l.cle}
                        </span>
                        {l.nom}
                        {descendable && (
                          <span aria-hidden style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>&rsaquo;</span>
                        )}
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
              zones={zonesAffichees}
              valeurs={valeursCarte}
              libelleValeur={encCourant.label}
              formater={formaterValeur}
              stops={(CARREAUX_PALETTES.find((p) => p.id === palette) ?? CARREAUX_PALETTES[0]).stops}
              /* Part et densité sont des RAPPORTS : l'aplat leur convient.
                 L'effectif est une quantité absolue — la peindre sur des
                 départements de tailles très différentes ferait lire la
                 surface au lieu de la valeur. Cercles proportionnels. */
              mode={encodageEffectif === 'exposee' ? 'cercles' : 'aplat'}
              codeActif={actif}
              onSurvol={setActif}
              onClic={descendable
                ? (code) => {
                    const l = agregat?.lignes.find((x) => x.cle === code);
                    if (l) descendre(l.cle, l.nom);
                  }
                : undefined}
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
            aucune exposition</strong> — pas une valeur faible.
            {' '}
            <strong style={{ fontWeight: 500 }}>Outre-mer : non calculable.</strong> Le carroyage
            INSEE 200 m, sur lequel repose tout ce calcul, ne couvre pas les DROM — zéro carreau
            mesuré en base. Les 45 sites Seveso et 32 périmètres PPRT qui y sont recensés
            n’apparaissent donc ni sur la carte, ni dans le tableau, ni dans le total. Ce n’est pas
            un oubli d’import : la donnée source s’arrête à la métropole.
          </p>
        </aside>
      </div>
      )}
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

/**
 * Fil d'Ariane. Chaque segment franchi est cliquable pour y revenir ; le
 * dernier ne l'est pas, on y est deja.
 *
 * Le segment porte le NIVEAU en plus du nom (« Region Normandie »), parce que
 * 18 codes INSEE designent a la fois un departement et une region (sql/171) :
 * un fil qui afficherait « France entiere › 76 » ne dirait pas de quoi 76 est
 * le code. C'est le defaut que l'en-tete de `BarreMaille` (Suivi V2) signale
 * pour lui-meme.
 */
function FilAriane({ chemin, maille, onRemonter }: {
  chemin: Array<{ niveau: 'region' | 'departement'; code: string; nom: string }>;
  maille: string;
  onRemonter: (n: number) => void;
}) {
  const LIB: Record<string, string> = { region: 'Région', departement: 'Département' };
  return (
    <nav aria-label="Fil d’Ariane" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <button
        type="button"
        onClick={() => onRemonter(0)}
        disabled={chemin.length === 0}
        style={{
          border: 0, background: 'none', padding: 0,
          fontFamily: fInter, fontSize: 12,
          cursor: chemin.length === 0 ? 'default' : 'pointer',
          color: chemin.length === 0 ? 'var(--text-primary)' : 'var(--brand-teal)',
          textDecoration: chemin.length === 0 ? 'none' : 'underline',
          textUnderlineOffset: 3,
        }}
      >
        France entière
      </button>
      {chemin.map((seg, i) => (
        <span key={seg.niveau + seg.code} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span aria-hidden style={{ color: 'var(--text-tertiary)' }}>&rsaquo;</span>
          <button
            type="button"
            onClick={() => onRemonter(i + 1)}
            disabled={i === chemin.length - 1}
            title={LIB[seg.niveau] + ' ' + seg.code}
            style={{
              border: 0, background: 'none', padding: 0,
              fontFamily: fInter, fontSize: 12,
              cursor: i === chemin.length - 1 ? 'default' : 'pointer',
              color: i === chemin.length - 1 ? 'var(--text-primary)' : 'var(--brand-teal)',
              textDecoration: i === chemin.length - 1 ? 'none' : 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {seg.nom}
          </button>
        </span>
      ))}
      <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 2 }}>
        · {maille.toLowerCase()}
      </span>
    </nav>
  );
}

function Th({ children, align = 'right', titre }: {
  children: React.ReactNode; align?: 'left' | 'right'; titre?: string;
}) {
  return (
    <th
      title={titre}
      style={{
        textAlign: align, padding: '6px 8px', fontWeight: 400,
        fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)',
        // Le pointillé signale qu'il y a une explication à survoler, sans
        // ajouter une icône de plus dans un en-tête déjà dense.
        ...(titre ? { borderBottom: '1px dotted var(--border-default)', cursor: 'help' } : null),
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
