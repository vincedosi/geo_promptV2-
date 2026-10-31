/**
 * ⑤ Jeu de zones — la conversion d'une zone dans une maille (lot 5, T9) : COPIE de `lib/zones/conversion.ts` (T5,
 * corrigé en T8) — seuil, perte, exactitude, maille par défaut, limites des plateformes. Logique PURE, sans I/O.
 *
 * L'écran rejoue le seuil avec CES fonctions (une réglette ne lance aucune requête, P-h) ; l'extraction rejoue les
 * mêmes côté serveur (A-5). `tests/unit/angular/conversion-paritaire.test.ts` exige que le corps de ce fichier soit
 * celui du serveur, mot pour mot : seuls cet en-tête et les chemins d'import diffèrent. Corriger ici = corriger là-bas.
 * Aucun import d'Angular : le test de parité (Vitest racine) importe ce fichier.
 */
import type { LigneCouverture } from '../analyses/couverture';
import type { PlateformeGeo } from './plateformes';
import type { Recette } from '../zones/recette';

type Maille = PlateformeGeo['maille'];
type Plateforme = PlateformeGeo['plateforme'];

/** Ce que le seuil lit d'une ligne de `couverture_geometrie` — rien d'autre, pour accepter aussi une ligne figée. */
export type LigneSeuil = Pick<LigneCouverture, 'pop_en_zone' | 'pop_totale' | 'part' | 'part_brute'>;

/**
 * Le bilan d'une maille calculée. Deux égalités, toujours (Review Focus 1) : `manques + couverte = population de la
 * zone` et `hors_zone + couverte = achetee`.
 */
export interface ResumeMaille {
  exacte: false;
  /** Unités retenues (part non arrondie ≥ seuil et > 0, {@link estRetenue}) — ce qui sera acheté. */
  n_unites: number;
  /** Unités touchées par la zone, retenues ou non. */
  n_touchees: number;
  /** Habitants de la zone dans les unités retenues. */
  couverte: number;
  /** Habitants des unités retenues, dans la zone ou non : la diffusion achetée. */
  achetee: number;
  /** Habitants de la zone qui ne seront pas touchés : unités écartées ET hors de tout territoire (on ne l'achète pas). */
  manques: number;
  /** Diffusion achetée hors de la zone. */
  hors_zone: number;
  /** `couverte / achetee` en %, une décimale, sur les SEULES unités retenues ; `null` si rien n'est acheté. */
  taux_utile: number | null;
}

/** Une maille exacte pour la recette (A-6) : zéro perte par construction, aucun calcul. */
export interface ResumeExact {
  exacte: true;
  /** Unités achetées : une (le polygone, le cercle de la recette), ou une par code d'une liste de codes postaux. */
  n_unites: number;
  population: number;
  surface_km2: number;
  couverte: number;
  achetee: number;
  manques: 0;
  hors_zone: 0;
  taux_utile: 100;
}

export type Resume = ResumeMaille | ResumeExact;

/** Un dépassement d'une limite de la plateforme : un avertissement, jamais un refus (A-9). */
export interface Avertissement {
  code: 'max_unites' | 'pop_min_groupe';
  limite: number;
  valeur: number;
}

/**
 * LA règle de rétention d'une unité : sa part (en %) atteint le seuil — la borne est retenue, comme dans
 * `appliquer_seuil_zone_set`. Une part NULL (territoire sans dénominateur) ne l'est jamais : on ne sait pas ce qu'on
 * achèterait. Exportée pour que l'extraction marque `retenu` par la MÊME règle que le bilan.
 *
 * B11 : la part comparée est `part_brute`, NON arrondie — `part`, au dixième, n'est que l'affichage (19,96 % s'affiche
 * 20,0 % mais ne passe pas un seuil de 20 %). Une part nulle n'est jamais retenue, même à seuil 0 (on n'achète pas une
 * unité où la zone n'a personne) ; 0,02 % (affichée 0,0 %) l'est. Même règle en SQL dans `paver_cercles` (sql/303).
 */
export function estRetenue(ligne: Pick<LigneSeuil, 'part_brute'>, seuil: number): boolean {
  return ligne.part_brute !== null && ligne.part_brute > 0 && ligne.part_brute >= seuil;
}

/**
 * Retient les unités dont la part (en %) atteint le seuil ({@link estRetenue}) — la borne est retenue, comme dans `appliquer_seuil_zone_set`.
 * Une ligne à `part_brute` NULL (territoire sans dénominateur) n'est jamais retenue : on ne sait pas ce qu'on achèterait.
 * `population` est celle de la zone (`couverture_geometrie.population`), hors-territoire compris.
 *
 * ⚠ Arrondis : la RPC arrondit à l'entier chaque `pop_en_zone`, `population` et `hors_territoire.population` (sql/275),
 * alors que les populations de carreaux sont fractionnaires (demi-habitants). `manques` (= population − couverte) et
 * la somme « CP écartés + hors territoire » diffèrent donc d'au plus ½ par ligne : −230 habitants sur les 895 CP de la
 * composite (24/10). L'écran affiche `manques` : c'est lui qui boucle avec la population de la zone affichée en tête
 * (`manques + couverte = population`) ; la somme des lignes d'un tableau peut s'en écarter de cet arrondi.
 */
export function appliquerSeuil(lignes: readonly LigneSeuil[], population: number, seuil: number): ResumeMaille {
  let n_unites = 0;
  let couverte = 0;
  let achetee = 0;
  for (const l of lignes) {
    if (!estRetenue(l, seuil)) continue;
    n_unites += 1;
    couverte += l.pop_en_zone;
    // Une part non nulle a un dénominateur ; `?? 0` ne sert que le typage.
    achetee += l.pop_totale ?? 0;
  }
  return {
    exacte: false,
    n_unites,
    n_touchees: lignes.length,
    couverte,
    achetee,
    manques: population - couverte,
    hors_zone: achetee - couverte,
    // En %, à une décimale : l'arrondi de `tauxUtile` (`plan.ts`), recopié et non importé — ce fichier est copié côté
    // Angular sans dépendance, et `tauxUtile` (non exporté) lit des `CpZone` du moteur risque.
    taux_utile: achetee > 0 ? Math.round((couverte / achetee) * 1000) / 10 : null,
  };
}

/**
 * Le bilan d'une maille exacte (le polygone, ou une maille exacte pour la recette) : la zone telle quelle. `n_unites` :
 * une par défaut ; le nombre de codes d'une recette `codes_postaux` achetée au CP.
 */
export function resumeExact(population: number, surface_km2: number, n_unites = 1): ResumeExact {
  return {
    exacte: true, n_unites, population, surface_km2, couverte: population, achetee: population, manques: 0, hors_zone: 0, taux_utile: 100,
  };
}

/** Le rayon est-il dans les bornes de la plateforme ? Une borne absente ne borne pas. */
function rayonAdmis(rayon_m: number, ligne?: PlateformeGeo): boolean {
  const { rayon_min_m, rayon_max_m } = ligne?.limites ?? {};
  return (rayon_min_m === undefined || rayon_m >= rayon_min_m) && (rayon_max_m === undefined || rayon_m <= rayon_max_m);
}

/**
 * La maille rend-elle la zone EXACTEMENT (A-6) ? Le polygone, toujours ; le CP pour une zone faite de codes postaux ;
 * le pays pour une zone pays (⑤ finitions) ; le cercle pour un rayon autour d'un point, si la plateforme admet ce rayon ET si le rayon choisi pour la plateforme
 * (`rayonChoisi`) est absent ou égal à celui de la recette — l'unité achetée est alors LE cercle de la recette ; un
 * autre rayon pave la zone, et la perte se calcule. Pas `rayon_poi` : sa zone est découpée par le périmètre de ①
 * (obligatoire, `executerRecette`), les cercles entiers en débordent — la perte se calcule.
 * Une maille exacte se fige sans calcul ni seuil (extraction, T8) : l'écran et le serveur lisent cette MÊME règle.
 */
export function exactitude(recette: Recette, maille: Maille, ligne?: PlateformeGeo, rayonChoisi?: number): 'exacte' | 'calculee' {
  if (maille === 'polygone') return 'exacte';
  // Le ciblage pays d'une zone nationale : la zone telle quelle (⑤ finitions, A-4).
  if (maille === 'pays' && recette.type === 'pays') return 'exacte';
  if (maille === 'cp' && recette.type === 'codes_postaux') return 'exacte';
  if (maille === 'cercle' && recette.type === 'rayon_point' && rayonAdmis(recette.rayon_m, ligne)
      && (rayonChoisi === undefined || rayonChoisi === recette.rayon_m)) return 'exacte';
  return 'calculee';
}

/**
 * De la plus fine à la plus grossière. Le cercle avant la commune : son rayon se règle, une commune ne se découpe
 * pas. L'IRIS n'est acheté par aucune plateforme au 24/10 (A-5) ; il prend son rang si une ligne le porte un jour.
 * Le pays en DERNIER (⑤ finitions, A-4) : il n'est jamais le défaut d'une zone qui n'est pas nationale.
 */
const FINESSE: readonly Maille[] = ['polygone', 'iris', 'cp', 'cercle', 'commune', 'departement', 'pays'];

/**
 * Les phrases d'une maille SANS OBJET pour la recette (⑤ finitions, A-3), refus `maille_sans_objet`.
 *
 * ⚠ COPIE DÉCLARÉE : `decoupage_pays` recopie `MESSAGES_REFUS_COUVERTURE.decoupage_trop_fin_pays`
 * (`lib/zones/couverture.ts`) — ce module n'importe que des types, il est recopié côté Angular.
 * `tests/unit/zones/conversion.test.ts` verrouille l'égalité.
 */
export const MESSAGES_MAILLE_SANS_OBJET = {
  cercles_pays: 'Sur toute la France, le ciblage par cercles n’a pas de sens : choisissez le pays.',
  decoupage_pays: 'Sur toute la France, le découpage par IRIS (48 872) ou par commune (34 918) est trop fin : '
    + 'choisissez le découpage par code postal.',
  pays_hors_zone_nationale: 'La maille pays ne s’achète que pour une zone nationale.',
} as const;

/**
 * LA règle « cette maille a-t-elle un sens pour cette recette ? » (⑤ finitions, A-3), la même au serveur (refus
 * d'enregistrer, d'extraire) et à l'écran (pastille grisée). Rend la phrase du refus, ou `null`.
 * - Zone pays : le cercle (80 km au plus, sur 547 779 km²) et les découpages trop fins (commune, IRIS) n'ont pas de
 *   sens ; CP, département, polygone et pays en ont (DV360 au CP reste le choix de l'utilisateur, § 16.1).
 * - Toute autre zone, et une recette illisible : seule la maille pays est sans objet — une campagne nationale passe
 *   par une zone nationale (Q-4 : on paierait 99 % de diffusion hors zone). L'écran ne l'affiche même pas.
 */
export function mailleSansObjet(recette: Recette | null, maille: Maille): string | null {
  if (recette?.type !== 'pays') return maille === 'pays' ? MESSAGES_MAILLE_SANS_OBJET.pays_hors_zone_nationale : null;
  if (maille === 'cercle') return MESSAGES_MAILLE_SANS_OBJET.cercles_pays;
  if (maille === 'commune' || maille === 'iris') return MESSAGES_MAILLE_SANS_OBJET.decoupage_pays;
  return null;
}

/**
 * Les libellés des codes pays que `plateformes_geo.codes_pays` porte (sql/300) : la France et les cinq DROM.
 *
 * EN DUR, À DESSEIN (relecture 1, déclaré dans l'en-tête de sql/300) : ces libellés et le département de chaque DROM
 * (`DEPARTEMENT_DROM`) sont des faits géographiques, pas des règles de plateforme. Un code ajouté en base sans entrée
 * ici fait échouer `tests/integration/plateformes-geo.test.ts`.
 */
export const NOMS_PAYS: Readonly<Record<string, string>> = {
  FR: 'France', GP: 'Guadeloupe', MQ: 'Martinique', GF: 'Guyane', RE: 'La Réunion', YT: 'Mayotte',
};

/** Le département de chaque DROM ciblé comme un pays : sa population se lit dans la couverture par département. */
const DEPARTEMENT_DROM: Readonly<Record<string, string>> = { GP: '971', MQ: '972', GF: '973', RE: '974', YT: '976' };

/** La note de `paysAVerifier` : ce qui n'est confirmé dans aucun compte pour « France entière » (Q-2). */
export const NOTE_PAYS_A_VERIFIER =
  'France entière : le ciblage des DROM comme pays distincts (GP, MQ, GF, RE, YT) n’est pas encore confirmé dans un compte.';

/**
 * Le ciblage pays de cette ligne est-il « à vérifier » POUR CETTE recette (relecture 1) ? Vrai quand le code de la
 * recette (`METRO`, `FR`) figure dans `pays_a_verifier` de la ligne — `FR` au 30/10, chez toutes les plateformes.
 * Un avertissement seulement : aucun défaut n'en dépend (la maille par défaut lit `a_verifier`, pas ceci).
 */
export function paysAVerifier(recette: Recette | null, ligne: PlateformeGeo | undefined): boolean {
  return recette?.type === 'pays' && ligne?.maille === 'pays' && (ligne.pays_a_verifier ?? []).includes(recette.code);
}

/** Une unité d'une plateforme au pays : un code ISO, son libellé, sa population carroyée (`null` : non carroyé). */
interface UnitePays { code: string; nom: string; population: number | null }

/**
 * Les unités d'une plateforme au pays (⑤ finitions, A-6), une par code de `codes_pays[code de la recette]`, dans
 * l'ordre de la table. `population` : celle de la zone (couverture « telle quelle », aucun carreau lu) ; `departements`
 * : les lignes de sa couverture par département, nécessaires dès qu'un code n'est pas `FR` (sinon `null`, rien lu).
 * - `FR` : la métropole, soit la zone moins les DROM qu'elle contient — la zone entière pour « France métropolitaine » ;
 * - un DROM : la population de son département ; `null`, JAMAIS 0, s'il n'est pas carroyé (E10 : Filosofi 2021 ne
 *   couvre que la Martinique et La Réunion) ou si le code est inconnu.
 */
export function unitesPays(
  codes: readonly string[], population: number,
  departements: readonly (Pick<LigneSeuil, 'pop_en_zone' | 'pop_totale'> & { code: string })[] | null,
): UnitePays[] {
  const drom = new Set(Object.values(DEPARTEMENT_DROM));
  const lignesDrom = (departements ?? []).filter((l) => drom.has(l.code));
  const popDrom = (dep: string | undefined) => {
    const l = lignesDrom.find((d) => d.code === dep);
    return l && l.pop_totale !== null ? l.pop_en_zone : null;
  };
  const metropole = population - lignesDrom.reduce((somme, l) => somme + l.pop_en_zone, 0);
  return codes.map((code) => ({
    code,
    nom: NOMS_PAYS[code] ?? code,
    population: code === 'FR' ? metropole : popDrom(DEPARTEMENT_DROM[code]),
  }));
}

/**
 * La maille proposée par défaut (A-4) parmi les mailles natives et disponibles de la plateforme : d'abord écarter les
 * mailles « à vérifier » (une maille exacte mais douteuse ne passe pas devant une maille sûre), puis préférer la maille
 * exacte pour la recette, puis la plus fine. Si toutes sont « à vérifier » (TTD au 24/10), le même ordre parmi elles :
 * le badge le dit à l'écran. `null` si la plateforme n'a aucune maille achetable. Une maille sans objet pour la recette
 * n'est pas candidate (`mailleSansObjet`) ; le pays, qui ne l'est que pour une zone nationale, y passe devant le
 * polygone, exact lui aussi (Q-1 du 30/10 : le ciblage pays d'office — TTD a les deux, toutes deux « à vérifier »).
 */
export function mailleParDefaut(lignes: readonly PlateformeGeo[], plateforme: Plateforme, recette: Recette): Maille | null {
  const rang = (l: PlateformeGeo) => [
    l.a_verifier ? 1 : 0,
    exactitude(recette, l.maille, l) === 'exacte' ? 0 : 1,
    l.maille === 'pays' ? -1 : FINESSE.indexOf(l.maille),
  ];
  // Une maille sans objet pour la recette n'est jamais le défaut (⑤ finitions, A-4).
  const candidates = lignes.filter((l) => l.plateforme === plateforme && l.natif && l.disponible && mailleSansObjet(recette, l.maille) === null);
  candidates.sort((a, b) => {
    const ra = rang(a);
    const rb = rang(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
  return candidates[0]?.maille ?? null;
}

/**
 * Les limites de la ligne que le bilan dépasse. `max_unites` porte sur les unités achetées, maille exacte comprise :
 * une liste de codes postaux exacte au CP peut dépasser le plafond de la plateforme (relecture T5). `pop_min_groupe`
 * porte sur la diffusion achetée — le palier unique d'A-9. `max_sommets` n'est pas vérifié ici : aucune forme n'est
 * simplifiée par ce module (le polygone part tel que ③ l'a enregistré).
 */
export function verifierLimites(resume: Resume, ligne: PlateformeGeo): Avertissement[] {
  const { max_unites, pop_min_groupe } = ligne.limites;
  const avertissements: Avertissement[] = [];
  if (max_unites !== undefined && resume.n_unites > max_unites) {
    avertissements.push({ code: 'max_unites', limite: max_unites, valeur: resume.n_unites });
  }
  if (pop_min_groupe !== undefined && resume.achetee < pop_min_groupe) {
    avertissements.push({ code: 'pop_min_groupe', limite: pop_min_groupe, valeur: resume.achetee });
  }
  return avertissements;
}

/** Les refus de `paver_cercles` (sql/276), tels que la RPC les rend dans `refus`. */
type RefusConversion =
  | 'zone_introuvable' | 'cible_inconnue' | 'zone_trop_vaste' | 'trop_de_candidates' | 'trop_de_cercles' | 'couverture_non_construite';

/**
 * Les refus de la conversion en cercles, en français — même forme que `MESSAGES_REFUS_COUVERTURE`, lue par
 * `repondreCouverture` (statut : 404, 503, sinon 422). Les chiffres (cercles retenus, plafond, rayon) partent à côté
 * du message, dans le corps de la réponse : l'écran les dit, aucun n'est écrit ici.
 *
 * ⚠ COPIE DÉCLARÉE : `zone_introuvable`, `cible_inconnue` et `couverture_non_construite` recopient les messages de la
 * couverture (`lib/zones/couverture.ts`) — ce module n'importe que des types, il est recopié côté Angular.
 * `tests/unit/zones/conversion.test.ts` verrouille l'égalité.
 */
export const MESSAGES_CONVERSION: Readonly<Record<RefusConversion, string>> = {
  zone_introuvable: 'Zone introuvable dans cet espace.',
  cible_inconnue: 'Cette cible n’est pas connue.',
  zone_trop_vaste: 'La zone est trop vaste pour ce rayon : augmentez le rayon ou réduisez la zone.',
  trop_de_candidates: 'La zone touche trop de cellules à paver : augmentez le rayon.',
  trop_de_cercles: 'Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.',
  couverture_non_construite: 'La couverture n’est pas encore construite sur cette base.',
};
