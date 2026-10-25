import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { type LinkLevel, type PlatformLinks, linksComplete } from '../../logique/plan/liens-plateformes';
import { CADRE_LIAISON, LIBELLE_NIVEAU, SAISIE_LIAISON, TEXTE_SUCCES } from './styles-plan';

/**
 * ⑥ Plan — la liaison d'une plateforme en SAISIE MANUELLE (lot 6, T5) : port de `PlatformLinkPanel.tsx`, le pendant de
 * la cascade API (`mg-liaison-dv360`) pour toute plateforme dont l'espace n'a pas de connexion listable. Un couple
 * Nom + ID par niveau du registre (`dsp_channel_registry.link_levels`), écrit en `${key}_name` / `${key}_id` — la même
 * forme que la cascade : rien à migrer quand la connexion arrive. ⑦ pousse et ⑧ lit par ces liaisons.
 *
 * Il ne garde aucun état : chaque frappe rend l'entrée entière au parent (`changement`), un champ vidé est retiré.
 */
@Component({
  selector: 'mg-liaison-manuelle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-liaison-manuelle': '' },
  template: `
    <div [class]="cadre">
      <div class="flex items-baseline gap-2.5">
        <span class="text-[12px] font-medium text-primary">Liaison {{ libelleCanal() }}</span>
        <span data-etat-liaison class="text-[11px]" [class]="complete() ? texteSucces : 'text-tertiary'">
          {{ complete() ? '✓ renseignée' : 'saisie manuelle — reporte les IDs depuis la plateforme' }}
        </span>
      </div>
      @for (n of niveaux(); track n.key) {
        <div>
          <span [class]="libelleNiveau">{{ n.label }}</span>
          <div class="grid grid-cols-[1fr_140px] gap-2">
            <input type="text" [attr.data-nom]="n.key" [class]="saisie" placeholder="Nom (facultatif)" [attr.aria-label]="n.label + ' — nom'"
                   [value]="liens()?.[n.key + '_name'] ?? ''" (input)="poser(n.key + '_name', $event)" />
            <input type="text" [attr.data-id]="n.key" [class]="saisie + ' font-mono !text-[12px]'" placeholder="ID" [attr.aria-label]="n.label + ' — ID'"
                   [value]="liens()?.[n.key + '_id'] ?? ''" (input)="poser(n.key + '_id', $event)" />
          </div>
        </div>
      }
    </div>
  `,
})
export class LiaisonManuelleComponent {
  readonly libelleCanal = input.required<string>();
  readonly niveaux = input.required<LinkLevel[]>();
  readonly liens = input<PlatformLinks | undefined>(undefined);
  readonly changement = output<PlatformLinks>();

  protected readonly cadre = CADRE_LIAISON;
  protected readonly saisie = SAISIE_LIAISON;
  protected readonly libelleNiveau = LIBELLE_NIVEAU;
  protected readonly texteSucces = TEXTE_SUCCES;
  protected readonly complete = computed(() => linksComplete(this.liens(), this.niveaux()));

  protected poser(champ: string, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    const suite: PlatformLinks = { ...(this.liens() ?? {}) };
    if (v.trim() === '') delete suite[champ];
    else suite[champ] = v;
    this.changement.emit(suite);
  }
}
