import { ChangeDetectionStrategy, Component, ElementRef, Injector, ViewEncapsulation, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { cibleDeRedirection } from '../../core/auth/messages';
import { DemarrageService } from '../../core/demarrage/demarrage.service';
import { DISPONIBLE_PROCHAINEMENT } from '../../layout/navigation';
import { monterRacineOmbre } from '../../layout/racine-ombre';
import { IconeComponent } from '../../ui/icone/icone.component';
import { LogoComponent } from '../../ui/logo/logo.component';
import { GRILLE, VITRINE } from './vitrine';

@Component({
  selector: 'mg-connexion',
  imports: [FormsModule, IconeComponent, LogoComponent],
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

  protected readonly afficherMdp = signal(false);
  /** Encart d'aide « Mot de passe oublié ? » : pas d'envoi d'e-mail dans le projet, seule la marche réelle est dite. */
  protected readonly aideMdp = signal(false);
  protected readonly prochainement = DISPONIBLE_PROCHAINEMENT;
  protected readonly vitrine = VITRINE;
  protected readonly grille = GRILLE;
  private readonly champEmail = viewChild<ElementRef<HTMLInputElement>>('champEmail');

  constructor() {
    monterRacineOmbre();
    // `autoFocus` de React sur le champ e-mail.
    afterNextRender(() => this.champEmail()?.nativeElement.focus());
  }
  protected readonly erreur = signal<string | null>(null);
  protected readonly enCours = signal(false);

  protected async envoyer(): Promise<void> {
    // Comme React (`page.tsx:52`) : deux champs vides ne partent pas.
    if (!this.email().trim() || !this.motDePasse().trim()) return;
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
