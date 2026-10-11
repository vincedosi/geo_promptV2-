import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type DessinRadar, dessinerRadar } from '../../../logique/clustering/radar';

/** Les traits de la grille, par variante : ceux de `RadarChart` (panneau) et de `ClusterRadar` (rapport). */
const GRILLE = {
  panneau: { exterieur: 'var(--border-default)', interieur: 'var(--border-subtle)', axe: 'var(--border-subtle)' },
  rapport: { exterieur: 'var(--border-subtle)', interieur: 'var(--bg-level-2)', axe: 'var(--border-subtle)' },
} as const;

/**
 * Un radar de profils — `RadarChart` (`ClusterPanel.tsx`, variante `panneau`, 6 axes) et `ClusterRadar`
 * (`components/ClusterRadar.tsx`, variante `rapport`, 16 axes, référence « Moy. France »). Le dessin est calculé par
 * `dessinerRadar` (logique pure) ; ce composant ne fait que le poser en SVG.
 *
 * Les couleurs passent par `style` (`fill`, `stroke`) et non par attributs : un `var(--jeton)` s'y résout toujours.
 * L'aplat des profils prend la teinte en `fill-opacity` (0,19 au panneau, 0,16 au rapport : les suffixes `30` et `28`
 * de React) — React concaténait `'var(--brand-teal)' + '30'`, couleur invalide : l'aplat des durées à 60 min et du
 * premier cluster du rapport ne se peignait pas. Défaut corrigé. L'axe `#1a1a1a` du panneau devient `--border-subtle`.
 */
@Component({
  selector: 'mg-radar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dessin(); as d) {
      <svg [attr.width]="d.taille" [attr.height]="d.taille" class="mx-auto block" role="img" [attr.aria-label]="libelle()">
        @for (g of d.grilles; track $index) {
          <polygon [attr.points]="g.points" fill="none" [style.stroke]="g.exterieur ? grille().exterieur : grille().interieur"
                   [attr.stroke-width]="g.exterieur ? 0.8 : 0.4" />
        }
        @for (a of d.axes; track $index) {
          <line [attr.x1]="a.x1" [attr.y1]="a.y1" [attr.x2]="a.x2" [attr.y2]="a.y2" [style.stroke]="grille().axe" stroke-width="0.5" />
        }
        @if (d.reference) {
          <path [attr.d]="d.reference" class="reference" stroke-width="1" stroke-dasharray="3 2" />
        }
        @for (t of d.traces; track $index) {
          <path [attr.d]="t.d" [style.fill]="t.couleur" [attr.fill-opacity]="opaciteAplat()" [style.stroke]="t.couleur" stroke-width="1.5" />
        }
        @for (e of d.etiquettes; track $index) {
          <text [attr.x]="e.x" [attr.y]="e.y" [attr.text-anchor]="e.ancre" [attr.dominant-baseline]="e.base"
                font-size="7" letter-spacing="0.05em" class="texte">{{ e.texte }}</text>
        }
        @for (l of d.legende; track $index) {
          <g [attr.transform]="l.transform">
            @if (l.tirets) {
              <line x1="0" y1="3.5" x2="7" y2="3.5" [style.stroke]="l.couleur" stroke-width="1.5" stroke-dasharray="3 2" />
            } @else {
              <rect width="7" height="7" rx="1" [style.fill]="l.couleur" />
            }
            <text x="10" y="6" font-size="7" class="texte">{{ l.libelle }}</text>
          </g>
        }
      </svg>
    }
  `,
  styles: `
    .texte { fill: var(--text-secondary); font-family: var(--font-sans); }
    /* « Moy. France » : le gris de React (#666666, rgba(160,160,160,0.08)) devenu --text-tertiary, aplat à 8 %. */
    .reference { stroke: var(--text-tertiary); fill: color-mix(in srgb, var(--text-tertiary) 8%, transparent); }
  `,
})
export class RadarComponent {
  readonly profils = input.required<readonly Readonly<Record<string, number>>[]>();
  readonly couleurs = input.required<readonly string[]>();
  readonly libelles = input.required<readonly string[]>();
  readonly cles = input.required<readonly string[]>();
  readonly taille = input(190);
  readonly variante = input<'panneau' | 'rapport'>('panneau');
  readonly reference = input<Readonly<Record<string, number>>>();
  readonly legende = input(true);
  readonly legendeReference = input<boolean>();
  readonly libelle = input('Radar des profils');

  protected readonly grille = computed(() => GRILLE[this.variante()]);
  protected readonly opaciteAplat = computed(() => (this.variante() === 'panneau' ? 0x30 / 255 : 0x28 / 255));
  protected readonly dessin = computed<DessinRadar | null>(() => dessinerRadar({
    profils: this.profils(), couleurs: this.couleurs(), libelles: this.libelles(), cles: this.cles(), taille: this.taille(),
    maxAxes: this.variante() === 'panneau' ? 6 : 16, reference: this.reference(), legende: this.legende(),
    legendeReference: this.legendeReference(),
  }));
}
