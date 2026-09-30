import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { STRATEGIE_SANS_SESSION } from '../core/auth/strategie-sans-session';
import { ThemeService } from '../core/theme/theme.service';
import { LogoComponent } from '../ui/logo/logo.component';

/**
 * Barre latérale MAGELIAN (DESIGN_SYSTEM.md § 6) autour des pages métier.
 * ⚠ Liens RELATIFS (`./`, `catalogue`…) : le `RouterLink` d'un composant routé
 * se résout contre SA route, donc sous le préfixe que l'hôte a choisi — `/app`
 * en autonome, n'importe quoi dans le shell AIDA. Un lien absolu en sortirait.
 */
@Component({
  selector: 'mg-coquille',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LogoComponent],
  templateUrl: './coquille.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoquilleComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly strategie = inject(STRATEGIE_SANS_SESSION);
  protected readonly email = this.auth.email;
  protected readonly theme = inject(ThemeService);

  /**
   * Autonome : vers la page de connexion, SANS page à reprendre — l'utilisateur
   * a choisi de partir. Cette navigation démarre avant que l'effet de
   * `RacineDistanteComponent` ne voie la session à null : il la trouve en
   * cours et s'abstient, sans quoi il ajouterait `?redirection=…`.
   * ⚠ HYPOTHÈSE nommée : cet ordre tient au planificateur ZONELESS. La mise à
   * null de la session ne fait que PROGRAMMER une détection de changement
   * (tâche macro), alors que `navigateByUrl` part dans la micro-tâche qui suit
   * l'`await` — donc avant que l'effet ne s'exécute. Sous zone.js, ou si un
   * appel synchrone à `ApplicationRef.tick()` s'intercalait, l'effet pourrait
   * passer le premier et rediriger AVEC `?redirection=…` — la navigation de la
   * coquille, lancée après, annulerait sans doute la sienne, mais ce cas n'est
   * ni testé ni mesuré. Verrouillé dans le mode actuel par `app.config.spec.ts`
   * (« Se déconnecter » mène à /connexion, sans paramètre de reprise).
   * Dans un hôte : pas de navigation, la racine affiche « Session requise… ».
   */
  protected async deconnecter(): Promise<void> {
    await this.auth.deconnecter();
    if (this.strategie.mode === 'rediriger') await this.router.navigateByUrl(this.strategie.chemin);
  }
}
