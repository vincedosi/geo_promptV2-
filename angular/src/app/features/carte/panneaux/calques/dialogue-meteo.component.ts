import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild,
} from '@angular/core';
import { MeteoService } from '../../couches/meteo.service';
import { PileEchapService } from '../../etat/pile-echap.service';
import { PRESETS, type Preset, periodeParDefaut, validerPeriodeDialogue } from '../../logique/meteo/periode-dialogue';
import { todayStr } from '../../logique/meteo/requete';
import type { MeteoMode, MeteoScale, MeteoVariable } from '../../logique/meteo/types';

/** Les quatre variables (`VARIABLES`, `MeteoGeoPanel.tsx:28-33`), icônes comprises. */
const VARIABLES: ReadonlyArray<{ id: MeteoVariable; label: string; icon: string }> = [
  { id: 'precipitation', label: 'Précipitations', icon: '☁' },
  { id: 'temperature_2m', label: 'Température', icon: '🌡' },
  { id: 'windspeed_10m', label: 'Vent', icon: '💨' },
  { id: 'sunshine_duration', label: 'Ensoleillement', icon: '☀' },
];

/** Granularités du plus fin au plus large (`SCALES`, `MeteoGeoPanel.tsx:36-40`). */
const ECHELLES: ReadonlyArray<{ id: MeteoScale; label: string; hint: string }> = [
  { id: 'cp', label: 'Code postal', hint: '~6 200 zones' },
  { id: 'departement', label: 'Département', hint: '96 zones' },
  { id: 'region', label: 'Région', hint: '13 zones' },
];

let compteur = 0;

/**
 * Le dialogue « Zones météo » de la carte — portage de `MeteoGeoPanel.tsx` en mode choroplèthe (`scaleSelectable`),
 * monté par la page comme la modale de `page.tsx:1456-1488`.
 *
 * `<dialog>` natif (B13), dans l'arbre de la racine d'ombre, jamais un voile `position: fixed`. Monté par un `@if` et
 * détruit à la fermeture : chaque ouverture repart des défauts de React (précipitations, département, prévisions sur
 * 7 jours — React le remontait sans `initialParams`). Il s'inscrit dans la pile Échap (`meteo`) le temps de sa vie ;
 * un Échap tapé dedans est CONSOMMÉ (`preventDefault`) : il ferme le dialogue, pas le panneau derrière.
 *
 * Le composant ne tient que l'état et le gabarit : validation, préréglages et périodes par défaut sont dans
 * `logique/meteo/periode-dialogue.ts` (pur, testé), les bornes et la date du jour dans `logique/meteo/requete.ts`.
 *
 * Il reste ouvert pendant le chargement (bouton « Chargement… », barre quand le serveur annonce plusieurs lots) et en
 * cas d'erreur (le message s'affiche dedans) ; c'est `MeteoService` qui le ferme à la réussite.
 *
 * Écarts à React, défauts corrigés : `#ff5757` en dur → `--danger` (lisible en thème clair) ; `colorScheme: 'dark'` en
 * dur sur les champs de date → hérité du thème (l'icône du calendrier disparaissait en clair) ; ombre portée retirée
 * (flat total) ; texte d'« Appliquer » en `--brand-teal-fg` (React : `--bg-primary`, blanc sur teal en clair). Gardés pour la parité (défauts listés) : libellés de section en capitales (`text-transform`),
 * statistiques au point décimal (`toFixed`).
 */
@Component({
  selector: 'mg-dialogue-meteo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialogue
      [attr.aria-labelledby]="idTitre"
      (cancel)="annuler($event)"
      (keydown)="clavier($event)"
      (click)="surClic($event)"
    >
      <div class="tete">
        <span class="point"></span>
        <span [id]="idTitre" data-titre class="titre">Zones météo</span>
        <button type="button" data-fermer class="croix" aria-label="Fermer" (click)="meteo.fermerDialogue()">×</button>
      </div>

      <div class="section">
        <span class="label">Variable</span>
        <div class="grille">
          @for (v of variables; track v.id) {
            <button type="button" class="pastille" [attr.data-variable]="v.id" [attr.aria-pressed]="variable() === v.id"
              (click)="variable.set(v.id)">{{ v.icon }} {{ v.label }}</button>
          }
        </div>
      </div>

      <div class="section">
        <span class="label">Granularité</span>
        <div class="ligne">
          @for (s of echelles; track s.id) {
            <button type="button" class="pastille echelle" [attr.data-echelle]="s.id" [attr.aria-pressed]="echelle() === s.id"
              (click)="echelle.set(s.id)">
              <span>{{ s.label }}</span>
              <span class="indice">{{ s.hint }}</span>
            </button>
          }
        </div>
        @if (echelle() === 'cp') {
          <div data-aide-cp class="aide">
            Les CP de la vue carte sont interrogés. Vue France entière :
            valeurs échantillonnées (~30 km, la résolution du modèle météo) —
            zoomez sur votre zone avant d'appliquer pour des valeurs par CP exactes.
          </div>
        }
      </div>

      <div class="section">
        <span class="label">Période</span>
        <div class="ligne mb">
          <button type="button" class="pastille large" data-mode="forecast" [attr.aria-pressed]="mode() === 'forecast'"
            (click)="changerMode('forecast')">Prévisions</button>
          <button type="button" class="pastille large" data-mode="history" [attr.aria-pressed]="mode() === 'history'"
            (click)="changerMode('history')">Historique</button>
        </div>
        <div class="presets">
          @for (p of presets(); track p.label) {
            <button type="button" class="pastille" [attr.data-preset]="p.label" (click)="appliquerPreset(p)">{{ p.label }}</button>
          }
        </div>
      </div>

      <div class="section">
        <span class="label">Dates</span>
        <div class="dates">
          <input type="date" data-debut aria-label="Date de début" [value]="debut()" (input)="debut.set($any($event.target).value)" />
          <input type="date" data-fin aria-label="Date de fin" [value]="fin()" (input)="fin.set($any($event.target).value)" />
        </div>
      </div>

      @if (validation(); as v) {
        <div data-validation class="alerte" role="alert">{{ v }}</div>
      }
      @if (meteo.erreur() && !meteo.chargement()) {
        <div data-erreur class="alerte" role="alert">{{ meteo.erreur() }}</div>
      }

      <div class="section">
        <button type="button" data-appliquer class="appliquer" [class.inactif]="bloque()" [disabled]="bloque()" (click)="appliquer()">
          @if (meteo.chargement()) { <span class="roue"></span> }
          {{ meteo.chargement() ? 'Chargement…' : 'Appliquer' }}
        </button>
        @if (progression(); as p) {
          <div data-progression class="progression">
            <div class="piste"><div data-progression-barre class="barre" [style.width]="p.largeur"></div></div>
            <div data-progression-texte class="compte">
              Chargement météo… {{ p.current }}/{{ p.total }} requêtes@if (p.minutes !== null) { · ~{{ p.minutes }} min restant}
            </div>
          </div>
        }
      </div>

      @if (stats(); as s) {
        <div data-stats class="section">
          <span class="label">Statistiques période</span>
          <div class="stats">
            <span>min <span class="fort">{{ s.min }}</span> {{ s.unit }}</span>
            <span>moy <span class="fort">{{ s.mean }}</span> {{ s.unit }}</span>
            <span>max <span class="fort">{{ s.max }}</span> {{ s.unit }}</span>
          </div>
        </div>
      }
    </dialog>
  `,
  styles: `
    dialog {
      margin: auto; padding: 0; width: 320px; max-width: calc(100% - 32px); overflow: hidden;
      background: var(--bg-surface); color: var(--text-primary); border: 0.5px solid var(--border-subtle); border-radius: 10px;
      font-family: var(--font-sans);
    }
    /* Le voile de React (rgba(0,0,0,0.5), page.tsx:1461) : noir dans les deux thèmes, comme lui ; aucun jeton de
       voile n'existe (le seul autre voile, dialogue-ajout-membre, est aussi en noir). */
    dialog::backdrop { background: color-mix(in srgb, black 50%, transparent); }
    .tete {
      padding: 10px 14px; display: flex; align-items: center; gap: 8px;
      border-bottom: 1px solid var(--border-subtle); background: var(--bg-level-2);
    }
    .point { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-teal); }
    .titre { flex: 1; font-size: 12px; font-weight: 500; color: var(--text-primary); }
    .croix {
      background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 14px; padding: 0; line-height: 1;
      font-family: var(--font-sans);
    }
    .section { padding: 12px 14px; border-top: 1px solid var(--border-subtle); }
    .label {
      display: block; margin-bottom: 8px; font-size: 10px; font-weight: 500; color: var(--text-tertiary);
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .grille { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .ligne { display: flex; gap: 6px; }
    .mb { margin-bottom: 8px; }
    .presets { display: flex; flex-wrap: wrap; gap: 4px; }
    .pastille {
      padding: 6px 10px; border-radius: 6px; border: 0.5px solid var(--border-subtle); background: transparent;
      color: var(--text-secondary); font-family: var(--font-sans); font-size: 11px; cursor: pointer;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover);
    }
    .pastille[aria-pressed='true'] { border-color: var(--brand-teal); background: var(--brand-teal-10); color: var(--brand-teal); }
    .pastille:focus-visible, .croix:focus-visible, .appliquer:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 1px; }
    .large { flex: 1; }
    .echelle { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .indice { font-family: var(--font-mono); font-size: 9px; color: var(--text-tertiary); }
    .aide { margin-top: 8px; font-size: 10px; color: var(--text-tertiary); line-height: 1.5; }
    .dates { display: flex; gap: 8px; }
    input {
      flex: 1; min-width: 0; background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px;
      padding: 7px 10px; color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; outline: none;
    }
    input:focus { border-color: var(--brand-teal-50); }
    .alerte {
      padding: 8px 14px; color: var(--danger); font-size: 11px;
      background: color-mix(in srgb, var(--danger) 5%, transparent); border-top: 1px solid var(--border-subtle);
    }
    .appliquer {
      width: 100%; padding: 10px 14px; display: flex; align-items: center; justify-content: center; gap: 8px;
      background: var(--brand-teal); border: 0.5px solid var(--brand-teal); border-radius: 6px; color: var(--brand-teal-fg);
      font-family: var(--font-sans); font-size: 12px; font-weight: 500; cursor: pointer; opacity: 1;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover);
    }
    .appliquer.inactif { background: transparent; color: var(--brand-teal); cursor: not-allowed; opacity: 0.5; }
    .roue {
      width: 12px; height: 12px; box-sizing: border-box; border: 2px solid var(--border-subtle); border-top-color: var(--brand-teal);
      border-radius: 50%; animation: tourner 0.8s linear infinite;
    }
    @keyframes tourner { to { transform: rotate(360deg); } }
    .progression { margin-top: 10px; }
    .piste { height: 3px; background: var(--border-subtle); border-radius: 2px; overflow: hidden; margin-bottom: 6px; }
    .barre { height: 100%; background: var(--brand-teal); border-radius: 2px; transition: width 300ms linear; }
    .compte { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); text-align: center; }
    .stats { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); display: flex; justify-content: space-between; gap: 8px; }
    .fort { color: var(--text-primary); }
    @media (prefers-reduced-motion: reduce) { .roue { animation: none; } }
  `,
})
export class DialogueMeteoComponent {
  protected readonly meteo = inject(MeteoService);
  private readonly pile = inject(PileEchapService);
  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  protected readonly idTitre = `mg-meteo-titre-${++compteur}`;
  protected readonly variables = VARIABLES;
  protected readonly echelles = ECHELLES;

  protected readonly variable = signal<MeteoVariable>('precipitation');
  protected readonly echelle = signal<MeteoScale>('departement');
  protected readonly mode = signal<MeteoMode>('forecast');
  private readonly periodeInitiale = periodeParDefaut('forecast', todayStr());
  protected readonly debut = signal(this.periodeInitiale.debut);
  protected readonly fin = signal(this.periodeInitiale.fin);

  protected readonly presets = computed(() => PRESETS[this.mode()]);
  protected readonly validation = computed(() => validerPeriodeDialogue(this.mode(), this.debut(), this.fin(), todayStr()));
  protected readonly bloque = computed(() => this.validation() !== null || this.meteo.chargement());
  /** `loading && progress && progress.total > 1` (`MeteoGeoPanel.tsx:399`). */
  protected readonly progression = computed(() => {
    const p = this.meteo.progression();
    if (!this.meteo.chargement() || !p || p.total <= 1) return null;
    return {
      current: p.current, total: p.total,
      largeur: `${Math.min(100, (p.current / p.total) * 100)}%`,
      minutes: p.etaMs !== undefined && p.etaMs > 5000 ? Math.ceil(p.etaMs / 60000) : null,
    };
  });
  protected readonly stats = computed(() => {
    const s = this.meteo.meta()?.stats;
    return s ? { min: s.min.toFixed(1), mean: s.mean.toFixed(1), max: s.max.toFixed(1), unit: s.unit } : null;
  });

  constructor() {
    this.pile.empiler('meteo', () => this.meteo.fermerDialogue());
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    const hote = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    inject(DestroyRef).onDestroy(() => {
      this.pile.depiler('meteo');
      const d = hote.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  /** `applyModeChange` (`MeteoGeoPanel.tsx:138-147`) : chaque mode repart de sa période par défaut. */
  protected changerMode(mode: MeteoMode): void {
    this.mode.set(mode);
    this.poserPeriode(periodeParDefaut(mode, todayStr()));
  }

  protected appliquerPreset(p: Preset): void {
    this.poserPeriode(p.periode(todayStr()));
  }

  private poserPeriode(p: { debut: string; fin: string }): void {
    this.debut.set(p.debut);
    this.fin.set(p.fin);
  }

  /** `handleApply` (`MeteoGeoPanel.tsx:149-152`) — l'échelle est toujours transmise (`scaleSelectable`). */
  protected appliquer(): void {
    if (this.bloque()) return;
    this.meteo.appliquer({ variable: this.variable(), startDate: this.debut(), endDate: this.fin(), scale: this.echelle() });
  }

  /** Échap tapé dans le dialogue : consommé, pour que l'hôte de la page ne ferme pas aussi le panneau derrière. */
  protected clavier(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    this.meteo.fermerDialogue();
  }

  /** Fermeture native (Échap que le navigateur traite seul) : on garde la main, le service décide. */
  protected annuler(e: Event): void {
    e.preventDefault();
    this.meteo.fermerDialogue();
  }

  /** Le voile (`onClick` du fond, `page.tsx:1458`) : un clic sur le `<dialog>` lui-même, hors de son contenu. */
  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement) this.meteo.fermerDialogue();
  }
}
