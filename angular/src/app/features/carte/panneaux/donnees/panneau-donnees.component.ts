import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { EnteteSectionComponent } from '../../../../ui/entete-section/entete-section.component';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { CarreauxService } from '../../couches/carreaux.service';
import { IndicateursCiviquesService } from '../../couches/indicateurs-civiques.service';
import { IrisService } from '../../couches/iris.service';
import { MeteoService } from '../../couches/meteo.service';
import { SanteService } from '../../couches/sante.service';
import { TmjaService } from '../../couches/tmja.service';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { DonneesAfficheesService } from '../../etat/donnees-affichees.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { JeuxRecommandesService } from '../../etat/jeux-recommandes.service';
import { RisqueCarteService } from '../../etat/risque-carte.service';
import { libelleDegrade } from '../../logique/degrades';
import { PREFIXE_POI } from '../../logique/jeux-carte';
import { type JeuAffichable, filtrerJeux, jeuxDeLaCarte, rangerJeux } from '../../logique/rangement-jeux';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { SectionCarreauxComponent } from '../calques/section-carreaux.component';
import { SectionCiviqueComponent } from '../calques/section-civique.component';
import { SectionIrisComponent } from '../calques/section-iris.component';
import { SectionMeteoComponent } from '../calques/section-meteo.component';
import { SectionRisqueComponent } from '../calques/section-risque.component';
import { SectionSanteComponent } from '../calques/section-sante.component';
import { SectionTmjaComponent } from '../calques/section-tmja.component';
import { SectionTransportComponent } from '../calques/section-transport.component';
import { SelectionsCalquesService } from '../calques/selections-calques.service';
import { ActionsPoiComponent } from './actions-poi.component';
import { LigneJeuComponent } from './ligne-jeu.component';

/** Un calque affiché, dans « Actifs (n) », avec la croix qui l'éteint (`PanneauCalques.tsx:327-358`). */
interface ActifCalque {
  readonly id: string;
  readonly label: string;
  readonly retirer: () => void;
}

/** Ce que le gabarit lit d'une ligne : tout est calculé ici, rien n'est appelé dans le gabarit. */
interface LigneVue {
  readonly jeu: JeuAffichable;
  readonly mode: 'case' | 'reglages';
  readonly affiche: boolean;
  readonly coche: boolean;
  readonly deplie: boolean;
}

const SANTE = 'sante:air-pollen';
const estPoi = (cle: string) => cle.startsWith(PREFIXE_POI);

/**
 * Le panneau ② « Données » (spec § 4 ②, lot 2) — il remplace le panneau « Calques ». « Rien n'est caché, tout est rangé » :
 *
 * 1. « Actifs (n) », repris VERBATIM de `panneau-calques` (version T11b : ni OOH ni radio) ; puis `mg-actions-poi` (ce
 *    qu'on fait des types de POI cochés) ; puis « Chercher un jeu ».
 * 2. « Données de l'espace » : les types de POI importés par l'espace actif ; et toujours, le chemin vers ses zones
 *    (boîte à outils, « Mes zones »).
 * 3. « Données communes » : la sélection recommandée de l'espace d'abord (`JeuxRecommandesService`), le reste replié
 *    dans « Plus de données communes (n) » (ruling contrôleur : « Autres » ne désigne que le bouton hors fil). Aucune
 *    sélection, une sélection périmée ou une lecture en échec : tout est visible, sans repli (`rangerJeux`).
 *
 * Chaque jeu est une ligne uniforme (`mg-ligne-jeu`, arbitrage A12) : un type de POI se COCHE (la sélection reste
 * `EtatCarteService.poiSelectionnes`, ordre gardé) ; un référentiel se DÉPLIE sur sa section existante, en-tête interne
 * masqué (`integre`). Une section n'est INSTANCIÉE que dépliée : rien n'est lu tant qu'on ne l'a pas ouverte.
 * La pastille « affiché » vient de `DonneesAfficheesService`, la même source que la pastille de l'étape (AT-4).
 *
 * ── RECHERCHE ─────────────────────────────────────────────────────────────
 * Le rangement est fait sur TOUS les jeux, puis chaque bloc est filtré : chercher ne change ni la précision (« sélection
 * recommandée ») ni le bloc d'un jeu ; une recherche non vide déplie « Plus de données communes » pour montrer ce
 * qu'elle y trouve. (Filtrer AVANT de ranger, comme l'écrivait le plan, faisait dire « aucune sélection » à une
 * recherche qui ne trouvait aucun jeu recommandé.)
 *
 * ── CE QUE LA CONSTRUCTION LIT ───────────────────────────────────────────
 * Monté à la PREMIÈRE visite de ② puis gardé (arbitrage A1) : le catalogue des types de POI (`chargerUneFois`) et la
 * sélection recommandée (le service fourni ICI la lit à sa construction). Deux GET légers, aucun calque — la
 * recommandation range, elle ne précharge rien.
 *
 * `SelectionsCalquesService` est fourni ici (sections, types de transport) ; le panneau « Autres » a le sien (régies
 * OOH) : deux instances, à ne pas fusionner (T11b).
 */
@Component({
  selector: 'mg-panneau-donnees',
  imports: [
    ActionsPoiComponent, EnteteSectionComponent, IconeComponent, LigneJeuComponent, NgTemplateOutlet, SectionCarreauxComponent,
    SectionCiviqueComponent, SectionIrisComponent, SectionMeteoComponent, SectionRisqueComponent, SectionSanteComponent,
    SectionTmjaComponent, SectionTransportComponent,
  ],
  providers: [SelectionsCalquesService, JeuxRecommandesService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    <div data-actifs class="border-b-fin border-subtle">
      <div class="px-[14px] py-[10px] text-[12px] font-medium text-primary">Actifs ({{ actifs().length }})</div>
      @if (actifs().length > 0) {
        <div class="flex flex-col gap-1 px-[14px] pb-[10px]">
          @for (a of actifs(); track a.id) {
            <div [attr.data-actif]="a.id" class="flex items-center gap-2 rounded-[4px] border-fin border-subtle bg-elevated px-2 py-[5px]">
              <span class="flex-1 text-[12px] text-secondary">{{ a.label }}</span>
              <button
                type="button"
                [title]="'Masquer ' + a.label"
                [attr.aria-label]="'Masquer ' + a.label"
                (click)="a.retirer()"
                class="flex cursor-pointer border-0 bg-transparent p-0 text-tertiary"
              >
                <mg-icone nom="croix" [taille]="13" />
              </button>
            </div>
          }
        </div>
      } @else {
        <div class="px-[14px] pb-[10px] text-[12px] text-tertiary">Aucun calque affiché</div>
      }
    </div>

    <mg-actions-poi />

    <div class="px-[14px] pb-[10px]">
      <input data-recherche type="search" placeholder="Chercher un jeu" aria-label="Chercher un jeu" [value]="recherche()"
        (input)="recherche.set($any($event.target).value)"
        class="w-full rounded-[6px] border-fin border-subtle bg-elevated px-3 py-2 text-[13px] text-primary outline-none transition-[border-color] duration-150 ease-[var(--ease-hover)] placeholder:text-tertiary focus:border-[var(--brand-teal-50)]" />
    </div>

    <section data-bloc="espace" aria-label="Données de l'espace">
      <mg-entete-section libelle="Données de l'espace" />
      @for (l of vue().espace; track l.jeu.cle) {
        <ng-container [ngTemplateOutlet]="ligne" [ngTemplateOutletContext]="{ $implicit: l }" />
      } @empty {
        <p data-espace-vide class="m-0 px-[14px] py-2 text-[12px] text-tertiary">{{ videEspace() }}</p>
      }
      <div data-zones-espace class="flex items-center gap-2 border-t-fin border-subtle px-[14px] py-2">
        <span class="min-w-0 flex-1 text-[12px] text-secondary">Zones de l'espace : boîte à outils, « Mes zones »</span>
        <button type="button" (click)="outils.ouvrir('zones')"
          class="shrink-0 cursor-pointer rounded-[6px] border-fin border-teal bg-transparent px-2.5 py-1 text-[11px] font-medium text-teal transition-colors duration-150 ease-[var(--ease-hover)] hover:bg-teal-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-teal-50)]">Ouvrir</button>
      </div>
    </section>

    <section data-bloc="commun" aria-label="Données communes">
      <mg-entete-section libelle="Données communes" />
      @if (lecture()) {
        <p class="m-0 px-[14px] py-2 text-[12px] text-tertiary">Lecture de la sélection…</p>
      } @else {
        <p data-precision class="m-0 px-[14px] pb-1.5 pt-2 text-[11px] text-tertiary">{{ precision() }}</p>
        @for (l of vue().recommandes; track l.jeu.cle) {
          <ng-container [ngTemplateOutlet]="ligne" [ngTemplateOutletContext]="{ $implicit: l }" />
        }
        @if (!vue().sansSelection) {
          <button type="button" data-repli-autres [attr.aria-expanded]="plusVisibles()" (click)="plusOuverts.set(!plusOuverts())"
            class="flex w-full cursor-pointer items-center gap-1.5 border-0 border-t-fin border-subtle bg-transparent px-[14px] py-2 text-left text-[12px] text-secondary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-teal-50)]">
            <span aria-hidden="true" class="w-2.5 text-tertiary">{{ plusVisibles() ? '▾' : '▸' }}</span>
            Plus de données communes ({{ vue().autres.length }})
          </button>
          @if (plusVisibles()) {
            @for (l of vue().autres; track l.jeu.cle) {
              <ng-container [ngTemplateOutlet]="ligne" [ngTemplateOutletContext]="{ $implicit: l }" />
            }
          }
        }
      }
    </section>

    <ng-template #ligne let-l>
      <mg-ligne-jeu [jeu]="l.jeu" [mode]="l.mode" [affiche]="l.affiche" [coche]="l.coche" [deplie]="l.deplie"
        (cocher)="cocher(l.jeu.cle)" (basculer)="deplier(l.jeu.cle)">
        @if (l.deplie) {
          @switch (l.jeu.cle) {
            @case ('iris:socio-demo') { <mg-section-iris /> }
            @case ('carreaux:filosofi') { <mg-section-carreaux /> }
            @case ('civique:indicateurs-cp') { <mg-section-civique [integre]="true" /> }
            @case ('transport:arrets') { <mg-section-transport [integre]="true" /> }
            @case ('tmja:comptages') { <mg-section-tmja [integre]="true" /> }
            @case ('risques:icpe-pprt') { <mg-section-risque [integre]="true" /> }
            @case ('sante:air-pollen') { <mg-section-sante [integre]="true" /> }
            @case ('meteo:zones') { <mg-section-meteo [integre]="true" /> }
          }
        }
      </mg-ligne-jeu>
    </ng-template>
  `,
})
export class PanneauDonneesComponent {
  private readonly carreaux = inject(CarreauxService);
  private readonly iris = inject(IrisService);
  private readonly etat = inject(EtatCarteService);
  private readonly selections = inject(SelectionsCalquesService);
  private readonly tmja = inject(TmjaService);
  private readonly civique = inject(IndicateursCiviquesService);
  private readonly sante = inject(SanteService);
  private readonly meteo = inject(MeteoService);
  private readonly risque = inject(RisqueCarteService);
  private readonly catalogue = inject(CataloguePoiService);
  private readonly reco = inject(JeuxRecommandesService);
  private readonly affiches = inject(DonneesAfficheesService);
  protected readonly outils = inject(OutilsCarteService);

  protected readonly recherche = signal('');
  /** Le repli « Plus de données communes », fermé à l'ouverture. */
  protected readonly plusOuverts = signal(false);
  /** Les référentiels dépliés — local au panneau, gardé avec lui (A1). */
  private readonly deplies = signal<ReadonlySet<string>>(new Set());

  protected readonly lecture = computed(() => this.reco.cles() === null);
  protected readonly plusVisibles = computed(() => this.plusOuverts() || this.recherche().trim() !== '');
  protected readonly precision = computed(() => {
    if (this.reco.indisponible()) return 'Sélection recommandée indisponible : tout est visible.';
    return this.rangement().sansSelection ? 'aucune sélection : tout est visible' : 'sélection recommandée';
  });
  private readonly rangement = computed(() => rangerJeux(jeuxDeLaCarte(this.catalogue.types()), this.reco.cles() ?? []));
  protected readonly videEspace = computed(() => {
    if (this.rangement().espace.length > 0) return "Aucun jeu de l'espace ne correspond.";
    return this.catalogue.chargement() ? 'Lecture des types de POI…' : "Cet espace n'a importé aucune donnée.";
  });
  protected readonly vue = computed(() => {
    const r = this.rangement();
    const q = this.recherche();
    const affiches = this.affiches.cles();
    const choisis = new Set(this.etat.poiSelectionnes().map((id) => `${PREFIXE_POI}${id}`));
    const deplies = this.deplies();
    const lignes = (jeux: readonly JeuAffichable[]): LigneVue[] => filtrerJeux(jeux, q).map((jeu) => ({
      jeu, mode: estPoi(jeu.cle) ? 'case' : 'reglages', affiche: affiches.has(jeu.cle), coche: choisis.has(jeu.cle),
      deplie: !estPoi(jeu.cle) && deplies.has(jeu.cle),
    }));
    return { espace: lignes(r.espace), recommandes: lignes(r.recommandes), autres: lignes(r.autres), sansSelection: r.sansSelection };
  });

  protected readonly actifs = computed<ActifCalque[]>(() => {
    const liste: ActifCalque[] = [];
    if (this.carreaux.visible()) {
      liste.push({ id: 'carreaux', label: libelleDegrade('carreaux'), retirer: () => this.carreaux.basculer(false) });
    }
    if (this.iris.visible()) {
      liste.push({ id: 'iris', label: libelleDegrade('iris'), retirer: () => this.iris.basculer(false) });
    }
    // `PanneauCalques.tsx:332-335` : la croix vide la SÉLECTION, elle n'efface pas les points affichés (comme React).
    const poi = this.etat.poiSelectionnes().length;
    if (poi > 0) liste.push({ id: 'poi', label: `POI (${poi})`, retirer: () => this.etat.poiSelectionnes.set([]) });
    const transport = this.selections.typesTransport().length;
    if (transport > 0) {
      liste.push({ id: 'transport', label: `Transport (${transport})`, retirer: () => this.selections.typesTransport.set([]) });
    }
    if (this.tmja.visible()) liste.push({ id: 'tmja', label: 'Flux routier (TMJA)', retirer: () => this.tmja.masquer() });
    if (this.civique.variable()) {
      liste.push({ id: 'civic-indicateurs', label: libelleDegrade('civic-indicateurs'), retirer: () => this.civique.choisir(null) });
    }
    if (this.sante.jeu()) liste.push({ id: 'civic-sante', label: libelleDegrade('civic-sante'), retirer: () => this.sante.choisirJeu(null) });
    // `PanneauCalques.tsx:339` : la croix fait `onClearMeteo` — dégradé rendu ET couche vidée.
    if (this.meteo.visible()) liste.push({ id: 'meteo', label: libelleDegrade('meteo'), retirer: () => this.meteo.masquer() });
    // `PanneauCalques.tsx:340-357` : les deux couches de risque, comptées séparément (elles s'allument séparément).
    if (this.risque.actif()) {
      liste.push({ id: 'risque-industriel', label: 'Zones à risque industriel', retirer: () => this.risque.actif.set(false) });
    }
    if (this.risque.pprtActif()) liste.push({ id: 'pprt', label: 'Périmètre PPRT', retirer: () => this.risque.pprtActif.set(false) });
    return liste;
  });

  constructor() {
    // Le catalogue n'attend plus l'ouverture d'une section : chaque type de POI est une ligne de ②.
    this.catalogue.chargerUneFois();
    // « Santé environnementale » se déplie d'elle-même au PREMIER IRIS sélectionné, une seule fois : repliée ensuite,
    // elle le reste (`use-filter-sections.ts:85-91`, même durée de vie : celle du panneau).
    let deplieeAuto = false;
    effect(() => {
      const commune = this.iris.detail()?.code_commune;
      if (!commune || deplieeAuto) return;
      deplieeAuto = true;
      untracked(() => {
        if (!this.deplies().has(SANTE)) this.deplier(SANTE);
      });
    });
  }

  /** La case d'un type de POI : l'ajoute à la fin de la sélection, ou l'en retire (l'ordre des autres est gardé). */
  protected cocher(cle: string): void {
    const id = cle.slice(PREFIXE_POI.length);
    this.etat.poiSelectionnes.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  protected deplier(cle: string): void {
    this.deplies.update((d) => {
      const n = new Set(d);
      if (n.has(cle)) n.delete(cle);
      else n.add(cle);
      return n;
    });
  }
}
