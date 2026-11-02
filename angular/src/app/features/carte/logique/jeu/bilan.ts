import { DECOUPAGES, type Decoupage, type ResultatCouverture } from '../analyses/couverture';
import type { Recette } from '../zones/recette';
import {
  type Avertissement, type Resume, appliquerSeuil, avertissementsDisque, exactitude, resumeExact, resumePays, unitesPays, verifierLimites,
} from './conversion';
import {
  type DefautExplique, REGLAGES_DEFAUT_REPLI, type ReglagesDefaut, type Simulations, choisirDefaut, mailleParDefaut, simulationDe,
  simulationsRequises,
} from './conversion-defaut';
import { avertissementsRayon } from './conversion-rayon';
import { type ChoixMaille, type ChoixParPlateforme, SEUIL_PAR_DEFAUT, rayonParDefaut } from './mailles-url';
import { type Maille, PLATEFORMES, type Plateforme, type PlateformeGeo } from './plateformes';

/**
 * ⑤ Jeu de zones — le bilan d'un choix à partir de ce qui est EN MÉMOIRE (lot 5, T9) : quelle lecture il faut, où
 * elle se range, et ce qu'elle dit une fois lue. Fonctions PURES, sorties de `JeuZonesService` : l'état décide QUAND
 * lire, ce fichier décide QUOI lire et comment le compter. Aucun import d'Angular.
 */

/** La réponse 200 de `GET /api/zones/[id]/cercles` (`paver_cercles`, sql/276) : seuls les cercles RETENUS. */
export interface ResultatCercles {
  zone_id: string;
  cible: string;
  rayon_m: number;
  seuil: number;
  /** Cellules hexagonales examinées — pas des territoires. */
  n_candidates: number;
  n_cercles: number;
  /** A6 (sql/311) : chiffres du DISQUE de chaque cercle (pas de sa cellule hexagonale) — population, part, seuil. */
  cercles: Array<{ lon: number; lat: number; pop_en_zone: number; pop_totale: number; part: number }>;
  population: number;
  couverte: number;
  manques: number;
  hors_zone: number;
  achetee: number;
  taux_utile: number | null;
  /**
   * A6 (sql/311) : somme des `pop_totale` des cercles — elle dépasse `achetee` (l'union dédoublonnée) de
   * `chevauchement` habitants, comptés dans plusieurs disques voisins.
   */
  somme_disques?: number;
  chevauchement?: number;
  n_carreaux: number;
  /** A5 (ARB-4, sql/310) : le minimum de ménages appliqué aux carreaux de la zone, des cellules et de l'union. */
  min_menages: number;
  /** A5 : les carreaux de la zone écartés par ce minimum. */
  carreaux_ecartes: { n_carreaux: number; population: number };
  motif_vide: 'territoire_non_carroye' | 'aucun_carreau' | 'carreaux_tous_ecartes' | 'aucune_cellule_au_seuil' | null;
}

/** Le bilan d'une plateforme pour son choix courant : la perte (ou « exacte ») et les limites dépassées. */
export interface BilanPlateforme {
  resume: Resume;
  avertissements: Avertissement[];
  /**
   * Maille pays d'une zone pays : une unité par code ciblé (`unitesPays`, la règle de l'extraction) — code ISO,
   * libellé, population carroyée, `null` pour un territoire non carroyé (jamais 0, E10) ; absent sinon.
   */
  pays?: ReturnType<typeof unitesPays>;
}

/**
 * Les codes que la plateforme cible pour une zone pays (`plateformes_geo.codes_pays`, sql/300), dans l'ordre de la
 * table ; vide pour une autre recette ou une autre maille.
 */
function codesPays(c: ChoixMaille, ligne: PlateformeGeo, recette: Recette | null): readonly string[] {
  return c.maille === 'pays' && recette?.type === 'pays' ? ligne.codes_pays?.[recette.code] ?? [] : [];
}

/**
 * Une zone sans recette lisible (d'avant le lot 3) : la règle du serveur à l'extraction est « seule la forme exacte
 * est exacte » — exactement ce que `exactitude` rend pour un dessin. Une seule règle, donc, des deux côtés.
 */
export const SANS_RECETTE: Recette = { v: 1, type: 'dessin' };

/**
 * Un choix bien formé : une maille cercle reçoit un rayon (le donné, sinon `rayonParDefaut`, tiré de la surface de la
 * zone sans rayon de recette — B10), une autre n'en porte pas.
 */
export function choixNeuf(
  maille: Maille, seuil: number, rayon: number | undefined, ligne: PlateformeGeo | undefined, recette: Recette | null, surface_km2?: number | null,
  registre?: readonly PlateformeGeo[],
): ChoixMaille {
  return maille === 'cercle' ? { maille, seuil, rayon_m: rayon ?? rayonParDefaut(ligne, recette, surface_km2, registre) } : { maille, seuil };
}

/**
 * Les choix de base : ceux du jeu ouvert (`enregistres`), sinon la maille par défaut de chaque plateforme au seuil par
 * défaut — B9 : celle de `defauts` (`defautsDe`, ARB-7) ; sans eux, l'ordre de finesse (A-4). Les choix explicites
 * (`?mailles=`) se posent par-dessus.
 */
export function choixDeBase(
  enregistres: readonly { plateforme: Plateforme; maille: Maille; seuil: number; rayon_m: number | null }[] | null,
  regles: readonly PlateformeGeo[], recette: Recette | null, defauts?: Partial<Record<Plateforme, DefautExplique>>, surface_km2?: number | null,
): ChoixParPlateforme {
  if (enregistres) {
    return Object.fromEntries(enregistres.map((c) => [c.plateforme, c.rayon_m === null
      ? { maille: c.maille, seuil: c.seuil } : { maille: c.maille, seuil: c.seuil, rayon_m: c.rayon_m }]));
  }
  const choix: ChoixParPlateforme = {};
  for (const p of PLATEFORMES) {
    const maille = defauts ? defauts[p]?.maille ?? null : mailleParDefaut(regles, p, recette ?? SANS_RECETTE);
    const ligne = regles.find((l) => l.plateforme === p && l.maille === maille);
    if (maille) choix[p] = choixNeuf(maille, SEUIL_PAR_DEFAUT, undefined, ligne, recette, surface_km2, regles);
  }
  return choix;
}

/**
 * B9 : les choix à SIMULER pour décider du défaut d'une plateforme (`simulationsRequises`) — chacun tel que le défaut le
 * deviendrait (seuil par défaut, rayon par défaut), donc chiffré par la MÊME lecture que le choix une fois adopté.
 */
export function choixASimuler(
  regles: readonly PlateformeGeo[], p: Plateforme, recette: Recette | null, surface_km2?: number | null,
): { choix: ChoixMaille; ligne: PlateformeGeo }[] {
  return simulationsRequises(regles, p, recette ?? SANS_RECETTE).flatMap((m) => {
    const ligne = regles.find((l) => l.plateforme === p && l.maille === m);
    return ligne ? [{ choix: choixNeuf(m, SEUIL_PAR_DEFAUT, undefined, ligne, recette, surface_km2, regles), ligne }] : [];
  });
}

/**
 * B9 (ARB-7 = A) : le défaut de chaque plateforme et sa raison (`choisirDefaut`), sur les lectures EN MÉMOIRE (`lu`,
 * celle que requiert le choix simulé) — aucune requête ici. Une simulation sans lecture et en échec (`echec`) est
 * `refusee` ; sans lecture ni échec, elle manque, et le défaut reste provisoire (`en_attente`). `reglages` : ceux de
 * `reglages_conversion` (sql/315) rendus par la route ; absents (réponse d'avant sql/315), leur repli documenté.
 */
export function defautsDe(
  regles: readonly PlateformeGeo[], recette: Recette | null, reglages: ReglagesDefaut | undefined,
  lu: (p: Plateforme, c: ChoixMaille, ligne: PlateformeGeo) => ResultatCouverture | ResultatCercles | undefined,
  echec: (p: Plateforme, c: ChoixMaille, ligne: PlateformeGeo) => boolean, surface_km2?: number | null,
): Partial<Record<Plateforme, DefautExplique>> {
  const sortie: Partial<Record<Plateforme, DefautExplique>> = {};
  for (const p of PLATEFORMES) {
    const simulations: Simulations = {};
    for (const { choix, ligne } of choixASimuler(regles, p, recette, surface_km2)) {
      const b = bilanDe(choix, ligne, recette, lu(p, choix, ligne));
      if (b) simulations[choix.maille] = simulationDe(b.resume);
      else if (echec(p, choix, ligne)) simulations[choix.maille] = 'refusee';
    }
    const d = choisirDefaut(regles, p, recette ?? SANS_RECETTE, simulations, reglages ?? REGLAGES_DEFAUT_REPLI);
    if (d) sortie[p] = d;
  }
  return sortie;
}

/** La maille rend-elle la zone telle quelle (A-6) ? Le rayon CHOISI compte : un autre rayon pave (T8). */
export function estExacte(c: ChoixMaille, ligne: PlateformeGeo, recette: Recette | null): boolean {
  return exactitude(recette ?? SANS_RECETTE, c.maille, ligne, c.rayon_m) === 'exacte';
}

/** Ce qu'il faut lire pour chiffrer un choix : un découpage de couverture (la forme pour une maille exacte), ou un pavage. */
export function lectureRequise(c: ChoixMaille, ligne: PlateformeGeo, recette: Recette | null): Decoupage | 'cercles' {
  // Le pays d'une zone pays : la couverture par DÉPARTEMENT dès qu'un DROM est ciblé (« France entière ») — elle porte
  // la population de la zone ET celle de chaque DROM, comme à l'extraction ; sinon la forme. Aucun carreau lu (sql/296).
  if (codesPays(c, ligne, recette).some((k) => k !== 'FR')) return 'departement';
  if (estExacte(c, ligne, recette)) return 'forme';
  if (c.maille === 'cercle') return 'cercles';
  // Le pays se chiffre par la couverture « telle quelle » de la zone nationale : aucun carreau lu (⑤ finitions, A-5).
  return c.maille === 'polygone' || c.maille === 'pays' ? 'forme' : c.maille;
}

/**
 * La clé d'une couverture en mémoire. `maj` (la date de mise à jour de la zone, donnée par la liste) y entre : une zone
 * recalculée en ③ (même id) revient en ⑤ sous une autre clé, donc se relit.
 */
export function cleCouverture(zone: string, maj: string | null, cible: string, decoupage: Decoupage): string {
  return `${zone}|${maj ?? ''}|${cible}|${decoupage}`;
}

/**
 * Une zone arrivée par l'URL est lue SANS date (`maj` inconnue) ; quand la liste la date ensuite, les entrées lues
 * passent sous la clé datée au lieu d'être jetées : c'est la même forme, et la purge de `rangerCouverture` (par
 * `zone_maj`) reste la seule garde de péremption. Les autres zones ne bougent pas.
 */
export function daterCouvertures(
  cache: ReadonlyMap<string, ResultatCouverture>, zone: string, maj: string,
): ReadonlyMap<string, ResultatCouverture> {
  const sansDate = `${zone}||`;
  return new Map([...cache].map(([k, v]) => [k.startsWith(sansDate) ? `${zone}|${maj}|${k.slice(sansDate.length)}` : k, v]));
}

/** Les couvertures EN MÉMOIRE de la zone et de la cible courantes, par découpage (`cle` : la clé de chacune). */
export function couverturesCourantes(
  cache: ReadonlyMap<string, ResultatCouverture>, cle: (d: Decoupage) => string,
): Partial<Record<Decoupage, ResultatCouverture>> {
  const sortie: Partial<Record<Decoupage, ResultatCouverture>> = {};
  for (const d of DECOUPAGES) {
    const r = cache.get(cle(d));
    if (r) sortie[d] = r;
  }
  return sortie;
}

/** Le dernier pavage de chaque plateforme, s'il est de cette zone et de cette cible ; les autres sont tus. */
export function cerclesCourants(
  pavages: Partial<Record<Plateforme, ResultatCercles>>, zone: string | null, cible: string,
): Partial<Record<Plateforme, ResultatCercles>> {
  return Object.fromEntries(Object.entries(pavages).filter(([, r]) => r.zone_id === zone && r.cible === cible));
}

/**
 * Range une couverture lue sous `cle`. Les entrées de la MÊME zone lues sur une AUTRE version de sa forme (`zone_maj`,
 * sql/270) sont retirées — jamais deux formes mêlées dans les bilans ; `purgee` le dit, pour retirer aussi les pavages.
 */
export function rangerCouverture(
  cache: ReadonlyMap<string, ResultatCouverture>, cle: string, r: ResultatCouverture,
): { cache: ReadonlyMap<string, ResultatCouverture>; purgee: boolean } {
  const zone = cle.slice(0, cle.indexOf('|') + 1);
  const suite = new Map<string, ResultatCouverture>();
  let purgee = false;
  for (const [k, v] of cache) {
    if (k.startsWith(zone) && v.zone_maj !== r.zone_maj) purgee = true;
    else suite.set(k, v);
  }
  return { cache: suite.set(cle, r), purgee };
}

/**
 * Le bilan d'un choix à partir de la lecture qu'il requiert (`lu`), ou `null` si elle manque ou est périmée : une
 * maille exacte par `resumeExact` sur la forme, une maille territoriale par `appliquerSeuil` — un seuil déplacé ne
 * requête rien —, un cercle par le pavage s'il est à ce rayon ET à ce seuil (calculés au serveur). La zone et la CIBLE
 * du pavage sont vérifiées en amont : `JeuZonesService.cercles` ne rend que ceux de la zone et de la cible courantes
 * (relecture T10-12 : une autre cible relit, test « changer de cible périme le pavage »).
 */
export function bilanDe(
  c: ChoixMaille, ligne: PlateformeGeo, recette: Recette | null, lu: ResultatCouverture | ResultatCercles | undefined,
): BilanPlateforme | null {
  if (!lu) return null;
  let resume: Resume;
  if (lectureRequise(c, ligne, recette) === 'cercles') {
    const k = lu as ResultatCercles;
    if (k.rayon_m !== c.rayon_m || k.seuil !== c.seuil) return null;
    resume = {
      exacte: false, n_unites: k.n_cercles, n_touchees: k.n_candidates, couverte: k.couverte, achetee: k.achetee,
      manques: k.manques, hors_zone: k.hors_zone, taux_utile: k.taux_utile,
      // A6 : la somme des lignes (disques), que le bilan compare à la diffusion achetée (`texteChevauchement`).
      ...(typeof k.somme_disques === 'number' ? { somme_disques: k.somme_disques } : {}),
    };
  } else {
    const cv = lu as ResultatCouverture;
    // Une liste de codes postaux achetée au CP : une unité par code (comme l'extraction, `convertirExacte`).
    // Une zone pays au pays : une unité par code ciblé (A-5).
    const codes = codesPays(c, ligne, recette);
    if (codes.length > 0) {
      const pays = unitesPays(codes, cv.population, cv.decoupage === 'departement' ? cv.lignes : null);
      // A4 (ARB-3) : les territoires à population inconnue comptés à part (`n_inconnues`), comme à l'extraction.
      resume = resumePays(pays, cv.population, cv.surface_km2);
      return { resume, avertissements: verifierLimites(resume, ligne), pays };
    }
    const nCodes = c.maille === 'cp' && recette?.type === 'codes_postaux' ? new Set(recette.codes).size : 1;
    resume = estExacte(c, ligne, recette) ? resumeExact(cv.population, cv.surface_km2, nCodes) : appliquerSeuil(cv.lignes, cv.population, c.seuil);
  }
  // A3 : le disque d'un rayon autour d'un point qui déborde du territoire (exact → calculé) se dit, comme à l'extraction.
  // B8 : le rayon de la recette hors des bornes de la plateforme (avant → après, exact → calculé), comme à l'extraction.
  return {
    resume,
    avertissements: [...verifierLimites(resume, ligne), ...avertissementsDisque(recette, c.maille), ...avertissementsRayon(recette, c.maille, ligne, c.rayon_m)],
  };
}

/** Une valeur par plateforme choisie et connue du registre ; les `undefined` sont omis. */
export function parPlateforme<V>(
  choix: ChoixParPlateforme, regle: (p: Plateforme, c: ChoixMaille) => PlateformeGeo | undefined,
  lire: (p: Plateforme, c: ChoixMaille, ligne: PlateformeGeo) => V | null | undefined,
): Partial<Record<Plateforme, V>> {
  const sortie: Partial<Record<Plateforme, V>> = {};
  for (const [p, c] of Object.entries(choix) as [Plateforme, ChoixMaille][]) {
    const ligne = regle(p, c);
    const v = ligne ? lire(p, c, ligne) : undefined;
    if (v !== undefined && v !== null) sortie[p] = v;
  }
  return sortie;
}
