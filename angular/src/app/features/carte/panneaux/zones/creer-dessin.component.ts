import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { DessinService } from '../../couches/dessin.service';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { messageZoneDessin, nomDessinParDefaut } from '../../logique/zones/creation-zone';
import type { ModeDessin } from '../../logique/zones/dessin';
import { OutilCreationComponent } from './outil-creation.component';

/** Les modes proposés, libellés de React (`DessinLibre.tsx:191-193`). */
const MODES: readonly { mode: ModeDessin; libelle: string }[] = [
  { mode: 'polygone', libelle: 'Polygone' },
  { mode: 'rectangle', libelle: 'Rectangle' },
];

/**
 * « Dessiner une zone » — `CreerZoneDessin.tsx` + les boutons de `DessinLibre.tsx` (lot 4, T16). Le moteur de tracé
 * est `DessinService` (maison, B8) ; ce composant l'ouvre et le ferme avec l'outil, et envoie le tracé FERMÉ, tel
 * quel, à `/source/dessin` — la base le répare (`ST_MakeValid`) et le clippe : « tracé réparé » et la part retenue
 * sont dits dans le message, parce que la zone n'est alors pas exactement celle qui a été dessinée.
 *
 * Écarts avec React : pas de mode « Modifier » (déplacer les sommets d'un tracé fini, que `terra-draw` offrait) —
 * le tracé maison se refait ou se corrige au `Backspace` ; et le premier sommet ne ferme plus le panneau (React le
 * fermait, l'outil et son tracé disparaissaient au premier clic : `EtatCarteService.prendreCarte`).
 */
@Component({
  selector: 'mg-creer-dessin',
  imports: [OutilCreationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-outil-creation
      titre="Dessiner une zone"
      [ouvert]="ouvert()"
      [(nom)]="nom"
      [enCours]="enCours()"
      [inactif]="inactif()"
      [erreur]="erreur()"
      [message]="message()"
      (basculer)="basculer($event)"
      (creer)="creer()"
    >
      <div class="flex flex-col gap-2">
        <div class="flex gap-1.5">
          @for (m of modes(); track m.mode) {
            <button
              type="button"
              [attr.data-mode]="m.mode"
              [attr.aria-pressed]="m.actif"
              class="flex-1 cursor-pointer rounded-[6px] border-fin px-2 py-1.5 text-[11px]"
              [class]="m.actif ? 'border-teal bg-teal-10 text-teal' : 'border-default bg-transparent text-secondary'"
              (click)="dessin.choisirMode(m.mode)"
            >{{ m.libelle }}</button>
          }
        </div>

        <div data-aide class="font-mono text-[10px] leading-[1.6] text-tertiary">{{ dessin.aide() }}</div>

        <div class="flex gap-1.5">
          <button
            type="button"
            data-effacer
            [disabled]="vide()"
            class="flex-1 rounded-[6px] border-fin border-default bg-transparent px-2 py-1.5 text-[11px] text-secondary"
            [class.cursor-pointer]="!vide()"
            [class.cursor-not-allowed]="vide()"
            [class.opacity-40]="vide()"
            (click)="dessin.effacer()"
          >Effacer</button>
          <button
            type="button"
            data-quitter
            class="flex-1 cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-2 py-1.5 text-[11px] text-secondary"
            (click)="basculer(false)"
          >Quitter le dessin</button>
        </div>
      </div>
    </mg-outil-creation>
  `,
})
export class CreerDessinComponent {
  private readonly api = inject(ZonesCustomApi);
  private readonly creation = inject(CreationZoneService);
  protected readonly dessin = inject(DessinService);

  readonly cree = output<void>();

  protected readonly ouvert = signal(false);
  protected readonly nom = signal('');
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);

  protected readonly modes = computed(() => MODES.map((m) => ({ ...m, actif: this.dessin.mode() === m.mode })));
  protected readonly vide = computed(() => this.dessin.nombreSommets() === 0);
  protected readonly inactif = computed(() => this.enCours() || !this.dessin.traceFerme() || !this.creation.org());

  private abonnement: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.abonnement?.unsubscribe();
      // Le panneau se ferme : le dessin s'arrête avec lui, comme `DessinLibre` démonté (`draw.stop()`).
      if (this.ouvert()) this.dessin.arreter();
    });
  }

  protected basculer(ouvert: boolean): void {
    if (ouvert === this.ouvert()) return;
    this.ouvert.set(ouvert);
    if (ouvert) this.dessin.demarrer();
    else this.dessin.arreter();
  }

  protected creer(): void {
    const trace = this.dessin.traceFerme();
    if (this.inactif() || !trace) return;
    const nom = this.nom();
    this.enCours.set(true);
    this.erreur.set(null);
    this.message.set(null);
    // Forme figée : la géométrie RÉPARÉE et clippée par la route source part avec la recette (P5).
    this.abonnement = this.creation.creer(
      this.api.depuisDessin(trace),
      (geo) => nom || nomDessinParDefaut(geo.surface_km2),
      () => ({ v: 1, type: 'dessin' }),
    ).subscribe((issue) => {
      this.enCours.set(false);
      if ('erreur' in issue) {
        this.erreur.set(issue.erreur);
        return;
      }
      this.message.set(messageZoneDessin(issue.geo, issue.countCp));
      this.nom.set('');
      // Le tracé est effacé : sans cela, un second clic créerait une seconde zone identique.
      this.dessin.effacer();
      this.cree.emit();
    });
  }
}
