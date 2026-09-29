import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import type { EtatChargement } from '../../core/etat/etat-chargement';
import { messageErreurApi } from '../../core/http/erreurs';
import { type CompteSites, SitesRisqueApi } from '../risques/data/sites-risque.api';

/**
 * Première page reliée à l'API : elle prouve la chaîne entière — session,
 * proxy, Bearer, route Next.js, base locale. Le module risque la remplacera.
 */
@Component({
  selector: 'mg-accueil',
  templateUrl: './accueil.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccueilPage {
  private readonly api = inject(SitesRisqueApi);
  private readonly nombre = new Intl.NumberFormat('fr-FR');

  protected readonly etat = toSignal(
    this.api.compter().pipe(
      map((valeur): EtatChargement<CompteSites> => ({ statut: 'pret', valeur })),
      catchError((e) => of<EtatChargement<CompteSites>>({ statut: 'echec', message: messageErreurApi(e) })),
      startWith<EtatChargement<CompteSites>>({ statut: 'chargement' }),
    ),
    { requireSync: true },
  );

  protected formater(n: number): string {
    return this.nombre.format(n);
  }
}
