import { ChangeDetectionStrategy, Component, Injector, computed, effect, inject, untracked } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { MESSAGE_SANS_SESSION, STRATEGIE_SANS_SESSION } from '../core/auth/strategie-sans-session';
import { DemarrageService } from '../core/demarrage/demarrage.service';

/**
 * Racine de `remoteRoutes` — le « BuilderShell » de la doc AIDA : le premier
 * composant que le shell monte. Il n'affiche ses enfants qu'une fois
 * l'application démarrée ET une session présente ; sinon un message, JAMAIS
 * un écran blanc — et surtout jamais un remplacement du `<body>`, qui
 * effacerait le shell.
 *
 * **Sans session**, selon `STRATEGIE_SANS_SESSION` (lue dans l'injecteur de
 * route) :
 * - `message` (hôte, défaut racine) : « Session requise… » À LA PLACE du
 *   `<router-outlet />`. Aucune page n'est donc créée, aucun appel d'API ne
 *   part, aucune navigation n'a lieu. Quand la session apparaît, l'outlet
 *   revient et monte la route DÉJÀ activée (`authGuard` a laissé passer) :
 *   la page demandée s'affiche sans renavigation.
 * - `rediriger` (autonome) : un `effect` renvoie vers la page de connexion
 *   avec la page courante à reprendre. C'est le SEUL endroit qui réagit à
 *   une fin de session en cours de page (401 via l'intercepteur, `SIGNED_OUT`
 *   de GoTrue) — `AuthService`, racine, ne navigue plus.
 *
 * ⚠ L'effet ne part jamais PENDANT une navigation (`currentNavigation`,
 * suivie) : au démarrage d'abord — la racine est créée au milieu de la
 * navigation initiale, avant que rien ne soit affiché —, et pendant la
 * déconnexion de la coquille, qui navigue elle-même vers `/connexion` sans
 * page à reprendre. Il réévalue à la fin de la navigation : si la racine
 * existe encore et qu'il n'y a toujours pas de session, il redirige.
 * Démarrage en échec : ni message de session ni redirection, l'erreur prime —
 * et `AuthService` n'est pas même construit (son client Supabase lit une
 * configuration absente), d'où l'injecteur lu à la demande.
 */
@Component({
  selector: 'mg-racine-distante',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (demarrage.erreur(); as message) {
      <p role="alert" class="m-6 rounded border border-danger bg-surface p-4 text-sm text-danger">{{ message }}</p>
    } @else if (afficherMessage()) {
      <p role="status" class="m-6 rounded border border-subtle bg-surface p-4 text-sm text-secondary">{{ messageSansSession }}</p>
    } @else {
      <router-outlet />
    }
  `,
})
export class RacineDistanteComponent {
  protected readonly demarrage = inject(DemarrageService);
  private readonly strategie = inject(STRATEGIE_SANS_SESSION);
  private readonly injecteur = inject(Injector);
  private readonly router = inject(Router);
  protected readonly messageSansSession = MESSAGE_SANS_SESSION;

  /** Démarrage réussi et pas de session. Faux tant que le démarrage est en échec. */
  private readonly sansSession = computed(
    () => !this.demarrage.erreur() && !this.injecteur.get(AuthService).connecte(),
  );
  protected readonly afficherMessage = computed(() => this.strategie.mode === 'message' && this.sansSession());

  constructor() {
    const strategie = this.strategie;
    if (strategie.mode !== 'rediriger') return;
    effect(() => {
      if (!this.sansSession()) return;
      if (this.router.currentNavigation()) return;
      untracked(() => {
        void this.router.navigate([strategie.chemin], { queryParams: { redirection: this.router.url } });
      });
    });
  }
}
