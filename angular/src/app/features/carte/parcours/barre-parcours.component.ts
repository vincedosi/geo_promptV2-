import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BadgeSessionComponent } from '../../../layout/badge-session.component';
import { BasculeThemeComponent } from '../../../layout/bascule-theme.component';
import { FilArianeComponent, type SegmentAriane } from '../../../ui/fil-ariane/fil-ariane.component';
import { type EtapeAffichee, FilEtapesComponent } from '../../../ui/fil-etapes/fil-etapes.component';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { LogoComponent } from '../../../ui/logo/logo.component';

/** Hauteur de la barre — celle de l'ancienne barre du haut (`MAP_TOPBAR_HEIGHT` de React). */
export const HAUTEUR_BARRE_PARCOURS = 44;

const BOUTON_TEAL = 'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-teal bg-transparent px-[10px] py-[5px] text-[11px] font-medium text-teal transition-colors duration-150 ease-[var(--ease-hover)] hover:bg-teal-10';
const BOUTON_NEUTRE = 'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-default bg-transparent px-[10px] py-[5px] text-[11px] text-secondary transition-colors duration-150 ease-[var(--ease-hover)] hover:border-hover hover:bg-elevated hover:text-primary';

/**
 * La barre du parcours (spec § 3) : OÙ JE REGARDE (fil d'Ariane, nourri par ①) puis OÙ J'EN SUIS (fil d'étapes) — deux
 * fils, pas un doublon, comme l'en-tête du module risque. À droite, ce qui vaut à toute étape (arbitrage A5) : les deux
 * boutons contextuels de l'ancienne colonne flottante (Script bidding DV360 de la zone du lien, Plan média (n) panneau
 * fermé), Tout effacer, le mode immersif, le thème, la session. Elle remplace la barre du haut et le rail.
 * Dans le flux de la page (jamais `fixed`, racine d'ombre).
 */
@Component({
  selector: 'mg-barre-parcours',
  imports: [BadgeSessionComponent, BasculeThemeComponent, FilArianeComponent, FilEtapesComponent, IconeComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'banner',
    class: 'flex shrink-0 items-center gap-3 border-b-fin border-subtle bg-surface pl-4 pr-[14px]',
    '[style.height.px]': 'hauteur',
  },
  template: `
    <mg-logo [hauteur]="18" class="block shrink-0" />
    <mg-fil-ariane class="shrink-0" [segments]="segments()" [precision]="precision()" (remonter)="remonter.emit($event)" />
    <div class="@container min-w-0 flex-1 overflow-x-auto">
      <mg-fil-etapes [compact]="true" [etapes]="etapes()" [courante]="courante()" (choisir)="choisir.emit($event)" />
    </div>
    @if (zoneScript(); as nom) {
      <button type="button" data-script-dv360 (click)="genererScript.emit()" [class]="boutonTeal"
              [attr.title]="'Générer le fichier custom bidding DV360 pour « ' + nom + ' »'">
        <mg-icone nom="fichier-bas" [taille]="13" [trait]="1.5" />Script bidding DV360
      </button>
    }
    @if (planMedia(); as n) {
      <button type="button" data-rouvrir-plan (click)="rouvrirPlan.emit()" title="Rouvrir le plan média des zones affichées"
              [class]="boutonTeal">Plan média ({{ n }})</button>
    }
    <button type="button" data-tout-effacer (click)="toutEffacer.emit()" title="Tout effacer (couches et zones affichées)" [class]="boutonNeutre">
      <mg-icone nom="gomme" [taille]="13" [trait]="1.5" />Tout effacer
    </button>
    <button type="button" data-immersif (click)="basculerImmersif.emit()" aria-label="Mode immersif"
            title="Masquer la barre et le panneau (mode immersif, Échap pour revenir)"
            class="flex shrink-0 cursor-pointer items-center rounded-[6px] border-0 bg-transparent p-1.5 text-tertiary hover:text-primary">
      <mg-icone nom="reduire" [taille]="16" [trait]="1.5" />
    </button>
    <mg-bascule-theme />
    <mg-badge-session (orgChangee)="orgChangee.emit($event)" />
  `,
})
export class BarreParcoursComponent {
  protected readonly hauteur = HAUTEUR_BARRE_PARCOURS;
  protected readonly boutonTeal = BOUTON_TEAL;
  protected readonly boutonNeutre = BOUTON_NEUTRE;

  readonly etapes = input.required<EtapeAffichee[]>();
  readonly courante = input.required<string>();
  readonly segments = input.required<SegmentAriane[]>();
  readonly precision = input<string>();
  /** Le nom de la zone du lien `?customZone=` ; `null` sans elle (le bouton DV360 n'existe que pour elle). */
  readonly zoneScript = input<string | null>(null);
  /** Le nombre de zones du plan média quand son panneau est FERMÉ, `null` sinon. */
  readonly planMedia = input<number | null>(null);

  readonly choisir = output<string>();
  readonly remonter = output<number>();
  readonly toutEffacer = output<void>();
  readonly genererScript = output<void>();
  readonly rouvrirPlan = output<void>();
  readonly basculerImmersif = output<void>();
  /** Relais de `mg-badge-session` : l'hôte de la route recrée la page (droits sur la carte, T3). */
  readonly orgChangee = output<string | null>();
}
