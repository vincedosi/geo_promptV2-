import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import { EntetePageComponent } from '../../../ui/entete-page/entete-page.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { DialogueNouvelEspaceComponent, type EspaceCree } from './dialogue-nouvel-espace.component';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { groupeDe, rangerParGroupe } from './logique/groupes';
import { NOM_SOCLE } from './logique/libelles';

/** Ce que les flèches parcourent : les liens de la colonne et les en-têtes de dossier. */
const NAVIGABLES = 'a, button[data-dossier]';

/** Une ligne de la colonne, prête pour le gabarit (aucun calcul dans le gabarit). */
interface LigneEspace {
  id: string;
  nom: string;
  compteurs: string;
  titre: string;
  inactif: boolean;
  groupe: string | null;
}

/** Un dossier de groupe, prêt pour le gabarit. */
interface LigneDossier {
  groupe: string;
  idListe: string;
  ouvert: boolean;
  nb: string;
  titre: string;
  espaces: LigneEspace[];
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
 * - Groupes (lot « Catalogue et groupes », A-9) : les espaces sans groupe d'abord, puis un dossier
 *   repliable par `groupe_espace` (ordre alphabétique). Le groupe arrive dans le même GET : aucun
 *   appel de plus. Dossiers fermés par défaut, sauf celui de l'espace affiché, qui s'ouvre ; l'état
 *   de repli n'est ni persistant ni dans l'URL (état d'affichage). Le groupe ne porte aucun droit.
 * - Clavier : flèches haut/bas entre TOUS les liens de la colonne (« Tous les comptes » compris) et
 *   les en-têtes de dossier ; le contenu d'un dossier fermé n'est pas rendu, donc pas parcouru.
 *   Écouteur posé sur la `<nav>` (jamais sur `document`, qui appartient au shell) ; Entrée suit le
 *   lien nativement, ou bascule le dossier.
 * - Le nom affiché vient du serveur (`nom_affiche`, E2) : jamais l'ancien nom de l'application.
 */
@Component({
  selector: 'mg-espaces',
  imports: [NgTemplateOutlet, RouterOutlet, RouterLink, RouterLinkActive, EntetePageComponent, DialogueNouvelEspaceComponent],
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
              @for (e of sansGroupe(); track e.id) {
                <li><ng-container *ngTemplateOutlet="ligneEspace; context: { $implicit: e }" /></li>
              }
              @for (d of dossiers(); track d.groupe) {
                <li data-dossier-groupe>
                  <button
                    type="button"
                    data-dossier
                    class="entete-dossier"
                    [attr.aria-expanded]="d.ouvert"
                    [attr.aria-controls]="d.idListe"
                    (click)="basculer(d.groupe)"
                  >
                    <span class="chevron" aria-hidden="true">{{ d.ouvert ? '▾' : '▸' }}</span>
                    <span data-nom-groupe class="nom">{{ d.groupe }}</span>
                    <span class="compteurs" [title]="d.titre">{{ d.nb }}</span>
                  </button>
                  @if (d.ouvert) {
                    <ul class="liste sous-liste" [id]="d.idListe">
                      @for (e of d.espaces; track e.id) {
                        <li><ng-container *ngTemplateOutlet="ligneEspace; context: { $implicit: e }" /></li>
                      }
                    </ul>
                  }
                </li>
              }
            </ul>
            <ng-template #ligneEspace let-e>
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
            </ng-template>
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
    /* En-tête de dossier : un <button> remis à plat AVANT la règle commune (dont le border-left doit gagner). */
    .entete-dossier {
      align-items: center; gap: 8px; width: 100%; min-width: 0; margin: 0;
      background: transparent; border: none; font-family: inherit; text-align: left; cursor: pointer;
    }
    /* Ligne d'espace et en-tête de dossier : même boîte, même survol, même focus. */
    .ligne, .entete-dossier {
      display: flex;
      padding: 8px 10px 8px 12px;
      border-left: 2px solid transparent;
      border-radius: 0 6px 6px 0;
      color: var(--text-secondary);
      font-size: 13px;
      transition: background-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .ligne { flex-direction: column; gap: 2px; text-decoration: none; }
    .ligne:hover, .entete-dossier:hover { background: var(--bg-level-2); color: var(--text-primary); }
    .ligne:focus-visible, .entete-dossier:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: -2px; }
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
    .chevron { width: 10px; flex-shrink: 0; font-size: 10px; color: var(--text-tertiary); }
    .sous-liste { margin-left: 17px; border-left: 0.5px solid var(--border-subtle); }
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
      padding: 12px; border-radius: 6px; font-size: 12px; color: var(--danger-texte);
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

  private readonly lignes = computed<LigneEspace[]>(() =>
    this.etat.espaces().map((e) => ({
      id: e.id,
      nom: e.nom_affiche,
      compteurs: `${formaterNombre(e.nb_membres)} · ${formaterNombre(e.nb_jeux_prives)}`,
      titre: `${formaterNombre(e.nb_membres)} membres · ${formaterNombre(e.nb_jeux_prives)} jeux privés`,
      inactif: !e.actif,
      groupe: groupeDe(e),
    })),
  );

  private readonly rangee = computed(() => rangerParGroupe(this.lignes(), (l) => l.groupe));
  protected readonly sansGroupe = computed(() => this.rangee().sansGroupe);

  /** Les groupes dépliés : état d'affichage, ni persistant ni dans l'URL. */
  private readonly ouverts = signal<ReadonlySet<string>>(new Set());
  /** L'espace affiché par la fiche (`…/acces/:id`), ou `null` (socle, comptes, invite). */
  private readonly selection = signal<string | null>(null);

  /** L'espace affiché et son groupe ; ne notifie qu'au changement de l'un des deux (pas à chaque relecture de la liste). */
  private readonly dossierDeLaSelection = computed(
    () => {
      const id = this.selection();
      const groupe = id === null ? null : (this.lignes().find((l) => l.id === id)?.groupe ?? null);
      return groupe === null ? null : { id, groupe };
    },
    { equal: (a, b) => a?.id === b?.id && a?.groupe === b?.groupe },
  );

  protected readonly dossiers = computed<LigneDossier[]>(() => {
    const ouverts = this.ouverts();
    return this.rangee().dossiers.map((d, i) => ({
      groupe: d.groupe,
      idListe: `groupe-espaces-${i}`,
      ouvert: ouverts.has(d.groupe),
      nb: formaterNombre(d.espaces.length),
      titre: `${formaterNombre(d.espaces.length)} espace${d.espaces.length > 1 ? 's' : ''}`,
      espaces: d.espaces,
    }));
  });

  constructor() {
    this.etat.charger();
    // Pendant la construction de la page, l'enfant n'est pas encore activé (`snapshot` absent) : NavigationEnd suit.
    const lireSelection = () => this.selection.set(this.route.firstChild?.snapshot?.paramMap.get('id') ?? null);
    lireSelection();
    // Écouteur coupé à la destruction (`@angular/core/rxjs-interop` n'est pas partagé par tout hôte : imports-partages).
    const navigations = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(lireSelection);
    inject(DestroyRef).onDestroy(() => navigations.unsubscribe());
    // Le dossier qui contient l'espace affiché s'ouvre, à la navigation comme à l'arrivée de la liste. On n'ouvre
    // qu'au changement de la PAIRE (espace affiché, son groupe) : une liste relue à l'identique (enregistrement des
    // Réglages, membre ajouté) ne rouvre pas un dossier que l'utilisateur a replié ; un changement de groupe, si.
    effect(() => {
      const groupe = this.dossierDeLaSelection()?.groupe ?? null;
      if (groupe === null) return;
      untracked(() => {
        if (!this.ouverts().has(groupe)) this.ouverts.set(new Set([...this.ouverts(), groupe]));
      });
    });
  }

  protected basculer(groupe: string): void {
    const s = new Set(this.ouverts());
    if (s.has(groupe)) s.delete(groupe);
    else s.add(groupe);
    this.ouverts.set(s);
  }

  protected reessayer(): void {
    this.etat.recharger();
  }

  /** Flèches haut/bas : focus sur le lien (ou l'en-tête de dossier) voisin de la colonne, sans boucler. */
  protected clavier(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const nav = e.currentTarget as HTMLElement;
    // La cible et non `document.activeElement` : dans une racine d'ombre, ce dernier vaut l'hôte.
    const actuel = (e.target as Element | null)?.closest<HTMLElement>(NAVIGABLES);
    if (!actuel) return;
    const liens = [...nav.querySelectorAll<HTMLElement>(NAVIGABLES)];
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
