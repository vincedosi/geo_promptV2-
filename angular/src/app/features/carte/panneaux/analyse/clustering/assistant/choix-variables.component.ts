import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  JETON_THEME, PREREGLAGES, THEMES, avisVariables, basculer, basculerTheme, etatTheme, prereglageActif, variablesDuPrereglage,
} from '../../../../logique/clustering/assistant';
import { FEATURE_LABELS, FEATURE_PRESETS, FEATURE_THEMES, type ThemeId } from '../../../../logique/clustering/feature-themes';
import { EtatAssistantClusteringService } from './etat-assistant-clustering.service';
import { STYLES_ASSISTANT } from './styles-assistant';

/**
 * « Variables d'analyse » de l'étape 3 (`ClusteringWizard.tsx:460-593`) : trois préréglages, quatre thématiques
 * dépliables (cases tout / partiel / rien), et l'avis sous la liste (erreur sous 2 variables, alerte sous 5).
 *
 * Écarts : la teinte d'une thématique est un JETON `--nature-*` (`JETON_THEME`) — React peignait les hexadécimaux de
 * `feature-themes.ts`, dont un violet interdit, et leur collait un suffixe d'opacité (`+ '40'`) devenu `color-mix` ;
 * les cases sont de vrais boutons (`aria-pressed`, ou `mixed` pour une thématique partielle).
 */
@Component({
  selector: 'mg-choix-variables',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="intertitre mb-2 text-[9px]!">Variables d'analyse</div>

    <div class="mb-[10px] flex gap-1.5">
      @for (p of prereglages(); track p.cle) {
        <button type="button" [attr.data-prereglage]="p.cle" [attr.aria-pressed]="p.actif" (click)="etat.variables.set(p.variables)"
                class="pastille-bouton inter px-[10px] py-1 text-[9px] tracking-[0.08em]" [class.actif]="p.actif">{{ p.libelle }}</button>
      }
    </div>

    <div class="flex flex-col gap-1">
      @for (t of themes(); track t.id) {
        <div class="theme overflow-hidden rounded-[2px]" [attr.data-theme]="t.id" [class.coche]="t.cochees > 0" [style.--teinte]="t.teinte">
          <div class="entete-theme flex items-center gap-2 px-[10px] py-[7px]">
            <button type="button" class="case-theme" [attr.aria-pressed]="t.toutes ? 'true' : t.aucune ? 'false' : 'mixed'"
                    [attr.aria-label]="t.libelle" [class.toutes]="t.toutes" [class.partielle]="!t.toutes && !t.aucune" (click)="basculerTheme(t.id)">
              @if (t.toutes) { ✓ } @else if (!t.aucune) { – }
            </button>
            <span class="pastille-theme size-2 shrink-0 rounded-full"></span>
            <button type="button" class="libelle-theme mono flex-1 text-left text-[10px]" [class.text-primary]="t.cochees > 0" [class.text-secondary]="t.cochees === 0"
                    (click)="basculerTheme(t.id)">{{ t.libelle }}</button>
            <span class="inter text-[9px] text-tertiary">{{ t.cochees }}/{{ t.total }}</span>
            <button type="button" data-deplier [attr.aria-expanded]="t.ouvert" [attr.aria-label]="'Détail ' + t.libelle"
                    class="chevron text-[10px] text-tertiary" (click)="deplier(t.id)">{{ t.ouvert ? '▲' : '▼' }}</button>
          </div>
          @if (t.ouvert) {
            <div class="flex flex-col gap-[3px] pb-2 pl-8 pr-[10px] pt-1">
              @for (v of t.variables; track v.cle) {
                <button type="button" [attr.data-variable]="v.cle" [attr.aria-pressed]="v.cochee" (click)="basculerVariable(v.cle)"
                        class="ligne-variable flex items-center gap-[7px] text-left">
                  <span class="case-variable" [class.cochee]="v.cochee">@if (v.cochee) { ✓ }</span>
                  <span class="mono text-[10px]" [class.text-secondary]="v.cochee" [class.text-tertiary]="!v.cochee">{{ v.libelle }}</span>
                </button>
              }
            </div>
          }
        </div>
      }
    </div>

    <div data-avis-variables class="mono mt-2 text-[9px]" [class.text-danger]="avis().niveau === 'erreur'"
         [class.text-warning]="avis().niveau === 'alerte'" [class.text-secondary]="avis().niveau === 'info'">{{ avis().texte }}</div>
  `,
  styles: [STYLES_ASSISTANT, `
    .theme { border: 0.5px solid var(--border-default); }
    .theme.coche { border-color: color-mix(in srgb, var(--teinte) 25%, transparent); }
    .theme.coche .entete-theme { background: color-mix(in srgb, var(--teinte) 4%, transparent); }
    .pastille-theme { background: var(--teinte); }
    .case-theme, .case-variable { display: flex; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 1px; padding: 0;
      background: transparent; border: 0.5px solid var(--border-default); color: var(--teinte); line-height: 1; cursor: pointer; }
    .case-theme { width: 14px; height: 14px; font-size: 8px; }
    .case-theme.partielle { border-color: color-mix(in srgb, var(--teinte) 50%, transparent); }
    .case-theme.toutes, .case-variable.cochee { border-color: var(--teinte); background: color-mix(in srgb, var(--teinte) 19%, transparent); }
    .case-variable { width: 11px; height: 11px; font-size: 7px; }
    .libelle-theme, .chevron, .ligne-variable { background: none; border: 0; padding: 0; cursor: pointer; }
  `],
})
export class ChoixVariablesComponent {
  protected readonly etat = inject(EtatAssistantClusteringService);

  protected readonly prereglages = computed(() => PREREGLAGES.map((cle) => ({
    cle, libelle: FEATURE_PRESETS[cle].label, variables: variablesDuPrereglage(cle), actif: prereglageActif(cle, this.etat.variables()),
  })));

  protected readonly themes = computed(() => {
    const variables = this.etat.variables();
    const ouverts = this.etat.themesOuverts();
    return THEMES.map((id) => ({
      id, libelle: FEATURE_THEMES[id].label, teinte: `var(--${JETON_THEME[id]})`, ouvert: ouverts.has(id), ...etatTheme(id, variables),
      variables: FEATURE_THEMES[id].features.map((cle) => ({ cle, libelle: FEATURE_LABELS[cle] ?? cle, cochee: variables.includes(cle) })),
    }));
  });

  protected readonly avis = computed(() => avisVariables(this.etat.variables()));

  protected basculerTheme(id: ThemeId): void {
    this.etat.variables.update((v) => basculerTheme(id, v));
  }

  protected basculerVariable(cle: string): void {
    this.etat.variables.update((v) => basculer(v, cle));
  }

  protected deplier(id: ThemeId): void {
    this.etat.themesOuverts.update((s) => {
      const suivant = new Set(s);
      if (suivant.has(id)) suivant.delete(id); else suivant.add(id);
      return suivant;
    });
  }
}
