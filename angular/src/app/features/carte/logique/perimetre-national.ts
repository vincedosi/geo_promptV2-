/**
 * @file perimetre-national.ts — « France métropolitaine » et « France + DROM » comme PÉRIMÈTRES de la carte (retours du
 * 26/10, T3), propre à Angular.
 *
 * Avant ce lot, les pastilles « France Metro » / « France + DROM » de ① n'écrivaient que `perimetreScope` : ni les
 * gardes de ④, ni les recettes de ③, ni le fil d'Ariane ne la voyaient (diagnostic du 26/10, cause commune 1b, 3, 5).
 * Elles posent désormais un vrai `FiltreActif` de type `france` — `code: 'metro'` pour la métropole, `code: 'france'`
 * (la valeur d'avant) pour la France entière. Aucun type neuf : l'union de `filtre.ts` ne bouge pas.
 *
 * Les copies VERBATIM (`filtre.ts`, `bbox-requete.ts`, `garde-perimetre.ts`, `panneau-filtre-logique.ts`) ne sont pas
 * modifiées : ce module les ENVELOPPE. `bboxPourRequete` rend toujours `undefined` pour `france` (métropole comprise) :
 * les POI sont bornés par `scope` (`BBOX_METRO` côté route, T1), les tuiles par la vue.
 *
 * Écart à React (A-1, 26/10) : React garde la pastille comme simple `perimeterScope` ; ses régions, départements et
 * communes ne bornent pas les POI. Il n'est pas corrigé (gel P5, React retiré au lot 7).
 */
import { territoireDuFiltre } from './bataille/parametres';
import type { FiltreActif } from './filtre';
import { type OutilAnalyse, messageGardeOutil, messageRefusNational } from './garde-perimetre';

/** La pastille « France Metro ». */
export const FILTRE_METROPOLE: FiltreActif = Object.freeze({ type: 'france', code: 'metro', label: 'France métropolitaine' });
/** La pastille « France + DROM » : la valeur qu'écrivait le bouton « France entière », retiré (Vincent, 26/10, Q-2). */
export const FILTRE_FRANCE_ENTIERE: FiltreActif = Object.freeze({ type: 'france', code: 'france', label: 'France entière' });

/** Portée des POI (`scope` de `POST /api/map/pois`). */
export type ScopePerimetre = 'metro' | 'all' | null;

export function estMetropole(f: FiltreActif | null): boolean {
  return f?.type === 'france' && f.code === 'metro';
}

/**
 * La portée nationale tirée du filtre : `metro` pour la métropole, `all` pour la France entière. Un autre filtre ne
 * porte aucune portée nationale (`null`) — il borne déjà la requête. Sans filtre seulement, `repli` (le
 * `perimetreScope` hérité) : le filtre fait foi, la pastille ne peut plus le contredire.
 */
export function scopeDuFiltre(f: FiltreActif | null, repli: ScopePerimetre): ScopePerimetre {
  if (f?.type === 'france') return f.code === 'metro' ? 'metro' : 'all';
  return f ? null : repli;
}

/** Les outils de ④ admis sur la métropole : les batailles (bornées par leur capacité, T4) et le score. */
const ADMIS_EN_METROPOLE: ReadonlySet<OutilAnalyse> = new Set<OutilAnalyse>([
  'bataille_v1', 'bataille_v2', 'application_bataille', 'score_composite',
]);

/**
 * La garde de ④ (A-4) : `messageGardeOutil` à l'identique, sauf sur la métropole. Là, les batailles et le score
 * passent ; Voronoï et clustering refusent avec un message qui nomme la métropole. Le score sur la métropole reste
 * national, DROM compris (route inchangée).
 */
export function messageGardeCarte(outil: OutilAnalyse, filtre: FiltreActif | null, zone?: string | null): string | null {
  if (!estMetropole(filtre)) return messageGardeOutil(outil, filtre, zone);
  if (ADMIS_EN_METROPOLE.has(outil)) return null;
  // Le libellé de l'outil vient de la copie verbatim (non exporté) : on réécrit seulement le périmètre nommé.
  return messageRefusNational(outil)?.replace('sur la France entière', 'sur toute la France métropolitaine') ?? null;
}

/** Le territoire du corps de `POST /api/map/pois`. */
export interface CorpsPoisTerritoire {
  regions: string[];
  depts: string[];
  ville: string;
  code_postal?: string;
}

/**
 * Le territoire d'une recherche de POI tiré du filtre (retour 5 du 26/10) : région, département et commune comme la
 * bataille (`territoireDuFiltre`), plus le code postal (paramètre `code_postal`, T1). Une zone garde sa bbox, la France
 * sa portée : leur territoire est vide.
 */
export function corpsPoisDuFiltre(f: FiltreActif | null): CorpsPoisTerritoire {
  const t = territoireDuFiltre(f);
  return { regions: t.regions, depts: t.depts, ville: t.ville, ...(f?.type === 'cp' ? { code_postal: f.code } : {}) };
}
