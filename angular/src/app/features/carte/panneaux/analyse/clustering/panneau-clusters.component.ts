import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { ClustersService } from '../../../couches/clusters.service';
import { DUREES_CLUSTERS, etiquetteRadarCluster } from '../../../logique/clustering/panneau';
import { ComparaisonDureesComponent } from './comparaison-durees.component';
import { ComparaisonPoiComponent } from './comparaison-poi.component';
import { EtatPanneauClustersService, type OngletClusters } from './etat-panneau-clusters.service';
import { FichePoiClusterComponent } from './fiche-poi-cluster.component';
import { RadarComponent } from './radar.component';
import { STYLES_CLUSTERS } from './styles-clusters';

/** L'assistant de calcul arrive avec la tâche 20 : bouton visible, inactif, qui le dit (précédent T12 → T13). */
const ASSISTANT_A_VENIR = 'Disponible prochainement';

/**
 * Le panneau de clusters — portage de `app/map/_components/ClusterPanel.tsx` (lot 4, T19) : en-tête (version, K,
 * silhouette, variance, durée), onglets Légende / POI / Comparer, fiche du POI cliqué sur la carte, mode comparaison.
 * Rendu sous « + Nouveau clustering » de la section, comme React.
 *
 * « Charger les clusters » ÉMET `charger` : c'est le panneau Analyse qui garde le périmètre puis charge
 * (`handleLoadClustersGarde`, `PanneauAnalyse.tsx:278`) — verrou structurel `panneau-analyse-garde.test.ts`. La durée et
 * la visibilité vont droit au service, comme `onDurationChange` / `onToggle` en React.
 *
 * Défauts React corrigés : une durée sans modèle ne disait rien (voir `ClustersService`) — le message s'affiche ici ;
 * « N CLUSTERS » en capitales et des instructions qui citaient des boutons inexistants (« ⇄ COMPARER », « ⧖ DURÉES »)
 * — sentence case, et les vrais libellés « Comparer » / « Durées » (revue 1).
 */
@Component({
  selector: 'mg-panneau-clusters',
  imports: [ComparaisonDureesComponent, ComparaisonPoiComponent, FichePoiClusterComponent, RadarComponent],
  providers: [EtatPanneauClustersService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (!donnees()) {
      <div class="flex flex-col gap-4 p-5">
        <div class="etiquette mb-0!">Clustering POI</div>
        <div class="mono text-[10px] leading-[1.6] text-tertiary">Visualise les POI regroupés par profil sociodémographique de leur bassin de chalandise.</div>
        @if (clusters.chargement()) {
          <div class="flex items-center gap-2" role="status">
            <span class="pulsation size-1.5 rounded-full bg-teal"></span>
            <span class="mono text-[10px] text-teal">Chargement...</span>
          </div>
        } @else {
          <button type="button" data-charger class="bouton teinte px-[14px]! py-2! text-[8px]!" style="--teinte: var(--success)" (click)="charger.emit()">Charger les clusters</button>
        }
        @if (clusters.erreur(); as e) { <div data-erreur role="alert" class="mono text-[10px] leading-[1.6] text-danger">{{ e }}</div> }
        <button type="button" data-assistant class="bouton teinte px-[14px]! py-2! text-[8px]!" style="--teinte: var(--warning)" disabled [title]="aVenir">Nouveau clustering</button>
      </div>
    } @else if (etat.modeComparaison() === 'selecting') {
      <div class="flex flex-col gap-[14px] p-4">
        <div class="flex items-center justify-between">
          <div class="etiquette">Mode comparaison</div>
          <button type="button" class="bouton px-[7px]! py-[3px]!" style="--teinte: var(--danger)" (click)="etat.quitterComparaison()">Annuler</button>
        </div>
        <div class="selection-a rounded-[2px] px-3 py-[10px]">
          <div class="mono mb-1 text-[10px] text-primary">POI A : <span class="text-teal">{{ etat.comparaisonA()?.poi_name }}</span></div>
          <div class="mono text-[9px] text-tertiary">Cliquez sur un second POI sur la carte pour comparer</div>
        </div>
        <div class="mono text-[9px] text-secondary">— Échap pour annuler —</div>
      </div>
    } @else if (meta(); as m) {
      <div class="shrink-0 border-b border-default px-4 py-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="inter text-[9px] tracking-[0.12em] text-teal">Clusters v{{ m.model_version }}</div>
          <button type="button" data-visible class="bouton px-2! py-[3px]! text-[7px]!" [class.actif]="clusters.visible()" style="--teinte: var(--success)"
                  [attr.aria-pressed]="clusters.visible()" (click)="clusters.basculerVisibilite()">{{ clusters.visible() ? 'Visible' : 'Masqué' }}</button>
        </div>
        <div class="mono flex gap-[14px] text-[9px] text-secondary">
          <span>K=<span class="text-primary">{{ m.k }}</span></span>
          <span>Sil=<span class="text-success">{{ silhouette() }}</span></span>
          <span>Var=<span class="text-primary">{{ variance() }}%</span></span>
        </div>
        <div class="mt-2 flex gap-1">
          <span class="inter mr-[2px] self-center text-[6.5px] tracking-[0.1em] text-secondary">Durée</span>
          @for (d of durees; track d) {
            <button type="button" [attr.data-duree]="d" class="bouton px-2! py-[3px]! text-[7px]! tracking-[0.08em]!" [class.actif]="clusters.duree() === d"
                    [attr.aria-pressed]="clusters.duree() === d" (click)="clusters.changerDuree(d)">{{ d }} min</button>
          }
          @if (clusters.chargement()) { <span class="mono ml-1 self-center text-[8px] text-teal">...</span> }
          <button type="button" data-assistant class="bouton nouveau ml-auto px-2! py-[3px]! text-[6.5px]! tracking-[0.08em]!" disabled [title]="aVenir">Nouveau</button>
        </div>
        @if (clusters.erreur(); as e) { <div data-erreur role="alert" class="mono mt-2 text-[9px] leading-[1.6] text-danger">{{ e }}</div> }
      </div>

      <div class="flex shrink-0 border-b border-default bg-surface" role="tablist">
        @for (o of onglets(); track o.id) {
          <button type="button" role="tab" data-onglet [attr.aria-selected]="etat.onglet() === o.id" (click)="etat.onglet.set(o.id)"
                  class="onglet inter flex-1 px-1 py-[7px] text-[6.5px] tracking-[0.1em]" [class.actif]="etat.onglet() === o.id">{{ o.libelle }}</button>
        }
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        @switch (etat.onglet()) {
          @case ('legend') {
            <div class="flex flex-col gap-3 p-4">
              @if (etat.selection(); as s) { <mg-fiche-poi-cluster [poi]="s" /> }
              <div>
                <div class="etiquette">
                  @if (etat.filtreCluster() !== null) {
                    <button type="button" class="lien-tous" (click)="etat.filtreCluster.set(null)">Tous</button> · Cluster {{ etat.filtreCluster() }}
                  } @else { {{ m.k }} clusters · {{ nombrePoi() }} POI }
                </div>
                <div class="flex flex-col gap-1">
                  @for (c of listeClusters(); track c.cid) {
                    <button type="button" [attr.data-cluster]="c.cid" (click)="etat.choisirCluster(c.cid)" [style.--teinte]="c.color"
                            class="ligne-cluster flex w-full items-center gap-2 px-[10px] py-[7px] text-left" [class.filtre]="etat.filtreCluster() === c.numero">
                      <span class="pastille size-[9px]" [style.background]="c.color"></span>
                      <span class="mono flex-1 text-[9px] leading-[1.3] text-primary">{{ c.label }}</span>
                      <span class="compte inter text-[7px]">{{ c.count }}</span>
                    </button>
                  }
                </div>
              </div>
              @if (radar(); as r) {
                <div class="tuile p-3">
                  <div class="etiquette mb-[10px]!">Profils moyens par cluster</div>
                  <mg-radar [profils]="r.profils" [couleurs]="r.couleurs" [libelles]="r.libelles" [cles]="etat.cles()" libelle="Profils moyens par cluster" />
                </div>
              }
            </div>
          }
          @case ('table') {
            <div class="flex flex-col gap-[10px] px-4 py-3">
              <div class="flex items-center justify-between">
                <div class="etiquette">
                  @if (etat.filtreCluster() !== null) {
                    <button type="button" class="lien-tous" (click)="etat.filtreCluster.set(null)">Tous</button> · Cluster {{ etat.filtreCluster() }}
                  } @else { {{ etat.lignes().length }} POI }
                </div>
                @if (etat.filtreCluster() !== null) {
                  <button type="button" class="bouton px-[7px]! py-[3px]! text-[7px]!" style="--teinte: var(--warning)" (click)="etat.filtreCluster.set(null)">Retirer filtre</button>
                }
              </div>
              <div class="flex flex-col gap-[3px]">
                @for (l of lignes(); track l.poi_id) {
                  <button type="button" [attr.data-ligne-poi]="l.poi_id" (click)="clusters.voler(l.lat, l.lng, 12)" [style.--teinte]="l.cluster_color"
                          class="tuile flex w-full cursor-pointer items-center gap-[7px] px-2 py-1.5 text-left">
                    <span class="pastille size-[7px]" [style.background]="l.cluster_color"></span>
                    <span class="min-w-0 flex-1 overflow-hidden">
                      <span class="mono block truncate text-[9px] text-primary">{{ l.nom }}</span>
                      <span class="mono block text-[8px] text-tertiary">{{ l.ville }}</span>
                    </span>
                    <span class="compte inter shrink-0 text-[6.5px]">C{{ l.cluster_id }}</span>
                  </button>
                }
              </div>
            </div>
          }
          @case ('compare') {
            <div class="flex flex-col gap-[14px] p-4">
              @if (etat.dureesPoi() && etat.modeComparaison() === 'idle') {
                <mg-comparaison-durees />
              } @else if (etat.modeComparaison() === 'comparing' && etat.comparaisonA() && etat.comparaisonB()) {
                <mg-comparaison-poi />
              } @else {
                <div class="flex flex-col gap-3">
                  <div class="etiquette">Comparer deux POI</div>
                  <div class="mono text-[9px] leading-[1.7] text-tertiary">
                    1. Cliquez sur un POI sur la carte (onglet Légende)<br />2. Cliquez « Comparer » dans sa fiche<br />3. Cliquez sur un second POI
                  </div>
                  <div class="etiquette mt-1">Comparaison de durées</div>
                  <div class="mono text-[9px] leading-[1.7] text-tertiary">
                    Sélectionnez un POI (Légende), puis cliquez « Durées » pour voir comment son bassin évolue à {{ dureesTexte }} min.
                  </div>
                </div>
              }
            </div>
          }
        }
      </div>
    }
  `,
  styles: [STYLES_CLUSTERS, `
    .pulsation { animation: pulsation 1s linear infinite; }
    @keyframes pulsation { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .selection-a { background: color-mix(in srgb, var(--brand-teal) 7%, transparent); border: 0.5px solid var(--brand-teal); }
    .nouveau { background: color-mix(in srgb, var(--warning) 8%, transparent); border-color: color-mix(in srgb, var(--warning) 35%, transparent); color: var(--warning); }
    .onglet { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--text-secondary); cursor: pointer;
      transition: background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out); }
    .onglet.actif { background: color-mix(in srgb, var(--brand-teal) 7%, transparent); border-bottom-color: var(--brand-teal); color: var(--brand-teal); }
    .ligne-cluster { background: var(--bg-level-2); border: 0.5px solid var(--border-default); border-radius: 2px; cursor: pointer; transition: border-color 200ms var(--ease-out); }
    .ligne-cluster.filtre { border-color: var(--teinte); }
    .lien-tous { background: none; border: 0; padding: 0; font: inherit; letter-spacing: inherit; color: var(--warning); cursor: pointer; }
  `],
})
export class PanneauClustersComponent {
  protected readonly clusters = inject(ClustersService);
  protected readonly etat = inject(EtatPanneauClustersService);
  /** « Charger les clusters » : le parent garde le périmètre, puis charge. */
  readonly charger = output<void>();

  protected readonly durees = DUREES_CLUSTERS;
  protected readonly dureesTexte = DUREES_CLUSTERS.join('/');
  protected readonly aVenir = ASSISTANT_A_VENIR;
  protected readonly donnees = this.clusters.donnees;
  protected readonly meta = computed(() => this.donnees()?.metadata ?? null);
  protected readonly nombrePoi = computed(() => this.donnees()?.features.length ?? 0);
  protected readonly silhouette = computed(() => (this.meta()?.silhouette_score ?? 0).toFixed(3));
  protected readonly variance = computed(() => ((this.meta()?.variance_explained ?? 0) * 100).toFixed(0));
  protected readonly onglets = computed<{ id: OngletClusters; libelle: string }[]>(() => [
    { id: 'legend', libelle: 'Légende' },
    { id: 'table', libelle: `POI (${this.etat.lignes().length})` },
    { id: 'compare', libelle: 'Comparer' },
  ]);
  /** Les clusters de la légende, identifiant numérique compris (le filtre est un nombre). */
  protected readonly listeClusters = computed(() => this.etat.clustersTries().map(([cid, c]) => ({ cid, numero: Number(cid), ...c })));
  /** Les lignes de la table, nom affiché compris (à défaut, les 8 premiers caractères de l'identifiant). */
  protected readonly lignes = computed(() => this.etat.lignes().map((l) => ({ ...l, nom: l.poi_name || l.poi_id.slice(0, 8) })));
  /** Le radar des profils moyens : seulement avec des clusters et au moins 3 variables. */
  protected readonly radar = computed(() => {
    const tries = this.etat.clustersTries();
    if (!tries.length || this.etat.cles().length < 3) return null;
    return {
      profils: tries.map(([, c]) => c.avg_profile),
      couleurs: tries.map(([, c]) => c.color),
      libelles: tries.map(([cid, c]) => etiquetteRadarCluster(cid, c.label)),
    };
  });
}
