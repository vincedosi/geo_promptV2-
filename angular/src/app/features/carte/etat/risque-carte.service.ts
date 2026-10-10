import { Injectable, type Signal, computed, signal } from '@angular/core';
import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from '../logique/familles-icpe';
import { type TypeRisque, librellesDuType } from '../logique/types-risque';

/** Ce que la couche des sites consomme — recopie de `FiltresRisque` (`RisqueIndustrielLayer.tsx:66-81`). */
export interface FiltresRisque {
  /** Niveaux réglementaires. Défaut : les deux niveaux Seveso. */
  gravites: readonly string[];
  /** Types de risque retenus (`toxique`, `inflammable`…). Vide = tous. */
  typesRisque: readonly string[];
  inclureInactifs: boolean;
  /** Rayon de la zone calculée, en mètres. 0 = pas de zone. */
  rayonM: number;
  /** Afficher le halo de lecture autour du point. */
  afficherHalo: boolean;
}

/** Le compte remonté par la couche : « 1 259 sites dans la vue sur 1 327 », et combien ont un vrai périmètre PPRT. */
export interface CompteRisque {
  rendus: number;
  total: number;
  avecPprt: number;
}

/** L'état de la couche PPRT — recopie de `EtatCouchePprt` (`PprtLayer.tsx:48-53`). */
export interface EtatCouchePprt {
  /** `true` quand la carte est sous le plancher : rien n'est demandé. */
  sousLePlancher: boolean;
  rendus: number;
  total: number;
}

/**
 * Les libellés de nature que la route attend pour des types de risque choisis (`RisqueIndustrielLayer.tsx:263-269`) :
 * `librellesDuType` sur le seed des familles — la MÊME fonction que la légende, pour qu'un point filtré « toxique » soit
 * bien celui peint en toxique —, plus « Nature non précisée » quand `non_precise` est retenu.
 */
export function naturesDesTypes(types: readonly string[]): string[] {
  const natures = types.flatMap((t) => librellesDuType(t as TypeRisque, FAMILLES_ICPE_SEED));
  if (types.includes('non_precise')) natures.push(NATURE_NON_PRECISEE);
  return natures;
}

/**
 * L'état de la couche « Zones à risque industriel » et de la couche « Périmètre PPRT » — recopie, en signaux, de
 * `EtatRisqueIndustriel` (`app/map/_components/filter-panel/use-risque-industriel.ts`).
 *
 * Les deux défauts de React, et pourquoi : `niveaux` = les deux niveaux Seveso (1 327 sites sur 99 152 installations
 * classées : ouvrir sur « tout » noierait les sites qui comptent) ; `rayonM = 0`, la zone calculée est une lecture EN
 * PLUS, pas le défaut. `pprtActif = false` : la couche a un plancher de zoom (8), l'allumer par défaut montrerait une
 * case cochée qui ne produit rien tant qu'on n'a pas zoomé.
 *
 * Le PPRT vit dans le MÊME état (une seule section du panneau), mais c'est une couche distincte — une servitude
 * opposable, pas un rayon de notre invention.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle (comme le `useState` de `page.tsx`).
 */
@Injectable()
export class RisqueCarteService {
  readonly actif = signal(false);
  readonly niveaux = signal<readonly string[]>(['seveso_haut', 'seveso_bas']);
  readonly typesRisque = signal<readonly string[]>([]);
  readonly inclureInactifs = signal(false);
  readonly rayonM = signal(0);
  readonly afficherHalo = signal(true);
  /** Remonté par la couche des sites ; `null` tant qu'aucune lecture n'a abouti. */
  readonly compte = signal<CompteRisque | null>(null);

  readonly pprtActif = signal(false);
  /** Familles de `type_zone` retenues. Vide = toutes. */
  readonly pprtTypes = signal<readonly string[]>([]);
  readonly pprtEtat = signal<EtatCouchePprt | null>(null);

  /** Ce que la couche consomme (`useMemo` de React). */
  readonly filtres: Signal<FiltresRisque> = computed(() => ({
    gravites: this.niveaux(),
    typesRisque: this.typesRisque(),
    inclureInactifs: this.inclureInactifs(),
    rayonM: this.rayonM(),
    afficherHalo: this.afficherHalo(),
  }));

  /** Les libellés de nature envoyés à la route (vide = toutes). */
  readonly natures = computed(() => naturesDesTypes(this.typesRisque()));
}
