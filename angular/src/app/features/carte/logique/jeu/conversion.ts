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
export type LigneSeuil = Pick<LigneCouverture, 'pop_en_zone' | 'pop_totale' | 'part' | 'part_brute' | 'membres' | 'incluse'>;

/**
 * A4 (ARB-3) : le libellé de la ligne SÉPARÉE du bilan quand une unité à population inconnue est retenue (`n_inconnues`)
 * — une diffusion achetée qu'aucun chiffre d'habitants ne compte (ni `achetee`, ni `hors_zone`, ni le taux d'utile).
 */
export const LIBELLE_POPULATION_INCONNUE = 'Diffusion à population inconnue';

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
  /**
   * Maille CP (lignes à `membres`, sql/304) : les CODES achetés, membres des groupes retenus développés — ce que la
   * plateforme reçoit, et ce que comptent ses limites (A1, relecture de A2 : 981 codes pour 895 unités). Absent sinon.
   */
  n_codes?: number;
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
  /**
   * A4 (ARB-3) : unités retenues à population INCONNUE (territoire non carroyé), comptées dans `n_unites` mais dans
   * aucun chiffre d'habitants — la ligne « diffusion à population inconnue » du bilan. Absent s'il n'y en a aucune.
   */
  n_inconnues?: number;
}

/** Une maille exacte pour la recette (A-6) : zéro perte par construction, aucun calcul. */
export interface ResumeExact {
  exacte: true;
  /** Unités achetées : une (le polygone, le cercle de la recette), ou une par code d'une liste de codes postaux. */
  n_unites: number;
  /** Liste de codes postaux exacte : les codes de la liste (A1) ; absent sinon. */
  n_codes?: number;
  population: number;
  surface_km2: number;
  couverte: number;
  achetee: number;
  manques: 0;
  hors_zone: 0;
  taux_utile: 100;
  /** A4 (ARB-3) : maille pays, territoires ciblés à population inconnue (GP, GF, YT au 31/10) ; absent sinon. */
  n_inconnues?: number;
}

export type Resume = ResumeMaille | ResumeExact;

/**
 * Un dépassement d'une limite de la plateforme : un avertissement, jamais un refus (A-9). Depuis A1, aussi ce que le
 * mécanisme de poids (`plateformes_poids`, sql/305) a fait au plan CP :
 * - `multiplicateur_min` / `multiplicateur_max` : des multiplicateurs ramenés à la plage — `valeur` le plus extrême
 *   calculé (avant), `limite` la borne (après), `n` le nombre d'unités CP ramenées ;
 * - `nb_max_entrees` : `valeur` codes envoyés pour `limite` par envoi, découpés en `n` envois.
 * Depuis A3, `disque_hors_france` (`avertissementsDisque`) : le disque d'un rayon autour d'un point déborde du
 * territoire — `limite` 100 (% du disque, avant : le cercle se disait exact), `valeur` la part en France (après).
 * `a_verifier` : la limite citée n'est pas confirmée (amendement E9, affiché à côté de la valeur).
 */
export interface Avertissement {
  code: 'max_unites' | 'pop_min_groupe' | 'multiplicateur_min' | 'multiplicateur_max' | 'nb_max_entrees' | 'disque_hors_france';
  limite: number;
  valeur: number;
  n?: number;
  /** `nb_max_entrees` : le mécanisme qui porte la limite (`script`…). */
  mecanisme?: string;
  a_verifier?: true;
}

/**
 * LA règle de rétention d'une unité, pour TOUTES les mailles territoriales (CP, commune, département, IRIS) : sa part
 * (en %) atteint le seuil — la borne est retenue, comme dans `appliquer_seuil_zone_set`. Exportée pour que
 * l'extraction marque `retenu` par la MÊME règle que le bilan, et l'écran (couche de la carte) aussi.
 *
 * B11 : la part comparée est `part_brute`, NON arrondie — `part`, au dixième, n'est que l'affichage (19,96 % s'affiche
 * 20,0 % mais ne passe pas un seuil de 20 %). Une part nulle n'est jamais retenue, même à seuil 0 (on n'achète pas une
 * unité où la zone n'a personne) ; 0,02 % (affichée 0,0 %) l'est. Même règle en SQL dans `paver_cercles` (sql/303).
 *
 * A4 (ARB-3) : une part NULL — territoire non carroyé, population totale inconnue — ne se compare à AUCUN seuil. Ce
 * qui retient une telle unité : être ENTIÈRE dans la zone (`incluse`, posé par la base, sql/308), car sa part vaut alors
 * 100 % quelle que soit sa population. Pour une zone nationale (recette `pays`), c'est toute unité du territoire de la
 * recette ; pour une zone locale, `ST_Covers(zone, unité)`. Une unité seulement touchée, ou dont l'inclusion n'est pas
 * dite (ligne figée avant sql/308), n'est jamais retenue : on ne sait pas ce qu'on achèterait de la zone.
 */
export function estRetenue(ligne: Pick<LigneSeuil, 'part_brute'> & Partial<Pick<LigneSeuil, 'incluse'>>, seuil: number): boolean {
  if (ligne.part_brute === null) return ligne.incluse === true;
  return ligne.part_brute > 0 && ligne.part_brute >= seuil;
}

/**
 * Retient les unités dont la part (en %) atteint le seuil ({@link estRetenue}) — la borne est retenue, comme dans `appliquer_seuil_zone_set`.
 * Une ligne à `part_brute` NULL (population inconnue, A4) n'est retenue que si elle est entière dans la zone : comptée
 * dans `n_unites` et `n_inconnues`, dans AUCUN chiffre d'habitants (ni `couverte`, ni `achetee` : on ne les connaît pas).
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
  let n_codes = 0;
  let n_inconnues = 0;
  let couverte = 0;
  let achetee = 0;
  for (const l of lignes) {
    if (!estRetenue(l, seuil)) continue;
    n_unites += 1;
    n_codes += l.membres?.length || 1;
    // A4 : retenue sans population (entière dans la zone) — achetée, comptée à part, jamais à 0 habitant.
    if (l.pop_totale === null) n_inconnues += 1;
    couverte += l.pop_en_zone ?? 0;
    achetee += l.pop_totale ?? 0;
  }
  return {
    exacte: false,
    n_unites,
    n_touchees: lignes.length,
    // Les codes, seulement pour une maille qui en a (lignes CP à `membres`, sql/304).
    ...(lignes.some((l) => l.membres !== undefined) ? { n_codes } : {}),
    couverte,
    achetee,
    manques: population - couverte,
    hors_zone: achetee - couverte,
    // En %, à une décimale : l'arrondi de `tauxUtile` (`plan.ts`), recopié et non importé — ce fichier est copié côté
    // Angular sans dépendance, et `tauxUtile` (non exporté) lit des `CpZone` du moteur risque.
    taux_utile: achetee > 0 ? Math.round((couverte / achetee) * 1000) / 10 : null,
    ...(n_inconnues > 0 ? { n_inconnues } : {}),
  };
}

/**
 * Le bilan d'une maille exacte (le polygone, ou une maille exacte pour la recette) : la zone telle quelle. `n_unites` :
 * une par défaut ; le nombre de codes d'une recette `codes_postaux` achetée au CP.
 */
export function resumeExact(population: number, surface_km2: number, n_unites = 1, n_codes?: number): ResumeExact {
  return {
    exacte: true, n_unites, ...(n_codes !== undefined ? { n_codes } : {}), population, surface_km2, couverte: population, achetee: population, manques: 0, hors_zone: 0, taux_utile: 100,
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
 * autre rayon pave la zone, et la perte se calcule. A3 : et seulement si le disque est ENTIER en France
 * (`part_retenue` = 1, posée par la base, sql/307) — la zone est découpée sur le territoire, le disque acheté ne l'est
 * pas : un disque tronqué (mer, frontière) se pave comme les POI, la perte se calcule (`avertissementsDisque` le dit). Pas `rayon_poi` : sa zone est découpée par le périmètre de ①
 * (obligatoire, `executerRecette`), les cercles entiers en débordent — la perte se calcule.
 * Une maille exacte se fige sans calcul ni seuil (extraction, T8) : l'écran et le serveur lisent cette MÊME règle.
 */
export function exactitude(recette: Recette, maille: Maille, ligne?: PlateformeGeo, rayonChoisi?: number): 'exacte' | 'calculee' {
  if (maille === 'polygone') return 'exacte';
  // Le ciblage pays d'une zone nationale : la zone telle quelle (⑤ finitions, A-4).
  if (maille === 'pays' && recette.type === 'pays') return 'exacte';
  if (maille === 'cp' && recette.type === 'codes_postaux') return 'exacte';
  if (maille === 'cercle' && recette.type === 'rayon_point' && recette.part_retenue === 1 && rayonAdmis(recette.rayon_m, ligne)
      && (rayonChoisi === undefined || rayonChoisi === recette.rayon_m)) return 'exacte';
  return 'calculee';
}

/**
 * A3 — le disque d'un rayon autour d'un point déborde du territoire français (`part_retenue` < 1, sql/307) : au
 * cercle, la plateforme achète le disque ENTIER, mer ou étranger compris, une diffusion qu'aucun carreau ne compte.
 * L'avertissement dit l'avant (100 % du disque, le cercle se disait exact) et l'après (la part en France, en %, une
 * décimale) ; la perte en population est celle du pavage (`paver_cercles`, la méthode des POI). Mer et étranger ne se
 * distinguent pas : `france_borders` est un seul contour terrestre. Aucun avertissement pour une autre maille (ses
 * unités sont françaises), ni pour une part inconnue (déjà « calculée » par `exactitude`, sans chiffre à dire).
 */
export function avertissementsDisque(recette: Recette | null, maille: Maille): Avertissement[] {
  if (maille !== 'cercle' || recette?.type !== 'rayon_point' || recette.part_retenue === undefined || recette.part_retenue >= 1) return [];
  return [{ code: 'disque_hors_france', limite: 100, valeur: Math.round(recette.part_retenue * 1000) / 10 }];
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
  // Un DROM non carroyé a sa ligne depuis sql/308 (A4), sans population : il ne retire rien à la métropole.
  const metropole = population - lignesDrom.reduce((somme, l) => somme + (l.pop_totale === null ? 0 : l.pop_en_zone ?? 0), 0);
  return codes.map((code) => ({
    code,
    nom: NOMS_PAYS[code] ?? code,
    population: code === 'FR' ? metropole : popDrom(DEPARTEMENT_DROM[code]),
  }));
}

/**
 * Le bilan de la maille pays d'une zone pays (exacte) : la zone telle quelle, une unité par code ciblé — TOUTES
 * retenues, puisque la zone est le territoire entier (la règle d'A4 : une unité entière dans la zone est retenue, même
 * sans population). `n_inconnues` : les territoires ciblés à population inconnue (A4, ARB-3), absent s'il n'y en a pas.
 * Le même bilan à l'écran et à l'extraction.
 */
export function resumePays(unites: readonly UnitePays[], population: number, surface_km2: number): ResumeExact {
  const n_inconnues = unites.filter((u) => u.population === null).length;
  return { ...resumeExact(population, surface_km2, unites.length), ...(n_inconnues > 0 ? { n_inconnues } : {}) };
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
 * Les limites de la ligne que le bilan dépasse. `max_unites` porte sur les unités achetées — en CODES au CP
 * (`n_codes`, groupes développés, A1) —, maille exacte comprise :
 * une liste de codes postaux exacte au CP peut dépasser le plafond de la plateforme (relecture T5). `pop_min_groupe`
 * porte sur la diffusion achetée — le palier unique d'A-9. `max_sommets` n'est pas vérifié ici : aucune forme n'est
 * simplifiée par ce module (le polygone part tel que ③ l'a enregistré).
 */
export function verifierLimites(resume: Resume, ligne: PlateformeGeo): Avertissement[] {
  const { max_unites, pop_min_groupe } = ligne.limites;
  const avertissements: Avertissement[] = [];
  // Au CP, la plateforme reçoit des CODES (groupes développés) : c'est eux que la limite compte (A1).
  const achetees = resume.n_codes ?? resume.n_unites;
  if (max_unites !== undefined && achetees > max_unites) {
    avertissements.push({ code: 'max_unites', limite: max_unites, valeur: achetees });
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
