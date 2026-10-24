import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';

/**
 * « Dilution au code postal » — portage de `Dilution` (`OngletZones.tsx:396-461`).
 *
 * Le DSP achète au CODE POSTAL, le risque se mesure au carreau de 200 m : acheter le code postal entier, c'est payer
 * pour des habitants qu'on ne visait pas. Le curseur décide de ce qu'on paie, et le bloc le dit en chiffres.
 *
 * ── LE CURSEUR SUIT LE DOIGT, LA BASE NE BOUGE QU'AU RELÂCHEMENT ─────────
 *
 * Rejouer le seuil coûte quelques dizaines de millisecondes en base, mais une requête par cran parcouru n'apprend
 * rien de plus que la dernière. `seuilChange` n'est émis qu'au relâchement (pointeur, toucher, touche relevée) — et
 * seulement si la valeur a BOUGÉ : React émettait aussi un relâchement sans déplacement, soit un PATCH pour rien.
 */
@Component({
  selector: 'mg-dilution',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mb-4 block rounded-[8px] border-fin border-subtle bg-elevated p-[14px]' },
  template: `
    <div class="mb-[6px] flex items-baseline gap-[10px]">
      <span class="text-[12px] font-medium text-primary">{{ titre() }}</span>
      <span data-role="seuil" class="font-mono text-[12px] text-teal">seuil {{ local() }} %</span>
    </div>
    <input type="range" min="0" max="60" step="5" [value]="local()"
           (input)="local.set(valeurDe($event))" (pointerdown)="saisir()" (keydown)="saisir()"
           (pointerup)="relacher()" (touchend)="relacher()" (keyup)="relacher()" (change)="relacher()"
           [attr.aria-label]="libelleCurseur()"
           class="w-full accent-teal" />
    <p class="mt-2 mb-0 text-[11.5px] leading-[1.6] text-secondary">
      {{ sujet() }} n’est retenu{{ accord() }} que si au moins <strong>{{ local() }} %</strong> de sa
      population vit en zone. En deçà, on achète surtout des habitants hors cible ;
      au-delà, le plan se vide des campagnes, où un site isolé ne couvre jamais une
      telle part de {{ complement() }}.
    </p>
    @if (achetee() > 0) {
      <p data-role="gaspille" class="mt-[6px] mb-0 text-[11.5px] text-secondary">
        À ce réglage, la campagne achèterait
        <span class="font-mono text-primary">{{ gaspilleTexte() }}</span>
        habitants situés hors des zones, soit
        <span class="font-mono text-primary">{{ partGaspilleeTexte() }} %</span>
        de ce qu’elle paie.
      </p>
    }
  `,
})
export class DilutionComponent {
  /** Le seuil du jeu, en pourcentage (0 à 60, pas de 5). */
  readonly seuil = input.required<number>();
  readonly visee = input.required<number>();
  readonly achetee = input.required<number>();
  /**
   * L'unité achetée — le code postal par défaut (le module risque). ⑤ Jeu de zones (lot 5, T10) monte ce bloc pour
   * chaque maille territoriale : « Une commune n'est retenue… » (sujet + accord), titre « Dilution à la commune ».
   */
  readonly titre = input('Dilution au code postal');
  readonly sujet = input('Un code postal');
  readonly accord = input<'' | 'e'>('');
  /** La fin de la phrase du seuil : « …une telle part de son code postal » (« de sa commune » en ⑤). */
  readonly complement = input('son code postal');
  readonly libelleCurseur = input('Part minimale de la population du code postal en zone');
  /** Émis au relâchement, jamais pendant le glissement. */
  readonly seuilChange = output<number>();

  /** La valeur sous le doigt — réalignée sur le seuil du jeu dès qu'il change (relecture du serveur). */
  protected readonly local = linkedSignal(() => this.seuil());

  private readonly gaspille = computed(() => Math.max(0, this.achetee() - this.visee()));
  protected readonly gaspilleTexte = computed(() => formaterNombre(Math.round(this.gaspille())));
  protected readonly partGaspilleeTexte = computed(() => formaterDecimal((100 * this.gaspille()) / this.achetee()));

  protected valeurDe(ev: Event): number {
    return Number((ev.target as HTMLInputElement).value);
  }

  /**
   * La dernière valeur émise depuis la dernière relecture du serveur. `change` est aussi écouté — un `pointerup`
   * relâché HORS du curseur n'arrive jamais à l'élément, `change` si — et un relâchement à la souris déclenche alors
   * les deux : sans cette mémoire, le même seuil partirait deux fois.
   */
  private readonly dernierEmis = linkedSignal<number, number | null>({ source: this.seuil, computation: () => null });

  /**
   * Un NOUVEAU geste commence : la mémoire du dernier envoi ne vaut que pour UN relâchement (pointerup + change). Sans
   * cet oubli, un PATCH refusé laissait `dernierEmis` sur la valeur rejetée — le serveur n'ayant rien changé, `seuil`
   * ne bougeait pas, et relâcher de nouveau au même cran ne renvoyait plus rien (relecture T14).
   */
  protected saisir(): void {
    this.dernierEmis.set(null);
  }

  protected relacher(): void {
    const v = this.local();
    if (v === this.seuil() || v === this.dernierEmis()) return;
    this.dernierEmis.set(v);
    this.seuilChange.emit(v);
  }
}
