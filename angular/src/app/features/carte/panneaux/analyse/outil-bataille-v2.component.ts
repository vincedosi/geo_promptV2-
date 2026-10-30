import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { BatailleService } from '../../couches/bataille.service';
import { BatailleV2Service, PALIERS_V2, REFUS_BATAILLE_PAYS } from '../../etat/bataille-v2.service';
import { ChoixSurZoneComponent } from './choix-sur-zone.component';
import { JournalBatailleComponent } from './journal-bataille.component';
import { StatutCacheComponent } from './statut-cache.component';
import {
  BOUTON_AVERTISSEMENT, BOUTON_DESACTIVE, BOUTON_GRIS, BOUTON_PRIMAIRE, BOUTON_TEAL, PASTILLE, PASTILLE_INACTIVE, PASTILLE_PRIMAIRE_ACTIVE,
} from './styles-analyse';

/**
 * L'outil « Bataille V2 (multi-paliers) » — portage de `filter-panel/BattleV2Tool.tsx` (lot 4, T17) : paliers,
 * statut du cache, remplissage ORS des POI manquants, LANCER / FORCER, progressions, journal, « Masquer ».
 *
 * Il LIT l'état (`BatailleV2Service`, `BatailleService`) et ÉMET chaque lancement : le panneau Analyse garde le
 * périmètre avant d'appeler le service. Comme React, LANCER et FORCER oublient le statut du cache AVANT l'émission.
 *
 * Écarts justifiés : la barre « indéterminée » de la découpe PostGIS est un dégradé animé chez React
 * (`linear-gradient` + `fpScan`, une `@keyframes` définie nulle part : elle n'a jamais bougé) — ici un segment plat,
 * même place, même largeur, « flat total » ; l'intitulé ne clignote pas, pour la même raison.
 */
@Component({
  selector: 'mg-outil-bataille-v2',
  imports: [ChoixSurZoneComponent, JournalBatailleComponent, StatutCacheComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block overflow-hidden rounded-[4px] border-fin', '[class.border-default]': 'ouvert()', '[class.border-subtle]': '!ouvert()' },
  template: `
    <button type="button" data-entete-outil [disabled]="v2.chargement()" [attr.aria-expanded]="ouvert()" (click)="basculer.emit()"
      class="flex w-full cursor-pointer items-center justify-between border-0 px-3 py-[9px]"
      [class]="ouvert() ? 'bg-elevated' : 'bg-[color-mix(in_srgb,var(--text-primary)_2%,transparent)]'">
      <span class="text-[12px] font-medium" [class]="bataille.visible() ? 'text-primary' : 'text-secondary'">{{ bataille.visible() ? '✓ ' : '' }}Bataille V2 (multi-paliers)</span>
      <span class="text-[10px] text-tertiary">{{ ouvert() ? '▲' : '▼' }}</span>
    </button>
    @if (ouvert()) {
      <div data-corps-outil class="flex flex-col gap-3 border-t-fin border-subtle bg-[color-mix(in_srgb,var(--text-primary)_1%,transparent)] p-[13px]">
        <div class="text-[12px] leading-[1.5] text-secondary">
          Lit le cache existant — <span class="text-primary">aucun appel ORS</span>. Paliers manquants skippés.
          S’il en manque, vérifiez le cache puis calculez les POI manquants (ORS) avec le bouton qui apparaît.
        </div>

        @if (v2.zoneAnalysee()) {
          <mg-choix-sur-zone [(surZone)]="v2.surZone" objet="de la bataille" />
        }
        @if (v2.zonePays()) {
          <div data-refus-pays class="text-[11px] leading-[1.5] text-secondary">{{ refusPays }}</div>
        }
        @if (v2.zoneBataille()) {
          <div data-cache-sur-zone class="text-[11px] leading-[1.5] text-tertiary">
            Sur la zone, la bataille lit le cache existant : les POI de la zone sans isochrones sont ignorés. La vérification
            du cache et le calcul ORS se font sur le périmètre de l’étape ①.
          </div>
        }

        <div>
          <div class="mb-1.5 text-[11px] font-medium text-secondary">Paliers — {{ v2.paliers().join(', ') }} min</div>
          <div class="flex flex-wrap gap-[5px]">
            @for (p of paliers; track p) {
              <button type="button" data-palier [attr.aria-pressed]="v2.paliers().includes(p)" (click)="v2.basculerPalier(p)"
                [class]="pastille + ' ' + (v2.paliers().includes(p) ? pastillePrimaire : pastilleInactive)">{{ p }} min</button>
            }
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          @if (v2.cache(); as s) {
            <mg-statut-cache [statut]="s" />
            @if (s.missing_pois > 0) {
              <button type="button" data-remplir [disabled]="remplirInactif()" (click)="remplir.emit()"
                [class]="bouton + ' ' + (remplirInactif() ? desactive : avertissement)">{{ v2.remplissage() ? 'ORS EN COURS...' : 'CALCULER ' + s.missing_pois + ' POI' + (s.missing_pois > 1 ? 'S' : '') + ' MANQUANTS (ORS)' }}</button>
            }
          }
          <div class="flex gap-1.5">
            <button type="button" data-verifier-cache [disabled]="verifInactive()" (click)="verifierCache.emit()"
              [class]="bouton + ' ' + (verifInactive() ? desactive : gris)">{{ v2.verification() ? 'VÉRIF...' : 'VÉRIFIER CACHE' }}</button>
            <button type="button" data-lancer [disabled]="lancerInactif()" (click)="lancerApresOubli(false)"
              [class]="bouton + ' ' + (lancerInactif() ? desactive : teal)">{{ v2.chargement() ? 'CALCUL...' : 'LANCER' }}</button>
            <button type="button" data-forcer [disabled]="lancerInactif()" (click)="lancerApresOubli(true)"
              [class]="bouton + ' ' + (lancerInactif() ? desactive : avertissement)">FORCER</button>
          </div>
        </div>

        @if (v2.remplissage()) {
          <div data-progression-ors class="flex flex-col gap-1">
            <div class="flex justify-between text-[11px] text-tertiary">
              <span class="text-warning">{{ v2.remplissageTotal() > 0 ? 'ORS — ' + v2.remplissageTermines() + '/' + v2.remplissageTotal() + ' POIs' : 'ORS — initialisation...' }}</span>
              <span [class]="v2.remplissagePct() > 0 ? 'text-success' : 'text-tertiary'">{{ v2.remplissagePct() }}%</span>
            </div>
            <div class="h-1 overflow-hidden rounded-[2px] bg-elevated">
              <div class="h-full rounded-[2px] transition-[width] duration-[400ms] ease-linear" [class]="v2.remplissagePct() === 100 ? 'bg-success' : 'bg-warning'" [style.width.%]="v2.remplissagePct()"></div>
            </div>
            <div class="flex gap-[10px] text-[11px] text-tertiary">
              @if (v2.remplissageTotal() > 0) {
                <span class="text-success">↗ {{ v2.remplissageAnneaux() }} isochrones reçus</span>
                <span>·</span>
                <span>{{ v2.remplissageTotal() - v2.remplissageTermines() }} POIs restants</span>
              }
            </div>
          </div>
        }

        @if (v2.chargement()) {
          <div data-progression-v2 class="flex flex-col gap-1">
            <div class="text-[11px] text-secondary">Bataille V2 — PostGIS ST_Difference...</div>
            <div class="relative h-1 overflow-hidden rounded-[2px] bg-elevated">
              <div class="absolute h-full w-[40%] rounded-[2px] bg-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)]"></div>
            </div>
          </div>
        }

        @if (v2.journal().length > 0) {
          <mg-journal-bataille [journal]="v2.journal()" [enCours]="v2.chargement() || v2.remplissage()" [hauteurMax]="140" />
        }

        @if (bataille.visible()) {
          <button type="button" data-masquer (click)="masquer()" [class]="pastille + ' ' + pastilleInactive">Masquer</button>
        }
      </div>
    }
  `,
})
export class OutilBatailleV2Component {
  readonly ouvert = input.required<boolean>();
  readonly basculer = output<void>();
  readonly verifierCache = output<void>();
  readonly remplir = output<void>();
  /** `true` : FORCER (`force_battle`). */
  readonly lancer = output<boolean>();

  protected readonly v2 = inject(BatailleV2Service);
  protected readonly bataille = inject(BatailleService);
  protected readonly paliers = PALIERS_V2;
  protected readonly pastille = PASTILLE;
  protected readonly pastillePrimaire = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  protected readonly bouton = BOUTON_PRIMAIRE;
  protected readonly desactive = BOUTON_DESACTIVE;
  protected readonly gris = BOUTON_GRIS;
  protected readonly teal = BOUTON_TEAL;
  protected readonly avertissement = BOUTON_AVERTISSEMENT;

  private readonly sansPaliers = computed(() => this.v2.paliers().length === 0);
  protected readonly lancerInactif = computed(() => this.sansPaliers() || this.v2.chargement() || this.v2.remplissage() || this.v2.zonePays());
  /** La phrase de la route (`isochrone-battle-v2`, zone pays → 422), dite avant le clic (relecture 2). */
  protected readonly refusPays = REFUS_BATAILLE_PAYS;
  // Sur la zone (④ finitions, T7), cache et remplissage restent sur ① : inactifs, la raison est dite au-dessus.
  protected readonly verifInactive = computed(() => this.lancerInactif() || this.v2.verification() || this.v2.zoneBataille() !== null);
  protected readonly remplirInactif = computed(() => this.v2.remplissage() || this.v2.chargement() || this.v2.zoneBataille() !== null);

  /** `setV2CacheStatus(null); handleBattleV2(force)` (`BattleV2Tool.tsx:179,186`). */
  protected lancerApresOubli(force: boolean): void {
    this.v2.oublierCache();
    this.lancer.emit(force);
  }

  /** « Masquer » : la bataille se cache, le journal se vide (`BattleV2Tool.tsx:268`). */
  protected masquer(): void {
    this.bataille.visible.set(false);
    this.v2.viderJournal();
  }
}
