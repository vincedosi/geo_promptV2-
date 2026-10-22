import { formaterNombre } from '../../../../core/format/nombre';

/**
 * ④ Analyse — la couverture d'une zone (lot 4, T7) : le contrat de `GET /api/zones/[id]/couverture` côté écran, et la
 * logique PURE qui le lit (paramètre d'URL, tri, pagination, messages, résumé).
 *
 * Copie des constantes de `lib/zones/couverture.ts` (`DECOUPAGES`, `MESSAGES_REFUS_COUVERTURE`) : Angular n'importe
 * jamais le serveur (`isolement.test.ts`) ; `tests/unit/angular/couverture-paritaire.test.ts` verrouille l'égalité.
 * Les types de la réponse recopient les clés de `couverture_geometrie` (sql/269) et le drapeau `cache` de
 * `couverture_zone` / `couverture_zone_en_cache` (sql/270).
 *
 * Aucun import d'Angular ici : le test de parité (Vitest racine) importe ce fichier. Les messages d'une erreur HTTP
 * (`HttpErrorResponse`) sont dans `couverture-erreurs.ts`.
 */

export const DECOUPAGES = ['forme', 'cp', 'iris'] as const;
export type Decoupage = (typeof DECOUPAGES)[number];

export const MESSAGES_REFUS_COUVERTURE = {
  zone_introuvable: 'Cette zone n’existe pas dans cet espace.',
  cible_inconnue: 'Cette cible n’est pas connue.',
  zone_trop_vaste: 'La zone est trop vaste : la couverture se calcule jusqu’à la taille d’une région.',
  trop_de_carreaux: 'La zone compte plus de 400 000 carreaux habités.',
  couverture_non_construite: 'La couverture n’est pas encore construite sur cette base.',
} as const;
export type RefusCouverture = keyof typeof MESSAGES_REFUS_COUVERTURE;

/** Les deux paramètres d'URL de la zone analysée (A-8) — ce que la version du § 18 sérialisera. */
export const PARAM_ZONE_ANALYSE = 'zoneAnalyse';
export const PARAM_COUVERTURE = 'couverture';
/** Défauts : population totale, zone telle quelle — `RequeteCouvertureSchema` du serveur. Le défaut ne s'écrit pas. */
export const CIBLE_PAR_DEFAUT = 'ind';
export const DECOUPAGE_PAR_DEFAUT: Decoupage = 'forme';
/** La forme d'une cible admise par la route (`/^[a-z0-9_]{2,20}$/`) : une autre partirait en 400. */
const MOTIF_CIBLE = /^[a-z0-9_]{2,20}$/;
/** Un identifiant de zone (`uuid`) : la route répond 400 à toute autre chaîne, sans rien lire. */
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un territoire touché par la zone (découpage `cp` ou `iris`). `part` est NULL si le territoire n'a pas de dénominateur. */
export interface LigneCouverture {
  code: string;
  nom: string | null;
  /** La commune de l'IRIS ; `null` en découpage CP. */
  commune: string | null;
  n_carreaux: number;
  pop_en_zone: number;
  pop_totale: number | null;
  part: number | null;
}

/** La réponse 200 de la route : un chiffrage, servi du cache (`cache: true`) ou calculé. */
export interface ResultatCouverture {
  zone_id: string;
  cible: string;
  decoupage: Decoupage;
  surface_km2: number;
  n_carreaux: number;
  population: number;
  lignes: LigneCouverture[];
  hors_territoire: { n_carreaux: number; population: number };
  n_territoires: number;
  /** Zone sans aucun carreau : `territoire_non_carroye` (Guadeloupe, Guyane, Mayotte…) ou `aucun_carreau`. */
  motif_vide: 'territoire_non_carroye' | 'aucun_carreau' | null;
  territoires_non_carroyes: Array<{ code: string; nom: string }>;
  reference: { source: string; millesime: number | string | null; population_france: number; n_carreaux_france: number };
  base_construite_le: string;
  calcule_le: string;
  cache: boolean;
}

/** `?couverture=<cible>.<decoupage>` → cible et découpage. Absent ou illisible : les défauts. Ne lève jamais. */
export function lireParamCouverture(brut: string | null | undefined): { cible: string; decoupage: Decoupage } {
  const defaut = { cible: CIBLE_PAR_DEFAUT, decoupage: DECOUPAGE_PAR_DEFAUT };
  if (typeof brut !== 'string') return defaut;
  const point = brut.lastIndexOf('.');
  if (point <= 0) return defaut;
  const cible = brut.slice(0, point);
  const decoupage = brut.slice(point + 1);
  if (!MOTIF_CIBLE.test(cible) || !(DECOUPAGES as readonly string[]).includes(decoupage)) return defaut;
  return { cible, decoupage: decoupage as Decoupage };
}

/** La forme canonique de `?couverture=` : `null` (paramètre absent) pour les défauts. */
export function ecrireParamCouverture(r: { cible: string; decoupage: Decoupage }): string | null {
  return r.cible === CIBLE_PAR_DEFAUT && r.decoupage === DECOUPAGE_PAR_DEFAUT ? null : `${r.cible}.${r.decoupage}`;
}

/** `?zoneAnalyse=` → l'identifiant, en minuscules, ou `null` s'il n'a pas la forme d'un uuid. */
export function lireZoneAnalyse(brut: string | null | undefined): string | null {
  return typeof brut === 'string' && MOTIF_UUID.test(brut) ? brut.toLowerCase() : null;
}

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
  forme: 'Telle quelle', cp: 'Par code postal', iris: 'Par IRIS',
};

export function libelleDecoupage(d: Decoupage): string {
  return LIBELLES_DECOUPAGE[d];
}

/** « 1 906 400 habitants · 5 103 km² · 126 codes postaux » ; le découpage `forme` n'a pas de territoires. */
export function resumeCouverture(r: Pick<ResultatCouverture, 'population' | 'surface_km2' | 'decoupage' | 'n_territoires'>, libelleCible: string): string {
  const morceaux = [`${formaterNombre(r.population)} ${libelleCible}`, `${formaterNombre(Math.round(r.surface_km2))} km²`];
  if (r.decoupage === 'cp') morceaux.push(`${formaterNombre(r.n_territoires)} ${r.n_territoires > 1 ? 'codes postaux' : 'code postal'}`);
  if (r.decoupage === 'iris') morceaux.push(`${formaterNombre(r.n_territoires)} IRIS`);
  return morceaux.join(' · ');
}
