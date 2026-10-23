import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { type Cible, ProfilRisqueApi } from '../../../risques/data/profil-risque.api';
import { LectureAnnulable } from '../../etat/lecture-annulable';
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
  private readonly lecture = new LectureAnnulable<{ cibles: Cible[] }>(messageErreurRequete);
  private readonly catalogue = computed(() => {
    const c = this.lecture.resultat()?.cibles;
    return Array.isArray(c) ? c : [];
  });
  protected readonly chargement = this.lecture.enCours.asReadonly();
  protected readonly erreur = this.lecture.erreur.asReadonly();

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

  constructor() {
    effect(() => {
      if (this.cible() !== CIBLE_PAR_DEFAUT) untracked(() => this.charger());
    });
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
    this.lecture.chargerUneFois(() => this.api.cibles());
  }
}
