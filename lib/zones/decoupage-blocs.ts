/**
 * @file lib/zones/decoupage-blocs.ts — B14 (ARB-6 = A) : le découpage en BLOCS d'une maille territoriale qui dépasse
 * la limite d'unités de la plateforme (`plateformes_geo.limites.max_unites`, 3 000 communes TikTok au 02/11).
 *
 * Logique PURE, sans I/O. Au-delà de la limite, les unités RETENUES sont découpées en N blocs numérotés à partir de 1,
 * triés par part décroissante (la part NON arrondie, `part_brute`, celle que compare le seuil ; à défaut `part`), à
 * part égale par code (ordre déterministe : deux extractions du même contenu font les mêmes blocs), une part inconnue
 * (A4, territoire non carroyé) en dernier. Chaque bloc compte au plus `limite` unités : le bloc 1 porte les plus fortes
 * parts, le dernier le reste. Le bilan est donné PAR BLOC (`BilanBloc`, mêmes égalités que `appliquerSeuil` :
 * `hors_zone + couverte = achetee`), et leur somme est le bilan de la maille.
 *
 * Le découpage n'est jamais silencieux : `verifierLimites` (conversion.ts) annonce `n` blocs dans l'avertissement
 * `max_unites`, à l'écran comme dans l'extraction figée. Seules les `MAILLES_DECOUPEES` le sont (une unité par entrée) ;
 * aucune limite n'est écrite ici, elle se lit dans la ligne du registre passée en argument.
 */
import { MAILLES_DECOUPEES } from './conversion';
import type { PlateformeGeo } from './plateformes';

/** Ce que le découpage lit d'une unité retenue (une ligne de `couverture_zone`, ou une unité figée). */
export interface LigneBloc {
  code: string;
  part: number | null;
  part_brute?: number | null;
  pop_en_zone: number | null;
  pop_totale: number | null;
}

/** Le bilan d'un bloc : ses unités et ses habitants, comptés comme le bilan de la maille. */
interface BilanBloc {
  /** À partir de 1 ; le bloc 1 porte les plus fortes parts. */
  numero: number;
  n_unites: number;
  couverte: number;
  achetee: number;
  hors_zone: number;
  /** `couverte / achetee` en %, une décimale ; `null` si rien n'est chiffré (toutes à population inconnue). */
  taux_utile: number | null;
  /** Parts extrêmes du bloc (l'affichage, au dixième) ; `null` si aucune n'est connue. */
  part_max: number | null;
  part_min: number | null;
  /** A4 : unités du bloc à population inconnue ; absent s'il n'y en a pas. */
  n_inconnues?: number;
}

/** Le découpage figé dans le résumé de la plateforme : la limite lue dans le registre, et chaque bloc. */
export interface Decoupage {
  limite: number;
  blocs: BilanBloc[];
}

const cle = (l: LigneBloc) => l.part_brute ?? l.part;

/** Part décroissante, inconnue en dernier, puis code croissant. */
function ordre(a: LigneBloc, b: LigneBloc): number {
  const pa = cle(a);
  const pb = cle(b);
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pb - pa;
  }
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function bilan(numero: number, lignes: readonly LigneBloc[]): BilanBloc {
  let couverte = 0;
  let achetee = 0;
  let n_inconnues = 0;
  const parts: number[] = [];
  for (const l of lignes) {
    if (l.pop_totale === null) n_inconnues += 1;
    couverte += l.pop_en_zone ?? 0;
    achetee += l.pop_totale ?? 0;
    if (l.part !== null) parts.push(l.part);
  }
  return {
    numero, n_unites: lignes.length, couverte, achetee, hors_zone: achetee - couverte,
    taux_utile: achetee > 0 ? Math.round((couverte / achetee) * 1000) / 10 : null,
    part_max: parts.length ? Math.max(...parts) : null,
    part_min: parts.length ? Math.min(...parts) : null,
    ...(n_inconnues > 0 ? { n_inconnues } : {}),
  };
}

/**
 * Découpe les unités RETENUES d'une plateforme en blocs sous `ligne.limites.max_unites`.
 *
 * @param retenues - Les unités retenues (l'ordre reçu ne compte pas).
 * @param ligne - La ligne de `plateformes_geo` de la plateforme et de la maille.
 * @returns `null` sans découpage (maille non découpée, aucune limite, ou limite non dépassée) ; sinon le bilan par
 *   bloc (`decoupage`) et le numéro de bloc de chaque code (`blocs`, dans l'ordre du découpage).
 */
export function decouperEnBlocs(
  retenues: readonly LigneBloc[], ligne: PlateformeGeo,
): { decoupage: Decoupage; blocs: ReadonlyMap<string, number> } | null {
  const limite = ligne.limites.max_unites;
  if (limite === undefined || retenues.length <= limite) return null;
  if (!(MAILLES_DECOUPEES as readonly string[]).includes(ligne.maille)) return null;
  const triees = [...retenues].sort(ordre);
  const blocs = new Map<string, number>();
  const bilans: BilanBloc[] = [];
  for (let debut = 0, numero = 1; debut < triees.length; debut += limite, numero += 1) {
    const bloc = triees.slice(debut, debut + limite);
    for (const l of bloc) blocs.set(l.code, numero);
    bilans.push(bilan(numero, bloc));
  }
  return { decoupage: { limite, blocs: bilans }, blocs };
}

/**
 * Les unités dans l'ordre du découpage — bloc 1 d'abord, part décroissante dans chaque bloc —, celles sans bloc (non
 * retenues) ensuite, dans l'ordre reçu. L'extraction les envoie ainsi : l'`ordinal` figé suit les blocs.
 */
export function dansLOrdreDesBlocs<T extends { code?: string }>(unites: readonly T[], blocs: ReadonlyMap<string, number>): T[] {
  const rang = new Map([...blocs.keys()].map((code, i) => [code, i]));
  const de = (u: T) => (u.code !== undefined ? rang.get(u.code) : undefined) ?? Number.MAX_SAFE_INTEGER;
  // `sort` est stable : les unités sans bloc gardent leur ordre.
  return [...unites].sort((a, b) => de(a) - de(b));
}
