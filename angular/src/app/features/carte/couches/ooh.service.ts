import { Injectable, inject, signal } from '@angular/core';
import { CarteApi } from '../data/carte.api';
import { EtatCarteService } from '../etat/etat-carte.service';
import { bboxPourRequete } from '../logique/bbox-requete';
import { PoisService } from './pois.service';

/**
 * Les panneaux OOH et DOOH (`handleDirectOOH`, `useMapDirectActions.ts:61-89`) : une requête qui REMPLACE la zone
 * partagée de `PoisService` — leurs points sont rendus, cliqués et ouverts dans le tiroir Street View comme des POI.
 *
 * Le corps est celui de React : `{ regies: regies ?? [] }`, plus la bbox SEULEMENT si un filtre géographique est actif
 * (`bboxPourRequete`) — jamais la métropole par défaut, qui masquerait l'outre-mer.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class OohService {
  private readonly etat = inject(EtatCarteService);
  private readonly api = inject(CarteApi);
  private readonly pois = inject(PoisService);

  /** Une requête en cours. */
  readonly chargement = signal(false);
  /** L'échec de la dernière requête (`Aucun panneau trouvé`, délai…), dit dans la section. */
  readonly erreur = signal<string | null>(null);

  /** « Afficher… » : sans régie = toutes. */
  charger(regies?: readonly string[]): void {
    const bbox = bboxPourRequete(this.etat.filtre());
    this.pois.lancer(
      this.api.ooh({ regies: regies ? [...regies] : [], ...(bbox ? { bbox } : {}) }),
      this.chargement, this.erreur, 'Délai dépassé — réessayez dans quelques instants',
    );
  }
}
