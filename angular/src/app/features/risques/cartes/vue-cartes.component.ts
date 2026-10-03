import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, model, output, signal } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { IconeComponent } from '../../../ui/icone/icone.component';
import type { ApercuRayon } from '../commandes/reglette-rayons.component';
import type { Etape } from '../logique/etape';
import type { ProfilRayons } from '../logique/profil';
import { CarteRisqueComponent } from './carte-risque.component';

/**
 * La zone cartographique du module — portage du CADRE de `VueCartesZones.tsx`
 * (lot 3, T4). La carte des rayons est `mg-carte-risque` (T7-T8) ; les autres
 * arrivent en T15 (codes postaux) et T17 (diffusion) ; ce composant ne décide que de ce qui est MONTÉ et de ce
 * qui est VISIBLE.
 *
 * ── LES CARTES NE SE DÉMONTENT JAMAIS ─────────────────────────────────────
 *
 * ⚠ Une instance MapLibre par vue, montée une fois : la carte des rayons dès
 * l'ouverture, celle de la diffusion à la PREMIÈRE visite de ⑤ (les étapes ①
 * à ④ ne paient pas une instance de plus), puis gardées. Aucun `@if` autour de
 * `mg-carte` : la remonter rechargerait fond, tuiles et position, et ferait
 * perdre la vue à chaque aller-retour ② ↔ ③ — le geste le plus fréquent du
 * module. Celle qu'on ne regarde pas garde une largeur NULLE et
 * `visibility: hidden`, jamais `display: none` ; `mg-carte` suit le
 * changement de largeur par son `ResizeObserver`.
 *
 * À l'étape ④ avec un jeu, la vue se DÉDOUBLE (rayons à gauche, codes postaux
 * à droite) : c'est là qu'on compare ce qu'on mesure et ce qu'on achète.
 * Ailleurs, un interrupteur Rayons / Codes postaux — ce dernier DÉSACTIVÉ tant
 * qu'aucun jeu n'existe : la carte des codes postaux n'existe que par rapport
 * à un jeu, et basculer dessus rendrait un écran vide qu'on lirait comme une
 * panne (`VueCartesZones.tsx:228`).
 */
@Component({
  selector: 'mg-vue-cartes',
  imports: [CarteRisqueComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full w-full flex-col' },
  template: `
    <div class="relative flex min-h-0 flex-1">
      <!-- ── Les rayons : montée dès l'ouverture, JAMAIS démontée ─────────── -->
      <div data-vue="rayons" class="relative flex min-w-0"
           [class.flex-1]="montreRayons()" [style.width.px]="montreRayons() ? null : 0"
           [style.visibility]="montreRayons() ? 'visible' : 'hidden'">
        <mg-carte-risque [profil]="profil()" [natures]="natures()" [gravites]="gravites()" [fusionner]="fusionner()"
                         [apercu]="apercu()" (carte)="carteRayons.emit($event)" />
        @if (double()) {
          <div class="absolute top-2.5 left-2.5 z-[3] rounded-lg border-fin border-default bg-[var(--card-overlay)] px-[9px] py-1 text-[11px] text-primary">Zones en rayon</div>
        }
      </div>

      @if (double()) {
        <div aria-hidden="true" class="w-1 shrink-0 bg-[var(--border-subtle)]"></div>
      }

      <!-- ── Les codes postaux (T15) : le cadre seul, à la même place ──────── -->
      <div data-vue="codes-postaux" class="relative flex min-w-0 items-center justify-center bg-[var(--bg-level-2)]"
           [class.flex-1]="montreCp()" [style.width.px]="montreCp() ? null : 0"
           [style.visibility]="montreCp() ? 'visible' : 'hidden'">
        <p class="m-0 px-5 text-center text-[12px] text-tertiary">Carte des codes postaux — disponible prochainement.</p>
        @if (double()) {
          <div class="absolute top-2.5 left-2.5 z-[3] rounded-lg border-fin border-default bg-[var(--card-overlay)] px-[9px] py-1 text-[11px] text-primary">Zones en codes postaux</div>
        }
      </div>

      <!-- ── La diffusion, à l'étape ⑤ (T17) : montée à la PREMIÈRE visite, puis gardée ── -->
      @if (campagneMontee()) {
        <div data-vue="campagne" class="relative flex min-w-0 items-center justify-center bg-[var(--bg-level-2)]"
             [class.flex-1]="campagne()" [style.width.px]="campagne() ? null : 0"
             [style.visibility]="campagne() ? 'visible' : 'hidden'">
          <p class="m-0 px-5 text-center text-[12px] text-tertiary">Carte de diffusion — disponible prochainement.</p>
        </div>
      }

      <!-- ── L'interrupteur, HORS des étapes ④ (avec un jeu) et ⑤ ─────────── -->
      @if (!double() && !campagne()) {
        <div class="absolute top-2.5 right-[190px] z-[3] flex gap-0.5 rounded-lg border-fin border-default bg-[var(--card-overlay)] p-0.5">
          <button type="button" (click)="vue.set('rayons')" [attr.aria-pressed]="vueEffective() === 'rayons'" title="Rayons"
                  class="inline-flex cursor-pointer items-center gap-[5px] rounded-md border-0 px-2 py-1 text-[10px]"
                  [class.bg-teal-10]="vueEffective() === 'rayons'" [class.text-teal]="vueEffective() === 'rayons'"
                  [class.bg-transparent]="vueEffective() !== 'rayons'" [class.text-secondary]="vueEffective() !== 'rayons'">
            <mg-icone nom="carte" [taille]="11" />Rayons
          </button>
          <button type="button" (click)="vue.set('cp')" [disabled]="!jeuId()" [attr.aria-pressed]="vueEffective() === 'cp'"
                  [attr.title]="jeuId() ? 'Codes postaux' : 'Construisez d’abord un jeu de zones'"
                  class="inline-flex items-center gap-[5px] rounded-md border-0 px-2 py-1 text-[10px]"
                  [class.cursor-pointer]="!!jeuId()" [class.cursor-not-allowed]="!jeuId()" [class.opacity-45]="!jeuId()"
                  [class.bg-teal-10]="vueEffective() === 'cp'" [class.text-teal]="vueEffective() === 'cp'"
                  [class.bg-transparent]="vueEffective() !== 'cp'" [class.text-secondary]="vueEffective() !== 'cp'">
            <mg-icone nom="grille" [taille]="11" />Codes postaux
          </button>
        </div>
      }

      <!-- Carte seule : REPLIE le panneau, sans passer par l'API plein écran — celle-ci sortirait la carte de
           l'écran, donc du bandeau KPI et du fil d'Ariane (React). Masqué aux étapes ④ (avec un jeu) et ⑤. -->
      <button type="button" (click)="carteSeule.set(!carteSeule())" [attr.aria-pressed]="carteSeule()"
              [attr.title]="carteSeule() ? 'Réafficher le panneau de l’étape' : 'Masquer le panneau et n’afficher que la carte'"
              class="absolute top-2.5 right-[56px] z-[4] cursor-pointer items-center gap-[5px] rounded-lg border-fin border-default bg-[var(--card-overlay)] px-[10px] py-[5px] text-[11px]"
              [class.inline-flex]="!double() && !campagne()" [class.hidden]="double() || campagne()"
              [class.text-teal]="carteSeule()" [class.text-secondary]="!carteSeule()">
        <mg-icone [nom]="carteSeule() ? 'reduire' : 'agrandir'" [taille]="12" />
        {{ carteSeule() ? 'Afficher le panneau' : 'Carte seule' }}
      </button>

    </div>
  `,
})
export class VueCartesComponent {
  readonly etape = input.required<Etape>();
  /** Le jeu de zones ouvert, ou `null` : la carte des codes postaux n'a alors rien à dire. */
  readonly jeuId = input<string | null>(null);
  /** Panneau d'étape replié : la carte occupe tout le corps. */
  readonly carteSeule = model(false);
  /** Le profil CALCULÉ, les natures, les niveaux, la lecture des zones et l'aperçu : relayés à `mg-carte-risque`. */
  readonly profil = input.required<ProfilRayons>();
  readonly natures = input<readonly string[]>([]);
  readonly gravites = input<readonly string[]>([]);
  readonly fusionner = input(true);
  readonly apercu = input<ApercuRayon | null>(null);
  /** La carte des rayons, à son premier `load` — pour la liaison des caméras (T15). */
  readonly carteRayons = output<maplibregl.Map>();

  /** Rayons ou codes postaux, hors étape ④ dédoublée. État LOCAL, comme React : il ne change aucun chiffre. */
  protected readonly vue = signal<'rayons' | 'cp'>('rayons');

  protected readonly double = computed(() => this.etape() === 'zones' && !!this.jeuId());
  protected readonly campagne = computed(() => this.etape() === 'campagne');
  /** Vrai dès la première visite de ⑤, et le reste : la carte de diffusion n'est jamais démontée ensuite. */
  protected readonly campagneMontee = linkedSignal<Etape, boolean>({
    source: this.etape,
    computation: (e, precedent) => (precedent?.value ?? false) || e === 'campagne',
  });
  /**
   * La vue réellement montrée : sans jeu, toujours les rayons. Écart à React (listé au rapport T4) : React
   * gardait `cp` après la fermeture d'un jeu, et montrait alors une carte des codes postaux VIDE sous un
   * bouton désactivé — l'écran vide que le bouton désactivé prétend justement éviter.
   */
  protected readonly vueEffective = computed(() => (this.jeuId() ? this.vue() : 'rayons'));
  protected readonly montreRayons = computed(() => !this.campagne() && (this.double() || this.vueEffective() === 'rayons'));
  protected readonly montreCp = computed(() => !this.campagne() && (this.double() || this.vueEffective() === 'cp'));
}
