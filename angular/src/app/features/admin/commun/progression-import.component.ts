import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formaterNombre } from '../../../core/format/nombre';
import { IconeComponent } from '../../../ui/icone/icone.component';

/**
 * Progression d'un import (arbitrage C5, règle « progression OBLIGATOIRE » de CLAUDE.md), rendu de
 * la carte de progression de l'import Shapefile (`carreaux-import/_components/ImportStep.tsx`) :
 * étape NOMMÉE, compteur, barre, puis état final.
 *
 * Elle n'invente AUCUN pourcentage : sans `total` (le flux n'en porte pas), la barre est
 * INDÉTERMINÉE et seul le compteur des lignes reçues s'affiche. Un échec garde le pourcentage
 * atteint — jamais une barre pleine. Exception, quand le FLUX porte lui-même un pourcentage sans
 * total (IRIS crawler, champ `percent` de `manual-import`, T15) : `pourcentageFlux` rend la barre
 * déterminée à cette valeur, le compteur dit alors « N lignes traitées ».
 *
 * Écarts à React, voulus (flat total) : remplissage UNI en jeton (React : dégradés et halo).
 * Contenu projeté : `[mesures]` à droite de l'en-tête (débit, durée), le reste sous la barre
 * (compteurs finaux).
 */
@Component({
  selector: 'mg-progression-import',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="carte flex flex-col gap-3.5">
      <div class="flex items-center justify-between gap-4">
        <div class="flex min-w-0 items-center gap-2.5">
          @if (enCours()) {
            <mg-icone nom="chargement" [taille]="15" [trait]="2.5" class="tourne shrink-0 text-success" />
          }
          <span class="font-mono text-[12px] font-bold" [class]="couleurTexte()">{{ texte() }}</span>
        </div>
        <div class="flex items-center gap-4 font-mono text-[12px] text-secondary">
          <ng-content select="[mesures]" />
        </div>
      </div>
      <div class="relative">
        <div
          role="progressbar"
          [attr.aria-label]="etape()"
          [attr.aria-busy]="enCours()"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="pourcentage()"
          class="piste"
        >
          @if (indeterminee()) {
            <div data-indeterminee class="curseur"></div>
          } @else {
            <div
              data-remplissage
              class="remplissage"
              [class.termine]="termine() && !echec()"
              [class.echec]="!!echec()"
              [style.width.%]="largeur()"
            ></div>
          }
        </div>
        @if (pourcentage() !== null) {
          <!-- React : texte blanc et ombre portée, lisible sur la piste comme sur le remplissage. Sans
               ombre (flat total), deux couches : texte du thème sur la piste, texte sombre invariant
               découpé à la largeur du remplissage. -->
          <div aria-hidden="true" class="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span class="font-mono text-[10px] font-bold text-primary">{{ pourcentage() }}%</span>
          </div>
          <div aria-hidden="true" class="pointer-events-none absolute inset-0 flex items-center justify-center" [style.clip-path]="decoupe()">
            <span class="font-mono text-[10px] font-bold text-teal-fg">{{ pourcentage() }}%</span>
          </div>
        }
      </div>
      <ng-content />
    </div>
  `,
  styles: `
    .carte {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 2px;
      padding: 20px;
    }
    .piste {
      height: 18px;
      border-radius: 2px;
      background: var(--bg-level-2);
      overflow: hidden;
      border: 1px solid var(--border-subtle);
      position: relative;
    }
    .remplissage {
      height: 100%;
      border-radius: 2px;
      background: var(--warning);
      transition: width 0.3s;
    }
    .remplissage.termine { background: var(--success); }
    .remplissage.echec { background: var(--danger); }
    .curseur {
      position: absolute; top: 0; left: 0; height: 100%; width: 25%;
      border-radius: 2px;
      background: var(--warning);
      animation: glisse 1.1s ease-in-out infinite;
    }
    @keyframes glisse {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
    .tourne { animation: tourne 1s linear infinite; }
    @keyframes tourne { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .curseur { animation: none; width: 100%; opacity: 0.45; }
      .tourne { animation: none; }
    }
  `,
})
export class ProgressionImportComponent {
  /** Étape nommée : « Analyse », « Insertion », « Post-traitement »… */
  readonly etape = input.required<string>();
  readonly traitees = input<number | null>(null);
  /** `null` : le flux ne porte pas de total, la barre est indéterminée. */
  readonly total = input<number | null>(null);
  /**
   * Pourcentage PORTÉ PAR LE FLUX (0-100), quand il n'annonce pas de total — jamais un pourcentage
   * calculé ici. Ignoré si `total` est connu.
   */
  readonly pourcentageFlux = input<number | null>(null);
  readonly termine = input(false);
  readonly echec = input<string | null>(null);

  protected readonly enCours = computed(() => !this.termine() && !this.echec());

  /** Pourcentage réel, seulement si le flux porte un total ; sinon `null` (aucun aria-valuenow). */
  protected readonly pourcentage = computed(() => {
    const t = this.total();
    const n = this.traitees();
    const pf = this.pourcentageFlux();
    if (t === null && pf !== null) return Math.max(0, Math.min(100, Math.round(pf)));
    if (t === null || t <= 0 || n === null) return this.termine() && !this.echec() && t !== null ? 100 : null;
    return Math.min(100, Math.round((n / t) * 100));
  });

  protected readonly indeterminee = computed(() => this.enCours() && this.pourcentage() === null);

  protected readonly largeur = computed(() => {
    const p = this.pourcentage();
    if (p !== null) return p;
    return this.termine() && !this.echec() ? 100 : 0;
  });

  /** Découpe de la couche sombre du libellé : la partie remplie de la barre (2 px de bordure compris). */
  protected readonly decoupe = computed(() => `inset(0 calc(${100 - this.largeur()}% - 1px) 0 0)`);

  protected readonly texte = computed(() => {
    const echec = this.echec();
    if (echec) return `! ${echec}`;
    if (this.termine()) return '✓ Import terminé';
    const n = this.traitees();
    const t = this.total();
    if (n !== null && t !== null) return `${this.etape()} — ${formaterNombre(n)} / ${formaterNombre(t)}`;
    if (n !== null && this.pourcentageFlux() !== null) return `${this.etape()} — ${formaterNombre(n)} lignes traitées`;
    if (n !== null) return `${this.etape()} — ${formaterNombre(n)} lignes reçues`;
    return `${this.etape()}…`;
  });

  protected readonly couleurTexte = computed(() =>
    this.echec() ? 'text-danger' : this.termine() ? 'text-success' : 'text-warning');
}
