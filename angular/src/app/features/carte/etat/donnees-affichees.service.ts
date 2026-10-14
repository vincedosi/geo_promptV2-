import { Injectable, type Signal, computed, inject } from '@angular/core';
import { CarreauxService } from '../couches/carreaux.service';
import { IndicateursCiviquesService } from '../couches/indicateurs-civiques.service';
import { IrisService } from '../couches/iris.service';
import { MeteoService } from '../couches/meteo.service';
import { PoisService } from '../couches/pois.service';
import { SanteService } from '../couches/sante.service';
import { TmjaService } from '../couches/tmja.service';
import { PREFIXE_POI } from '../logique/jeux-carte';
import { EtatCarteService } from './etat-carte.service';
import { RisqueCarteService } from './risque-carte.service';

/** Ce que la page sait de chaque jeu de ② : allumé ou non, et les types de POI choisis. */
export interface EtatAffichage {
  readonly iris: boolean;
  readonly carreaux: boolean;
  readonly civique: boolean;
  readonly transport: boolean;
  readonly tmja: boolean;
  readonly risques: boolean;
  readonly sante: boolean;
  readonly meteo: boolean;
  readonly pois: readonly string[];
}

/** Les clés des jeux de ② affichés, dans l'ordre du registre puis des POI choisis. Pur. Ni OOH ni radio (T11b). */
export function clesAffichees(e: EtatAffichage): ReadonlySet<string> {
  const paires: readonly (readonly [boolean, string])[] = [
    [e.iris, 'iris:socio-demo'], [e.carreaux, 'carreaux:filosofi'], [e.civique, 'civique:indicateurs-cp'],
    [e.transport, 'transport:arrets'], [e.tmja, 'tmja:comptages'], [e.risques, 'risques:icpe-pprt'],
    [e.sante, 'sante:air-pollen'], [e.meteo, 'meteo:zones'],
  ];
  return new Set([...paires.filter(([on]) => on).map(([, cle]) => cle), ...e.pois.map((id) => `${PREFIXE_POI}${id}`)]);
}

/**
 * « Affiché » pour ②, UNE seule source (ruling AT-4) : la pastille de chaque ligne du panneau Données ET la pastille
 * « renseignée » de l'étape dans le fil. Fourni par la PAGE — le fil s'allume même si ② n'a jamais été visité (un
 * calque allumé depuis le module risque, par exemple).
 *
 * Un type de POI compte dès qu'il est CHOISI (la case de sa ligne ; « Afficher les POI » reste un geste explicite,
 * arbitrage A12). Les arrêts de transport comptent quand ils sont sur la carte (la zone de points affichée est une
 * zone d'arrêts) : les types choisis vivent dans le panneau (`SelectionsCalquesService`), que la page ne voit pas, et
 * « aucun type choisi » veut dire « tous les types » — ce n'est donc pas un signe d'affichage. Le score composite et
 * les autres dégradés de ④ ne sont pas des jeux de ② : ils ne renseignent plus ② (la pastille comptait
 * `degradeActif() !== null` jusqu'à T13).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class DonneesAfficheesService {
  private readonly carreaux = inject(CarreauxService);
  private readonly iris = inject(IrisService);
  private readonly civique = inject(IndicateursCiviquesService);
  private readonly pois = inject(PoisService);
  private readonly tmja = inject(TmjaService);
  private readonly risque = inject(RisqueCarteService);
  private readonly sante = inject(SanteService);
  private readonly meteo = inject(MeteoService);
  private readonly etat = inject(EtatCarteService);

  readonly cles: Signal<ReadonlySet<string>> = computed(() => clesAffichees({
    iris: this.iris.visible(),
    carreaux: this.carreaux.visible(),
    civique: this.civique.variable() !== null,
    transport: this.pois.zone()?.categorie_poi === 'arret_transport',
    tmja: this.tmja.visible(),
    risques: this.risque.actif() || this.risque.pprtActif(),
    sante: this.sante.jeu() !== null,
    meteo: this.meteo.visible(),
    pois: this.etat.poiSelectionnes(),
  }));
  /** La pastille « renseignée » de ② dans le fil. */
  readonly renseignee: Signal<boolean> = computed(() => this.cles().size > 0);
}
