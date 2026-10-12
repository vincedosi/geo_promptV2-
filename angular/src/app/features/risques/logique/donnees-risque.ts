/**
 * Types et règles PURES des données partagées de l'écran risque (`etat/donnees-risque.service.ts`) : formes des
 * résultats (bandes, courbe, référentiel, contours), lecture d'un élément de `etat.chemin`, corps d'une erreur HTTP,
 * aplatissement du référentiel. Sortis du service au lot 4 (T22) : le service ne garde que les chargements et l'état.
 */
import { HttpErrorResponse } from '@angular/common/http';
import type { Bandes } from '../data/profil-risque.api';
import type { ReponseRefGeo } from '../data/referentiel.api';
import type { FiltresCompte } from '../data/sites-risque.api';
import type { FiltresCourbe, ReponseCourbe } from '../data/zones-risque.api';

/** Les contours d'une maille : `null` en chargement, `'indisponible'` après un échec (jamais gardé en cache). */
export type ContoursMaille = GeoJSON.Feature[] | null | 'indisponible';

/** Un territoire du fil d'Ariane, son nom résolu par le référentiel (`AnalysePopulationOverlay.tsx:114`). */
export interface Segment { niveau: 'region' | 'departement'; code: string; nom: string }

/** Un code de territoire et son libellé, pour les menus de périmètre. */
export interface UniteRef { code: string; nom: string }

export interface RefGeo {
  regions: UniteRef[];
  departements: UniteRef[];
  /** Les départements de chaque région : la route les rend IMBRIQUÉS, l'aplatir perdrait le rattachement. */
  deptsParRegion: Record<string, string[]>;
}

export type EtatChargementBandes = 'chargement' | 'echec' | 'pret';

/** Résultat de `use-bandes.ts` : l'état VOYAGE avec la donnée — un tableau vide confondait les trois. */
export interface ResultatBandes {
  etat: EtatChargementBandes;
  bandes: Bandes | null;
  erreur: string | null;
  /** 409 « pré-calcul absent » : seul cas où l'écran doit dire de lancer le script. */
  aConstruire: boolean;
}

/** Résultat de `use-courbe-rayon.ts`. */
export interface ResultatCourbe {
  data: ReponseCourbe | null;
  chargement: boolean;
  erreur: string | null;
  aConstruire: boolean;
}

export type PointCourbe = ReponseCourbe['courbes'][number]['points'][number];

/** Anti-rebond des bandes (`use-bandes.ts:112`) : un calcul national coûte 2,8 s, un geste en émet plusieurs. */
export const DELAI_BANDES_MS = 400;

export const REF_VIDE: RefGeo = { regions: [], departements: [], deptsParRegion: {} };
export const BANDES_INITIALES: ResultatBandes = { etat: 'chargement', bandes: null, erreur: null, aConstruire: false };
export const BANDES_INACTIVES: ResultatBandes = { etat: 'pret', bandes: null, erreur: null, aConstruire: false };

/** Un élément `niveau:code` de `etat.chemin`, ou `null` s'il est mal formé (préfixe inconnu, code vide). */
export function lireElementChemin(el: string): { niveau: 'region' | 'departement'; code: string } | null {
  const i = el.indexOf(':');
  if (i < 0) return null;
  const niveau = el.slice(0, i);
  const code = el.slice(i + 1);
  if ((niveau !== 'region' && niveau !== 'departement') || code === '') return null;
  return { niveau, code };
}

/** Le corps JSON d'une réponse d'erreur, ou `null` (réseau, corps illisible) — React passait alors par son `catch`. */
export function corpsErreur(e: unknown): Record<string, unknown> | null {
  if (!(e instanceof HttpErrorResponse) || e.status === 0) return null;
  return e.error && typeof e.error === 'object' ? (e.error as Record<string, unknown>) : null;
}

/** La route rend les départements IMBRIQUÉS dans leur région : on aplatit sans perdre le rattachement (l.452-466). */
export function aplatirRef(j: ReponseRefGeo): RefGeo {
  const regions = (j.regions ?? []).map((x) => ({ code: x.code_region, nom: x.nom_region }));
  const departements = (j.regions ?? []).flatMap((x) => (x.depts ?? []).map((d) => ({ code: d.code_dept, nom: d.nom_dept })));
  const deptsParRegion: Record<string, string[]> = {};
  for (const x of j.regions ?? []) deptsParRegion[x.code_region] = (x.depts ?? []).map((d) => d.code_dept);
  return { regions, departements, deptsParRegion };
}

/**
 * `etat.chemin` (sérialisé `a|b`) résolu contre le référentiel. Un élément mal formé, ou dont le code n'existe pas, est
 * IGNORÉ ; référentiel en ÉCHEC : l'élément bien formé est gardé sous son code (voir `DonneesRisqueService.chemin`).
 */
export function resoudreChemin(brut: string, statut: 'chargement' | 'pret' | 'echec', ref: RefGeo): Segment[] {
  if (brut === '') return [];
  const segments: Segment[] = [];
  for (const el of brut.split('|')) {
    const lu = lireElementChemin(el);
    if (!lu) continue;
    const { niveau, code } = lu;
    const unite = (niveau === 'region' ? ref.regions : ref.departements).find((u) => u.code === code);
    if (unite) segments.push({ niveau, code, nom: unite.nom });
    else if (statut === 'echec') segments.push({ niveau, code, nom: code });
  }
  return segments;
}

/** Au moins un élément BIEN FORMÉ dans le chemin sérialisé : seul cas où attendre le référentiel a un sens. */
export function cheminBienForme(brut: string): boolean {
  return brut !== '' && brut.split('|').some((el) => lireElementChemin(el) !== null);
}

/** Une courbe en échec : le message du serveur s'il en donne un, et `a_construire` (409 pré-calcul absent). */
export function courbeEnEchec(e: unknown): ResultatCourbe {
  const corps = corpsErreur(e);
  return {
    data: null, chargement: false, aConstruire: Boolean(corps?.['a_construire']),
    erreur: typeof corps?.['error'] === 'string' ? (corps['error'] as string) : 'Courbe indisponible.',
  };
}

/** Des bandes en échec : sans corps (réseau), « n'a pas répondu » ; sinon le message du serveur et `a_construire`. */
export function bandesEnEchec(e: unknown): ResultatBandes {
  const corps = corpsErreur(e);
  return corps === null
    ? { etat: 'echec', bandes: null, aConstruire: false, erreur: 'Le calcul des bandes n’a pas répondu.' }
    : {
      etat: 'echec', bandes: null, aConstruire: corps['a_construire'] === true,
      erreur: typeof corps['error'] === 'string' ? corps['error'] : 'Calcul des bandes indisponible.',
    };
}

/** Une liste sérialisée `a,b` ; vide → aucune. */
const liste = (s: string): string[] => (s ? s.split(',') : []);

/** Le périmètre sérialisé `niveau:code` des clés de chargement ; vide → France entière. */
function perimetreDe(perim: string): { perimNiveau: 'region' | 'departement' | null; perimCode: string | null } {
  const [niveau, code] = perim ? perim.split(':') : [null, null];
  return { perimNiveau: niveau as 'region' | 'departement' | null, perimCode: code };
}

/** La lecture de la courbe, depuis sa clé `[cible, gravités, natures, périmètre]` (`DonneesRisqueService.cleCourbe`). */
export function parametresCourbe(cle: string): { gravites: string; filtres: FiltresCourbe } {
  const [cible, gravites, natures, perim] = JSON.parse(cle) as [string, string, string, string];
  return { gravites, filtres: { cible, natures: liste(natures), ...perimetreDe(perim) } };
}

/** Le comptage des sites, depuis sa clé `[gravités, natures, périmètre]` (`DonneesRisqueService.cleSites`). */
export function filtresSites(cle: string): FiltresCompte {
  const [gravites, natures, perim] = JSON.parse(cle) as [string, string, string];
  return { gravites: liste(gravites), natures: liste(natures), ...perimetreDe(perim) };
}
