import { ChangeDetectionStrategy, Component, Injector, ViewEncapsulation, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { cibleDeRedirection } from '../../core/auth/messages';
import { DemarrageService } from '../../core/demarrage/demarrage.service';
import { monterRacineOmbre } from '../../layout/racine-ombre';
import { LogoComponent } from '../../ui/logo/logo.component';

@Component({
  selector: 'mg-connexion',
  imports: [FormsModule, LogoComponent],
  templateUrl: './connexion.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Lancement autonome seulement, HORS de RacineDistanteComponent : elle porte
  // donc sa propre racine d'ombre, pour que l'application n'ait qu'un chemin de
  // style (la feuille adoptée), dans les deux modes.
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class ConnexionPage {
  // AuthService n'est PAS injecté à la construction : démarrage en échec, son
  // client Supabase ne peut pas se construire (pas de configuration) et la
  // page elle-même échouerait — or c'est elle qui doit dire pourquoi.
  private readonly injecteur = inject(Injector);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly demarrage = inject(DemarrageService);

  protected readonly email = signal('');
  protected readonly motDePasse = signal('');

  constructor() {
    monterRacineOmbre();
  }
  protected readonly erreur = signal<string | null>(null);
  protected readonly enCours = signal(false);

  protected async envoyer(): Promise<void> {
    this.enCours.set(true);
    this.erreur.set(null);
    const message = await this.injecteur.get(AuthService).connecter(this.email(), this.motDePasse());
    this.enCours.set(false);
    if (message) {
      this.erreur.set(message);
      return;
    }
    const cible = cibleDeRedirection(this.route.snapshot.queryParamMap.get('redirection'));
    await this.router.navigateByUrl(cible);
  }
}
