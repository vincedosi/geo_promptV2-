import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { ScoreCompositeService } from '../../etat/score-composite.service';
import { dateFr } from '../../logique/analyses/commun';
import { MAX_INDICATEURS, libelleIndicateur, libelleRetenus } from '../../logique/analyses/score';
import {
  BOUTON_CALCUL, CORPS_ACCORDEON, ENCART_ERREUR, ENTETE_ACCORDEON, LIBELLE_CHAMP, LISTE_CHAMP, PASTILLE, PASTILLE_INACTIVE,
  PASTILLE_PRIMAIRE_ACTIVE,
} from './styles-analyse';

/**
 * L'outil « Score composite » du panneau Analyse — le gabarit de `filter-panel/ScoreCompositeTool.tsx` (lot 4, T18).
 * Répond à « où faut-il acheter ? » par une note 0-100 par code postal, agrégeant jusqu'à six indicateurs INSEE de
 * poids et de sens différents, sur le périmètre du filtre — la France entière comprise (seul outil national).
 *
 * Il LIT et règle l'état (`ScoreCompositeService`) et ÉMET le lancement : c'est le panneau qui garde le périmètre avant
 * d'appeler le service (verrou `tests/unit/angular/panneau-analyse-garde.test.ts`).
 */
@Component({
  selector: 'mg-outil-score',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button type="button" data-entete-outil [attr.aria-expanded]="s.ouvert()" (click)="s.basculerOuvert()" [class]="entete">
      <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
      <span class="flex-1 text-left text-[12px] font-medium text-primary">Score composite</span>
      <span class="text-[10px] text-tertiary">{{ s.ouvert() ? '▲' : '▼' }}</span>
    </button>
    @if (s.ouvert()) {
      <div [class]="corps">
        <div class="text-[11px] leading-[1.5] text-tertiary">
          Combine plusieurs indicateurs en une note de 0 à 100 par code postal, sur le périmètre du filtre actif.
        </div>

        <div>
          <div [class]="libelleChamp">Indicateurs ({{ s.choisis().length }}/{{ max }})</div>
          @if (s.chargementCatalogue()) {
            <div class="font-mono text-[11px] text-tertiary">Chargement du catalogue…</div>
          } @else {
            <select data-ajouter [class]="liste" [disabled]="s.choisis().length >= max || s.disponibles().length === 0"
              (change)="ajouter($event)">
              <option value="">{{ s.choisis().length >= max ? 'Maximum atteint' : 'Ajouter un indicateur…' }}</option>
              @for (i of s.disponibles(); track i.indicator_code) {
                <option [value]="i.indicator_code">{{ libelleIndicateur(i) }}</option>
              }
            </select>
          }
        </div>

        @for (c of s.choisis(); track c.code) {
          <div [attr.data-indicateur]="c.code" class="rounded-[6px] border-fin border-subtle bg-elevated p-[10px]">
            <div class="mb-2 flex items-center gap-2">
              <span class="flex-1 text-[12px] text-primary">{{ c.label }}</span>
              <button type="button" [attr.aria-label]="'Retirer ' + c.label" (click)="s.retirer(c.code)"
                class="cursor-pointer border-0 bg-transparent text-[14px] leading-none text-tertiary">×</button>
            </div>
            <div class="mb-2 flex items-center gap-2">
              <span class="w-[42px] text-[11px] text-tertiary">Poids</span>
              <input type="range" min="0.1" max="3" step="0.1" [value]="c.poids" [attr.aria-label]="'Poids de ' + c.label"
                (input)="poids(c.code, $event)" class="flex-1 accent-[var(--brand-teal)]" />
              <span class="w-7 text-right font-mono text-[11px] text-secondary">{{ c.poids.toFixed(1) }}</span>
            </div>
            <div class="flex gap-[5px]">
              <button type="button" data-sens="croissant" [attr.aria-pressed]="c.sens === 'croissant'" (click)="s.modifier(c.code, { sens: 'croissant' })"
                [class]="pastille + ' flex-1 text-center ' + (c.sens === 'croissant' ? pastilleActive : pastilleInactive)">Haut = mieux</button>
              <button type="button" data-sens="decroissant" [attr.aria-pressed]="c.sens === 'decroissant'" (click)="s.modifier(c.code, { sens: 'decroissant' })"
                [class]="pastille + ' flex-1 text-center ' + (c.sens === 'decroissant' ? pastilleActive : pastilleInactive)">Bas = mieux</button>
            </div>
          </div>
        }

        <label class="flex cursor-pointer items-center gap-2">
          <input type="checkbox" data-enregistrer [checked]="s.enregistrer()" (change)="s.enregistrer.set(!s.enregistrer())"
            class="accent-[var(--brand-teal)]" />
          <span class="text-[11px] text-secondary">Enregistrer dans « Mes analyses »</span>
        </label>

        <button type="button" data-calculer [disabled]="s.choisis().length === 0 || s.calcul()" (click)="lancer.emit()" [class]="boutonCalcul">
          {{ s.calcul() ? 'Calcul…' : 'Calculer le score' }}
        </button>

        @if (s.erreur(); as e) {
          <div data-erreur [class]="encartErreur">{{ e }}</div>
        }

        @if (s.resultat(); as r) {
          <div class="flex flex-col gap-[10px]">
            <div data-resume class="font-mono text-[11px] leading-[1.6] text-secondary">
              {{ nombre(r.perimetre.n_scores) }} codes postaux scorés sur {{ nombre(r.perimetre.n_codes_postaux) }}
              <!-- Un score calculé sur un sous-ensemble des indicateurs demandés n'est pas comparable à un score complet. -->
              @if (r.perimetre.n_complets < r.perimetre.n_scores) {
                <br /><span class="text-warning">{{ nombre(r.perimetre.n_scores - r.perimetre.n_complets) }} partiels (indicateur manquant sur ces CP)</span>
              }
            </div>
            <!-- Matérialisés à la demande, les indicateurs peuvent dater de plusieurs semaines. -->
            <div data-dates class="font-mono text-[10px] leading-[1.6] text-tertiary">
              @for (i of r.indicateurs; track i.code) {
                <div>{{ i.label }} · {{ date(i.calcule_le) }}</div>
              }
            </div>
            <div>
              <div [class]="libelleChamp">Créer une zone au-dessus d’un seuil</div>
              <div class="mb-2 flex items-center gap-2">
                <input type="range" min="0" max="100" step="5" [value]="s.seuil()" aria-label="Seuil du score"
                  (input)="seuil($event)" class="flex-1 accent-[var(--brand-teal)]" />
                <span class="w-7 text-right font-mono text-[11px] text-secondary">{{ s.seuil() }}</span>
              </div>
              <div data-retenus class="mb-2 font-mono text-[10px] text-tertiary">{{ retenus(s.auDessusDuSeuil()) }}</div>
              <button type="button" data-creer-zone [disabled]="s.creationZone() || s.auDessusDuSeuil() === 0 || !s.org()" (click)="s.creerZone()"
                class="w-full rounded-[6px] border-fin border-subtle bg-transparent px-4 py-2 text-[12px] text-secondary disabled:cursor-not-allowed disabled:opacity-40 enabled:cursor-pointer">
                {{ s.creationZone() ? 'Création…' : 'Créer la zone' }}
              </button>
              @if (s.messageZone(); as mz) {
                <div data-message-zone class="mt-2 text-[11px] leading-[1.5] text-secondary">{{ mz }}</div>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class OutilScoreComponent {
  /** « Calculer le score » : le panneau garde le périmètre, puis appelle `ScoreCompositeService.lancer`. */
  readonly lancer = output<void>();

  protected readonly s = inject(ScoreCompositeService);
  protected readonly max = MAX_INDICATEURS;
  protected readonly libelleIndicateur = libelleIndicateur;
  protected readonly nombre = formaterNombre;
  protected readonly date = dateFr;
  protected readonly retenus = libelleRetenus;
  protected readonly entete = ENTETE_ACCORDEON;
  protected readonly corps = CORPS_ACCORDEON;
  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly liste = LISTE_CHAMP;
  protected readonly boutonCalcul = BOUTON_CALCUL;
  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly pastille = PASTILLE;
  protected readonly pastilleActive = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;

  /** La liste revient à « Ajouter un indicateur… » après chaque choix (`value=""` de React). */
  protected ajouter(e: Event): void {
    const select = e.target as HTMLSelectElement;
    const code = select.value;
    select.value = '';
    if (code) this.s.ajouter(code);
  }

  protected poids(code: string, e: Event): void {
    this.s.modifier(code, { poids: Number((e.target as HTMLInputElement).value) });
  }

  protected seuil(e: Event): void {
    this.s.seuil.set(Number((e.target as HTMLInputElement).value));
  }
}
