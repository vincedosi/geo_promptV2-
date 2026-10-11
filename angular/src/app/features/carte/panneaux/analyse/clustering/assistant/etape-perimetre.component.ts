import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { basculer, libelleRegionsChoisies } from '../../../../logique/clustering/assistant';
import { EtatAssistantClusteringService } from './etat-assistant-clustering.service';
import { STYLES_ASSISTANT } from './styles-assistant';

/**
 * Étape 2 de l'assistant — « Périmètre géographique » (`ClusteringWizard.tsx:349-433`) : l'interrupteur « France
 * métropolitaine uniquement » et les régions du référentiel. Ce périmètre est PROPRE à l'assistant (il part dans
 * `geo_filter`) ; la garde du panneau Analyse, elle, lit le filtre de la carte — deux barrières indépendantes, comme React.
 *
 * Écart : l'interrupteur est un vrai `<button role="switch">` (React : une `div` cliquable dans un `label`, injoignable
 * au clavier).
 */
@Component({
  selector: 'mg-etape-perimetre',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[14px]' },
  template: `
    <div class="intertitre">2 / 4 — Périmètre géographique</div>

    <div class="choix block! cursor-default! px-3 py-[10px]" [class.actif]="etat.metropolitaine()">
      <div class="flex items-center gap-[10px]">
        <button type="button" role="switch" data-metropole [attr.aria-checked]="etat.metropolitaine()" aria-label="France métropolitaine uniquement"
                class="interrupteur h-[18px] w-9" [style.background]="etat.metropolitaine() ? 'var(--brand-teal)' : null"
                (click)="etat.metropolitaine.set(!etat.metropolitaine())">
          <span class="top-[2px] size-[14px]" [style.left.px]="etat.metropolitaine() ? 20 : 2"></span>
        </button>
        <span class="mono text-[11px] text-primary">France métropolitaine uniquement</span>
      </div>
      @if (!etat.metropolitaine()) {
        <div data-avertissement-drom class="encart alerte mono mt-2 px-[10px] py-[7px]">
          ! Les POI outre-mer (DOM-TOM) n'ont pas de données Filosofi — ils seront ignorés lors du clustering sociodemographique.
        </div>
      }
    </div>

    <div class="inter mb-1 text-[10px] tracking-[1px] text-secondary">Régions — laisser vide = toutes</div>
    <div class="flex flex-col gap-[3px]">
      @if (etat.referentielVide()) { <div class="inter py-2 text-[10px] text-tertiary">Chargement des régions…</div> }
      @for (r of regions(); track r.code_region) {
        <button type="button" [attr.data-region]="r.code_region" [attr.aria-pressed]="r.choisie" (click)="basculer(r.code_region)"
                class="choix px-[11px] py-[7px]" [class.actif]="r.choisie">
          <div class="flex items-center gap-2">
            <span class="case size-[11px]" [class.actif]="r.choisie"></span>
            <span class="mono text-[11px]" [class.text-primary]="r.choisie" [class.text-secondary]="!r.choisie">{{ r.nom_region }}</span>
          </div>
          <span class="mono text-[9px] text-tertiary">{{ r.depts.length }} dép.</span>
        </button>
      }
    </div>

    @if (etat.regions().length > 0) {
      <div class="mono text-[10px] text-teal">{{ libelleChoix() }}</div>
    } @else {
      <div class="mono text-[10px] text-tertiary">Aucune région sélectionnée = toute la France {{ etat.metropolitaine() ? 'métropolitaine' : '' }}.</div>
    }
  `,
  styles: [STYLES_ASSISTANT],
})
export class EtapePerimetreComponent {
  protected readonly etat = inject(EtatAssistantClusteringService);
  protected readonly regions = computed(() => this.etat.regionsProposees().map((r) => ({ ...r, choisie: this.etat.regions().includes(r.code_region) })));
  protected readonly libelleChoix = computed(() => libelleRegionsChoisies(this.etat.regions().length, this.etat.depts().length));

  protected basculer(code: string): void {
    this.etat.regions.update((l) => basculer(l, code));
  }
}
