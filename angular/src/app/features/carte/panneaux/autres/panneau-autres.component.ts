import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SectionOohComponent } from '../calques/section-ooh.component';
import { SectionRadioComponent } from '../calques/section-radio.component';
import { SelectionsCalquesService } from '../calques/selections-calques.service';

/** La ligne qui dit pourquoi ces données sont hors du fil (T11b). */
export const TEXTE_AUTRES = 'Ces données s’affichent sur la carte mais ne servent pas encore à construire des zones.';

/**
 * Le panneau « Autres » — ouvert par le bouton du même nom, dans la barre du parcours, HORS du fil (T11b, Vincent
 * 14/10 : « on ne crée pas de zones avec la radio et OOH, tu les sors du fil d'Ariane… un bouton "Autres" »). Il vit
 * dans le cadre flottant des panneaux d'étape (`mg-panneau-etape`) et y est monté à la première ouverture, puis GARDÉ
 * comme une étape visitée (arbitrage A1).
 *
 * Premier contenu : les sections Panneaux OOH et Radio, DÉPLACÉES telles quelles du groupe « Médias offline » du
 * panneau Calques (②), qui ne les porte plus. Les couches restent dans `OohService` et `RadioService`, fournis par la
 * PAGE ; les sections ouvertes et les régies choisies dans `SelectionsCalquesService`, fourni par CE panneau — une
 * instance à lui, qui survit à la fermeture d'« Autres » puisque le panneau n'est jamais démonté. Comme dans le
 * groupe d'origine (mode overlay de `sectionsInitiales`), les deux sections s'ouvrent repliées.
 *
 * En-tête en bandeau (DESIGN_SYSTEM § 5 « Section header ») : fond `--elevated`, filet haut 1 px `--border-subtle`,
 * dot teal 6 px, Inter 500 12 px.
 */
@Component({
  selector: 'mg-panneau-autres',
  imports: [SectionOohComponent, SectionRadioComponent],
  providers: [SelectionsCalquesService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col' },
  template: `
    <div data-entete-autres class="flex items-center gap-2 border-t border-subtle bg-elevated px-[14px] py-[10px]">
      <span data-dot aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
      <h2 class="m-0 text-[12px] font-medium text-primary">Médias offline</h2>
    </div>
    <p data-texte-autres class="m-0 px-4 pt-3 text-[12px] leading-[1.5] text-tertiary">{{ texte }}</p>
    <!-- L'espacement du groupe d'origine (PanneauCalques.tsx:527-575) : padding 16, sections espacées de 16. -->
    <div class="flex flex-col gap-4 p-4">
      <mg-section-ooh />
      <mg-section-radio />
    </div>
  `,
})
export class PanneauAutresComponent {
  protected readonly texte = TEXTE_AUTRES;
}
