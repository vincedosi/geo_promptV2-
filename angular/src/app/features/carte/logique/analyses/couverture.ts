import { formaterNombre } from '../../../../core/format/nombre';

/**
 * ④ Analyse — la couverture d'une zone (lot 4, T7) : le contrat de `GET /api/zones/[id]/couverture` côté écran, et la
 * logique PURE qui le lit (paramètre d'URL, tri, pagination, messages, résumé).
 *
 * Copie des constantes de `lib/zones/couverture.ts` (`DECOUPAGES`, `MESSAGES_REFUS_COUVERTURE`, bornes) : Angular n'importe
 * jamais le serveur (`isolement.test.ts`) ; `tests/unit/angular/couverture-paritaire.test.ts` verrouille l'égalité.
 * Les types de la réponse recopient les clés de `couverture_geometrie` (sql/269) et le drapeau `cache` de
 * `couverture_zone` / `couverture_zone_en_cache` (sql/270).
 *
 * Aucun import d'Angular ici : le test de parité (Vitest racine) importe ce fichier. Les messages d'une erreur HTTP
 * (`HttpErrorResponse`) sont dans `couverture-erreurs.ts`.
 */

/** Bornes de la base (sql/269, sql/272), copiées du serveur. */
export const RAYON_MIN_M = 100;
export const RAYON_MAX_M = 10_000;
export const MAX_VALEURS = 8;
export const MAX_CARREAUX_COUVERTURE = 400_000;

export const DECOUPAGES = ['forme', 'cp', 'iris', 'commune', 'departement'] as const;
export type Decoupage = (typeof DECOUPAGES)[number];
/**
 * Les découpages que ④ PROPOSE (pastilles, `?couverture=`) : commune et département (sql/275, lot 5) sont la maille
 * de ⑤ (TikTok) ; l'écran de ④ reste celui du lot 4.
 */
export const DECOUPAGES_ANALYSE = ['forme', 'cp', 'iris'] as const satisfies readonly Decoupage[];
export type DecoupageAnalyse = (typeof DECOUPAGES_ANALYSE)[number];

export const MESSAGES_REFUS_COUVERTURE = {
  zone_introuvable: 'Zone introuvable dans cet espace.',
  cible_inconnue: 'Cette cible n’est pas connue.',
  zone_trop_vaste: 'La zone est trop vaste : la couverture se calcule jusqu’à la taille d’une région.',
  trop_de_carreaux: `La zone compte plus de ${formaterNombre(MAX_CARREAUX_COUVERTURE)} carreaux habités.`,
  couverture_non_construite: 'La couverture n’est pas encore construite sur cette base.',
  decoupage_trop_fin_pays: 'Sur toute la France, le découpage par IRIS (48 872) ou par commune (34 918) est trop fin : '
    + 'choisissez le découpage par code postal.',
} as const;
export type RefusCouverture = keyof typeof MESSAGES_REFUS_COUVERTURE;

/** Les deux paramètres d'URL de la zone analysée (A-8) — ce que la version du § 18 sérialisera. */
export const PARAM_ZONE_ANALYSE = 'zoneAnalyse';
export const PARAM_COUVERTURE = 'couverture';
/** Défauts : population totale, zone telle quelle — `RequeteCouvertureSchema` du serveur. Le défaut ne s'écrit pas. */
export const CIBLE_PAR_DEFAUT = 'ind';
export const DECOUPAGE_PAR_DEFAUT: DecoupageAnalyse = 'forme';
/** La forme d'une cible admise par la route (`/^[a-z0-9_]{2,20}$/`) : une autre partirait en 400. */
const MOTIF_CIBLE = /^[a-z0-9_]{2,20}$/;
/** Un identifiant de zone (`uuid`) : la route répond 400 à toute autre chaîne, sans rien lire. */
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un territoire touché par la zone (tout découpage sauf `forme`). `part` est NULL si le territoire n'a pas de dénominateur. */
export interface LigneCouverture {
  code: string;
  nom: string | null;
  /** La commune de l'IRIS ; `null` dans les autres découpages. */
  commune: string | null;
  n_carreaux: number;
  /** A4 (sql/308) : NULL, jamais 0, pour un territoire non carroyé (population inconnue, `pop_totale` NULL aussi). */
  pop_en_zone: number | null;
  pop_totale: number | null;
  /** C24 (sql/327), cible ≠ `ind` seulement : la population TOTALE de l'unité, la diffusion qu'achète la plateforme. */
  pop_totale_ind?: number | null;
  /** En %, arrondie au dixième : l'AFFICHAGE. */
  part: number | null;
  /** B11 (sql/303) : la même part SANS arrondi, la seule que compare le seuil (`estRetenue`) ; NULL comme `part`. */
  part_brute: number | null;
  /**
   * A2 (sql/304), découpage CP seulement : les codes de l'UNITÉ — le groupe de codes postaux indiscernables (même
   * contour dans le référentiel, `cp_groupe`), triés ; `[code]` pour un code ordinaire. `code` est l'identifiant de
   * l'unité (son canonique) ; une ligne = une unité = une part. Absent sur les autres découpages.
   */
  membres?: string[];
  /**
   * A4 (sql/308), ligne d'un territoire NON CARROYÉ seulement (population inconnue, ARB-3) : l'unité est-elle dans la
   * zone ? C'est ce qui la retient (`estRetenue`), à défaut de part à comparer au seuil — toujours vrai pour une zone
   * pays (le territoire entier) ; pour une zone locale, `part_surface` ≥ la tolérance `inclusion_surface_inconnue` de
   * `reglages_conversion` (sql/309). Absent sur les autres lignes.
   */
  incluse?: boolean;
  /** A4 tour 1 (sql/309), zone locale, ligne inconnue seulement : part de la surface de l'unité dans la zone (0-1, au millième). */
  part_surface?: number;
}

/** La réponse 200 de la route : un chiffrage, servi du cache (`cache: true`) ou calculé. */
export interface ResultatCouverture {
  zone_id: string;
  cible: string;
  decoupage: Decoupage;
  surface_km2: number;
  n_carreaux: number;
  population: number;
  /** C24 round 1 (sql/330) : cible ≠ `ind`, la population TOTALE de la forme (la diffusion d'une maille exacte). */
  population_ind?: number;
  lignes: LigneCouverture[];
  hors_territoire: { n_carreaux: number; population: number };
  n_territoires: number;
  /**
   * A5 (ARB-4, sql/310) : le minimum de ménages d'un carreau compté — 0 pour la population totale, le réglage
   * `min_menages_cible` de `reglages_conversion` (11, secret statistique INSEE) pour toute autre cible. Les carreaux en
   * dessous sont écartés du chiffre ET des dénominateurs des parts.
   */
  min_menages: number;
  /** A5 : les carreaux de la zone écartés par ce minimum (avant = `n_carreaux` + écartés ; après = `n_carreaux`). */
  carreaux_ecartes: { n_carreaux: number; population: number };
  /**
   * Zone sans aucun carreau compté : `territoire_non_carroye` (Guadeloupe, Guyane, Mayotte…), `aucun_carreau`, ou
   * `carreaux_tous_ecartes` (A5 : des carreaux, tous sous le minimum de ménages).
   */
  motif_vide: 'territoire_non_carroye' | 'aucun_carreau' | 'carreaux_tous_ecartes' | null;
  territoires_non_carroyes: Array<{ code: string; nom: string }>;
  /**
   * C21 round 1 (sql/326) : zone nationale moins zones locales — les territoires non carroyés du pays que les zones
   * retirées recouvrent. Le retrait ne peut pas les chiffrer : leurs unités (population inconnue) restent dans la zone.
   * Absent pour toute autre zone.
   */
  inconnues_recouvertes?: Array<{ code: string; nom: string }>;
  reference: { source: string; millesime: number | string | null; population_france: number; n_carreaux_france: number };
  base_construite_le: string;
  calcule_le: string;
  cache: boolean;
  /** La version de la forme chiffrée (`custom_geo_zones.updated_at`, sql/270) : le contour se relit quand elle change. */
  zone_maj: string;
}

/**
 * `?couverture=<cible>.<decoupage>` → cible et découpage DE ④ (`DECOUPAGES_ANALYSE`). Absent ou illisible : les
 * défauts. Ne lève jamais.
 */
export function lireParamCouverture(brut: string | null | undefined): { cible: string; decoupage: DecoupageAnalyse } {
  const defaut = { cible: CIBLE_PAR_DEFAUT, decoupage: DECOUPAGE_PAR_DEFAUT };
  if (typeof brut !== 'string') return defaut;
  const point = brut.lastIndexOf('.');
  if (point <= 0) return defaut;
  const cible = brut.slice(0, point);
  const decoupage = brut.slice(point + 1);
  if (!MOTIF_CIBLE.test(cible) || !(DECOUPAGES_ANALYSE as readonly string[]).includes(decoupage)) return defaut;
  return { cible, decoupage: decoupage as DecoupageAnalyse };
}

/**
 * Un code de cible lu dans l'URL (`?cibleJeu=` de ⑤), ou `null` s'il n'en a pas la forme. Ne lève jamais.
 *
 * Contrôle de FORME seulement, à dessein (relecture 2, comportement gardé) : un code bien formé mais inconnu du
 * catalogue des cibles (`ind_xyz`) est ADMIS ici — lire le catalogue au chargement serait une lecture de plus à
 * l'ouverture de ⑤. La route de couverture le refuse ensuite (`cible_inconnue`, « Cette cible n’est pas connue. »),
 * dit dans la colonne de chaque plateforme ; le choix d'une autre cible le remplace.
 */
export function lireCible(brut: string | null | undefined): string | null {
  return typeof brut === 'string' && MOTIF_CIBLE.test(brut) ? brut : null;
}

/** La forme canonique de `?couverture=` : `null` (paramètre absent) pour les défauts. */
export function ecrireParamCouverture(r: { cible: string; decoupage: DecoupageAnalyse }): string | null {
  return r.cible === CIBLE_PAR_DEFAUT && r.decoupage === DECOUPAGE_PAR_DEFAUT ? null : `${r.cible}.${r.decoupage}`;
}

/** `?zoneAnalyse=` → l'identifiant, en minuscules, ou `null` s'il n'a pas la forme d'un uuid. */
export function lireZoneAnalyse(brut: string | null | undefined): string | null {
  return typeof brut === 'string' && MOTIF_UUID.test(brut) ? brut.toLowerCase() : null;
}

/** Un uuid lu dans l'URL, en minuscules ; `null` sinon. Le même contrôle, nommé pour ce qu'il fait (`?campagne=`, lot 6). */
export const lireUuid = lireZoneAnalyse;

export type CleTriCouverture = 'code' | 'nom' | 'pop_en_zone' | 'pop_totale' | 'part';
export type SensTri = 'asc' | 'desc';

/** Trie une COPIE ; une valeur absente (`null`) va toujours en fin de liste ; à égalité, le code départage. */
export function trierLignes(lignes: readonly LigneCouverture[], cle: CleTriCouverture, sens: SensTri): LigneCouverture[] {
  const signe = sens === 'asc' ? 1 : -1;
  return [...lignes].sort((a, b) => {
    const va = a[cle];
    const vb = b[cle];
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    let c = 0;
    if (va !== null && vb !== null) {
      c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr');
    }
    return c !== 0 ? c * signe : a.code.localeCompare(b.code);
  });
}

/** Une page de lignes (1-indexée, ramenée dans les bornes) : l'écran ne tronque jamais sans le dire. */
export function pageDeLignes<T>(lignes: readonly T[], page: number, taille = 50): { lignes: T[]; page: number; nPages: number } {
  const nPages = Math.max(1, Math.ceil(lignes.length / taille));
  const p = Math.min(Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)), nPages);
  return { lignes: lignes.slice((p - 1) * taille, p * taille), page: p, nPages };
}

const LIBELLES_DECOUPAGE: Readonly<Record<Decoupage, string>> = {
  forme: 'Telle quelle', cp: 'Par code postal', iris: 'Par IRIS', commune: 'Par commune', departement: 'Par département',
};

/** Le territoire d'un découpage, après « hors » : « hors code postal », « hors département »… */
const HORS_DECOUPAGE: Readonly<Record<Exclude<Decoupage, 'forme'>, string>> = {
  cp: 'code postal', iris: 'IRIS', commune: 'commune', departement: 'département',
};

export function libelleDecoupage(d: Decoupage): string {
  return LIBELLES_DECOUPAGE[d];
}

/** « 63,78 M » au-delà du million (deux décimales), sinon le nombre complet. */
function effectifFrance(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M` : formaterNombre(n);
}

/**
 * La phrase qui qualifie TOUS les chiffres d'un chiffrage, chiffre de tête compris et dans les trois découpages
 * (Q-J) : « Population des carreaux Filosofi 2021 (63,78 M en France) ». Sans elle, un client compare le total à la
 * population légale (≈ 2,04 M pour les Bouches-du-Rhône contre 1,91 M carroyés).
 */
export function phraseReference(r: Pick<ResultatCouverture, 'reference' | 'cible'>): string {
  const m = r.reference.millesime;
  const france = `${effectifFrance(r.reference.population_france)} en France${r.cible === CIBLE_PAR_DEFAUT ? '' : ' pour cette cible'}`;
  return `Population des carreaux Filosofi${m ? ` ${m}` : ''} (${france})`;
}

/** « ce territoire (Guadeloupe) », « ces territoires (Guadeloupe, Guyane) » ; la liste connue à défaut. */
function nomsNonCarroyes(r: Pick<ResultatCouverture, 'territoires_non_carroyes'>): string {
  const noms = r.territoires_non_carroyes.map((t) => t.nom).filter(Boolean);
  const liste = noms.length > 0 ? noms : ['Guadeloupe', 'Guyane', 'Mayotte'];
  return `${liste.length > 1 ? 'ces territoires' : 'ce territoire'} (${liste.join(', ')})`;
}

/**
 * Le message d'une zone SANS aucun carreau, à la place de « 0 » (Q-J) ; `null` si la zone en a. Le carroyage ne
 * couvre ni la Guadeloupe, ni la Guyane, ni Mayotte : là, « 0 » se lirait « personne n'habite ici ».
 */
export function messageZoneVide(r: Pick<ResultatCouverture, 'motif_vide' | 'territoires_non_carroyes'>): string | null {
  if (r.motif_vide === 'territoire_non_carroye') {
    return `Aucun habitant chiffrable : le carroyage Filosofi ne couvre pas ${nomsNonCarroyes(r)}. Ce n’est pas une population nulle, c’est une donnée absente à la source.`;
  }
  if (r.motif_vide === 'aucun_carreau') {
    return 'Aucun carreau habité dans cette zone (mer, étang, montagne inhabitée…) : aucun ménage fiscal n’y est recensé.';
  }
  if (r.motif_vide === 'carreaux_tous_ecartes') {
    return 'Tous les carreaux de la zone comptent moins de ménages que le minimum : leurs valeurs sont imputées par l’INSEE (secret statistique), aucun n’est compté pour cette cible.';
  }
  return null;
}

/**
 * A5 (ARB-4) : le minimum de ménages APPLIQUÉ et ce qu'il écarte, avant / après — jamais un ajustement silencieux.
 * « Minimum de ménages par carreau : 11 (secret statistique INSEE) · 581 carreaux comptés sur 618, 37 écartés » ;
 * « Minimum de ménages par carreau : 0 (population totale : tous les carreaux comptent) ». `null` pour une réponse
 * sans la clé (aucune ne devrait l'être : le cache d'avant sql/310 n'est plus servi).
 */
export function phraseMinimumMenages(r: { min_menages?: number; n_carreaux: number; carreaux_ecartes?: { n_carreaux: number } }): string | null {
  if (r.min_menages === undefined || r.min_menages === null) return null;
  const tete = `Minimum de ménages par carreau : ${formaterNombre(r.min_menages)}`;
  if (r.min_menages === 0) return `${tete} (population totale : tous les carreaux comptent)`;
  const ecartes = r.carreaux_ecartes?.n_carreaux ?? 0;
  const avant = r.n_carreaux + ecartes;
  return `${tete} (secret statistique INSEE : en dessous, valeurs imputées) · ${formaterNombre(r.n_carreaux)} carreau${r.n_carreaux > 1 ? 'x' : ''} compté${r.n_carreaux > 1 ? 's' : ''} sur ${formaterNombre(avant)}, ${formaterNombre(ecartes)} écarté${ecartes > 1 ? 's' : ''}`;
}

/** Une zone qui DÉBORDE sur un territoire non carroyé, mais compte des habitants ailleurs : l'avertir. */
export function avertissementNonCarroye(
  r: Pick<ResultatCouverture, 'motif_vide' | 'territoires_non_carroyes'> & Partial<Pick<ResultatCouverture, 'inconnues_recouvertes'>>,
): string | null {
  // C21 round 1 : une zone nationale moins des zones qui recouvrent un territoire non carroyé — jamais en silence.
  const recouverts = r.inconnues_recouvertes ?? [];
  if (recouverts.length > 0) {
    const noms = recouverts.map((t) => t.nom || t.code).join(', ');
    return `Les zones retirées recouvrent ${recouverts.length > 1 ? 'des territoires' : 'un territoire'} que le carroyage Filosofi ne couvre pas (${noms}) : `
      + 'leur population est inconnue, le retrait ne peut pas la chiffrer, et leurs unités restent dans la zone.';
  }
  if (r.motif_vide !== null || r.territoires_non_carroyes.length === 0) return null;
  return `La zone touche ${nomsNonCarroyes(r)}, que le carroyage Filosofi ne couvre pas : ses habitants n’y sont pas comptés.`;
}

/** « 1 786 habitants hors code postal (12 carreaux) » ; `null` en `forme` ou sans carreau hors territoire. */
export function ligneHorsTerritoire(r: Pick<ResultatCouverture, 'decoupage' | 'hors_territoire' | 'cible'>): string | null {
  if (r.decoupage === 'forme' || r.hors_territoire.n_carreaux === 0) return null;
  const n = r.hors_territoire.n_carreaux;
  const qui = r.cible === CIBLE_PAR_DEFAUT ? 'habitants' : 'de la cible';
  return `${formaterNombre(r.hors_territoire.population)} ${qui} hors ${HORS_DECOUPAGE[r.decoupage]} (${formaterNombre(n)} carreau${n > 1 ? 'x' : ''}) : comptés dans le total, absents du tableau.`;
}
