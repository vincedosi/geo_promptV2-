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
  DIMENSIONS,
  MODES_ZONE,
  modesValides,
  type Dimension,
  type ModeZone,
} from '@/lib/risques/dimensions';
import {
  GRAVITE_DU_NIVEAU,
  NIVEAUX,
  PROFIL_DEFAUT,
  type ProfilRayons,
} from '@/lib/risques/profil';
import { codeProfil, profilDepuisCode } from '@/lib/risques/code-profil';

/** Les trois onglets, dans l'ordre du travail : on règle, on lit, on confronte. */
const ONGLETS = ['rayons', 'territoires', 'diffusion'] as const;

export type Onglet = (typeof ONGLETS)[number];

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
  onglet: Onglet;
  /** Campagne confrontée dans l'onglet Diffusion, ou `null`. */
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
  onglet: 'rayons',
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

  if (e.onglet !== ETAT_DEFAUT.onglet) p.set('onglet', e.onglet);
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
  const onglet = p.get('onglet');
  const campagne = p.get('campagne');
  const profilBrut = p.get('profil');
  const profil = profilBrut ? profilDepuisCode(profilBrut) : null;

  const gravitesBrutes = (p.get('gravites') ?? '')
    .split(SEP)
    .filter((g) => GRAVITES_CONNUES.has(g));

  return {
    cible: p.get('cible') ?? ETAT_DEFAUT.cible,
    maille: (DIMENSIONS as readonly string[]).includes(maille ?? '')
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
    onglet: (ONGLETS as readonly string[]).includes(onglet ?? '')
      ? (onglet as Onglet)
      : ETAT_DEFAUT.onglet,
    campagne: campagne && MOTIF_UUID.test(campagne) ? campagne : null,
  };
}
