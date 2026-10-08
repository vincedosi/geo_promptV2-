import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, afterNextRender, computed, inject, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MODE_DEVELOPPEMENT } from '../core/environnement/mode-developpement';
import { IconeComponent } from '../ui/icone/icone.component';
import { MarqueComponent } from '../ui/marque/marque.component';
import { DISPONIBLE_PROCHAINEMENT, type EntreeNavigation, LIENS_DEVELOPPEMENT, SECTIONS_NAVIGATION } from './navigation';

interface EntreeIndexee extends EntreeNavigation {
  /** Rang global, pour l'apparition échelonnée (40 ms par entrée, `AppSidebar.tsx:248-256`). */
  rang: number;
}

/**
 * Contenu de la barre latérale — `SidebarContent` de `components/AppSidebar.tsx:139-309`,
 * partagé comme en React entre la colonne fixe (grand écran) et le tiroir (petit écran).
 * Classes recopiées une à une de React ; seules différences, voulues :
 * - `rounded-md` vaut 4 px comme dans React : l'échelle des rayons est alignée dans `styles.css` ;
 * - les écrans pas encore portés sont INERTES (`aria-disabled`, infobulle
 *   « Disponible prochainement ») — rendus à l'identique, survol compris ;
 * - des liens d'icônes vers les pages propres à Angular, dans le pied « Online » (hors production
 *   seulement) : en section du `nav`, ils le faisaient déborder et apparaître une barre de défilement.
 * Liens RELATIFS : le `RouterLink` se résout contre la route de la coquille, donc sous le
 * préfixe de l'hôte.
 */
@Component({
  selector: 'mg-barre-laterale',
  imports: [RouterLink, RouterLinkActive, MarqueComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <div class="flex h-full flex-col bg-surface">
      <mg-marque />
      <div data-filet class="h-[0.5px] w-full shrink-0 bg-subtle"></div>

      <!-- Campagnes — ouvrira l'overlay cockpit campagne (lot 5) : inerte d'ici là. -->
      <div class="px-3 pt-3">
        <button
          type="button"
          aria-disabled="true"
          [attr.title]="prochainement"
          class="group flex w-full items-center gap-2.5 rounded-md border-0 bg-primary px-3 py-2 text-[12.5px] font-medium tracking-[0.03em] text-page transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--brand-teal-50)]"
        >
          <span class="flex-1 text-left leading-none">Campagnes</span>
          <mg-icone
            nom="fleche-haut-droite"
            [taille]="14"
            [trait]="1.75"
            class="shrink-0 opacity-40 transition-transform duration-150 group-hover:translate-x-[1px] group-hover:-translate-y-[1px]"
          />
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 py-3" aria-label="Navigation principale">
        <!-- React écrit mt-5 entre les sections, mais le space-y-0 du nav (Tailwind 3 : sélecteur
             enfant, plus spécifique) le ramène à 0 : l'écart RENDU est nul, c'est lui qu'on porte. -->
        @for (section of sections(); track section.section) {
          <div [attr.data-section]="section.section">
            <p class="mb-2 px-3 text-[11px] font-normal text-tertiary">{{ section.section }}</p>
            <div class="space-y-0.5">
              @for (e of section.entrees; track e.libelle) {
                <div
                  class="transition-all duration-300"
                  [style.opacity]="monte() ? 1 : 0"
                  [style.transform]="monte() ? 'translateX(0)' : 'translateX(-8px)'"
                  [style.transition-delay.ms]="e.rang * 40"
                >
                  @if (e.cible !== null) {
                    <a
                      [routerLink]="e.cible"
                      routerLinkActive
                      #actif="routerLinkActive"
                      [routerLinkActiveOptions]="{ exact: !!e.exact }"
                      (click)="naviguer.emit()"
                      class="group flex items-center gap-2.5 rounded-md border-l-2 px-3 py-[9px] pl-[10px] text-[13px] font-normal transition-all duration-150 ease-[cubic-bezier(0,0,0.2,1)]"
                      [class]="actif.isActive ? lienActif : lienInactif"
                    >
                      <mg-icone
                        [nom]="e.icone"
                        [taille]="16"
                        [trait]="1.5"
                        class="shrink-0 transition-colors duration-150"
                        [class]="actif.isActive ? iconeActive : iconeInactive"
                      />
                      <span class="flex-1 leading-none">{{ e.libelle }}</span>
                      @if (e.badge) {
                        <span data-badge [class]="classeBadge">{{ e.badge }}</span>
                      }
                    </a>
                  } @else {
                    <a
                      role="link"
                      aria-disabled="true"
                      tabindex="0"
                      [attr.title]="prochainement"
                      class="group flex cursor-default items-center gap-2.5 rounded-md border-l-2 border-transparent px-3 py-[9px] pl-[10px] text-[13px] font-normal text-secondary transition-all duration-150 ease-[cubic-bezier(0,0,0.2,1)] hover:translate-x-[2px] hover:bg-elevated hover:text-primary"
                    >
                      <mg-icone
                        [nom]="e.icone"
                        [taille]="16"
                        [trait]="1.5"
                        class="shrink-0 text-tertiary transition-colors duration-150 group-hover:text-secondary"
                      />
                      <span class="flex-1 leading-none">{{ e.libelle }}</span>
                      @if (e.badge) {
                        <span data-badge [class]="classeBadge">{{ e.badge }}</span>
                      }
                    </a>
                  }
                </div>
              }
            </div>
          </div>
        }
      </nav>

      @if (dev) {
        <div class="h-[0.5px] w-full shrink-0 bg-subtle"></div>
        <div data-pied class="px-4 py-3">
          <div class="flex items-center gap-2.5">
            <span class="relative flex size-[6px] shrink-0">
              <span class="absolute inset-0 animate-ping rounded-full bg-success opacity-40 [animation-duration:2s]"></span>
              <span class="relative inline-flex size-[6px] rounded-full bg-success"></span>
            </span>
            <span class="font-mono text-[11px] text-tertiary">Online</span>
            <!-- Pages propres à Angular, en icônes (voir LIENS_DEVELOPPEMENT) : titre et nom accessible = libellé.
                 Quatre cases de 20 px sans écart : à 24 px + 2 px, la quatrième (Module risque, lot 3) poussait
                 l'horloge hors des 208 px du pied (mesuré : 226 px de contenu). -->
            <span data-liens-dev class="-my-1 ml-auto flex items-center">
              @for (l of liensDev; track l.libelle) {
                <a
                  [routerLink]="l.cible"
                  routerLinkActive
                  #actif="routerLinkActive"
                  [routerLinkActiveOptions]="{ exact: !!l.exact }"
                  [attr.title]="l.libelle"
                  [attr.aria-label]="l.libelle"
                  (click)="naviguer.emit()"
                  class="inline-flex size-5 items-center justify-center rounded-md transition-colors duration-150 hover:bg-elevated hover:text-primary"
                  [class]="actif.isActive ? 'bg-overlay text-primary' : 'text-tertiary'"
                >
                  <mg-icone [nom]="l.icone" [taille]="14" [trait]="1.5" />
                </a>
              }
            </span>
            @if (heure()) {
              <span class="font-mono text-[10px] text-hover">{{ heure() }}</span>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class BarreLateraleComponent {
  protected readonly dev = inject(MODE_DEVELOPPEMENT);
  protected readonly liensDev = LIENS_DEVELOPPEMENT;
  protected readonly prochainement = DISPONIBLE_PROCHAINEMENT;
  // États d'un lien, `AppSidebar.tsx:106-108` et `:117-120` (icône).
  protected readonly lienActif = 'bg-overlay text-primary border-primary';
  protected readonly lienInactif = 'text-secondary border-transparent hover:bg-elevated hover:text-primary hover:translate-x-[2px]';
  protected readonly iconeActive = 'text-primary';
  protected readonly iconeInactive = 'text-tertiary group-hover:text-secondary';
  /** Badge « Admin » / « Sys », `AppSidebar.tsx:124-131` — bord 1 px comme React (`border`), et non 0,5. */
  protected readonly classeBadge = 'rounded border border-default bg-overlay px-1.5 py-0.5 text-[10px] leading-[1.4] text-tertiary';
  /** Émis au clic d'un lien actif (le tiroir se referme). */
  readonly naviguer = output<void>();

  protected readonly sections = computed(() => {
    let rang = 0;
    return SECTIONS_NAVIGATION.map((s) => ({ section: s.section, entrees: s.entrees.map((e): EntreeIndexee => ({ ...e, rang: rang++ })) }));
  });

  /** Apparition échelonnée : faux au premier rendu, vrai à l'image suivante (`requestAnimationFrame`, comme React). */
  protected readonly monte = signal(false);
  /** Horloge du pied, `fr-FR` HH:MM:SS, rafraîchie chaque seconde (hors production seulement). */
  protected readonly heure = signal('');

  constructor() {
    const fenetre = inject(DOCUMENT).defaultView;
    afterNextRender(() => {
      const image = fenetre?.requestAnimationFrame?.bind(fenetre) ?? ((f: () => void) => setTimeout(f, 16));
      image(() => this.monte.set(true));
    });
    if (!this.dev) return;
    const tic = () =>
      this.heure.set(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tic();
    const minuterie = setInterval(tic, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(minuterie));
  }
}
