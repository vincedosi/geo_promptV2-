import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { type Cible, ProfilRisqueApi } from '../../../risques/data/profil-risque.api';
import { messageErreurRequete } from '../../logique/analyses/commun';
import { CIBLE_PAR_DEFAUT } from '../../logique/analyses/couverture';
import { LIBELLE_CHAMP, PASTILLE, PASTILLE_INACTIVE, PASTILLE_PRIMAIRE_ACTIVE } from './styles-analyse';

/** Le libellé de la cible par défaut tant que le catalogue n'est pas lu (`cibles_exposition`, rang 1). */
const LIBELLE_CIBLE_DEFAUT = 'Population totale';

/**
 * ④ Analyse — le choix de la cible (catalogue `GET /api/risques/exposition/cibles`, par famille), extrait de
 * « Couverture d'une zone » (T8) pour servir aussi « Couverture par rayon » (lot 4, T12).
 *
 * AUCUNE LECTURE À L'OUVERTURE : le catalogue est lu à la première ouverture du sélecteur — ou quand la cible reçue
 * n'est pas la cible par défaut, pour la NOMMER —, une fois par composant ; un échec se relit à l'ouverture suivante.
 * `libelle` est public : le parent le lit pour écrire le chiffre de tête.
 */
@Component({
  selector: 'mg-choix-cible',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-choix-cible': '' },
  template: `
    <div [class]="libelleChamp">Cible</div>
    @if (!ouverte()) {
      <button type="button" data-ouvrir-cible (click)="ouvrir()" [class]="pastille + ' ' + pastilleInactive">{{ libelle() }} ▾</button>
    } @else {
      @if (chargement()) { <div class="font-mono text-[11px] text-tertiary">Chargement…</div> }
      @if (erreur(); as e) { <div class="text-[11px] text-danger" role="alert">{{ e }}</div> }
      <div class="flex max-h-[220px] flex-col gap-2 overflow-y-auto" data-liste-cibles>
        @for (g of familles(); track g.famille) {
          <div>
            <div class="mb-1 text-[10px] text-tertiary">{{ g.famille }}</div>
            <div class="flex flex-wrap gap-[5px]">
              @for (c of g.cibles; track c.code) {
                <button type="button" [attr.data-cible]="c.code" [attr.aria-pressed]="c.code === cible()" (click)="choisir(c.code)"
                  [class]="pastille + ' ' + (c.code === cible() ? pastilleActive : pastilleInactive)">{{ c.libelle }}</button>
              }
            </div>
          </div>
        }
      </div>
      <button type="button" data-fermer-cible (click)="ouverte.set(false)" [class]="pastille + ' ' + pastilleInactive + ' mt-1.5'">Fermer</button>
    }
  `,
})
export class ChoixCibleComponent {
  readonly cible = input.required<string>();
  readonly choisie = output<string>();

  private readonly api = inject(ProfilRisqueApi);
  protected readonly ouverte = signal(false);
  private readonly catalogue = signal<Cible[]>([]);
  protected readonly chargement = signal(false);
  protected readonly erreur = signal<string | null>(null);

  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly pastille = PASTILLE;
  protected readonly pastilleActive = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;

  /** Les cibles regroupées par famille, dans l'ordre du catalogue (rang de population). */
  protected readonly familles = computed(() => {
    const g = new Map<string, Cible[]>();
    for (const c of this.catalogue()) g.set(c.famille, [...(g.get(c.famille) ?? []), c]);
    return [...g].map(([famille, cibles]) => ({ famille, cibles }));
  });
  readonly libelle = computed(() => {
    const code = this.cible();
    return this.catalogue().find((c) => c.code === code)?.libelle ?? (code === CIBLE_PAR_DEFAUT ? LIBELLE_CIBLE_DEFAUT : code);
  });

  private lecture: Subscription | null = null;
  private demandee = false;

  constructor() {
    effect(() => {
      if (this.cible() !== CIBLE_PAR_DEFAUT) untracked(() => this.charger());
    });
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
  }

  protected ouvrir(): void {
    this.ouverte.set(true);
    this.charger();
  }

  protected choisir(code: string): void {
    this.ouverte.set(false);
    this.choisie.emit(code);
  }

  private charger(): void {
    if (this.demandee) return;
    this.demandee = true;
    this.chargement.set(true);
    this.erreur.set(null);
    this.lecture = this.api.cibles().subscribe({
      next: (r) => {
        this.catalogue.set(Array.isArray(r.cibles) ? r.cibles : []);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(messageErreurRequete(e));
        this.demandee = false;
      },
    });
  }
}
