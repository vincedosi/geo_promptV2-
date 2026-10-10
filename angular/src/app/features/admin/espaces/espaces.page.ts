import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { formaterNombre } from '../../../core/format/nombre';
import { EntetePageComponent } from '../../../ui/entete-page/entete-page.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { DialogueNouvelEspaceComponent, type EspaceCree } from './dialogue-nouvel-espace.component';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { NOM_SOCLE } from './logique/libelles';

/** Une ligne de la colonne, prête pour le gabarit (aucun calcul dans le gabarit). */
interface LigneEspace {
  id: string;
  nom: string;
  compteurs: string;
  titre: string;
  inactif: boolean;
}

/**
 * `admin/acces` — la page « Accès » (spec 2026-10-08, plan T5 ; « Espaces de travail » jusqu'au
 * 2026-10-10). Pas de port : aucun écran React équivalent ; elle remplace `/admin/users` et
 * `/admin/organizations` (E6). C'est LA page unique des droits : comptes, espaces, données visibles.
 *
 * Une colonne persistante (le socle, « Tous les comptes », puis chaque espace, puis « + Nouvel
 * espace ») et un `<router-outlet>` pour la fiche (`socle`, `comptes`, `:id`, ou l'invite quand
 * rien n'est choisi). La colonne vit avec la page : passer d'une fiche à l'autre ne relit pas la
 * liste. Le compteur de « Tous les comptes » vient du même GET (`nb_comptes`) : aucun appel de plus.
 *
 * - Fournit `EspacesEtatService` (détruit avec la page) et appelle `charger()` UNE fois : un seul
 *   `GET admin/espaces` au montage, rien d'autre.
 * - Liens RELATIFS à la route de la page (`socle`, `comptes`, `<id>`) : le préfixe de montage
 *   appartient au shell (contrat AIDA).
 * - Clavier : flèches haut/bas entre TOUS les liens de la colonne (« Tous les comptes » compris),
 *   écouteur posé sur la `<nav>` (jamais sur
 *   `document`, qui appartient au shell) ; Entrée suit le lien nativement.
 * - Le nom affiché vient du serveur (`nom_affiche`, E2) : jamais l'ancien nom de l'application.
 */
@Component({
  selector: 'mg-espaces',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, EntetePageComponent, DialogueNouvelEspaceComponent],
  providers: [EspacesEtatService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- En-tête au-dessus de la grille : la fiche commence ainsi à la hauteur de la colonne, sous le
         chrome du haut (badge de session), au lieu de remonter à son niveau. -->
    <mg-entete-page titre="Accès" />
    <div class="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
      <div class="min-w-0">
        <nav aria-label="Accès" class="colonne" (keydown)="clavier($event)">
          @if (erreur(); as message) {
            <div role="alert" class="erreur">
              <p class="m-0">{{ message }}</p>
              <button type="button" class="bouton-neutre" (click)="reessayer()">Réessayer</button>
            </div>
          } @else if (squelettes()) {
            @for (i of [1, 2, 3]; track i) {
              <div data-squelette class="squelette" aria-hidden="true"></div>
            }
          } @else {
            <ul class="liste">
              @if (sousLigneSocle(); as sous) {
                <li>
                  <a
                    routerLink="socle"
                    routerLinkActive="actif"
                    ariaCurrentWhenActive="page"
                    class="ligne"
                  >
                    <span class="haut">
                      <span class="point" aria-hidden="true"></span>
                      <span data-nom class="nom">{{ nomSocle }}</span>
                    </span>
                    <span data-sous-ligne class="sous-ligne">{{ sous }}</span>
                  </a>
                </li>
                <li>
                  <a
                    routerLink="comptes"
                    routerLinkActive="actif"
                    ariaCurrentWhenActive="page"
                    class="ligne"
                    data-tous-les-comptes
                  >
                    <span class="haut">
                      <span data-nom class="nom">Tous les comptes</span>
                      <span data-compteurs class="compteurs" [title]="titreComptes()">{{ nbComptes() }}</span>
                    </span>
                  </a>
                </li>
                <li class="separateur" role="presentation"></li>
              }
              @for (e of lignes(); track e.id) {
                <li>
                  <a
                    [routerLink]="e.id"
                    routerLinkActive="actif"
                    ariaCurrentWhenActive="page"
                    class="ligne"
                  >
                    <span class="haut">
                      <span data-nom class="nom">{{ e.nom }}</span>
                      @if (e.inactif) {
                        <span data-inactif class="badge">Inactif</span>
                      }
                      <span data-compteurs class="compteurs" [title]="e.titre">{{ e.compteurs }}</span>
                    </span>
                  </a>
                </li>
              }
            </ul>
            <button type="button" data-nouvel-espace class="bouton-neutre nouvel" (click)="dialogueOuvert.set(true)">+ Nouvel espace</button>
          }
        </nav>
      </div>
      <div class="min-w-0">
        <router-outlet />
      </div>
    </div>
    @if (dialogueOuvert()) {
      <mg-dialogue-nouvel-espace (creer)="surCree($event)" (annuler)="dialogueOuvert.set(false)" />
    }
  `,
  styles: `
    :host { display: block; font-family: var(--font-sans); }
    .colonne { display: flex; flex-direction: column; gap: 8px; }
    .liste { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .ligne {
      display: flex; flex-direction: column; gap: 2px;
      padding: 8px 10px 8px 12px;
      border-left: 2px solid transparent;
      border-radius: 0 6px 6px 0;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 13px;
      transition: background-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .ligne:hover { background: var(--bg-level-2); color: var(--text-primary); }
    .ligne:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: -2px; }
    .ligne.actif { background: var(--bg-level-3); border-left-color: var(--text-primary); color: var(--text-primary); }
    .haut { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .point { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-teal); flex-shrink: 0; }
    .sous-ligne { font-size: 11px; color: var(--text-tertiary); padding-left: 14px; }
    .compteurs {
      margin-left: auto; flex-shrink: 0;
      font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary);
    }
    .badge {
      flex-shrink: 0;
      background: var(--bg-level-3); border: 0.5px solid var(--border-default); color: var(--text-tertiary);
      font-size: 10px; border-radius: 4px; padding: 1px 6px;
    }
    .separateur { height: 0; border-top: 0.5px solid var(--border-subtle); margin: 6px 0; }
    .squelette { height: 36px; border-radius: 6px; background: var(--bg-level-2); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .bouton-neutre {
      align-self: flex-start;
      background: transparent;
      border: 0.5px solid var(--border-default);
      color: var(--text-secondary);
      border-radius: 6px;
      padding: 7px 14px;
      font-family: inherit; font-size: 12px; font-weight: 500;
      cursor: pointer;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .bouton-neutre:hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .bouton-neutre:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .nouvel { margin-top: 6px; }
    .erreur {
      display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
      padding: 12px; border-radius: 6px; font-size: 12px; color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
    }
    @media (prefers-reduced-motion: reduce) { .squelette { animation: none; } }
  `,
})
export class EspacesPage {
  private readonly etat = inject(EspacesEtatService);
  private readonly notifications = inject(NotificationsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly nomSocle = NOM_SOCLE;
  protected readonly dialogueOuvert = signal(false);
  protected readonly erreur = this.etat.erreur;

  /** Trois lignes squelettes tant que la PREMIÈRE lecture n'a rien rendu (une relecture garde la liste). */
  protected readonly squelettes = computed(() => this.etat.chargement() && this.etat.socle() === null);

  protected readonly sousLigneSocle = computed(() => {
    const s = this.etat.socle();
    return s ? `visible de tous · ${formaterNombre(s.nb_jeux)} jeux` : null;
  });

  protected readonly nbComptes = computed(() => formaterNombre(this.etat.nbComptes() ?? 0));
  protected readonly titreComptes = computed(() => `${this.nbComptes()} comptes`);

  protected readonly lignes = computed<LigneEspace[]>(() =>
    this.etat.espaces().map((e) => ({
      id: e.id,
      nom: e.nom_affiche,
      compteurs: `${formaterNombre(e.nb_membres)} · ${formaterNombre(e.nb_jeux_prives)}`,
      titre: `${formaterNombre(e.nb_membres)} membres · ${formaterNombre(e.nb_jeux_prives)} jeux privés`,
      inactif: !e.actif,
    })),
  );

  constructor() {
    this.etat.charger();
  }

  protected reessayer(): void {
    this.etat.recharger();
  }

  /** Flèches haut/bas : focus sur le lien voisin de la colonne, sans boucler. */
  protected clavier(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const nav = e.currentTarget as HTMLElement;
    // La cible et non `document.activeElement` : dans une racine d'ombre, ce dernier vaut l'hôte.
    const actuel = (e.target as Element | null)?.closest('a');
    if (!actuel) return;
    const liens = [...nav.querySelectorAll<HTMLAnchorElement>('a')];
    const i = liens.indexOf(actuel);
    if (i < 0) return;
    e.preventDefault();
    const suivant = liens[e.key === 'ArrowDown' ? Math.min(i + 1, liens.length - 1) : Math.max(i - 1, 0)];
    suivant.focus();
  }

  protected surCree(c: EspaceCree): void {
    this.dialogueOuvert.set(false);
    if (c.descriptionPerdue) this.notifications.warning('Espace créé, mais la description n\'a pas été enregistrée');
    else this.notifications.success('Espace créé');
    this.etat.recharger();
    void this.router.navigate([c.id], { relativeTo: this.route });
  }
}
