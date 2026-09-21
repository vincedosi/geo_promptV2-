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
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre } from '@/lib/format/nombre';
import { empiler, depiler } from '@/lib/carte/pile-echap';
import { librellesDuType } from '@/lib/carte/palette-risques';
import type { TypeRisque } from '@/lib/carte/palette-risques';
import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from '@/lib/import/georisques/familles';
import { CarteMiniFrance, type ZoneGeo } from './CarteMiniFrance';
import { CARREAUX_PALETTES } from '@/lib/carreaux/catalogue';
import { OngletRayons } from '@/components/risques/OngletRayons';
import { fInter, fMono } from '@/lib/design/polices';
import {
  DIMENSIONS_PROPOSEES,
  LIBELLE_DIMENSION,
  MODES_ZONE as MODES_PARTAGES,
} from '@/lib/risques/dimensions';
import type { Dimension as DimensionPartagee, ModeZone } from '@/lib/risques/dimensions';
import { Champ, Pastille, FilAriane, Th, Td, styleLien } from '@/components/risques/elements';
import { FournisseurRisque, useEtatRisque } from '@/components/risques/ContexteRisque';
import type { Etape } from '@/lib/risques/etape';
import { FilArianeEtapes } from '@/components/risques/FilArianeEtapes';
import { CarteRisque } from '@/components/risques/CarteRisque';
import {
  FournisseurChargement, usePiste, useChargement,
} from '@/components/risques/ContexteChargement';
import { BarreProgression, Perime } from '@/components/risques/BarreProgression';
import { estPerime } from '@/lib/risques/chargement';
import {
  mailleExploree, perimetreExplore, peutDescendre, peutRemonter,
  descendre as descendreExploration, remonter as remonterExploration,
  type SegmentExploration,
} from '@/lib/risques/exploration';
import { PanneauSites } from '@/components/risques/PanneauSites';
import { ResumeProfil } from '@/components/risques/ResumeProfil';
import { RegletteRayons, type ApercuRayon } from '@/components/risques/RegletteRayons';
import { BandeauKpi } from '@/components/risques/BandeauKpi';
import { anneauxDuNiveau, NIVEAUX as NIVEAUX_PROFIL } from '@/lib/risques/profil';
import { useSitesCompte } from '@/components/risques/use-sites-compte';
import { PanneauProfil } from '@/components/risques/PanneauProfil';
import { useBandes } from '@/components/risques/use-bandes';
import { useCourbeRayon } from '@/components/risques/use-courbe-rayon';
import { TableauCouverture } from '@/components/risques/TableauCouverture';
import { BoutonVoirCarte } from '@/components/risques/BoutonVoirCarte';
import { OngletZones } from '@/components/risques/OngletZones';
import { BoutonExportProfil } from '@/components/risques/BoutonExportProfil';
import { NIVEAUX_RISQUE } from '@/lib/risques/gravites';

// La maille vient de `lib/risques/dimensions.ts` : les trois listes blanches
// (les deux routes d'exposition) divergeaient, et `arrondissement` etait donc
// inatteignable alors que la RPC et l'export l'acceptent (R-09).
type Dimension = DimensionPartagee;

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

/**
 * Ce que la mini-carte sait dessiner, par maille.
 *
 * Seule information PROPREMENT locale de ce tableau : les ids et les libellés
 * viennent de `lib/risques/dimensions.ts`, où ils sont écrits une fois pour
 * l'écran et les deux routes d'exposition.
 *
 * Les contours postaux existent mais ne sont plus dessinés : à l'intérieur d'un
 * département, une carte de France entière n'en montrerait qu'un confetti.
 */
const ZONES_DESSINEES: Record<DimensionPartagee, 'region' | 'departement' | 'cp' | null> = {
  region: 'region',
  departement: 'departement',
  commune: null,
  code_postal: null,
  arrondissement: null,
};

const DIMENSIONS = DIMENSIONS_PROPOSEES.map((id) => ({
  id,
  label: LIBELLE_DIMENSION[id],
  zones: ZONES_DESSINEES[id],
}));

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
/**
 * Les deux origines de zone, telles que l'écran les présente.
 *
 * Les IDENTIFIANTS viennent de `lib/risques/dimensions.ts` — les mêmes que les
 * routes valident. Le libellé et l'aide sont propres à l'écran.
 */
const AIDE_MODE: Record<ModeZone, { label: string; aide: string }> = {
  pprt: { label: 'Périmètre PPRT', aide: "Servitude publiée par l'État, opposable" },
  buffer: { label: 'Rayon calculé', aide: 'Rayon choisi ci-dessus — aucune valeur réglementaire' },
};

const MODES_ZONE = MODES_PARTAGES.map((id) => ({ id, ...AIDE_MODE[id] }));

// Les niveaux viennent de `lib/risques/gravites.ts`. Cette liste etait ecrite
// ici en dur sous le commentaire « Miroir du panneau Calques » — et divergeait
// sur QUATRE libelles sur six (constat R-26).
const NIVEAUX = NIVEAUX_RISQUE;



/** Un code de territoire et son libellé, pour les menus de périmètre. */
interface UniteRef { code: string; nom: string }

/*
 * ── LES TYPES DE L'ANCIEN MOTEUR ONT DISPARU ─────────────────────────────
 *
 * `Ligne` et `Agregat` décrivaient le payload de `/api/risques/exposition/
 * agregats`. L'écran lit maintenant `population_par_classe`, dont le type vit
 * dans `use-bandes.ts` — une seule déclaration, partagée par le tableau des
 * bandes et par ce panneau, qui ne peuvent donc plus se désaccorder.
 */

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


/**
 * L'écran du module. Enveloppé par {@link AnalysePopulationOverlay}, qui lui
 * fournit l'état partagé.
 *
 * ⚠ Il ne peut pas porter le fournisseur lui-même : un composant ne consomme
 * pas un contexte qu'il déclare dans son propre rendu.
 */
function CorpsAnalyse({ onFermer, gravites, typesRisque }: Props) {
  /**
   * L'ÉTAT PARTAGÉ, et non vingt `useState` indépendants.
   *
   * Les deux onglets portaient chacun leur copie des mêmes filtres : changer de
   * niveau réglementaire dans l'un ne changeait rien dans l'autre, et les deux
   * affichaient alors des chiffres différents pour la même question sans que
   * rien ne le signale. Ce qui change un chiffre vit désormais ici, et se
   * reflète dans l'URL — donc se partage et survit à un rechargement.
   */
  const { etat, majEtat } = useEtatRisque();

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
  const cible = etat.cible;
  const setCible = useCallback((v: string) => majEtat({ cible: v }), [majEtat]);
  const [encodage, setEncodage] = useState<Encodage>('part');
  const [cibles, setCibles] = useState<Cible[]>([]);
  const [zones, setZones] = useState<ZoneGeo[]>([]);
  /*
   * ⚠ Plus d'état d'erreur local : `useBandes` porte le sien, À CÔTÉ de la
   * donnée. Un second état ici aurait laissé afficher un message périmé sous
   * un tableau qui a réussi depuis.
   */
  const [actif, setActif] = useState<string | null>(null);
  /**
   * Modes et niveaux passent par l'état partagé, avec un shim qui accepte la
   * forme « fonction de mise à jour » déjà employée plus bas.
   *
   * ⚠ Le shim lit `etat` et non une valeur figée : écrire
   * `majEtat({ modes: f(modes) })` en capturant `modes` du rendu courant
   * perdrait une modification sur deux quand deux cases sont cochées coup sur
   * coup — la seconde recalculerait à partir d'un état déjà périmé.
   */
  const modes = etat.modes as string[];
  const setModes = useCallback(
    (f: (v: string[]) => string[]) => majEtat({ modes: f([...etat.modes]) as ModeZone[] }),
    [majEtat, etat.modes],
  );
  const niveaux = etat.gravites;
  const setNiveaux = useCallback(
    (f: (v: string[]) => string[]) => majEtat({ gravites: f([...etat.gravites]) }),
    [majEtat, etat.gravites],
  );
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


  /*
   * ── DEUX ÉTATS DE RAYON ONT DISPARU ────────────────────────────────────
   *
   * `forcerRayon` imposait le cercle à TOUS les sites, servitude publiée
   * comprise. `rayonSaisi` amortissait la frappe sur la réglette locale — le
   * champ relançait le calcul à chaque pression, quatre requêtes de 4 s sur un
   * quota de 20/min, d'où le 429 observé.
   *
   * Les deux appartenaient à un moteur que l'écran n'appelle plus. Le profil
   * dit maintenant la même chose autrement : ses anneaux valent pour tous les
   * niveaux, et `inclurePPRT` décide si la servitude prime. L'amortissement,
   * lui, vit dans `useBandes`, qui l'applique à TOUT l'écran plutôt qu'à une
   * seule réglette.
   */

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
  const etape = etat.etape;

  const setEtape = useCallback((v: Etape) => majEtat({ etape: v }), [majEtat]);

  /*
   * ⚠ La largeur du panneau et le repli de la carte vivent en état LOCAL, pas
   * dans l'URL : ils ne changent aucun chiffre. `lib/risques/etat-url.ts` ne
   * porte que ce qui décide d'un résultat — mettre une préférence d'affichage
   * dans un lien partagé imposerait sa mise en page au destinataire.
   */
  const [largeurPanneau, setLargeurPanneau] = useState(480);
  const [carteSeule, setCarteSeule] = useState(false);

  /*
   * Le rayon en cours de réglage, le temps d'un glissement. Il ne va ni dans
   * l'URL ni dans l'état du module : il n'a pas encore de géométrie en base,
   * et un lien partagé porterait un rayon que personne n'a validé.
   */
  const [apercuRayon, setApercuRayon] = useState<ApercuRayon | null>(null);


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

  /*
   * `rayonCourant` et `maxRayonM` ont disparu avec la réglette locale.
   *
   * `maxRayonM` valait `agregat.rayon_max_m` — le plafond que le garde-fou de
   * surface de `population_exposee_agregee` renvoie, 1 179 m sur la France.
   * Il n'a plus d'objet : `population_par_classe` lit un pré-calcul et n'a
   * aucun rayon maximal. Le profil décide seul, et il va jusqu'à 10 km.
   */

  /*
   * ⚠ `descendable` et `descendre` ont été RETIRÉS le 2026-09-21.
   *
   * Ils poussaient un segment dans `chemin`, c'est-à-dire dans le filtre
   * « Territoire » de la barre commune : descendre pour regarder les
   * départements d'une région faisait basculer tout l'écran — bandeau KPI,
   * courbe, étapes voisines. La descente vit désormais dans
   * `lib/risques/exploration.ts`, en état LOCAL à l'étape ③, et le filtre
   * reste où l'utilisateur l'a posé.
   *
   * Ce qu'ils portaient de juste est conservé là-bas : on ne descend que
   * depuis une région ou un département (`peutDescendre`), et le survol est
   * effacé au changement de niveau — l'unité survolée appartient au niveau
   * qu'on QUITTE, et la laisser ferait surligner un code qui n'existe plus,
   * ou pire un homonyme, les nomenclatures INSEE de région et de département
   * se recouvrant sur 18 codes (sql/171).
   */

  /*
   * ── L'EXPLORATION LOCALE DU TABLEAU (étape ③) ───────────────────────────
   *
   * Déclarée ICI, avant les géométries : c'est elle qui décide de la maille
   * affichée par le tableau ET par la mini-carte. Plus bas, la mini-carte
   * aurait chargé les contours de la maille GLOBALE pendant que le tableau
   * liste ceux de la maille explorée — une carte et un tableau qui ne parlent
   * pas du même découpage.
   */
  const [exploration, setExploration] = useState<SegmentExploration[]>([]);

  /*
   * L'unité sur laquelle la carte est cadrée. Distincte de `actif`, qui est le
   * SURVOL : l'un suit la souris et s'efface, l'autre tient jusqu'au clic
   * suivant. Les confondre ferait sauter le cadrage au moindre mouvement.
   */
  const [selectionCarte, setSelectionCarte] = useState<string | null>(null);

  const mailleTableau = mailleExploree(exploration, dimension);
  const perimetreTableau = perimetreExplore(exploration, {
    region: chemin.find((c) => c.niveau === 'region')?.code ?? null,
    parent: chemin.find((c) => c.niveau === 'departement')?.code ?? null,
  });

  const dimCourante = DIMENSIONS.find((d) => d.id === dimension) ?? DIMENSIONS[0];
  /** La maille réellement listée par l'étape ③ — explorée ou non. */
  const dimTableau = DIMENSIONS.find((d) => d.id === mailleTableau) ?? dimCourante;

  // Les géométries de la maille LISTÉE, celle du tableau et de la mini-carte.
  useEffect(() => {
    const cle = dimTableau.zones;
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
  }, [dimTableau.zones]);

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

  /*
   * La courbe de couverture, hissée pour la MÊME raison que les bandes : elle
   * vivait dans `OngletRayonInfluence`, sous l'onglet Rayons, et repartait à
   * chaque retour — quatre appels mesurés pour cinq bascules, sans qu'un seul
   * réglage ait bougé.
   */
  const resultatCourbe = useCourbeRayon(
    cible,
    niveaux,
    natures,
    (() => {
      const dernier = chemin[chemin.length - 1];
      return dernier && (dernier.niveau === 'region' || dernier.niveau === 'departement')
        ? { niveau: dernier.niveau, code: dernier.code }
        : null;
    })(),
  );

  /*
   * ── LE PRÉ-CALCUL DES BANDES VIT ICI, PAS DANS L'ONGLET ────────────────
   *
   * Il alimente le tableau de l'onglet Rayons ET le tiroir de réglage, qui est
   * ouvrable depuis les trois onglets (chaque anneau y affiche ce qu'il
   * apporte). Le laisser dans `OngletRayons` le faisait repartir à chaque
   * retour sur cet onglet : le tableau se vidait le temps de la réponse, alors
   * que rien n'avait changé.
   *
   * ⚠ La maille est ramenée à ce que le pré-calcul porte EN COLONNE. `cp` et
   * les autres seraient refusées par la route ; les envoyer quand même ferait
   * afficher une erreur là où l'utilisateur n'a rien demandé de spécial.
   */
  /*
   * ⚠ La maille N'EST PLUS rabattue sur `departement`/`commune`.
   *
   * Elle l'était parce que `population_par_classe` ne portait que ces deux-là ;
   * sql/221 lui a ajouté la région et le code postal, tirés de colonnes que
   * `carreau_risque_distance` avait déjà. Les quatre mailles rendent
   * désormais le MÊME total à l'habitant près — vérifié : 24 406 555 aux
   * quatre.
   */
  const resultatBandes = useBandes(
    etat.profil,
    cible,
    dimension,
    chemin.find((c) => c.niveau === 'departement')?.code ?? null,
    // ⚠ Le filtre de nature de la barre COMMUNE. Il n'arrivait pas jusqu'ici
    // avant le 2026-09-20 : le décocher changeait la courbe de l'onglet Rayons
    // et pas le tableau juste au-dessus.
    natures,
    /*
     * ⚠ La RÉGION part dans son propre argument, jamais dans `parent`.
     * `parent` est un code de DÉPARTEMENT, et les deux nomenclatures INSEE se
     * recouvrent sur 18 codes — les confondre a déjà fait rendre 164 codes
     * postaux au lieu de 21 sur un drill-down parisien (sql/171).
     */
    chemin.find((c) => c.niveau === 'region')?.code ?? null,
  );

  /*
   * ── L'EXPLORATION LOCALE DU TABLEAU (étape ③) ───────────────────────────
   *
   * Cliquer une ligne écrivait le filtre « Territoire » de la barre commune :
   * on descendait dans une région pour REGARDER ses départements, et tout
   * l'écran basculait avec — bandeau KPI, courbe, autres étapes. Le filtre dit
   * ce qu'on ÉTUDIE, l'exploration ce qu'on REGARDE dans le tableau.
   *
   * ⚠ Elle ne touche JAMAIS à `chemin` : la garantie tient parce que
   * `perimetreExplore` ne reçoit le périmètre global qu'en lecture.
   */
  /*
   * ⚠ Ce second appel ne part QUE pendant une exploration. Sans ce garde-fou,
   * il doublerait chaque calcul — y compris les 2,8 s du national — pour un
   * résultat identique au premier. Hors exploration, le tableau lit le même
   * résultat que le bandeau KPI, donc il n'y a rien à charger.
   */
  const resultatExplore = useBandes(
    etat.profil, cible, mailleTableau, perimetreTableau.parent,
    natures, perimetreTableau.region,
    exploration.length > 0,
  );

  /* Le résultat que le tableau affiche : l'exploré s'il existe, sinon le global. */
  const bandesTableau = exploration.length > 0 ? resultatExplore : resultatBandes;

  /**
   * Ce qui est DEMANDÉ : dimension, cible, filtres, périmètre, rayon.
   *
   * Une seule fabrique pour l'écran ET pour l'export. Les deux construisaient
   * les mêmes douze lignes chacun de leur côté (constat R-08 de
   * `docs/AUDIT_ZONE_RISQUE.md`), à l'ordre des clés près. Un filtre ajouté
   * d'un seul côté aurait fait diverger le tableur de l'écran — précisément ce
   * que l'en-tête de `export/route.ts` déclare vouloir empêcher.
   *
   * Ce qui reste propre à chaque appelant est ajouté APRÈS : les libellés
   * lisibles pour l'export, le plafond de lignes pour l'écran. Ni l'un ni
   * l'autre ne change le périmètre interrogé.
   */
  // Remontee ici : `exporter` la capture, et elle etait declaree 120 lignes
  // plus bas. Correct a l'execution — l'export n'est appele qu'apres le
  // rendu — mais c'est un couplage temporel implicite (constat R-26).
  const libelleCible = cibles.find((c) => c.code === cible)?.libelle ?? 'Population totale';

  /*
   * Le comptage des sites ne dépend PAS du profil : déplacer un anneau ne
   * change pas le nombre de sites classés. Il a donc son propre hook, et ne
   * repart pas à chaque geste sur une réglette.
   */
  const compteSites = useSitesCompte(
    niveaux,
    natures,
    perim ? (perim.niveau as 'departement' | 'region') : null,
    perim ? perim.code : null,
  );

  /*
   * ── LES PISTES DE CHARGEMENT ────────────────────────────────────────────
   *
   * Trois sources vivent ici ; les deux autres se déclarent d'où elles
   * chargent — la préparation des zones dans `CarteRisque`, la construction
   * d'un jeu dans le panneau ④. C'est tout l'intérêt du registre : aucune
   * n'a besoin de savoir où la barre s'affiche.
   *
   * Les libellés disent le TRAVAIL et jamais la route : « Calcul de la
   * population » et non « /profil/bandes », que personne n'attend.
   */
  usePiste('bandes', 'Calcul de la population par classe…', resultatBandes.etat === 'chargement');
  usePiste('courbe', 'Lecture de la courbe de couverture…', resultatCourbe.chargement);
  usePiste('sites', 'Comptage des sites…', compteSites.chargement);

  const chargement = useChargement();
  /*
   * Des chiffres DÉJÀ à l'écran pendant qu'on recalcule : ils décrivent le
   * filtre précédent, et rien ne le disait jusqu'ici. Au tout premier
   * chargement il n'y a rien à périmer — `estPerime` fait la distinction.
   */
  const perime = estPerime(chargement.actif, resultatBandes.bandes !== null);

  /**
   * Le plus grand rayon du profil — l'abscisse à laquelle on lit le gain
   * marginal.
   *
   * ⚠ Le MAXIMUM et non le premier anneau : « ce que 100 m de plus
   * apporteraient » se demande au bord de la zone, pas en son milieu.
   */
  const rayonMaxProfil = useMemo(() => {
    const tous = NIVEAUX_PROFIL.flatMap((n) => anneauxDuNiveau(etat.profil, n));
    return tous.length > 0 ? Math.max(...tous) : null;
  }, [etat.profil]);

  /*
   * La courbe TOTALE, celle dont la clé est `'*'`. C'est la seule qui porte
   * l'incrément du profil entier ; une courbe par nature répondrait à une autre
   * question, et leur somme ne voudrait rien dire — un carreau proche de deux
   * natures compte dans les deux.
   */
  const courbeTotale = useMemo(
    () => resultatCourbe.data?.courbes.find((c) => c.cle === '*')?.points ?? null,
    [resultatCourbe.data],
  );

  /*
   * ⚠ Ce memo est DESCENDU ici, sous `resultatBandes`.
   *
   * Il vivait deux cents lignes plus haut, quand il lisait `agregat`. Il lit
   * maintenant les mêmes unités que le tableau — c'est ce qui garantit que la
   * carte et la liste ne puissent plus montrer deux territoires différents —
   * et une constante de bloc ne s'utilise pas avant sa déclaration.
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
    for (const u of resultatBandes.bandes?.unites ?? []) codes.add(u.unite);

    // Tant que rien n'est résolu, mieux vaut tout montrer que rien : une carte
    // vide se lirait comme une panne.
    if (codes.size === 0) return zones;
    const filtrees = zones.filter((z) => codes.has(z.properties.code));
    return filtrees.length > 0 ? filtrees : zones;
  }, [zones, chemin, dimension, refGeo.deptsParRegion, resultatBandes.bandes]);

  /*
   * ── LE CALCUL PAR L'ANCIEN MOTEUR A DISPARU ────────────────────────────
   *
   * Il portait un garde-fou `tropLarge` : « à l'échelle nationale, le détail
   * par code postal dépasse le temps de calcul — il exige un point-dans-
   * polygone contre les 6 187 contours postaux, carreau par carreau ».
   *
   * C'était vrai de CE moteur, et de lui seul. `carreau_risque_distance` porte
   * le code postal en colonne depuis sql/203 : ce croisement a été payé une
   * fois pour toutes. Mesuré le 2026-09-20 — la maille code postal sur la
   * France entière répond en **4,2 s**, soit le coût des trois autres.
   *
   * Le garde-fou part donc avec le moteur qui le justifiait. Le supprimer
   * n'ouvre aucune vanne : `population_par_classe` ne touche jamais à une
   * géométrie et ne balaie jamais les 2,3 millions de carreaux.
   */

  /**
   * Les valeurs peintes sur la mini-carte, dérivées des MÊMES unités que le
   * tableau — c'est ce qui garantit que la carte et la liste ne peuvent pas
   * raconter deux choses.
   *
   * Part et densité sont calculées ICI, à partir des deux dénominateurs bruts
   * que la RPC rend. Les faire calculer par la base aurait dispersé la
   * définition entre le SQL, l'écran et le classeur.
   */
  const valeurs = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of resultatBandes.bandes?.unites ?? []) {
      const v = encodage === 'part'
        ? (u.pop_totale && u.pop_totale > 0 ? (u.total / u.pop_totale) * 100 : null)
        : encodage === 'densite'
          ? (u.surface_km2 && u.surface_km2 > 0 ? u.total / u.surface_km2 : null)
          : u.total;
      if (v !== null && Number.isFinite(v)) m.set(u.unite, v);
    }
    return m;
  }, [resultatBandes.bandes, encodage]);

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
    (resultatBandes.bandes?.unites.length ?? 0) > 0 &&
    valeurs.size === 0;
  const encodageEffectif: Encodage = encodageIndisponible ? 'exposee' : encodage;

  const valeursCarte = useMemo(() => {
    if (!encodageIndisponible) return valeurs;
    const m = new Map<string, number>();
    for (const u of resultatBandes.bandes?.unites ?? []) m.set(u.unite, u.total);
    return m;
  }, [encodageIndisponible, valeurs, resultatBandes.bandes]);

  const encCourant = ENCODAGES.find((e) => e.id === encodageEffectif) ?? ENCODAGES[0];
  const formaterValeur = useCallback(
    (v: number) =>
      encodageEffectif === 'part' ? `${formaterNombre(v)} %`
      : encodageEffectif === 'densite' ? `${formaterNombre(v)} hab/km²`
      : formaterNombre(v),
    [encodageEffectif],
  );


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
        {/*
          ⚠ DEUX fils d'Ariane sur cet en-tête, et ce n'est pas un doublon :
          celui du dessus dit OÙ JE REGARDE (France › PACA › Bouches-du-Rhône),
          celui-ci dit OÙ J'EN SUIS dans le travail. Les fondre obligerait à
          quitter son territoire pour changer d'étape.
        */}
        <FilArianeEtapes
          etape={etape}
          parcours={{
            gravites: etat.gravites,
            profil: etat.profil,
            chemin: etat.chemin,
            jeu: etat.jeu,
          }}
          onEtape={setEtape}
        />
        <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>
          {libelleCible}
        </span>
        {/* Le profil decide de la classe de chaque carreau, donc de TOUS les
            chiffres affiches. Le laisser dans le seul onglet « Rayons » ferait
            lire un tableau sans savoir sur quels anneaux il a ete calcule.
            ⚠ Il DÉPLIE désormais le tiroir au lieu de changer d'onglet :
            renvoyer ailleurs pour régler ce qui vaut partout était le défaut. */}
        <ResumeProfil
          profil={etat.profil}
          onOuvrirAtelier={() => majEtat({ atelier: !etat.atelier })}
        />
        <div style={{ flex: 1 }} />
        {/* Persistant, dans l'en-tete : la carte illustre le profil quel que
            soit l'onglet ouvert, et le chercher dans un onglet precis serait
            une devinette. */}
        <BoutonExportProfil
          profil={etat.profil}
          cible={cible}
          libelleCible={libelleCible}
          maille={dimCourante.id}
          parent={chemin.find((c) => c.niveau === 'departement')?.code ?? null}
          campagne={etat.campagne}
        />
        <BoutonVoirCarte profil={etat.profil} onFermer={onFermer} />
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

      {/*
        ── LA BARRE COMMUNE ───────────────────────────────────────────────
        UNE seule rangée pour les trois onglets : tout ce qui est ici vaut
        partout, et le changer met à jour les trois — l'état est unique
        (`lib/risques/etat-url.ts`), il n'y a pas de copie à synchroniser.

        Ce qui n'est PAS commun descend dans la rangée suivante, nommée. Le
        mélange obligeait à relire toute la barre pour savoir si un réglage
        agissait sur ce qu'on regardait.
      */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap',
          padding: '12px 20px',
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

        {/*
          La maille dit CE QU'ON LISTE, le fil d'Ariane dit OÙ. Les deux
          cohabitent : lister les communes de France entière est une question
          légitime — c'est même la demande d'origine, « les 100 plus grandes
          communes exposées » — et la retirer au profit du seul drill-down
          serait une régression.

          ⚠ Ce sélecteur vivait sous ce bandeau d'onglet. Il n'a jamais été
          propre à quoi que ce soit : il décrit ce qu'on regarde, au
          même titre que la cible et le territoire. Ce qui l'accompagnait —
          une réglette de rayon à part — l'était, lui, et a disparu avec le
          moteur qui l'imposait.
        */}
        <Champ label="Lister par">
          <div style={{ display: 'flex', gap: 4 }}>
            {DIMENSIONS.map((d) => (
              <Pastille
                key={d.id}
                actif={dimension === d.id}
                onClick={() => setMailleChoisie(d.id === mailleNaturelle ? null : d.id)}
                titre={
                  d.id === 'commune'
                    ? 'Le carroyage INSEE porte le code commune tel qu’il l’écrit : Paris, Lyon et Marseille y sont par arrondissement.'
                    : d.id === 'code_postal'
                      ? 'Ni part ni densité à cette maille : le seul référentiel de population par code postal surcompte de 10,5 %.'
                      : undefined
                }
              >
                {d.label}
              </Pastille>
            ))}
          </div>
        </Champ>

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
            UNE réglette par niveau, dans la barre commune — et plus une
            réglette locale à un seul onglet, qui affichait 390 112 habitants
            pendant que l'en-tête en annonçait 24 406 618 pour le même profil.

            Elle déplace le BORD de la zone. Les anneaux intérieurs restent à
            l'atelier : un niveau en porte jusqu'à quatre, et le profil par
            défaut en a trois sur le seuil haut — un curseur ne peut pas les
            représenter, il peut seulement mentir sur leur nombre.

            Le pas est celui du pré-calcul (100 m) et la borne celle de la
            donnée (10 km) : on ne peut plus glisser jusqu'à un refus, ni
            déplacer une frontière entre deux paliers sans qu'aucun chiffre
            ne bouge. Le calcul ne part qu'au relâchement. */}
        <RegletteRayons
          profil={etat.profil}
          onProfil={(p) => majEtat({ profil: p })}
          /* L'aperçu ne va PAS dans l'état d'URL : il ne dure que le temps
             d'un geste, et un lien partagé porterait alors un rayon que
             personne n'a validé. */
          onApercu={setApercuRayon}
        />
      </div>

      {/* Suite de la MÊME barre : les filtres. Séparés d'un trait fin plutôt
          que d'une bordure pleine — au-dessus on choisit CE QU'ON REGARDE,
          ici CE QU'ON RETIENT, mais les deux valent pour les trois onglets. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
          padding: '0 20px 12px',
          borderBottom: '0.5px solid var(--border-subtle)',
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


        {/*
          ── LA SEULE COMMANDE DE CETTE BARRE QUI NE FILTRE RIEN ──────────
          Les autres décident de ce qu'on RETIENT ; celle-ci de comment on le
          LIT. Elle est ici quand même, parce que la barre vaut pour les
          quatre étapes et que la carte, elle aussi, est permanente.

          ⚠ Aucun recalcul : les enveloppes sont déjà en cache côté serveur et
          les cercles se dérivent des sites déjà chargés. C'est la raison pour
          laquelle cette case peut vivre dans la barre des filtres sans y
          apporter le coût des filtres.
        */}
        <Champ label="Lecture des zones">
          <div style={{ display: 'flex', gap: 4 }}>
            <Pastille
              actif={etat.fusionner}
              titre="Une enveloppe continue par bande — jusqu'où s'étend le risque"
              onClick={() => majEtat({ fusionner: true })}
            >
              Fusionnées
            </Pastille>
            <Pastille
              actif={!etat.fusionner}
              titre="Un cercle par site et par anneau — de quel site vient cette zone"
              onClick={() => majEtat({ fusionner: false })}
            >
              Site par site
            </Pastille>
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


      {/*
        ── LE TIROIR DES ANNEAUX, COMMUN AUX TROIS ONGLETS ────────────────
        Le profil décide de la classe de chaque carreau, donc de tous les
        chiffres de l'écran. Il vivait dans une colonne de l'onglet Rayons :
        régler un rayon qu'on lisait ailleurs obligeait à changer d'onglet,
        puis à revenir. Il se déplie maintenant sur place, où qu'on soit.
      */}
      {etat.atelier && (
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '0.5px solid var(--border-subtle)',
            background: 'var(--bg-level-2)',
            maxHeight: 340, overflowY: 'auto',
          }}
        >
          <PanneauProfil
            profil={etat.profil}
            onProfil={(p) => majEtat({ profil: p })}
            parClasse={resultatBandes.bandes?.par_classe ?? {}}
          />
        </div>
      )}

      {/*
        ── LES SIX CHIFFRES, PERMANENTS ───────────────────────────────────────

        Sous la barre de réglages et AU-DESSUS du corps : chaque geste de la
        barre les change, et ils doivent rester sous les yeux pendant qu'on
        règle. Les enfermer dans un panneau obligerait à y revenir après chaque
        réglage — ce que faisait l'écran précédent, dont les KPI vivaient dans
        l'onglet Territoires pendant qu'on posait les anneaux ailleurs.
      */}
      {/*
        La barre est ENTRE les réglages et les chiffres : c'est le geste du
        dessus qui déclenche le calcul, et ce sont les chiffres du dessous qui
        l'attendent. Posée ailleurs, il faudrait la chercher.
      */}
      <BarreProgression />

      <Perime actif={perime}>
        <BandeauKpi
          bandes={resultatBandes.bandes}
          sites={compteSites.compte}
          courbe={courbeTotale}
          rayonMax={rayonMaxProfil}
          maille={dimension}
          libelleCible={libelleCible}
        />
      </Perime>

      {/*
        ── CE QUI EST PROPRE À L'ONGLET ───────────────────────────────────
        Nommé, et sous la barre commune : sans ce libellé, un réglage visible
        seulement ici se lit comme un filtre général, et on le cherche ensuite
        sur les autres onglets.
      */}
      {/*
        ── LA RÉGLETTE LOCALE A DISPARU ──────────────────────────────────────

        Ce bloc s'annonçait comme propre à un seul onglet et portait une
        réglette de rayon à lui, plus une case « imposer le cercle à tous les
        sites ».
        L'en-tête annonçait « Seveso seuil haut 5 km », ce bloc calculait à
        500 m, et les deux chiffres se contredisaient à deux ordres de grandeur
        près — 390 112 contre 24 406 618.

        ⚠ **Toute réglette locale est un bug**, mais celle-ci n'était pas une
        négligence : l'onglet tournait sur un moteur dont le garde-fou de
        surface plafonne le rayon national à 1 179 m, et qui ne POUVAIT donc pas
        honorer le profil. C'est le moteur qui a changé (sql/221), pas seulement
        le câblage.

        Le sélecteur de maille, lui, n'était pas local : il décrit ce qu'on
        regarde, comme la cible et le territoire. Il a rejoint la barre commune.

        Ce qui est perdu avec ce bloc, et qu'il faut nommer : `forcer_rayon`,
        qui imposait le cercle même aux sites couverts par une servitude
        publiée. Le profil exprime la même intention autrement — `inclurePPRT`
        décide si la servitude prime sur l'anneau — mais la formulation n'est
        pas identique. `population_exposee_agregee` reste en base et garde ce
        paramètre.
      */}

      {/*
        ── CORPS : LE PANNEAU DE L'ÉTAPE À GAUCHE, LA CARTE À DROITE ───────

        ⚠ **UNE seule instance MapLibre, et elle ne se démonte JAMAIS** entre
        les étapes : seules les couches et la caméra changent. La remonter à
        chaque étape rechargerait le fond, les tuiles et la position — et le
        geste le plus fréquent du module est l'aller-retour entre ② et ③, donc
        on perdrait la vue de l'utilisateur précisément là où il revient le
        plus souvent.

        C'est pour cela que la carte est ICI, en dehors du ternaire des étapes,
        et non dans chacun des panneaux.
      */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside
          style={{
            width: carteSeule ? 0 : largeurPanneau,
            flexShrink: 0, minWidth: 0,
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            /*
             * ⚠ `visibility` et non `display: none` : le panneau reste dans le
             * flux, donc ses composants ne sont pas démontés. Les replier
             * relancerait tous leurs chargements au retour — et l'étape ④
             * perdrait son jeu en cours de construction.
             */
            visibility: carteSeule ? 'hidden' : 'visible',
          }}
        >
        {/* Le panneau de l'étape porte lui aussi des chiffres : le tableau de
            ③, les décomptes de ①, les classes de ④. Ils périment ensemble. */}
        <Perime
          actif={perime}
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
      {etape === 'sites' ? (
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          <PanneauSites
            compte={compteSites.compte}
            chargement={compteSites.chargement}
            libelleTerritoire={chemin.length > 0 ? chemin[chemin.length - 1].nom : 'la France entière'}
          />
        </div>
      ) : etape === 'zones' ? (
        <OngletZones
          profil={etat.profil}
          /* Pas de `onProfil` : le rayon vient de la réglette du menu unifié,
             et de nulle part ailleurs (lot 5). */
          cible={cible}
          libelleCible={libelleCible}
          gravites={niveaux}
          natures={natures}
          /* Le territoire du jeu est le DÉPARTEMENT du fil d'Ariane, jamais la
             région : `construire_zone_set` filtre sur `code_departement`, et
             lui passer un code de région ne lèverait pas — il ne trouverait
             simplement aucun carreau, et le jeu serait vide sans dire
             pourquoi. */
          territoire={chemin.find((c) => c.niveau === 'departement')?.code ?? null}
          jeuOuvert={etat.jeu}
          onJeuOuvert={(id) => majEtat({ jeu: id })}
          onFermer={onFermer}
        />
      ) : etape === 'rayon' ? (
        <OngletRayons
          profil={etat.profil}
          bandes={resultatBandes}
          courbe={resultatCourbe}
          cible={cible}
          libelleCible={libelleCible}
          maille={dimCourante.id}
          /* Le fil d'Ariane ne descend qu'au departement pour les bandes : le
             pre-calcul porte le departement et la commune en colonne, jamais
             une region. Le dernier segment de niveau 'departement' fait donc
             foi, et `null` vaut « France entiere ». */
          parent={chemin.find((c) => c.niveau === 'departement')?.code ?? null}
          nomPerimetre={chemin.length > 0 ? chemin[chemin.length - 1].nom : 'France entière'}
          gravites={niveaux}
          natures={natures}
          perim={perim}
        />
      ) : (
      /*
       * ⚠ EMPILÉS, et non plus côte à côte (2026-09-21).
       *
       * Le tableau et la choroplèthe latérale partageaient la largeur de
       * l'écran entier. Depuis que la carte permanente occupe la droite, cette
       * étape tient dans le panneau : mesuré à 480 px, la choroplèthe gardait
       * ses 340 px fixes et il restait une vingtaine de pixels au tableau, dont
       * chaque ligne se réduisait à un caractère.
       *
       * La choroplèthe N'EST PAS redondante avec la grande carte : celle-ci
       * montre les zones et les sites, celle-là peint les unités par part,
       * densité ou effectif. Deux questions différentes — d'où l'empilement
       * plutôt que la suppression.
       */
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Tableau */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', minWidth: 0 }}>
          {/*
            Le tableau, la ventilation par classe, les notes de lecture et les
            trois KPI vivent maintenant dans un composant à part — celui que le
            brief appelle « ③ Couverture ». Il lit le MÊME résultat que le
            tableau des bandes de l'onglet Rayons, donc les deux ne peuvent plus
            diverger : c'est un seul appel, pas deux calculs qu'on synchronise.
          */}
          {/*
            ⚠ Le tableau lit `bandesTableau` et NON `resultatBandes` : pendant
            une exploration, il montre les unités du territoire exploré pendant
            que le bandeau KPI garde celles du filtre Territoire. Deux lectures
            volontairement distinctes — et c'est le fil d'Ariane local qui dit
            laquelle on regarde.
          */}
          <TableauCouverture
            bandes={bandesTableau.bandes}
            etat={bandesTableau.etat}
            erreur={bandesTableau.erreur}
            aConstruire={bandesTableau.aConstruire}
            maille={mailleTableau}
            profil={etat.profil}
            libelleCible={libelleCible}
            descendable={peutDescendre(mailleTableau)}
            onDescendre={(code, nom) => {
              setExploration((c) => descendreExploration(c, mailleTableau, code, nom));
              // L'unité survolée appartient au niveau qu'on QUITTE : la garder
              // ferait surligner un code qui n'existe plus au niveau suivant —
              // ou pire, un homonyme, les nomenclatures INSEE de région et de
              // département se recouvrant sur 18 codes.
              setActif(null);
              setSelectionCarte(null);
            }}
            remontable={peutRemonter(exploration)}
            onRemonter={() => {
              setExploration(remonterExploration);
              setActif(null);
              setSelectionCarte(null);
            }}
            onSelection={(code) => setSelectionCarte(code)}
            actif={actif}
            onSurvol={setActif}
          />

          {/* Le fil d'Ariane LOCAL : sans lui, on lirait un tableau de
              départements sans savoir de quelle région, pendant que la barre
              du haut annonce « France entière ». */}
          {exploration.length > 0 && (
            <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10 }}>
              Exploration :{' '}
              <button
                type="button"
                onClick={() => { setExploration([]); setActif(null); setSelectionCarte(null); }}
                style={{
                  background: 'none', border: 0, padding: 0, cursor: 'pointer',
                  fontFamily: fInter, fontSize: 11, color: 'var(--brand-teal)',
                }}
              >
                {chemin.length > 0 ? chemin[chemin.length - 1].nom : 'France entière'}
              </button>
              {exploration.map((s) => <span key={s.code}> › {s.nom}</span>)}
              {' — '}le filtre Territoire de la barre, lui, n’a pas bougé.
            </p>
          )}
        </div>

        {/* Mini-carte — SOUS le tableau, plus à côté : voir l'en-tête du bloc. */}
        <aside
          style={{
            flexShrink: 0,
            borderTop: '0.5px solid var(--border-subtle)',
            padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: 12,
            overflow: 'auto', maxHeight: '55%',
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
              cadrageSur={selectionCarte}
              onSurvol={setActif}
              /*
                ⚠ Cliquer une unité SUR LA CARTE la sélectionne et recadre,
                comme un clic sur la ligne du tableau. Elle faisait DESCENDRE
                jusqu'au 2026-09-21, ce qui écrivait le filtre Territoire de la
                barre commune : on cliquait pour regarder de plus près, et tout
                l'écran changeait de sujet. Descendre est désormais le rôle des
                flèches du tableau, et d'elles seules.
              */
              onClic={(code) => setSelectionCarte(code)}
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
          ) : dimTableau.zones === null ? (
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
            <strong style={{ fontWeight: 500 }}>Outre-mer : calculable pour la Martinique
            et La Réunion</strong>, dont l’INSEE publie le carroyage 200 m dans le même
            fichier que la métropole (26 022 carreaux, 1 190 910 habitants). Y compris leurs
            14 sites Seveso et 26 périmètres PPRT.{' '}
            <strong style={{ fontWeight: 500 }}>La Guadeloupe, la Guyane et Mayotte ne sont
            pas carroyées par l’INSEE</strong> : leurs 603 sites, dont <strong style={{ fontWeight: 500 }}>31
            Seveso — les 27 de Guyane compris</strong>, n’ont donc aucune population exposée
            calculable. Un site y apparaît sans chiffre : c’est une donnée absente à la source,
            pas une exposition nulle.
          </p>
        </aside>
      </div>
      )}
        </Perime>
        </aside>

        {/*
          ── LA POIGNÉE ──────────────────────────────────────────────────
          Le panneau ③ porte un tableau ET une choroplèthe latérale, le ①
          trois lignes : une largeur unique ne peut pas convenir aux quatre
          étapes. On la règle, plutôt que d'arbitrer à leur place.
        */}
        {!carteSeule && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Largeur du panneau"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const depart = e.clientX;
              const initiale = largeurPanneau;
              const deplacer = (ev: PointerEvent) => {
                // Bornée : sous 320 px le tableau de ③ devient illisible, et
                // au-delà de 900 la carte ne montre plus rien d'utile.
                const l = Math.max(320, Math.min(900, initiale + ev.clientX - depart));
                setLargeurPanneau(l);
              };
              const relacher = () => {
                window.removeEventListener('pointermove', deplacer);
                window.removeEventListener('pointerup', relacher);
              };
              window.addEventListener('pointermove', deplacer);
              window.addEventListener('pointerup', relacher);
            }}
            style={{
              width: 5, flexShrink: 0, cursor: 'col-resize',
              background: 'var(--border-subtle)',
            }}
          />
        )}

        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <CarteRisque
            profil={etat.profil}
            apercu={apercuRayon}
            gravites={niveaux}
            natures={natures}
            fusionner={etat.fusionner}
          />

          {/*
            « Carte seule » replie le panneau au lieu d'appeler l'API plein
            écran : celle-ci sortirait la carte de l'overlay, donc du bandeau
            KPI et du fil d'Ariane — on verrait grand, sans plus savoir ce
            qu'on regarde ni comment en sortir.
          */}
          <button
            type="button"
            onClick={() => setCarteSeule((v) => !v)}
            aria-pressed={carteSeule}
            title={carteSeule
              ? 'Réafficher le panneau de l’étape'
              : 'Masquer le panneau et n’afficher que la carte'}
            style={{
              position: 'absolute', top: 10, right: 56, zIndex: 3,
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--card-overlay)',
              border: '0.5px solid var(--border-default)',
              fontFamily: fInter, fontSize: 11,
              color: carteSeule ? 'var(--brand-teal)' : 'var(--text-secondary)',
            }}
          >
            {carteSeule ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {carteSeule ? 'Afficher le panneau' : 'Carte seule'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Le module « Population à risque industriel ».
 *
 * Enveloppe {@link CorpsAnalyse} du fournisseur d'état : c'est lui qui lit
 * l'URL au montage et l'y reflète ensuite, de sorte qu'une vue se partage par
 * un simple lien et survive à un rechargement.
 */
export function AnalysePopulationOverlay(props: Props) {
  return (
    <FournisseurRisque>
      {/*
        Le registre des chargements enveloppe TOUT le corps : les sources qui
        chargent ne sont pas au même endroit de l'arbre (les bandes ici, la
        préparation des zones dans la carte, la construction d'un jeu dans le
        panneau ④), et chacune déclare sa piste sans savoir où la barre
        s'affiche.
      */}
      <FournisseurChargement>
        <CorpsAnalyse {...props} />
      </FournisseurChargement>
    </FournisseurRisque>
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
