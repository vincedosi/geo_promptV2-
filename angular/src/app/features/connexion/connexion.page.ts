import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { cibleDeRedirection } from '../../core/auth/messages';

@Component({
  selector: 'mg-connexion',
  imports: [FormsModule],
  templateUrl: './connexion.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnexionPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly email = signal('');
  protected readonly motDePasse = signal('');
  protected readonly erreur = signal<string | null>(null);
  protected readonly enCours = signal(false);

  protected async envoyer(): Promise<void> {
    this.enCours.set(true);
    this.erreur.set(null);
    const message = await this.auth.connecter(this.email(), this.motDePasse());
    this.enCours.set(false);
    if (message) {
      this.erreur.set(message);
      return;
    }
    const cible = cibleDeRedirection(this.route.snapshot.queryParamMap.get('redirection'));
    await this.router.navigateByUrl(cible);
  }
}
