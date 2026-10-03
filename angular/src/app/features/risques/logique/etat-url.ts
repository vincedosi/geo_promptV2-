/**
 * L'état unique du module « Population à risque industriel », et son
 * aller-retour avec l'URL.
 *
 * ── CE QUE CE FICHIER REMPLACE ────────────────────────────────────────────
 *
 * Vingt `useState` indépendants dans `AnalysePopulationOverlay.tsx`, et **rien**
 * dans l'adresse de la page — vérifié le 2026-09-19 : l'unique
 * `URLSearchParams` du composant construisait un appel API, pas une URL.
 *
 * Ce n'était pas un manque de confort. Un média planner ne pouvait pas envoyer
 * sa vue à un collègue, un rechargement perdait tous les réglages, et le bouton
 * « retour » du navigateur quittait le module au lieu de défaire un filtre.
 *
 * ── DEUX RÈGLES, ET POURQUOI ──────────────────────────────────────────────
 *
 * **Les valeurs par défaut ne s'écrivent pas.** Une URL fraîchement ouverte
 * doit être vide de paramètres, sans quoi on ne distingue plus ce que
 * l'utilisateur a choisi de ce qu'il a subi. C'est aussi ce qui rend un lien
 * partagé lisible.
 *
 * **La lecture ne lève JAMAIS.** L'URL vient de l'extérieur : d'un lien collé,
 * tronqué par un client de messagerie, ou écrit à la main. Une exception ici
 * afficherait un écran blanc, là où retomber sur le défaut affiche
 * l'application. Chaque champ est donc validé séparément et remplacé
 * individuellement — une nature illisible ne doit pas faire perdre la maille.
 */
import {
  DIMENSIONS_PROPOSEES,
  MODES_ZONE,
  modesValides,
  type Dimension,
  type ModeZone,
} from './dimensions';
import {
  GRAVITE_DU_NIVEAU,
  NIVEAUX,
  PROFIL_DEFAUT,
  type ProfilRayons,
} from './profil';
import { codeProfil, profilDepuisCode } from './code-profil';
import { ETAPES, ETAPES_HERITEES, type Etape } from './etape';

/*
 * Les trois onglets `rayons` / `territoires` / `zones` ont laissé place aux
 * QUATRE ÉTAPES du parcours le 2026-09-21 (`lib/risques/etape.ts`). Ils
 * restent lus comme alias hérités — un lien partagé ne se corrige pas après
 * coup.
 */

/**
 * L'état complet du module. Un seul objet, une seule source.
 *
 * Tout ce qui change un chiffre affiché est ici — et rien de ce qui n'est
 * qu'affichage transitoire (chargement, erreur, survol) : ces états-là vivent
 * dans les composants, parce que les sérialiser mettrait un spinner dans un
 * lien partagé.
 */
export interface EtatRisque {
  /** Code de la cible comptée, validé contre `cibles_exposition` côté serveur. */
  cible: string;
  /** Maille d'agrégation du tableau et de la carte. */
  maille: Dimension;
  /** Fil d'Ariane : les codes de territoire traversés, du plus large au plus fin. */
  chemin: string[];
  /** Natures de risque retenues. Vide = toutes. */
  natures: string[];
  /** Origine de la zone retenue autour d'un site. */
  modes: ModeZone[];
  /**
   * Gravités retenues, telles que `poi_france.sous_categorie` les écrit.
   *
   * ⚠ Ce sont des GRAVITÉS (`seveso_haut`, `ied`, `autorisation`…) et non les
   * niveaux du profil (`haut`, `bas`, `autres`). Les deux vocabulaires
   * coexistent et `niveauDeGravite` fait le pont : écrire `'haut'` ici ne
   * lèverait pas, le filtre ne trouverait simplement aucun site et l'écran
   * afficherait zéro habitant exposé — un résultat plausible, donc invisible.
   */
  gravites: string[];
  /** Le profil d'anneaux, qui décide de la classe de chaque carreau. */
  profil: ProfilRayons;
  /** L'étape ouverte du parcours. Le panneau de gauche en dépend, rien d'autre. */
  etape: Etape;
  /** Campagne confrontée, héritage de l'onglet Diffusion retiré. */
  /**
   * Jeu de zones ouvert dans l'onglet Zones, ou `null` pour un jeu non encore
   * enregistré (le profil courant fait alors foi).
   */
  jeu: string | null;
  /**
   * Le tiroir de réglage des anneaux est-il déplié ?
   *
   * Il vit dans l'URL comme le reste : le profil décide de la classe de chaque
   * carreau, donc de TOUS les chiffres de l'écran. Un lien partagé doit pouvoir
   * montrer d'où ils viennent, pas seulement ce qu'ils valent.
   */
  atelier: boolean;
  /**
   * Les zones sont-elles affichées fusionnées par bande, ou site par site ?
   *
   * ⚠ C'est le SEUL champ de cet état qui ne change aucun chiffre — et il est
   * ici quand même. Le commentaire de tête dit « tout ce qui change un chiffre
   * affiché », ce qui l'exclurait ; mais la règle qu'il sert est « un lien
   * partagé doit rendre la vue de son auteur », et deux lecteurs qui voient
   * l'un des enveloppes et l'autre des cercles ne regardent pas la même carte.
   *
   * Aucun chargement n'en dépend : les cinq crochets de données prennent des
   * champs scalaires nommés (`code`, `cible`, `maille`, `cleNatures`…) et
   * jamais l'état entier, donc basculer cette case ne relance aucun calcul.
   * C'est vérifié, pas supposé — et c'est ce qui rend la bascule instantanée.
   */
  fusionner: boolean;
  campagne: string | null;
}

/**
 * L'état d'ouverture.
 *
 * `ind` est la population totale du carroyage Filosofi, la cible que tout le
 * monde comprend sans explication.
 */
export const ETAT_DEFAUT: EtatRisque = {
  cible: 'ind',
  maille: 'departement',
  chemin: [],
  natures: [],
  modes: [...MODES_ZONE],
  gravites: ['seveso_haut', 'seveso_bas'],
  profil: PROFIL_DEFAUT,
  /*
   * On ouvre sur la PREMIÈRE étape, et non plus sur les rayons.
   *
   * Le parcours commence par le choix des sites : régler un rayon avant de
   * savoir autour de quoi revient à répondre avant d'avoir la question. Les
   * liens qui portaient `onglet=rayons` continuent d'ouvrir l'étape ② — c'est
   * le rôle des alias hérités.
   */
  etape: 'sites',
  jeu: null,
  atelier: false,
  /*
   * Fusionné par défaut : c'est la lecture qui répond à la question du module
   * — « jusqu'où s'étend le risque » — sans faire croire à une intensité là où
   * il n'y a qu'une densité de sites. Le mode site par site répond à une autre
   * question, « de quel site vient cette zone », qu'on ne pose qu'ensuite.
   */
  fusionner: true,
  campagne: null,
};

/** Séparateur de liste. Les valeurs qui peuvent le contenir sont encodées. */
const SEP = '.';

/** Les gravités que la base peut porter, toutes familles confondues. */
const GRAVITES_CONNUES = new Set(NIVEAUX.flatMap((n) => [...GRAVITE_DU_NIVEAU[n]]));

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encode une liste dont les éléments peuvent contenir le séparateur.
 *
 * ⚠ Nécessaire : des natures de risque réelles portent des points et des
 * parenthèses (« Inflammables (ancienne nomenclature) »). Joindre naïvement
 * couperait la valeur en deux, et l'écran filtrerait sur une nature qui
 * n'existe pas — sans message, puisque le filtre serait syntaxiquement valide.
 */
const encoderListe = (valeurs: string[]): string =>
  valeurs.map((v) => encodeURIComponent(v)).join(SEP);

const decoderListe = (brut: string): string[] =>
  brut.split(SEP).map((v) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }).filter((v) => v !== '');

/**
 * Écrit l'état dans une chaîne de requête, en n'y mettant que ce qui diffère
 * du défaut.
 *
 * @param e - L'état courant.
 * @returns La chaîne de requête, sans `?`, vide si l'état est celui par défaut.
 *
 * @example
 * ecrireEtatUrl({ ...ETAT_DEFAUT, cible: 'pop_65_plus' }) // 'cible=pop_65_plus'
 */
export function ecrireEtatUrl(e: EtatRisque): string {
  const p = new URLSearchParams();
  if (e.cible !== ETAT_DEFAUT.cible) p.set('cible', e.cible);
  if (e.maille !== ETAT_DEFAUT.maille) p.set('maille', e.maille);
  if (e.chemin.length > 0) p.set('chemin', encoderListe(e.chemin));
  if (e.natures.length > 0) p.set('natures', encoderListe(e.natures));
  if (e.modes.length !== MODES_ZONE.length) p.set('modes', e.modes.join(SEP));
  if (e.gravites.join(SEP) !== ETAT_DEFAUT.gravites.join(SEP)) p.set('gravites', e.gravites.join(SEP));

  const code = codeProfil(e.profil);
  if (code !== codeProfil(ETAT_DEFAUT.profil)) p.set('profil', code);

  if (e.etape !== ETAT_DEFAUT.etape) p.set('etape', e.etape);
  if (e.jeu) p.set('jeu', e.jeu);
  if (e.atelier) p.set('atelier', '1');
  // `fusion=0` et non `fusion=1` : le défaut ne s'écrit pas, donc seul le mode
  // site par site laisse une trace — celui qu'on a choisi.
  if (!e.fusionner) p.set('fusion', '0');
  if (e.campagne) p.set('campagne', e.campagne);
  return p.toString();
}

/**
 * Relit un état depuis une chaîne de requête. Ne lève jamais.
 *
 * Chaque champ est validé et remplacé SÉPARÉMENT : un profil illisible ne doit
 * pas faire perdre la maille, ni une nature mal encodée effacer le fil
 * d'Ariane. Un état partiellement récupéré vaut mieux qu'un retour au défaut
 * complet, qui donnerait l'impression que le lien n'a rien transporté.
 *
 * @param p - Les paramètres de l'URL.
 * @returns Un état valide, complété par les valeurs par défaut.
 */
export function lireEtatUrl(p: URLSearchParams): EtatRisque {
  const maille = p.get('maille');
  /*
   * ⚠ `etape` d'abord, `onglet` ensuite — et jamais l'inverse. Une URL écrite
   * aujourd'hui porte les deux si elle a été construite à partir d'un ancien
   * lien, et c'est la valeur COURANTE qui doit gagner : l'alias ne sert qu'à
   * rattraper un lien qui n'a pas la nouvelle clé.
   */
  const etapeBrute = p.get('etape') ?? p.get('onglet');
  const jeu = p.get('jeu');
  const atelier = p.get('atelier');
  const campagne = p.get('campagne');
  const profilBrut = p.get('profil');
  const profil = profilBrut ? profilDepuisCode(profilBrut) : null;

  const gravitesBrutes = (p.get('gravites') ?? '')
    .split(SEP)
    .filter((g) => GRAVITES_CONNUES.has(g));

  return {
    cible: p.get('cible') ?? ETAT_DEFAUT.cible,
    /*
     * ⚠ Validé contre `DIMENSIONS_PROPOSEES` et non `DIMENSIONS`.
     *
     * `arrondissement` est une maille LÉGITIME de `population_exposee_agregee`,
     * mais `population_par_classe` — le moteur de cet écran depuis sql/221 — ne
     * la porte pas : le carroyage INSEE écrit déjà le code commune en
     * arrondissement pour Paris, Lyon et Marseille, donc les deux mailles
     * rendraient le même tableau sous deux noms.
     *
     * L'accepter ici la laisserait partir à la route, qui répondrait 400 : un
     * lien collé afficherait une erreur au lieu de l'écran.
     */
    maille: (DIMENSIONS_PROPOSEES as readonly string[]).includes(maille ?? '')
      ? (maille as Dimension)
      : ETAT_DEFAUT.maille,
    chemin: p.has('chemin') ? decoderListe(p.get('chemin') ?? '') : [],
    natures: p.has('natures') ? decoderListe(p.get('natures') ?? '') : [],
    // `modesValides` rend `null` quand rien n'est reconnu, et ce `null` signifie
    // « les deux modes » — jamais « aucun », qui viderait l'écran sans message.
    modes: modesValides(p.has('modes') ? (p.get('modes') ?? '').split(SEP) : null)
      ?? [...ETAT_DEFAUT.modes],
    gravites: gravitesBrutes.length > 0 ? gravitesBrutes : [...ETAT_DEFAUT.gravites],
    profil: profil ?? ETAT_DEFAUT.profil,
    etape: (ETAPES as readonly string[]).includes(etapeBrute ?? '')
      ? (etapeBrute as Etape)
      // Un alias hérité AVANT le repli : traiter `territoires` comme une valeur
      // invalide renverrait un ancien lien sur la première étape, donc ailleurs
      // que là où son auteur regardait.
      : ETAPES_HERITEES[etapeBrute ?? ''] ?? ETAT_DEFAUT.etape,
    jeu: jeu && MOTIF_UUID.test(jeu) ? jeu : null,
    atelier: atelier === '1',
    /*
     * Seul `fusion=0` défusionne. Toute autre valeur — absente, vide, « oui »,
     * tronquée par un client de messagerie — retombe sur le défaut fusionné,
     * qui est la lecture sûre : un `fusion=` mal transporté ne doit pas
     * remplacer les enveloppes par des centaines de cercles sans qu'on l'ait
     * demandé.
     */
    fusionner: p.get('fusion') !== '0',
    campagne: campagne && MOTIF_UUID.test(campagne) ? campagne : null,
  };
}
