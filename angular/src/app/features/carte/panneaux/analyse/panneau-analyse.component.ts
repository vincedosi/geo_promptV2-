import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { BatailleV1Service } from '../../etat/bataille-v1.service';
import { BatailleV2Service } from '../../etat/bataille-v2.service';
import { ContexteBatailleService } from '../../etat/contexte-bataille.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { ReferentielGeoService } from '../../etat/referentiel-geo.service';
import type { FiltreActif } from '../../logique/filtre';
import { type OutilAnalyse, messageGardeOutil } from '../../logique/garde-perimetre';
import { ISO_MODES } from '../../logique/modes-isochrones';
import { IntroAnalyseComponent } from './intro-analyse.component';
import { OutilBatailleV2Component } from './outil-bataille-v2.component';
import { OutilIsochronesComponent } from './outil-isochrones.component';
import { PASTILLE, PASTILLE_INACTIVE, PASTILLE_PRIMAIRE_ACTIVE } from './styles-analyse';

/** L'outil déplié : les deux s'excluent (chacun ferme l'autre, `PanneauAnalyse.tsx:176-179`). */
type OutilOuvert = 'bataille-v2' | 'isochrones' | null;

/**
 * Le panneau « Analyse » de la carte — portage de `app/map/_components/panneaux/PanneauAnalyse.tsx` (lot 4, T17) :
 * le message de garde, puis l'accordéon « Analyse spatiale » (encarts d'accueil, mode de transport, Bataille V2,
 * Isochrones routiers). Score composite et corrélation (T18), clustering (T19-T20) s'y ajouteront.
 *
 * ── GARDE DE PÉRIMÈTRE (spec §5, incidents du 28/03 et du 08/04) ─────────
 * Chaque lancement passe par `verifierPerimetreOutil('<outil>')` AVANT d'appeler son service : sans filtre, « Choisissez
 * un périmètre… » ; sur la France entière, un refus qui NOMME l'outil — et aucune requête dans les deux cas. Les outils
 * ÉMETTENT, ce panneau garde : verrou structurel `tests/unit/angular/panneau-analyse-garde.test.ts`, qui lit CE source.
 * Le message vit au niveau du panneau (un refus de n'importe quel outil s'y affiche) et s'efface dès qu'un filtre est
 * posé.
 *
 * ── VORONOÏ ABSENT ───────────────────────────────────────────────────────
 * Décision du propriétaire : le Voronoï ne se lançait que par un message à l'Assistant, jamais porté. Il n'est ni
 * rendu ni gardé ici (React l'affichait entre le mode de transport et la Bataille V2).
 *
 * Le territoire des batailles vient du FILTRE (`ContexteBatailleService`), pas du sélecteur de périmètre, code mort
 * côté React depuis la refonte du panneau Filtre.
 */
@Component({
  selector: 'mg-panneau-analyse',
  imports: [IntroAnalyseComponent, OutilBatailleV2Component, OutilIsochronesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    @if (gardeMessage(); as m) {
      <div data-garde role="alert"
        class="mx-[14px] mt-[10px] rounded-[4px] border-fin border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-[10px] py-2 text-[12px] leading-[1.5] text-danger">
        ! {{ m }}
      </div>
    }

    <div class="flex flex-col">
      <button type="button" data-accordeon="spatiale" [attr.aria-expanded]="spatialeOuverte()" (click)="spatialeOuverte.set(!spatialeOuverte())"
        class="flex w-full cursor-pointer items-center gap-2 border-b-fin border-l-2 border-t border-b-subtle border-l-[color-mix(in_srgb,var(--brand-teal)_25%,transparent)] border-t-subtle bg-elevated px-[14px] py-[10px] transition-[background-color] duration-[180ms] ease-[var(--ease-out)]">
        <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
        <span class="flex-1 text-left text-[12px] font-medium text-primary">Analyse spatiale</span>
        <span class="text-[10px] text-tertiary">{{ spatialeOuverte() ? '▲' : '▼' }}</span>
      </button>
      @if (spatialeOuverte()) {
        <div class="border-b-fin border-subtle p-4">
          <div class="pb-1">
            <mg-intro-analyse [nombrePoi]="nombrePoi()" />
            @if (contexte.unPoi()) {
              <div class="mt-1 flex flex-col gap-2">
                <div>
                  <div class="mb-1.5 text-[11px] font-medium text-secondary">Mode de transport</div>
                  <div class="flex gap-[5px]">
                    @for (m of modes; track m.id) {
                      <button type="button" [attr.data-mode]="m.id" [attr.aria-pressed]="contexte.mode() === m.id" (click)="contexte.mode.set(m.id)"
                        [class]="pastille + ' flex-1 text-center ' + (contexte.mode() === m.id ? pastillePrimaire : pastilleInactive)">{{ m.label }}</button>
                    }
                  </div>
                </div>
                <mg-outil-bataille-v2
                  [ouvert]="outilOuvert() === 'bataille-v2'"
                  (basculer)="basculerOutil('bataille-v2')"
                  (verifierCache)="verifierCacheV2()"
                  (remplir)="remplirV2()"
                  (lancer)="lancerV2($event)"
                />
                <mg-outil-isochrones
                  [ouvert]="outilOuvert() === 'isochrones'"
                  (basculer)="basculerOutil('isochrones')"
                  (verifierCache)="verifierCacheV1()"
                  (lancer)="lancerV1($event)"
                  (appliquer)="appliquerBataille()"
                />
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class PanneauAnalyseComponent {
  private readonly etat = inject(EtatCarteService);
  protected readonly contexte = inject(ContexteBatailleService);
  private readonly v1 = inject(BatailleV1Service);
  private readonly v2 = inject(BatailleV2Service);

  protected readonly modes = ISO_MODES;
  protected readonly pastille = PASTILLE;
  protected readonly pastillePrimaire = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  /** Fermé à l'ouverture du panneau, comme React (`analyseOpen.spatiale: false`). */
  protected readonly spatialeOuverte = signal(false);
  protected readonly outilOuvert = signal<OutilOuvert>(null);
  protected readonly nombrePoi = computed(() => this.etat.poiSelectionnes().length);
  /** Le dernier refus ; un filtre posé l'efface (`useEffect(() => { if (filtre) setGardeMessage(null) })`). */
  protected readonly gardeMessage = linkedSignal<FiltreActif | null, string | null>({
    source: this.etat.filtre,
    computation: (filtre, precedent) => (filtre ? null : (precedent?.value ?? null)),
  });

  constructor() {
    // Le nom des régions dans le journal et la règle « toutes les régions » : lu une fois par écran (cache).
    inject(ReferentielGeoService).charger();
  }

  protected basculerOutil(outil: Exclude<OutilOuvert, null>): void {
    this.outilOuvert.update((o) => (o === outil ? null : outil));
  }

  /** La garde, pour UN outil : le message affiché, `true` si le calcul peut partir (`messageGardeOutil`). */
  protected verifierPerimetreOutil(outil: OutilAnalyse): boolean {
    const message = messageGardeOutil(outil, this.etat.filtre());
    this.gardeMessage.set(message);
    return message === null;
  }

  protected verifierCacheV1(): void {
    if (!this.verifierPerimetreOutil('bataille_v1')) return;
    this.v1.verifierCache();
  }

  protected lancerV1(force: boolean): void {
    if (!this.verifierPerimetreOutil('bataille_v1')) return;
    this.v1.lancer(force);
  }

  /** « X BATAILLE (ST_Difference) » : un second calcul PostGIS, distinct du lancement — gardé à part. */
  protected appliquerBataille(): void {
    if (!this.verifierPerimetreOutil('application_bataille')) return;
    this.v1.appliquer();
  }

  protected verifierCacheV2(): void {
    if (!this.verifierPerimetreOutil('bataille_v2')) return;
    this.v2.verifierCache();
  }

  protected remplirV2(): void {
    if (!this.verifierPerimetreOutil('bataille_v2')) return;
    this.v2.remplir();
  }

  protected lancerV2(force: boolean): void {
    if (!this.verifierPerimetreOutil('bataille_v2')) return;
    this.v2.lancer(force);
  }
}
