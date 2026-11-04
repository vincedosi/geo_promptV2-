import { ChangeDetectionStrategy, Component, Injector, ViewEncapsulation, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { ConnexionAutoService } from '../core/auth/connexion-auto.service';
import {
  MESSAGE_CONNEXION_AUTO_ECHOUEE,
  MESSAGE_SANS_SESSION,
  MESSAGE_SESSION_FERMEE_LOCALE,
  STRATEGIE_SANS_SESSION,
} from '../core/auth/strategie-sans-session';
import { MODE_DEVELOPPEMENT } from '../core/environnement/mode-developpement';
import { DemarrageService } from '../core/demarrage/demarrage.service';
import { monterRacineOmbre } from './racine-ombre';

/**
 * Racine de `remoteRoutes` — le « BuilderShell » de la doc AIDA : le premier
 * composant que le shell monte. Il n'affiche ses enfants qu'une fois
 * l'application démarrée ET une session présente ; sinon un message, JAMAIS
 * un écran blanc — et surtout jamais un remplacement du `<body>`, qui
 * effacerait le shell.
 *
 * **Sans session** : un message À LA PLACE du `<router-outlet />`, dans
 * l'hôte comme en autonome — il n'y a plus de page de connexion vers
 * laquelle naviguer (décision du propriétaire, 2026-11-05 : AIDA gère la
 * session). Aucune page n'est donc créée, aucun appel d'API ne part, aucune
 * navigation n'a lieu. Quand la session apparaît, l'outlet revient et monte
 * la route DÉJÀ activée (`authGuard` a laissé passer) : la page demandée
 * s'affiche sans renavigation. Le texte dépend du contexte :
 * - hôte AIDA, ou autonome hors développement : `MESSAGE_SANS_SESSION` ;
 * - autonome en développement, connexion automatique en échec :
 *   `MESSAGE_CONNEXION_AUTO_ECHOUEE` (vérifier `DEV_CONNEXION_AUTO_*`) ;
 * - autonome en développement, session fermée en cours de page
 *   (« Deconnexion », 401, `SIGNED_OUT`) : `MESSAGE_SESSION_FERMEE_LOCALE` —
 *   la session n'est PAS rouverte d'office, sans quoi « Deconnexion » ne
 *   déconnecterait rien ; un rechargement la rouvre (`authGuard`).
 *
 * Démarrage en échec : l'erreur prime — et `AuthService` n'est pas même
 * construit (son client Supabase lit une configuration absente), d'où
 * l'injecteur lu à la demande.
 */
@Component({
  selector: 'mg-racine-distante',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Isolation CSS : toute l'application vit dans cette racine d'ombre (voir racine-ombre.ts).
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    @if (demarrage.erreur(); as message) {
      <p role="alert" class="m-6 rounded border-fin border-danger bg-surface p-4 text-sm text-danger">{{ message }}</p>
    } @else if (afficherMessage()) {
      <p role="status" class="m-6 rounded border-fin border-subtle bg-surface p-4 text-sm text-secondary">{{ messageSansSession() }}</p>
    } @else {
      <router-outlet />
    }
  `,
})
export class RacineDistanteComponent {
  protected readonly demarrage = inject(DemarrageService);
  private readonly injecteur = inject(Injector);
  private readonly connexionAutoLocale = inject(STRATEGIE_SANS_SESSION).connexionAuto && inject(MODE_DEVELOPPEMENT);

  /** Démarrage réussi et pas de session. Faux tant que le démarrage est en échec. */
  protected readonly afficherMessage = computed(
    () => !this.demarrage.erreur() && !this.injecteur.get(AuthService).connecte(),
  );

  protected readonly messageSansSession = computed(() => {
    if (!this.connexionAutoLocale) return MESSAGE_SANS_SESSION;
    return this.injecteur.get(ConnexionAutoService).echec() ? MESSAGE_CONNEXION_AUTO_ECHOUEE : MESSAGE_SESSION_FERMEE_LOCALE;
  });

  constructor() {
    monterRacineOmbre();
  }
}
