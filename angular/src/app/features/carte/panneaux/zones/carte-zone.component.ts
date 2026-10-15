import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import type { FormatExportZone, ZoneCustomResume } from '../../data/zones-custom.api';
import type { IndicateurRegistre } from '../../logique/analyses/score';
import { decrireComposition } from '../../logique/zones/composition';
import { libelleRecetteAffiche, libelleSource } from '../../logique/zones/libelle-zone';
import { estRecalculable } from '../../logique/zones/recette';
import { dateZone } from '../../logique/zones/zones-affichees';

/** Le bouton fantôme de React (`ghostBtn`, `ZonesOverlay.tsx:615-624`) : bord 0,5 px subtil, 10 px, rayon 4. */
const FANTOME = 'flex cursor-pointer items-center justify-center gap-1 rounded-[4px] border-fin bg-transparent text-[10px] '
  + 'transition-all duration-150 ease-[var(--ease-hover)]';

/**
 * Une carte de « Mes zones » — `ZoneCard` (`components/map/overlays/ZonesOverlay.tsx:431-588`), présentationnelle :
 * case de sélection et son RANG (l'ordre de cochage désigne la base d'une soustraction), point et bord à la teinte de
 * la zone quand elle est affichée, type de source, comptes, composition en clair (dérivée, aucune requête), codes
 * département / région, date, puis Afficher / Masquer, script DV360, ciblage TikTok, supprimer.
 *
 * Lot 3 (T12) : la RECETTE de la zone en une ligne (`data-recette`, « Forme figée » sans recette) et « Recalculer »
 * quand elle se rejoue. Pour une zone à recette, la ligne de composition (qui ne lit que les métadonnées de React et
 * rendait « recette_codes_postaux ») disparaît, et la puce de source prend le libellé du type (`libelleSource`).
 *
 * La teinte d'une zone affichée est une DONNÉE (`PALETTE_ZONES`, B12) : elle est posée en style, comme sur la carte.
 */
@Component({
  selector: 'mg-carte-zone',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col gap-1.5 rounded-[8px] border-fin bg-elevated p-[10px] transition-[border-color] duration-150 ease-[var(--ease-hover)]',
    '[class.border-subtle]': '!couleur()',
    '[style.border-color]': 'couleur()',
    '[attr.data-zone]': 'zone().id',
  },
  template: `
    <div class="flex items-center gap-1.5">
      <label class="flex shrink-0 cursor-pointer items-center gap-1">
        <input
          type="checkbox"
          data-selection
          class="cursor-pointer accent-[var(--brand-teal)]"
          [checked]="rang() >= 0"
          [attr.aria-label]="'Selectionner ' + zone().name + ' pour une operation'"
          (change)="basculer.emit()"
        />
        @if (rang() >= 0) {
          <span data-rang class="min-w-[10px] text-center font-mono text-[9px] text-teal">{{ rang() + 1 }}</span>
        }
      </label>
      @if (couleur(); as c) {
        <span data-point class="size-1.5 shrink-0 rounded-full" [style.background]="c"></span>
      }
      <span class="flex-1 truncate text-[12px] font-medium text-primary">{{ zone().name }}</span>
    </div>

    <div class="flex items-center gap-1.5 text-[10px]">
      <span data-source class="rounded-[3px] bg-elevated px-1.5 py-px text-[9px] text-secondary" [class.font-mono]="!source().isReadable">{{ source().label }}</span>
      <span data-comptes class="font-mono text-tertiary">{{ comptes() }}</span>
    </div>

    <!-- Une zone à recette (lot 3) : sa recette REMPLACE la composition, qui ne lit que les métadonnées de React. -->
    @if (!zone().recette) {
      <div data-composition class="text-[10px] leading-[1.5] text-secondary">{{ composition() }}</div>
    }
    <!-- Sur la largeur étroite du tiroir, la recette passe à la ligne plutôt que d'être tronquée : c'est son contenu
         (seuil, rayon, unité) qui distingue deux zones. -->
    <div class="flex items-start gap-1.5">
      <div data-recette class="min-w-0 flex-1 break-words text-[11px] leading-[1.5] text-tertiary">{{ recette() }}</div>
      @if (recalculable()) {
        <button
          type="button"
          data-recalculer
          [disabled]="recalculEnCours()"
          (click)="recalculer.emit()"
          class="shrink-0 cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-2 py-1 text-[11px] text-secondary hover:border-hover hover:bg-elevated hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >Recalculer</button>
      }
    </div>

    <!-- L'espace interpolée après « Dept: » : celle de React ; Angular retire un blanc seul entre deux balises. -->
    @if (codes(); as c) {
      <div data-codes class="text-[10px] leading-[1.5] text-tertiary">
        @if (c.dept) {
          <span><span class="text-secondary">Dept:</span>{{ ' ' }}<span class="font-mono">{{ c.dept }}</span></span>
        }
        @if (c.dept && c.region) {
          <span class="mx-1.5">·</span>
        }
        @if (c.region) {
          <span><span class="text-secondary">Région:</span>{{ ' ' }}<span class="font-mono">{{ c.region }}</span></span>
        }
      </div>
    }

    <div class="font-mono text-[9px] text-tertiary">{{ date() }}</div>

    <div class="mt-1 flex gap-1.5">
      @if (couleur()) {
        <button type="button" data-masquer [class]="fantome + ' flex-1 border-subtle px-2 py-[5px] text-secondary'" (click)="masquer.emit()">
          <mg-icone nom="oeil-barre" [taille]="11" /> Masquer
        </button>
      } @else {
        <button
          type="button"
          data-afficher
          [class]="fantome + ' flex-1 border-teal px-2 py-[5px] text-teal'"
          [class.cursor-wait]="enCours()"
          [class.opacity-60]="enCours()"
          [disabled]="enCours()"
          (click)="afficher.emit()"
        >
          <mg-icone nom="oeil" [taille]="11" /> {{ enCours() ? 'Chargement…' : 'Afficher' }}
        </button>
      }
      <button
        type="button"
        data-export="bidding_script"
        title="Générer le script custom bidding DV360 (fichier à coller dans DV360)"
        [class]="fantome + ' flex-none border-teal px-2 py-1 text-teal'"
        (click)="exporter.emit('bidding_script')"
      >
        <mg-icone nom="fichier-bas" [taille]="11" />
      </button>
      <button
        type="button"
        data-export="tiktok_geo"
        title="Exporter le ciblage géo TikTok Ads (régions + départements de la zone)"
        [class]="fantome + ' flex-none border-subtle px-2 py-1 text-secondary'"
        (click)="exporter.emit('tiktok_geo')"
      >
        <mg-icone nom="musique" [taille]="11" />
      </button>
      <button
        type="button"
        data-supprimer
        title="Supprimer la zone"
        [class]="fantome + ' supprimer flex-1 border-subtle px-2 py-1 text-tertiary'"
        (click)="supprimer.emit()"
      >
        <mg-icone nom="corbeille" [taille]="11" />
      </button>
    </div>
  `,
  // Le survol rouge de la corbeille (`ZonesOverlay.tsx:580-581`) : rgba(255,87,87,0.3) = le jeton danger à 30 %.
  styles: `
    .supprimer:hover { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
  `,
})
export class CarteZoneComponent {
  readonly zone = input.required<ZoneCustomResume>();
  /** La teinte de la zone si elle est affichée, `null` sinon (`loaded`). */
  readonly couleur = input<string | null>(null);
  /** Sa géométrie est en lecture (`pending`). */
  readonly enCours = input(false);
  /**
   * Son recalcul est en vol : « Recalculer » est désactivé. Distinct d'`enCours` (lecture de la géométrie), qui
   * désactive « Afficher » et lui fait dire « Chargement… » — un recalcul ne doit pas passer pour un affichage.
   */
  readonly recalculEnCours = input(false);
  /** Position dans la sélection (0 = base d'une soustraction), -1 si non cochée. */
  readonly rang = input(-1);

  readonly afficher = output<void>();
  readonly masquer = output<void>();
  readonly supprimer = output<void>();
  readonly basculer = output<void>();
  readonly exporter = output<FormatExportZone>();
  /** « Recalculer » (lot 3) : rejouer la recette côté serveur. Émise seulement si la recette se recalcule. */
  readonly recalculer = output<void>();
  /**
   * Le catalogue d'indicateurs, pour nommer un seuil sur territoires (libellé et unité, jamais l'identifiant). Lu par
   * « Mes zones » seulement quand un tel seuil est listé ; vide sinon.
   */
  readonly indicateurs = input<readonly IndicateurRegistre[]>([]);

  protected readonly fantome = FANTOME;
  protected readonly source = computed(() => libelleSource(this.zone().source_type));
  /** La recette en clair ; « Forme figée » pour une zone d'avant le lot 3 (aucune recette enregistrée). */
  protected readonly recette = computed(() => {
    const r = this.zone().recette;
    return r ? libelleRecetteAffiche(r, this.indicateurs()) : 'Forme figée';
  });
  protected readonly recalculable = computed(() => {
    const r = this.zone().recette;
    return !!r && estRecalculable(r);
  });
  /** Bruts, sans séparateur de milliers, comme React (`{zone.feature_count_iris} IRIS · {zone.feature_count_cp} CP`). */
  protected readonly comptes = computed(() => `${this.zone().feature_count_iris} IRIS · ${this.zone().feature_count_cp} CP`);
  protected readonly composition = computed(() => decrireComposition(this.zone().source_type, this.zone().source_metadata));
  protected readonly codes = computed(() => {
    const dept = (this.zone().dept_codes ?? []).join(', ');
    const region = (this.zone().region_codes ?? []).join(', ');
    return dept || region ? { dept, region } : null;
  });
  protected readonly date = computed(() => dateZone(this.zone().created_at));
}
