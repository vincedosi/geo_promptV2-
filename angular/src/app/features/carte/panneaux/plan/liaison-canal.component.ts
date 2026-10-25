import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import type { ResolvedChannel } from '../../logique/plan/canaux';
import { type PlatformLinks, linksComplete, linksSummary } from '../../logique/plan/liens-plateformes';
import { LiaisonDv360Component } from './liaison-dv360.component';
import { LiaisonManuelleComponent } from './liaison-manuelle.component';
import { TEXTE_SUCCES } from './styles-plan';

/** L'état d'une liaison, tel que la ligne repliée et le récapitulatif le disent (`ChannelLinkAccordion`, `ChannelHubRecap`). */
export function etatLiaison(liens: PlatformLinks | undefined, canal: Pick<ResolvedChannel, 'link_levels'>): { liee: boolean; partielle: boolean; resume: string } {
  const niveaux = canal.link_levels ?? [];
  const liee = niveaux.length > 0 && linksComplete(liens, niveaux);
  const partielle = !liee && !!liens && Object.values(liens).some((v) => (v ?? '').toString().trim() !== '');
  return { liee, partielle, resume: linksSummary(liens, niveaux) };
}

/**
 * ⑥ Plan — l'accordéon de liaison sous une plateforme cochée (lot 6, T5) : port de `ChannelLinkAccordion.tsx`. Replié,
 * une ligne d'état « Liaison — non liée ▸ » ; déplié, la cascade API (`mg-liaison-dv360`) si la plateforme est DV360
 * ET connectée, la saisie manuelle (`mg-liaison-manuelle`) sinon. Le panneau déplié n'existe que déplié : la cascade ne
 * lit l'API qu'à l'ouverture, comme React.
 */
@Component({
  selector: 'mg-liaison-canal',
  imports: [IconeComponent, LiaisonDv360Component, LiaisonManuelleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ml-3.5 block border-l-fin border-subtle pl-3', '[attr.data-liaison-canal]': 'canal().code' },
  template: `
    <button type="button" data-bascule-liaison [attr.aria-expanded]="ouvert()" (click)="ouvert.set(!ouvert())"
            class="flex cursor-pointer items-center gap-2 border-0 bg-transparent px-0 py-1 text-[12px] text-tertiary">
      <span>Liaison</span>
      <span data-statut-liaison class="font-mono text-[11px]" [class]="etat().liee || etat().partielle ? texteSucces : 'text-tertiary'">{{ statut() }}</span>
      <mg-icone [nom]="ouvert() ? 'chevron-haut' : 'chevron-bas'" [taille]="12" [trait]="1.5" class="shrink-0" />
    </button>
    @if (ouvert()) {
      <div class="pb-2">
        @if (canal().connection_provider === 'dv360' && canal().connected) {
          <mg-liaison-dv360 [campagne]="campagne()" [liens]="liens()" (changement)="changement.emit($event)" />
        } @else {
          <mg-liaison-manuelle [libelleCanal]="canal().label" [niveaux]="canal().link_levels ?? []" [liens]="liens()" (changement)="changement.emit($event)" />
        }
      </div>
    }
  `,
})
export class LiaisonCanalComponent {
  readonly canal = input.required<ResolvedChannel>();
  readonly campagne = input.required<string>();
  readonly liens = input<PlatformLinks | undefined>(undefined);
  readonly changement = output<PlatformLinks>();

  protected readonly texteSucces = TEXTE_SUCCES;
  protected readonly ouvert = signal(false);
  protected readonly etat = computed(() => etatLiaison(this.liens(), this.canal()));
  protected readonly statut = computed(() => {
    const { liee, partielle, resume } = this.etat();
    if (liee) return `✓ liée${resume ? ` · ${resume}` : ''}`;
    return partielle ? `liaison partielle${resume ? ` · ${resume}` : ''}` : 'non liée';
  });
}
