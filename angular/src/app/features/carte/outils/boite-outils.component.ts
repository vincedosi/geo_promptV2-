import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import type { NomIcone } from '../../../ui/icone/icones';
import { ChoixFondComponent } from '../commun/choix-fond.component';
import type { EtapeCarte } from '../logique/parcours';
import { AideComponent } from '../panneaux/aide.component';
import { LARGEUR_PLAN_MEDIA } from '../panneaux/zones/plan-media.component';
import { ReglagesComponent } from '../panneaux/reglages.component';
import { type OutilCarte, OutilsCarteService } from './outils-carte.service';

export interface EntreeOutil {
  readonly id: OutilCarte | 'legende';
  readonly libelle: string;
  readonly icone: NomIcone;
  /** Un filet AVANT l'entrée (Aide et Réglages, à part : maquette du 2026-10-13). */
  readonly separeAvant?: boolean;
}

/** Les boutons, dans l'ordre de la maquette. T6 ajoute « Mes analyses » et « Mes zones » en tête. */
export const OUTILS: readonly EntreeOutil[] = [
  { id: 'fond', libelle: 'Fond de carte', icone: 'carte' },
  { id: 'legende', libelle: 'Légende', icone: 'menu' },
  { id: 'aide', libelle: 'Aide', icone: 'aide', separeAvant: true },
  { id: 'reglages', libelle: 'Réglages', icone: 'reglages' },
];

/** Écart du tiroir à la colonne : colonne de 41 px (bouton 32 + marge 2 × 4 + bord 2 × 0,5), puis 7 px de jour. */
const ECART_TIROIR = 48;
/** Largeur du tiroir (`w-[320px]` du gabarit). */
const LARGEUR_TIROIR = 320;

/**
 * Les panneaux ancrés au bord DROIT du conteneur carte que la boîte à outils ne doit pas recouvrir (ruling AT-3), avec
 * la largeur écrite dans leur gabarit : plan média `LARGEUR_PLAN_MEDIA`, détail IRIS `w-[320px]`
 * (`couches/detail-iris.component.ts`), tiroir Street View `w-[min(420px,92vw)]` (`couches/tiroir-panneau.component.ts`).
 */
const LARGEURS_BORD_DROIT = { planMedia: LARGEUR_PLAN_MEDIA, detailIris: 320, streetView: 420 } as const;

/**
 * L'écart de la boîte à outils au bord droit du conteneur carte : 10 px, plus le plus large des panneaux ouverts au bord
 * droit et 10 px de jour. Tous sont ancrés à `right: 0` et se recouvrent : c'est le plus large qui compte, pas la somme.
 */
export function ecartOutils(ouverts: Readonly<Record<keyof typeof LARGEURS_BORD_DROIT, boolean>>): number {
  const largeurs = (Object.keys(LARGEURS_BORD_DROIT) as (keyof typeof LARGEURS_BORD_DROIT)[])
    .filter((k) => ouverts[k]).map((k) => LARGEURS_BORD_DROIT[k] + 10);
  return 10 + Math.max(0, ...largeurs);
}

/**
 * L'écart des annonces au bord droit (ruling AT-3) : à GAUCHE de la colonne, et du tiroir quand il est ouvert — jamais
 * par-dessus un outil. En haut à droite, elles recouvraient la boîte à outils pendant leurs 4 s.
 */
export function droiteAnnonces(droite: number, tiroirOuvert: boolean): number {
  return droite + ECART_TIROIR + (tiroirOuvert ? LARGEUR_TIROIR + 8 : 0);
}

/**
 * La boîte à outils (spec § 6) : une colonne de boutons-icônes en haut à droite du conteneur carte, hors du fil, et UN
 * tiroir à sa gauche. Tout est `absolute` dans le conteneur carte (jamais `fixed`, racine d'ombre) ; `droite` écarte la
 * colonne des panneaux ouverts au bord droit (`ecartOutils`). Échap ferme le tiroir (pile, `OutilsCarteService`). En
 * mode immersif, la colonne porte aussi le bouton qui en sort.
 *
 * Le contenu d'un outil est monté à sa PREMIÈRE ouverture, puis GARDÉ (ruling AT-6, patron A1 des panneaux d'étape) :
 * le tiroir fermé est invisible et inerte, l'outil quitté masqué et inerte — jamais `@if` sur l'outil courant. Une
 * opération en vol (sur « Mes zones », T6) ne meurt donc pas d'un Échap, et rouvrir ne relit rien.
 */
@Component({
  selector: 'mg-boite-outils',
  imports: [AideComponent, ChoixFondComponent, IconeComponent, ReglagesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div role="toolbar" aria-label="Boîte à outils" aria-orientation="vertical" data-boite-outils
         class="absolute top-[10px] z-[45] flex flex-col gap-1 rounded-[8px] border-fin border-subtle bg-card-overlay p-1"
         [style.right.px]="droite()">
      @for (o of liste; track o.id) {
        @if (o.separeAvant) { <div aria-hidden="true" class="mx-1 my-0.5 h-[0.5px] bg-subtle"></div> }
        <button type="button" [attr.data-outil]="o.id" [attr.title]="o.libelle" [attr.aria-label]="o.libelle"
                [attr.aria-pressed]="o.id === 'legende' ? outils.legendeVisible() : outils.outil() === o.id"
                (click)="cliquer(o.id)"
                class="grid size-8 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-secondary hover:bg-[var(--overlay)] hover:text-primary aria-pressed:bg-teal-10 aria-pressed:text-teal">
          <mg-icone [nom]="o.icone" [taille]="16" [trait]="1.5" />
        </button>
      }
      @if (immersif()) {
        <div aria-hidden="true" class="mx-1 my-0.5 h-[0.5px] bg-subtle"></div>
        <button type="button" data-quitter-immersif (click)="quitterImmersif.emit()" aria-label="Quitter le mode immersif"
                title="Afficher la barre et le panneau (Échap)"
                class="grid size-8 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-secondary hover:bg-[var(--overlay)] hover:text-primary">
          <mg-icone nom="agrandir" [taille]="16" [trait]="1.5" />
        </button>
      }
    </div>

    @if (montes().length > 0) {
      <section role="region" data-tiroir-outil [attr.data-outil-ouvert]="outils.outil()" [attr.aria-label]="titre()"
               class="absolute top-[10px] z-[45] flex max-h-[calc(100%-20px)] w-[320px] flex-col overflow-hidden rounded-[8px] border-fin border-subtle bg-surface"
               [class.invisible]="!outils.outil()" [attr.inert]="outils.outil() ? null : ''" [attr.aria-hidden]="outils.outil() ? null : 'true'"
               [style.right.px]="droite() + ecartTiroir" [style.max-width]="largeurMaxTiroir()">
        <header class="flex shrink-0 items-center gap-2 border-b-fin border-subtle px-3.5 py-2.5">
          <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
          <span class="text-[12px] font-medium text-primary">{{ titre() }}</span>
          <button type="button" aria-label="Fermer" (click)="outils.fermer()"
                  class="ml-auto flex cursor-pointer border-0 bg-transparent p-1 text-tertiary hover:text-primary">
            <mg-icone nom="croix" [taille]="14" [trait]="1.5" />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto">
          @for (m of montes(); track m) {
            <div [attr.data-contenu-outil]="m" [class.hidden]="m !== outils.outil()" [attr.inert]="m !== outils.outil() ? '' : null">
              @switch (m) {
                @case ('fond') { <mg-choix-fond [fond]="fond()" (choisirFond)="choisirFond.emit($event)" /> }
                @case ('aide') { <mg-aide [etape]="etape()" /> }
                @case ('reglages') { <mg-reglages /> }
              }
            </div>
          }
        </div>
      </section>
    }
  `,
})
export class BoiteOutilsComponent {
  protected readonly outils = inject(OutilsCarteService);
  protected readonly liste = OUTILS;
  protected readonly ecartTiroir = ECART_TIROIR;

  /** Écart au bord droit du conteneur carte : `ecartOutils` (10 px, plus les panneaux ouverts au bord droit). */
  readonly droite = input(10);
  readonly fond = input.required<string>();
  readonly etape = input.required<EtapeCarte>();
  readonly immersif = input(false);
  readonly choisirFond = output<string>();
  readonly quitterImmersif = output<void>();

  /** Les outils dont le contenu est monté, dans l'ordre de la colonne. */
  protected readonly montes = computed(() => {
    const visites = this.outils.visites();
    return OUTILS.map((x) => x.id).filter((id): id is OutilCarte => id !== 'legende' && visites.has(id));
  });
  /**
   * Le tiroir ne déborde jamais à gauche du conteneur carte (qui coupe ce qui dépasse) : plan média ouvert sur un écran de
   * 1 440 px, il ne reste que 960 px de carte, et 668 + 320 n'y tiennent pas — le tiroir rétrécit, 10 px de jour gardés.
   */
  protected readonly largeurMaxTiroir = computed(() => `calc(100% - ${this.droite() + ECART_TIROIR + 10}px)`);
  /** Le titre du tiroir ouvert ; tiroir fermé, aucun (il est invisible et inerte). */
  protected readonly titre = computed(() => OUTILS.find((x) => x.id === this.outils.outil())?.libelle ?? null);

  protected cliquer(id: EntreeOutil['id']): void {
    if (id === 'legende') this.outils.legendeVisible.update((v) => !v);
    else this.outils.basculer(id);
  }
}
