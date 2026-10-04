import { ChangeDetectionStrategy, Component, computed, effect, input, linkedSignal, model, output, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import type { Bbox } from '../../../carte/bbox';
import { lierCameras } from '../../../carte/lier-cameras';
import { formaterDecimal, formaterNombre } from '../../../core/format/nombre';
import { IconeComponent } from '../../../ui/icone/icone.component';
import type { ApercuRayon } from '../commandes/reglette-rayons.component';
import type { Etape } from '../logique/etape';
import { codeProfil } from '../logique/code-profil';
import type { ProfilRayons } from '../logique/profil';
import {
  CarteCodesPostauxComponent, type ChiffresCp, type ColorationCp, LIBELLE_COLORATION,
} from './carte-codes-postaux.component';
import { TableauZonesCampagneComponent } from '../etapes/campagne/tableau-zones-campagne.component';
import { CarteCampagneComponent } from './carte-campagne.component';
import { CarteRisqueComponent } from './carte-risque.component';
import { TableauGrappesComponent } from './tableau-grappes.component';

/**
 * La zone cartographique du module — portage de `VueCartesZones.tsx` (lot 3 : cadre T4, double carte T15).
 * La carte des rayons est `mg-carte-risque` (T7-T8), celle des codes postaux `mg-carte-codes-postaux` (T15,
 * montée dès l'ouverture à largeur nulle, comme React), sous elles le bandeau des quatre chiffres et le tableau
 * des bassins (`mg-tableau-grappes`) ; à ⑤, la carte de diffusion `mg-carte-campagne` et le tableau des zones
 * `mg-tableau-zones-campagne` (T17). Ce composant décide de ce qui est MONTÉ, de ce
 * qui est VISIBLE, et de la LIAISON des caméras (double vue seulement).
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
  imports: [
    CarteCampagneComponent, CarteCodesPostauxComponent, CarteRisqueComponent, IconeComponent, TableauGrappesComponent,
    TableauZonesCampagneComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full w-full flex-col' },
  template: `
    <div class="relative flex min-h-0 flex-1">
      <!-- ── Les rayons : montée dès l'ouverture, JAMAIS démontée ─────────── -->
      <div data-vue="rayons" class="relative flex min-w-0"
           [class.flex-1]="montreRayons()" [style.width.px]="montreRayons() ? null : 0"
           [style.visibility]="montreRayons() ? 'visible' : 'hidden'">
        <mg-carte-risque [profil]="profil()" [natures]="natures()" [gravites]="gravites()" [fusionner]="fusionner()"
                         [apercu]="apercu()" (carte)="surCarteRayons($event)" />
        @if (double()) {
          <div class="absolute top-2.5 left-2.5 z-[3] rounded-lg border-fin border-default bg-[var(--card-overlay)] px-[9px] py-1 text-[11px] text-primary">Zones en rayon</div>
        }
      </div>

      @if (double()) {
        <div aria-hidden="true" class="w-1 shrink-0 bg-[var(--border-subtle)]"></div>
      }

      <!-- ── Les codes postaux : montée dès l'ouverture, JAMAIS démontée (largeur nulle tant qu'on ne la regarde pas) ── -->
      <div data-vue="codes-postaux" class="relative flex min-w-0"
           [class.flex-1]="montreCp()" [style.width.px]="montreCp() ? null : 0"
           [style.visibility]="montreCp() ? 'visible' : 'hidden'">
        <mg-carte-codes-postaux [jeuId]="jeuId()" [codeProfil]="codeProfilZones()" [natures]="natures()"
                                [coloration]="coloration()" [surbrillance]="surbrillance()" [actif]="montreCp()"
                                (carte)="carteCp.set($event)" (chiffres)="chiffres.set($event)" />
        @if (double()) {
          <div class="absolute top-2.5 left-2.5 z-[3] rounded-lg border-fin border-default bg-[var(--card-overlay)] px-[9px] py-1 text-[11px] text-primary">Zones en codes postaux</div>
        }
        <!-- Le choix de ce que la couleur encode. -->
        @if (montreCp()) {
          <div data-coloration class="absolute top-2.5 right-[56px] z-[3] flex gap-0.5 rounded-lg border-fin border-default bg-[var(--card-overlay)] p-0.5">
            @for (c of colorations; track c.id) {
              <button type="button" (click)="coloration.set(c.id)" [attr.aria-pressed]="coloration() === c.id"
                      class="cursor-pointer rounded-md border-0 px-2 py-1 text-[10px]"
                      [class.bg-teal-10]="coloration() === c.id" [class.text-teal]="coloration() === c.id"
                      [class.bg-transparent]="coloration() !== c.id" [class.text-secondary]="coloration() !== c.id">{{ c.libelle }}</button>
            }
          </div>
        }
      </div>

      <!-- ── La diffusion, à l'étape ⑤ : montée à la PREMIÈRE visite, puis gardée (jamais démontée) ── -->
      @if (campagneMontee()) {
        <div data-vue="campagne" class="relative flex min-w-0"
             [class.flex-1]="campagne()" [style.width.px]="campagne() ? null : 0"
             [style.visibility]="campagne() ? 'visible' : 'hidden'">
          <mg-carte-campagne [actif]="campagne()" />
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

    <!-- ── Le bandeau, sous les deux cartes ─────────────────────────────── -->
    @if (double()) {
      <div data-bandeau-cp class="flex shrink-0 flex-wrap gap-[18px] border-t border-subtle bg-[var(--bg-level-2)] px-3.5 py-2 text-[11px] text-secondary">
        @for (c of bandeau(); track c.libelle) {
          <div class="flex items-baseline gap-1.5" [attr.title]="c.aide">
            <span>{{ c.libelle }}</span><span class="font-mono text-[12px] text-primary">{{ c.valeur }}</span>
          </div>
        }
      </div>
    }

    <!-- ── Le tableau des zones de la campagne, trié par écart (⑤ seulement, aucune requête) ── -->
    @if (campagne()) {
      <mg-tableau-zones-campagne />
    }

    <!-- ── Le tableau des bassins : monté au premier jeu, gardé (lu une fois par jeu), visible à ④ dédoublée ── -->
    @if (tableauMonte()) {
      <mg-tableau-grappes [class.hidden]="!double()" [jeuId]="jeuId()" [actif]="double()"
                          (recadrer)="recadrer($event)" (survol)="surbrillance.set($event)" />
    }
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

  /** Ce que la couleur des codes postaux encode — état LOCAL, comme React (`coloration`). */
  protected readonly coloration = signal<ColorationCp>('plan');
  protected readonly colorations = (Object.keys(LIBELLE_COLORATION) as ColorationCp[]).map((id) => ({ id, libelle: LIBELLE_COLORATION[id] }));
  /** Les codes postaux du bassin survolé dans le tableau. */
  protected readonly surbrillance = signal<string[] | null>(null);
  protected readonly chiffres = signal<ChiffresCp | null>(null);
  /** La clé du profil CALCULÉ, la même que la carte des rayons (React : `codeProfil(profilCalcul)`). */
  protected readonly codeProfilZones = computed(() => codeProfil(this.profil()));
  /** Monté au premier jeu, puis gardé : ses bassins ne sont pas redemandés à chaque retour à ④. */
  protected readonly tableauMonte = linkedSignal<boolean, boolean>({
    source: this.double,
    computation: (d, precedent) => (precedent?.value ?? false) || d,
  });

  /** Les quatre chiffres du bandeau (`VueCartesZones.tsx:274-303`). `null` se lit « aucun code postal retenu », jamais 0 %. */
  protected readonly bandeau = computed(() => {
    const c = this.chiffres();
    return [
      { libelle: 'Codes postaux du jeu', valeur: c ? formaterNombre(c.n_total) : '—', aide: null },
      { libelle: 'Retenus par le seuil', valeur: c ? formaterNombre(c.n_retenus) : '—', aide: null },
      {
        libelle: 'Taux d’utile', valeur: c?.taux_utile != null ? `${formaterDecimal(c.taux_utile, 1)} %` : '—',
        aide: 'Population exposée rapportée à celle des codes postaux achetés',
      },
      {
        libelle: 'Affichés dans le cadre', valeur: c ? formaterNombre(c.n_affiches) : '—',
        aide: 'La carte ne charge que la vue visible — jamais la France entière',
      },
    ];
  });

  private readonly carteRayonsInstance = signal<maplibregl.Map | null>(null);
  protected readonly carteCp = signal<maplibregl.Map | null>(null);

  constructor() {
    /*
     * ⚠ Les caméras ne sont liées qu'EN DOUBLE VUE, et déliées dès qu'on en sort (aucune carte détruite pour autant).
     * `lierCameras` porte le VERROU DE RÉENTRANCE (placer B émet `move` sur B, qui replacerait A…) et `jumpTo`, jamais
     * `easeTo` ; il aligne la carte des codes postaux à l'établissement de la liaison — elle vient d'apparaître et
     * montrerait sinon la France pendant que l'autre montre l'Étang de Berre. Rétablie quand le jeu change, comme React.
     */
    effect((surNettoyage) => {
      const a = this.carteRayonsInstance();
      const b = this.carteCp();
      const double = this.double();
      this.jeuId();
      if (!double || !a || !b) return;
      surNettoyage(untracked(() => lierCameras(a, b)));
    });
  }

  protected surCarteRayons(carte: maplibregl.Map): void {
    this.carteRayonsInstance.set(carte);
    this.carteRayons.emit(carte);
  }

  /** Un clic sur un bassin recadre les DEUX cartes (600 ms, marge 40 — `VueCartesZones.tsx:131`). */
  protected recadrer(b: Bbox): void {
    for (const m of [this.carteRayonsInstance(), this.carteCp()]) {
      m?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 600 });
    }
  }
}
