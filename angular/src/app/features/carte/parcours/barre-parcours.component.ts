import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BadgeSessionComponent } from '../../../layout/badge-session.component';
import { BasculeThemeComponent } from '../../../layout/bascule-theme.component';
import { FilArianeComponent, type SegmentAriane } from '../../../ui/fil-ariane/fil-ariane.component';
import { type EtapeAffichee, FilEtapesComponent } from '../../../ui/fil-etapes/fil-etapes.component';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { LogoComponent } from '../../../ui/logo/logo.component';
import { ETAPES_CAMPAGNE, type EtapeCarte } from '../logique/parcours';
import { ChoixCampagneComponent } from './choix-campagne.component';

/** Hauteur de la barre — celle de l'ancienne barre du haut (`MAP_TOPBAR_HEIGHT` de React). */
export const HAUTEUR_BARRE_PARCOURS = 44;

const BOUTON_TEAL = 'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-teal bg-transparent px-[10px] py-[5px] text-[11px] font-medium text-teal transition-colors duration-150 ease-[var(--ease-hover)] hover:bg-teal-10';
/**
 * « Autres » (T11b) : le gabarit EXACT d'une étape du fil compact (`mg-fil-etapes`, `boutonCompact`) — 30 px de haut,
 * 24 px de large au moins, 12 px, soulignement teal de 2 px quand il est ouvert. Littéral : Tailwind lit le source.
 */
const BOUTON_AUTRES = 'inline-flex h-[30px] min-w-6 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap border-b-2 px-1 pt-1 pb-1.5 text-[12px]';
const BOUTON_NEUTRE = 'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-default bg-transparent px-[10px] py-[5px] text-[11px] text-secondary transition-colors duration-150 ease-[var(--ease-hover)] hover:border-hover hover:bg-elevated hover:text-primary';

/**
 * La barre du parcours (spec § 3) : OÙ JE REGARDE (fil d'Ariane, nourri par ①) puis OÙ J'EN SUIS (fil d'étapes) — deux
 * fils, pas un doublon, comme l'en-tête du module risque. Juste après le fil, DANS son conteneur, séparé de lui par un filet, le bouton
 * « Autres » (T11b, Vincent 14/10) : au niveau des étapes mais HORS du fil — ni numéro, ni Alt+N, hors de la liste
 * `nav` des étapes ; ouvert, il prend l'état actif d'une étape courante et le fil n'en marque plus aucune. À droite, ce qui vaut à toute étape (arbitrage A5) : les deux
 * le bouton contextuel de l'ancienne colonne flottante (Plan média (n) panneau fermé), Tout effacer, le mode immersif, le thème, la session. Aux étapes ⑥-⑧, avant eux, le sélecteur de campagne
 * (`mg-choix-campagne`, lot 6, A-1). Elle remplace la barre du haut et le rail. Le bouton « Script bidding DV360 » de la
 * zone du lien `?customZone=` en est retiré le 04/11 (O-3 : aucune régie DSP visible pour le moment) ; le lien, lui, vit.
 * Dans le flux de la page (jamais `fixed`, racine d'ombre).
 */
@Component({
  selector: 'mg-barre-parcours',
  imports: [BadgeSessionComponent, BasculeThemeComponent, ChoixCampagneComponent, FilArianeComponent, FilEtapesComponent, IconeComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'banner',
    class: 'flex shrink-0 items-center gap-3 border-b-fin border-subtle bg-surface pl-4 pr-[14px]',
    '[style.height.px]': 'hauteur',
  },
  template: `
    <mg-logo [hauteur]="18" class="block shrink-0" />
    <mg-fil-ariane class="shrink-0" [segments]="segments()" [precision]="precision()" (remonter)="remonter.emit($event)" />
    <div class="@container flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      <mg-fil-etapes class="shrink-0" [compact]="true" [etapes]="etapes()" [courante]="autresOuvert() ? '' : courante()" (choisir)="choisir.emit($event)" />
      <span data-separateur-autres aria-hidden="true" class="h-5 w-px shrink-0 bg-[var(--border-subtle)]"></span>
      <button type="button" data-autres (click)="ouvrirAutres.emit()" aria-label="Autres, hors parcours"
              title="Ce qui n’a pas encore sa place dans le parcours"
              [attr.aria-current]="autresOuvert() ? 'true' : null" [class]="boutonAutres"
              [class.font-medium]="autresOuvert()" [class.text-primary]="autresOuvert()" [class.border-teal]="autresOuvert()"
              [class.text-tertiary]="!autresOuvert()" [class.border-transparent]="!autresOuvert()">Autres</button>
    </div>
    <!-- ⑥-⑧ (lot 6, A-1) : la campagne courante (?campagne=). Hors du fil : elle vaut pour les trois étapes. -->
    @if (avecCampagne()) { <mg-choix-campagne /> }
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
  protected readonly boutonAutres = BOUTON_AUTRES;

  readonly etapes = input.required<EtapeAffichee[]>();
  readonly courante = input.required<string>();
  readonly segments = input.required<SegmentAriane[]>();
  readonly precision = input<string>();
  /** Le nombre de zones du plan média quand son panneau est FERMÉ, `null` sinon. */
  readonly planMedia = input<number | null>(null);
  /** « Autres » est ouvert (`ParcoursService.autres`) : aucune étape n'est alors courante dans le fil. */
  readonly autresOuvert = input(false);
  /** Le sélecteur de campagne, aux étapes ⑥-⑧ seulement (et pas sous « Autres »). */
  protected readonly avecCampagne = computed(() => !this.autresOuvert() && ETAPES_CAMPAGNE.includes(this.courante() as EtapeCarte));

  readonly choisir = output<string>();
  readonly remonter = output<number>();
  readonly toutEffacer = output<void>();
  readonly rouvrirPlan = output<void>();
  readonly basculerImmersif = output<void>();
  readonly ouvrirAutres = output<void>();
  /** Relais de `mg-badge-session` : l'hôte de la route recrée la page (droits sur la carte, T3). */
  readonly orgChangee = output<string | null>();
}
