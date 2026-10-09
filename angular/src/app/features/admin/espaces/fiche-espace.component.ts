import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { OngletMembresComponent } from './onglet-membres.component';

type Onglet = 'membres' | 'donnees' | 'apercu' | 'reglages';
const ONGLETS: readonly Onglet[] = ['membres', 'donnees', 'apercu', 'reglages'];

/**
 * Fiche d'un espace (`admin/espaces/:id`, spec § 4.3, plan T7) : un en-tête et quatre onglets.
 *
 * - `:id` est lu en S'ABONNANT à `paramMap` : le routeur réutilise ce composant d'un espace à
 *   l'autre. Un changement de paramètre remet l'onglet sur « Membres » et oublie les onglets déjà
 *   ouverts (ils sont démontés, leurs lectures en vol abandonnées) ; l'onglet Membres, lui, relit
 *   pour le nouvel espace (son `espaceId` est un input réactif).
 * - Un onglet n'est créé — et ne lit rien — qu'à sa PREMIÈRE ouverture ; il reste ensuite monté
 *   (caché) pour ne pas relire à chaque aller-retour. En T7, Données, Aperçu et Réglages ne sont que
 *   des emplacements (T8 à T10 les branchent).
 * - Le nom et le compteur de membres viennent de la liste de la page (`EspacesEtatService`), sans
 *   lecture de plus : à l'ouverture, un seul appel (les membres). Tant que l'espace n'est pas dans
 *   la liste (encore en lecture, en échec, ou inconnu), aucun onglet n'est monté : rien n'est lu.
 * - Espace absent de la liste CHARGÉE → « Espace introuvable » et un lien relatif vers la page.
 */
@Component({
  selector: 'mg-fiche-espace',
  imports: [RouterLink, OngletMembresComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (introuvable()) {
      <div class="introuvable">
        <p class="m-0 text-[13px] text-secondary">Espace introuvable</p>
        <a routerLink=".." data-retour class="retour">Retour</a>
      </div>
    } @else if (espace(); as e) {
      <header class="mb-4">
        <h2 class="m-0 text-[16px] font-medium text-primary">{{ e.nom_affiche }}</h2>
      </header>

      <div role="tablist" aria-label="Sections de l'espace" class="onglets" (keydown)="clavier($event)">
        @for (o of onglets(); track o.cle) {
          <button
            type="button"
            role="tab"
            class="onglet"
            [id]="'onglet-' + o.cle"
            [attr.data-onglet]="o.cle"
            [attr.aria-selected]="o.actif"
            [attr.aria-controls]="'panneau-' + o.cle"
            [attr.tabindex]="o.actif ? 0 : -1"
            (click)="ouvrir(o.cle)"
          >{{ o.libelle }}</button>
        }
      </div>

      <div role="tabpanel" id="panneau-membres" aria-labelledby="onglet-membres" [hidden]="onglet() !== 'membres'">
        <mg-onglet-membres [espaceId]="e.id" />
      </div>
      @for (o of ongletsEnAttente(); track o) {
        <div role="tabpanel" [id]="'panneau-' + o" [attr.aria-labelledby]="'onglet-' + o" [hidden]="onglet() !== o">
          <p class="m-0 text-[13px] text-secondary">Onglet en cours de construction</p>
        </div>
      }
    } @else if (chargementListe()) {
      <div data-squelette class="squelette" aria-hidden="true"></div>
    }
  `,
  styles: `
    :host { display: block; font-family: var(--font-sans); }
    .onglets { display: flex; gap: 20px; margin-bottom: 16px; border-bottom: 0.5px solid var(--border-subtle); }
    .onglet {
      background: transparent; border: none; border-bottom: 2px solid transparent; margin-bottom: -0.5px;
      padding: 8px 0; font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--text-tertiary); cursor: pointer;
      transition: color 150ms var(--ease-hover);
    }
    .onglet:hover { color: var(--text-secondary); }
    .onglet[aria-selected='true'] { color: var(--text-primary); border-bottom-color: var(--brand-teal); }
    .onglet:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .introuvable { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
    .retour { font-size: 13px; color: var(--brand-teal); text-decoration: none; }
    .retour:hover { text-decoration: underline; }
    .retour:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .squelette { height: 24px; width: 240px; border-radius: 6px; background: var(--bg-level-2); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    @media (prefers-reduced-motion: reduce) { .squelette { animation: none; } }
  `,
})
export class FicheEspaceComponent {
  private readonly etat = inject(EspacesEtatService);

  protected readonly id = signal<string | null>(null);
  protected readonly onglet = signal<Onglet>('membres');
  /** Onglets déjà ouverts pour l'espace courant : créés une fois, puis gardés. */
  private readonly ouverts = signal<ReadonlySet<Onglet>>(new Set<Onglet>(['membres']));

  /** L'espace de la liste chargée ; tant qu'il est `null`, aucun onglet n'est monté (donc aucune lecture). */
  protected readonly espace = computed(() => {
    const id = this.id();
    return id ? this.etat.espaces().find((e) => e.id === id) ?? null : null;
  });

  /** La liste est chargée (le compteur du socle n'est posé qu'après une lecture réussie) et l'espace n'y est pas. */
  protected readonly introuvable = computed(
    () => this.id() !== null && this.espace() === null && this.etat.socle() !== null && !this.etat.chargement(),
  );

  protected readonly chargementListe = computed(() => this.etat.chargement());

  protected readonly onglets = computed(() => {
    const actif = this.onglet();
    const nb = this.espace()?.nb_membres ?? 0;
    const libelles: Record<Onglet, string> = {
      membres: `Membres (${nb})`,
      donnees: 'Données',
      apercu: 'Aperçu',
      reglages: 'Réglages',
    };
    return ONGLETS.map((cle) => ({ cle, libelle: libelles[cle], actif: cle === actif }));
  });

  /** Onglets non branchés en T7, rendus seulement après leur première ouverture. */
  protected readonly ongletsEnAttente = computed(() => ONGLETS.filter((o) => o !== 'membres' && this.ouverts().has(o)));

  constructor() {
    const abonnement = inject(ActivatedRoute).paramMap.subscribe((p) => {
      this.id.set(p.get('id'));
      this.onglet.set('membres');
      this.ouverts.set(new Set<Onglet>(['membres']));
    });
    inject(DestroyRef).onDestroy(() => abonnement.unsubscribe());
  }

  protected ouvrir(o: Onglet): void {
    this.onglet.set(o);
    if (!this.ouverts().has(o)) this.ouverts.set(new Set([...this.ouverts(), o]));
  }

  /** Flèches gauche/droite entre les onglets (motif ARIA « tabs »), écouteur sur la liste. */
  protected clavier(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = ONGLETS.indexOf(this.onglet());
    const suivant = ONGLETS[(i + (e.key === 'ArrowRight' ? 1 : ONGLETS.length - 1)) % ONGLETS.length];
    this.ouvrir(suivant);
    const liste = e.currentTarget as HTMLElement;
    liste.querySelector<HTMLButtonElement>(`[data-onglet="${suivant}"]`)?.focus();
  }
}
