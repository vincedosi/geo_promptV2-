import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { versEtat } from '../../core/etat/vers-etat';
import { SitesRisqueApi, type CompteSites } from '../risques/data/sites-risque.api';

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

  protected readonly etat = versEtat<CompteSites>(this.api.compter());

  protected formater(n: number): string {
    return this.nombre.format(n);
  }
}
