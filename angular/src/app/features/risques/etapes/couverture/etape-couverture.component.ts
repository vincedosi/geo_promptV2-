import { ChangeDetectionStrategy, Component, type Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { PastilleComponent } from '../../../../ui/pastille/pastille.component';
import { DonneesRisqueService } from '../../etat/donnees-risque.service';
import type { ContoursMaille } from '../../logique/donnees-risque';
import type { Dimension } from '../../logique/dimensions';
import { codesDessines, peutDescendre, peutRemonter } from '../../logique/exploration';
import type { ZoneGeo } from '../../logique/mini-france';
import { PALETTES_DONNEES } from '../../logique/palettes-donnees';
import { CarteMiniFranceComponent } from './carte-mini-france.component';
import { TableauCouvertureComponent } from './tableau-couverture.component';

type Encodage = 'part' | 'densite' | 'exposee';

/**
 * Ce que la mini-carte sait dessiner, par maille (`AnalysePopulationOverlay.tsx:125-131`). Les contours postaux
 * existent mais ne sont pas dessinés : dans un département, une carte de France n'en montrerait qu'un confetti.
 */
const ZONES_DESSINEES: Record<Dimension, 'region' | 'departement' | null> = {
  region: 'region',
  departement: 'departement',
  commune: null,
  code_postal: null,
  arrondissement: null,
};

/** Les trois encodages, chacun avec son libellé (l.144-148) : basculer sans changer la légende mentirait. */
const ENCODAGES: { id: Encodage; label: string; aide: string }[] = [
  { id: 'part', label: 'Part %', aide: "Part des habitants de l'unité qui vivent en zone à risque" },
  { id: 'densite', label: 'Densité', aide: "Habitants exposés par km² d'unité" },
  { id: 'exposee', label: 'Effectif', aide: "Nombre d'habitants exposés — un grand territoire paraît plus intense" },
];

/**
 * ③ Couverture — le tableau des territoires, son exploration LOCALE et la mini-carte qui le suit. Portage de
 * `AnalysePopulationOverlay.tsx:1377-1572` (tableau, fil local, mini-carte) et `:771-890` (zones, valeurs).
 *
 * ── LE FILTRE DIT CE QU'ON ÉTUDIE, L'EXPLORATION CE QU'ON REGARDE ────────
 *
 * Descendre dans une région liste ses départements DANS CE TABLEAU, et nulle part ailleurs : ni le filtre Territoire,
 * ni l'URL, ni le bandeau KPI, ni la courbe ne bougent. Le second calcul ne part que pendant une exploration.
 *
 * ── LA MINI-CARTE LIT `bandesTableau`, JAMAIS LE CALCUL GLOBAL ──────────
 *
 * Défaut du 2026-09-22 : le tableau lisait l'exploré pendant que la carte lisait le global ; en descendant dans
 * l'Île-de-France, elle peignait « Aude 26,0 % » — la valeur de la RÉGION 11 posée sur le DÉPARTEMENT 11. Ici les
 * contours dessinés (`codesDessines`), les valeurs ET le verdict « encodage indisponible » viennent tous trois de
 * `bandesTableau`.
 *
 * ⚠ Empilés, et non côte à côte : mesuré à 480 px de panneau, une choroplèthe latérale laissait une vingtaine de
 * pixels au tableau.
 *
 * ⚠ L'état (exploration, encodage, palette) vit dans `DonneesRisqueService` : ce panneau se démonte sous le
 * `@switch` des étapes, React le garde à travers un aller-retour ② ↔ ③.
 */
@Component({
  selector: 'mg-etape-couverture',
  imports: [TableauCouvertureComponent, CarteMiniFranceComponent, PastilleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
  template: `
    <div class="min-w-0 flex-1 overflow-auto px-5 py-4">
      <mg-tableau-couverture [resultat]="bandesTableau()" [maille]="mailleTableau()" [profil]="donnees.profilCalcul()"
                             [libelleCible]="donnees.libelleCible()" [descendable]="descendable()"
                             [remontable]="remontable()" [actif]="actif()"
                             (descendre)="donnees.descendreExploration($event.code, $event.nom)"
                             (remonter)="donnees.remonterExploration()" (selection)="donnees.selectionner($event)"
                             (survol)="donnees.survoler($event)" />

      <!-- Le fil d'Ariane LOCAL : sans lui, on lirait des départements sans savoir de quelle région, pendant que la
           barre du haut annonce « France entière ». Mot pour mot de React (l.1441-1456). -->
      @if (exploration().length > 0) {
        <p data-role="fil-exploration" class="mb-0 mt-[10px] text-[11px] text-tertiary">
          Exploration :
          <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-teal"
                  (click)="donnees.quitterExploration()">{{ racine() }}</button>@for (s of exploration(); track s.code) {<span> › {{ s.nom }}</span>} — le filtre Territoire de la barre, lui, n’a pas bougé.
        </p>
      }
    </div>

    <!-- Mini-carte — SOUS le tableau (l.1460-1572). -->
    <aside data-role="mini-carte"
           class="flex max-h-[55%] shrink-0 flex-col gap-3 overflow-auto border-t-fin border-subtle px-[18px] py-4">
      <div class="flex gap-1">
        @for (e of encodages; track e.id) {
          <button mgPastille [actif]="donnees.encodage() === e.id" [title]="e.aide" [attr.data-encodage]="e.id"
                  (click)="donnees.encodage.set(e.id)">{{ e.label }}</button>
        }
      </div>

      @if (zones().length > 0) {
        <mg-carte-mini-france [zones]="zonesAffichees()" [valeurs]="valeursCarte()" [libelleValeur]="encodageCourant().label"
                              [formater]="formaterValeur()" [stops]="stops()"
                              [mode]="encodageEffectif() === 'exposee' ? 'cercles' : 'aplat'"
                              [codeActif]="actif()" [cadrageSur]="selectionCarte()"
                              (survol)="donnees.survoler($event)" (clic)="donnees.selectionner($event)" />

        <!-- Sélecteur de palette, repris TEL QUEL du panneau Carreaux : mêmes pastilles, même catalogue. -->
        <div class="mt-[2px] flex items-center gap-[6px]">
          <span class="text-[10px] text-tertiary">Palette</span>
          <div class="flex flex-wrap gap-1">
            @for (p of palettes; track p.id) {
              <button type="button" [title]="p.label" [attr.aria-pressed]="donnees.palette() === p.id"
                      [attr.data-palette]="p.id" (click)="donnees.palette.set(p.id)"
                      class="flex h-3 w-7 cursor-pointer overflow-hidden rounded-[3px] border-[1.5px] border-solid bg-transparent p-0"
                      [style.border-color]="donnees.palette() === p.id ? 'var(--text-primary)' : 'transparent'">
                @for (c of p.stops; track $index) { <span class="flex-1" [style.background]="c"></span> }
              </button>
            }
          </div>
        </div>
      } @else if (sansContours()) {
        <!-- Rien à charger à cette maille : on dit pourquoi, plutôt qu'un chargement qui tournerait sans fin. -->
        <p data-role="sans-carte" class="m-0 text-[11px] leading-[1.5] text-tertiary">
          Pas de carte à la maille commune : 34 921 polygones sur 300 px
          donneraient une bouillie de traits. Le classement ci-contre reste
          lisible, lui — c’est ce qu’on vient chercher ici.
        </p>
      } @else if (contoursIndisponibles()) {
        <!-- Échec du chargement : dit tel quel, et redemandé au prochain changement de maille (jamais gardé). -->
        <p data-role="contours-indisponibles" class="m-0 text-[11px] text-tertiary">Contours indisponibles</p>
      } @else {
        <p class="m-0 text-[11px] text-tertiary">Chargement des contours…</p>
      }

      @if (encodageIndisponible()) {
        <p data-role="encodage-indisponible" class="m-0 text-[10px] leading-[1.5] text-warning">
          Part et densité ne sont pas disponibles au code postal : aucun
          référentiel de population n’y est fiable — celui de La Poste
          recense 110,5 % de la population française. La carte affiche
          l’effectif.
        </p>
      }

      <p class="m-0 text-[10px] leading-[1.5] text-tertiary">
        {{ encodageCourant().aide }}. Le gris signale une unité <strong class="font-medium">sans
        aucune exposition</strong> — pas une valeur faible.
        <strong class="font-medium">Outre-mer : calculable pour la Martinique
        et La Réunion</strong>, dont l’INSEE publie le carroyage 200 m dans le même
        fichier que la métropole (26 022 carreaux, 1 190 910 habitants). Y compris leurs
        14 sites Seveso et 26 périmètres PPRT.
        <strong class="font-medium">La Guadeloupe, la Guyane et Mayotte ne sont
        pas carroyées par l’INSEE</strong> : leurs 603 sites, dont <strong class="font-medium">31
        Seveso — les 27 de Guyane compris</strong>, n’ont donc aucune population exposée
        calculable. Un site y apparaît sans chiffre : c’est une donnée absente à la source,
        pas une exposition nulle.
      </p>
    </aside>
  `,
})
export class EtapeCouvertureComponent {
  protected readonly donnees = inject(DonneesRisqueService);
  protected readonly encodages = ENCODAGES;
  protected readonly palettes = PALETTES_DONNEES;

  /** Les unités traversées par l'exploration. */
  readonly exploration = this.donnees.exploration;
  /** La maille réellement listée ET dessinée. */
  readonly mailleTableau = this.donnees.mailleTableau;
  /** Le résultat affiché : l'exploré s'il existe, sinon le global — la mini-carte lit CELUI-CI. */
  readonly bandesTableau = this.donnees.bandesTableau;
  /** L'unité survolée, partagée tableau ↔ mini-carte. */
  readonly actif = this.donnees.actif;
  /** L'unité sur laquelle la mini-carte se cadre. */
  readonly selectionCarte = this.donnees.selectionCarte;

  protected readonly descendable = computed(() => peutDescendre(this.mailleTableau()));
  protected readonly remontable = computed(() => peutRemonter(this.exploration()));
  /** Le premier lien du fil local : le territoire du FILTRE, d'où l'exploration est partie. */
  protected readonly racine = computed(() => this.donnees.chemin().at(-1)?.nom ?? 'France entière');

  /** L'échelle de contours de la maille LISTÉE ; `null` à la commune et au code postal (aucune requête). */
  private readonly echelle = computed(() => ZONES_DESSINEES[this.mailleTableau()]);
  protected readonly sansContours = computed(() => this.echelle() === null);
  /**
   * Le signal de contours de l'échelle courante, mis en cache PAR ÉCHELLE dans le service : basculer de maille ou
   * d'encodage ne redemande rien. Posé par un `effect` (le service souscrit : jamais dans un `computed`).
   */
  private readonly sourceContours = signal<Signal<ContoursMaille> | null>(null);
  protected readonly contoursIndisponibles = computed(() => this.sourceContours()?.() === 'indisponible');
  protected readonly zones = computed<ZoneGeo[]>(() => {
    const c = this.sourceContours()?.();
    return (Array.isArray(c) ? c : []) as unknown as ZoneGeo[];
  });

  constructor() {
    effect(() => {
      const e = this.echelle();
      this.sourceContours.set(e === null ? null : untracked(() => this.donnees.contours(e)));
    });
  }

  /** Les codes dessinés suivent le TABLEAU (l.771-798) : 8 départements quand on explore l'Île-de-France, pas 96. */
  protected readonly zonesAffichees = computed(() => {
    const zones = this.zones();
    const codes = codesDessines({
      chemin: this.donnees.chemin(),
      exploration: this.exploration(),
      mailleDessinee: this.mailleTableau(),
      unites: (this.bandesTableau().bandes?.unites ?? []).map((u) => u.unite),
      deptsParRegion: this.donnees.refGeo().deptsParRegion,
    });
    if (codes === null) return zones;
    const filtrees = zones.filter((z) => codes.has(z.properties.code));
    // Une carte vide se lirait comme une panne.
    return filtrees.length > 0 ? filtrees : zones;
  });

  /** Part et densité calculées ICI, depuis les deux dénominateurs bruts de la RPC, sur les unités du TABLEAU. */
  private readonly valeurs = computed(() => {
    const encodage = this.donnees.encodage();
    const m = new Map<string, number>();
    for (const u of this.bandesTableau().bandes?.unites ?? []) {
      const v = encodage === 'part'
        ? (u.pop_totale && u.pop_totale > 0 ? (u.total / u.pop_totale) * 100 : null)
        : encodage === 'densite'
          ? (u.surface_km2 && u.surface_km2 > 0 ? u.total / u.surface_km2 : null)
          : u.total;
      if (v !== null && Number.isFinite(v)) m.set(u.unite, v);
    }
    return m;
  });

  /**
   * Au code postal, part et densité sont NULLES (aucun dénominateur fiable) : on bascule sur l'effectif ET on le dit.
   * Les deux termes viennent de `bandesTableau`, sinon le verdict porterait sur deux ensembles différents.
   */
  protected readonly encodageIndisponible = computed(() => {
    const e = this.donnees.encodage();
    return (e === 'part' || e === 'densite')
      && (this.bandesTableau().bandes?.unites.length ?? 0) > 0
      && this.valeurs().size === 0;
  });
  protected readonly encodageEffectif = computed<Encodage>(() => (this.encodageIndisponible() ? 'exposee' : this.donnees.encodage()));

  protected readonly valeursCarte = computed(() => {
    if (!this.encodageIndisponible()) return this.valeurs();
    const m = new Map<string, number>();
    for (const u of this.bandesTableau().bandes?.unites ?? []) m.set(u.unite, u.total);
    return m;
  });

  protected readonly encodageCourant = computed(() => ENCODAGES.find((e) => e.id === this.encodageEffectif()) ?? ENCODAGES[0]);
  protected readonly formaterValeur = computed(() => {
    const e = this.encodageEffectif();
    return (v: number): string => (e === 'part' ? `${formaterNombre(v)} %`
      : e === 'densite' ? `${formaterNombre(v)} hab/km²`
      : formaterNombre(v));
  });
  protected readonly stops = computed(() => (PALETTES_DONNEES.find((p) => p.id === this.donnees.palette()) ?? PALETTES_DONNEES[0]).stops);
}
