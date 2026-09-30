import { DOCUMENT, EnvironmentInjector, Injectable, inject, runInInjectionContext, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '../config/config.service';
import { chargerFeuille } from '../ressources/feuilles';
import { BASE_RESSOURCES, urlRessourceDistante } from '../ressources/ressource-distante';

/** Ce qui suit tout message d'échec : l'utilisateur doit savoir quoi faire. */
const CONSIGNE = 'Rechargez la page pour réessayer.';

/**
 * Démarrage de l'application : feuille de style globale, PUIS configuration,
 * PUIS session — dans cet ordre.
 *
 * - **La feuille d'abord.** `magelian.css` (Tailwind, jetons, polices) est
 *   émise avec `inject: false` : ni le shell AIDA, qui possède `index.html`,
 *   ni notre `index.html` ne la posent. Rien ne s'affiche avant elle — une
 *   page sans ses jetons est illisible, et même le message d'erreur en a
 *   besoin. Si c'est ELLE qui échoue, le message s'affiche sans style :
 *   accepté, c'est le seul cas où il ne peut pas en être autrement.
 * - Le client Supabase lit la configuration à sa construction, d'où
 *   configuration avant session.
 *
 * Déclenché par la route racine de `remoteRoutes` (le shell AIDA n'exécute
 * pas d'APP_INITIALIZER), donc dans les deux modes. Une seule promesse tant
 * que le démarrage réussit ou est en cours : naviguer dix fois ne recharge
 * rien. **Un ÉCHEC n'est pas gardé** : la promesse est oubliée, et la
 * navigation suivante retente — dans AIDA, recharger la page, c'est recharger
 * tout le shell, alors qu'une coupure passagère se rattrape d'un clic dans le
 * menu. Le message garde sa consigne de rechargement, qui reste le geste sûr
 * en lancement autonome ; il n'est effacé que par un démarrage réussi (le
 * vider au début de la tentative ferait afficher une racine vide pendant
 * qu'elle se joue).
 *
 * Zoneless : l'issue du démarrage ne passe que par des signals (`erreur`) et
 * par la résolution du garde de route — rien ne dépend d'une détection de
 * changement déclenchée par zone.js.
 */
@Injectable({ providedIn: 'root' })
export class DemarrageService {
  private readonly config = inject(ConfigService);
  private readonly injecteur = inject(EnvironmentInjector);
  private readonly document = inject(DOCUMENT);
  private readonly base = inject(BASE_RESSOURCES);
  private enCours: Promise<void> | null = null;
  private readonly _erreur = signal<string | null>(null);
  readonly erreur = this._erreur.asReadonly();

  demarrer(): Promise<void> {
    // L'oubli d'un échec passe par `.then` : il s'exécute toujours APRÈS
    // l'affectation de `enCours`, même si la tentative échoue sans attendre.
    this.enCours ??= this.tenter().then((reussi) => {
      if (!reussi) this.enCours = null;
    });
    return this.enCours;
  }

  private async tenter(): Promise<boolean> {
    try {
      await chargerFeuille(this.document, 'data-mg-styles', urlRessourceDistante('magelian.css', this.base));
      await this.config.charger();
      // AuthService injecté APRÈS le chargement : son client Supabase lit
      // la configuration dans sa fabrique (même raison que l'ancien app.config).
      // inject() après un await est hors contexte (NG0203) : l'injecteur a été
      // capturé à la construction, on le rejoue ici.
      const auth = runInInjectionContext(this.injecteur, () => inject(AuthService));
      await auth.initialiser();
      this._erreur.set(null);
      return true;
    } catch (e) {
      const message = (e instanceof Error ? e.message : 'Démarrage impossible.').trim();
      // Un message peut finir sur une commande (« npm run config ») : on ferme
      // la phrase avant d'enchaîner la consigne.
      this._erreur.set(`${/[.!?]$/.test(message) ? message : `${message}.`} ${CONSIGNE}`);
      return false;
    }
  }
}
