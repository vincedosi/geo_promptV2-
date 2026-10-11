import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { ClustersService } from '../../../couches/clusters.service';
import { basculerDuree, comparaisonDurees, pourcent1 } from '../../../logique/clustering/panneau';
import { EtatPanneauClustersService } from './etat-panneau-clusters.service';
import { RadarComponent } from './radar.component';
import { STYLES_CLUSTERS } from './styles-clusters';

/**
 * La teinte de chaque durée (`DUR_COLORS`, `ClusterPanel.tsx:722`) : des séries QUALITATIVES, en jetons. Le vert
 * `#59a14f` de React devient `--nature-3` (le vert qualitatif du projet), l'ambre `#f59e0b` `--warning` ; le teal reste.
 */
const TEINTES_DUREES: Readonly<Record<number, string>> = { 30: 'var(--nature-3)', 45: 'var(--warning)', 60: 'var(--brand-teal)' };
const teinte = (d: number) => TEINTES_DUREES[d] ?? 'var(--text-secondary)';

/**
 * « Comparaison durées » d'un POI (`CompareDurationsView`, `ClusterPanel.tsx:724-919`) : durées cochables (jamais la
 * dernière), radar superposé, « Variation par feature » (8 lignes au plus), résumé. Les calculs sont dans
 * `comparaisonDurees` (logique pure).
 */
@Component({
  selector: 'mg-comparaison-durees',
  imports: [RadarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-[14px]">
      <div class="flex items-start justify-between">
        <div>
          <div class="etiquette">Comparaison durées</div>
          @if (pret()) { <div class="mono text-[10px] font-bold text-primary">{{ nomCourt() }}</div> }
        </div>
        <button type="button" class="bouton px-[7px]! py-[3px]! text-[7px]!" (click)="etat.fermerDurees()">Fermer</button>
      </div>
      @if (etat.dureesChargement()) {
        <div class="mono text-[10px] text-teal"><span class="opacity-70">◈</span> Chargement des profils multi-durées...</div>
      } @else if (etat.dureesErreur(); as e) {
        <div data-erreur-durees role="alert" class="mono text-[10px] text-danger">{{ e }}</div>
      } @else if (!pret()) {
        <div class="mono text-[10px] text-tertiary">Aucune donnée multi-durée disponible pour ce POI.</div>
      } @else {
        <div class="flex flex-wrap gap-[5px]">
          @for (b of boutons(); track b.duree) {
            <button type="button" [attr.data-duree-comparee]="b.duree" class="bouton px-[10px]! py-1! text-[7px]! tracking-[0.08em]!" [style.--teinte]="b.teinte"
                    [class.actif]="b.actif" [attr.aria-pressed]="b.actif" (click)="basculer(b.duree)">{{ b.duree }} min {{ b.courante ? '★' : '' }}</button>
          }
        </div>
        @if (etat.cles().length >= 3 && vue().choisies.length > 0) {
          <div class="tuile p-3">
            <div class="etiquette mb-[10px]!">Profils superposés</div>
            <mg-radar [profils]="profils()" [couleurs]="couleurs()" [libelles]="libellesRadar()" [cles]="etat.cles()" [taille]="180" libelle="Profils superposés par durée" />
          </div>
        }
        @if (lignes().length > 0) {
          <div>
            <div class="etiquette">Variation par feature</div>
            <div class="flex flex-col gap-[2px]">
              @for (l of lignes(); track l.cle) {
                <div class="tuile px-2 py-[5px]">
                  <div class="mb-[3px] flex justify-between">
                    <span class="inter text-[7px] text-secondary">{{ l.libelle }}</span>
                    <div class="mono flex gap-1.5 text-[8px]">
                      @for (v of l.cellules; track $index) { <span [style.color]="v.couleur">{{ v.texte }}</span> }
                    </div>
                  </div>
                  <div class="barre">
                    @for (v of l.cellules; track $index) {
                      <div class="absolute top-0 left-0 h-full rounded-[1px] opacity-70" [style.width.%]="v.largeur" [style.background]="v.couleur"></div>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        }
        @if (vue().disponibles.length > 1) {
          <div class="resume rounded-[2px] px-3 py-2">
            <div class="mono text-[9px] leading-[1.7] text-secondary">
              {{ vue().disponibles.length }} paliers disponibles · durée actuelle : <span [style.color]="teinteCourante()">{{ clusters.duree() }} min</span>
            </div>
            @if (lignes()[0]; as l) {
              <div class="mono mt-[2px] text-[9px] text-tertiary">Variation max : <span class="text-primary">{{ l.amplitudeTexte }}</span> sur {{ l.libelle }}</div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [STYLES_CLUSTERS, `
    .resume { background: color-mix(in srgb, var(--brand-teal) 5%, transparent); border: 0.5px solid color-mix(in srgb, var(--brand-teal) 15%, transparent); }
  `],
})
export class ComparaisonDureesComponent {
  protected readonly etat = inject(EtatPanneauClustersService);
  protected readonly clusters = inject(ClustersService);

  private readonly donnees = computed(() => this.etat.dureesDonnees() ?? {});
  /** Toutes les durées cochées à l'arrivée des données (`useEffect(() => setActiveDurs(…), [durData])`). */
  protected readonly actives = linkedSignal(() => Object.keys(this.donnees()).map(Number).sort((a, b) => a - b));
  protected readonly vue = computed(() => comparaisonDurees(this.donnees(), this.actives(), this.etat.cles()));
  protected readonly boutons = computed(() => this.vue().disponibles.map((duree) => ({
    duree, teinte: teinte(duree), actif: this.actives().includes(duree), courante: duree === this.clusters.duree(),
  })));
  protected readonly teinteCourante = computed(() => teinte(this.clusters.duree()));
  protected readonly pret = computed(() => this.etat.dureesDonnees() !== null && this.vue().disponibles.length > 0);
  protected readonly nomCourt = computed(() => {
    const nom = this.etat.selection()?.poi_name ?? (this.etat.dureesPoi() ?? '').slice(0, 8);
    return nom.length > 22 ? `${nom.slice(0, 22)}…` : nom;
  });
  protected readonly profils = computed(() => this.vue().choisies.map((d) => this.donnees()[d]));
  protected readonly couleurs = computed(() => this.vue().choisies.map(teinte));
  protected readonly libellesRadar = computed(() => this.vue().choisies.map((d) => `${d} min`));
  protected readonly lignes = computed(() => this.vue().lignes.map((l) => {
    const max = Math.max(...l.valeurs, 0.001);
    return {
      ...l,
      amplitudeTexte: pourcent1(l.amplitude),
      cellules: l.valeurs.map((v, i) => ({ texte: pourcent1(v), couleur: this.couleurs()[i], largeur: Number(((v / max) * 100).toFixed(1)) })),
    };
  }));

  /** Cocher / décocher une durée : jamais la dernière. */
  protected basculer(duree: number): void {
    this.actives.update((a) => basculerDuree(a, duree));
  }
}
