import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ProgDraft } from '../../logique/plan/brouillon';
import type { ResolvedChannel } from '../../logique/plan/canaux';
import { etatLiaison } from './liaison-canal.component';
import { TEXTE_SUCCES } from './styles-plan';

/**
 * ⑥ Plan — le récapitulatif du câblage (lot 6, T5) : port de `ChannelHubRecap.tsx`. Un nœud central (nom, annonceur ·
 * produit), puis une branche par famille de plateformes cochées avec l'état de liaison de chacune. Tout est local
 * (brouillon + catalogue résolu), aucune requête.
 *
 * Écarts à React : la branche « Mesure » (ad server) n'est pas portée — l'ad server est hors V1 (spec § 19) ; les
 * titres de branche sont en sentence case (React les passait en capitales par CSS).
 */
@Component({
  selector: 'mg-recap-canaux',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col items-stretch', 'data-recap-canaux': '' },
  template: `
    <div class="self-center rounded-[8px] border-fin border-default px-[18px] py-2.5 text-center">
      <div data-noeud-nom class="text-[13px] font-medium text-primary">{{ brouillon().name || 'Campagne sans nom' }}</div>
      @if (sousTitre(); as s) { <div class="text-[11px] text-tertiary">{{ s }}</div> }
    </div>
    <div aria-hidden="true" class="h-3.5 w-px self-center bg-[var(--border-default)]"></div>
    <div class="flex flex-wrap gap-2.5">
      @for (b of branches(); track b.titre) {
        <div [attr.data-branche]="b.titre" class="min-w-[150px] flex-1 rounded-[8px] border-fin border-subtle px-3 py-2.5">
          <div class="mb-2 text-[10px] text-tertiary">{{ b.titre }}</div>
          @for (r of b.lignes; track r.code) {
            <div class="mb-1.5" [attr.data-ligne-recap]="r.code">
              <div class="text-[12.5px] text-primary">{{ r.libelle }}</div>
              <div class="font-mono text-[11px]" [class]="r.liee ? texteSucces : 'text-tertiary'">{{ r.liee ? '✓ liée' + (r.detail ? ' · ' + r.detail : '') : '— non liée' }}</div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class RecapCanauxComponent {
  readonly brouillon = input.required<ProgDraft>();
  readonly catalogue = input.required<readonly ResolvedChannel[]>();

  protected readonly texteSucces = TEXTE_SUCCES;
  protected readonly sousTitre = computed(() => [this.brouillon().advertiser, this.brouillon().product].filter(Boolean).join(' · '));
  protected readonly branches = computed(() => {
    const d = this.brouillon();
    const parCode = new Map(this.catalogue().map((c) => [c.code, c]));
    const ligne = (code: string) => {
      const c = parCode.get(code);
      const e = etatLiaison(d.channelLinks[code], c ?? {});
      return { code, libelle: c?.label ?? code, liee: e.liee || e.partielle, detail: e.resume };
    };
    return [
      { titre: 'DSP', lignes: d.channels.dsps.map(ligne) },
      { titre: 'Social', lignes: d.channels.socials.map(ligne) },
    ].filter((b) => b.lignes.length > 0);
  });
}
