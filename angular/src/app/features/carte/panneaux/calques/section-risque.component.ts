import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { formaterNombre } from '../../../../core/format/nombre';
import { PARAM_RISQUE } from '../../../risques/etat/etat-risque.service';
import { NIVEAUX_RISQUE } from '../../../risques/logique/gravites';
import { LARGEUR_TRAIT_ZONE, TIRETE_ZONE_CALCULEE } from '../../../risques/logique/nature-zone';
import { PprtService } from '../../couches/pprt.service';
import { RisquesIndustrielsService } from '../../couches/risques-industriels.service';
import { RisqueCarteService } from '../../etat/risque-carte.service';
import { risqueDepuisCalques } from '../../logique/entree-module-risque';
import { LARGEUR_TRAIT_PPRT, LIBELLE_TYPE_ZONE_PPRT } from '../../logique/pprt';
import { JETON_TYPE, LIBELLE_TYPE, ORDRE_TYPES } from '../../logique/types-risque';
import { PPRT_ZOOM_PLANCHER } from '../../logique/versions';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { type ElementListe, ListeMultipleComponent } from '../filtre/liste-multiple.component';
import { SelectionsCalquesService } from './selections-calques.service';

/** Rayons proposés pour la zone calculée (`RisqueIndustrielSection.tsx:67`). 0 = aucune zone. */
const RAYONS = [0, 300, 500, 1000, 2000, 5000] as const;

/** Les trois familles de `pprt_perimetres.type_zone`, dans l'ordre de leur effectif mesuré (639 / 18 / 7). */
const TYPES_ZONE_PPRT = ['enveloppe', 'perimetre_reglemente', 'indetermine'] as const;

/**
 * Ce que porte la base, à une DATE (`RisqueIndustrielSection.tsx:276-285`) : l'API rend la vue courante, pas un
 * dénombrement national — dater est la seule honnêteté disponible. Mesuré le 19/09/2026.
 */
const RECENSEMENT = {
  date: '19/09/2026',
  icpe: 99152,
  seveso: 1327,
  sevesoSeuilHaut: 717,
  pprt: 664,
  departementsAvecPprt: 87,
  departementsConcernes: 88,
} as const;

/** Le tracé tel que MapLibre le dessine : plein = réglementaire, tireté = calculé (`nature-zone.ts`). */
@Component({
  selector: 'mg-trace-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'block w-5 shrink-0', '[style]': 'style()' },
  template: '',
})
export class TraceZoneComponent {
  readonly tirete = input.required<boolean>();
  protected readonly style = computed(() => this.tirete()
    ? {
      height: `${LARGEUR_TRAIT_ZONE}px`,
      // Motif DÉRIVÉ de `TIRETE_ZONE_CALCULEE`, la constante que MapLibre reçoit (R-13 de React).
      'background-image': `repeating-linear-gradient(to right, var(--text-secondary) 0 ${TIRETE_ZONE_CALCULEE[0]}px, transparent ${TIRETE_ZONE_CALCULEE[0]}px ${TIRETE_ZONE_CALCULEE[0] + TIRETE_ZONE_CALCULEE[1]}px)`,
    }
    : { height: '0', 'border-top': `${LARGEUR_TRAIT_PPRT}px solid var(--pprt-contour)` });
}

/** Carte d'une zone (`CarteZone`, `RisqueIndustrielSection.tsx:166-214`) : tracé, nom, valeur, case — enfants si cochée. */
@Component({
  selector: 'mg-carte-zone',
  imports: [TraceZoneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col gap-2 rounded-[8px] border-fin px-3 py-[10px] transition-[border-color,background-color] duration-200 ease-[var(--ease-out)]',
    '[style.border-color]': "actif() ? 'var(--brand-teal-30)' : 'var(--border-subtle)'",
    '[style.background-color]': "actif() ? 'var(--brand-teal-10)' : 'transparent'",
  },
  template: `
    <label class="flex cursor-pointer items-center gap-2">
      <mg-trace-zone [tirete]="tirete()" />
      <span class="flex min-w-0 flex-1 flex-col gap-px">
        <span class="text-[12px] font-medium text-primary">{{ titre() }}</span>
        <span class="text-[10px] leading-[1.35] text-tertiary">{{ sousTitre() }}</span>
      </span>
      <input type="checkbox" [checked]="actif()" (change)="basculer.emit($any($event.target).checked)"
        class="shrink-0 cursor-pointer accent-[var(--brand-teal)]" />
    </label>
    @if (actif()) {
      <ng-content />
    }
  `,
})
export class CarteZoneComponent {
  readonly tirete = input.required<boolean>();
  readonly titre = input.required<string>();
  readonly sousTitre = input.required<string>();
  readonly actif = input.required<boolean>();
  readonly basculer = output<boolean>();
}

/** Repli secondaire (`Repli`, `RisqueIndustrielSection.tsx:217-259`) : un réglage qu'on ouvre quand on en a besoin. */
@Component({
  selector: 'mg-repli-risque',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button type="button" (click)="ouvert.set(!ouvert())" [attr.aria-expanded]="ouvert()"
      class="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0 py-1 text-left text-[11px] text-secondary">
      <span aria-hidden="true" class="w-2 text-tertiary">{{ ouvert() ? '−' : '+' }}</span>
      <span class="flex-1">{{ titre() }}</span>
      @if (indice()) {
        <span class="font-mono text-[10px] text-tertiary">{{ indice() }}</span>
      }
    </button>
    @if (ouvert()) {
      <div class="flex flex-col gap-2 pb-1 pl-[14px] pt-1.5">
        <ng-content />
      </div>
    }
  `,
})
export class RepliRisqueComponent {
  readonly titre = input.required<string>();
  readonly indice = input<string | null>(null);
  protected readonly ouvert = signal(false);
}

/** « D'où viennent ces zones ? » (`ProvenanceDesZones`, `RisqueIndustrielSection.tsx:630-695`), chiffres datés. */
@Component({
  selector: 'mg-provenance-zones',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-0.5 block border-t-fin border-subtle pt-2' },
  template: `
    <button type="button" data-provenance (click)="ouvert.set(!ouvert())" [attr.aria-expanded]="ouvert()"
      class="cursor-pointer border-0 bg-transparent p-0 text-left text-[11px] text-teal">{{ ouvert() ? '− ' : '+ ' }}D'où viennent ces zones ?</button>
    @if (ouvert()) {
      <div class="mt-1.5 text-[10px] leading-[1.5] text-tertiary">
        <p class="mb-1.5 mt-0"><strong class="font-medium text-secondary">L'État ne publie pas de « rayon de risque » par site.</strong>
          Il produit une cascade : les zones d'effets de l'étude de dangers (seuils SEI, SEL, SELS), puis l'aléa du PPRT en sept
          niveaux, puis le zonage réglementaire (rouge, bleu, gris), puis l'enveloppe du périmètre.</p>
        <p class="mb-1.5 mt-0"><strong class="font-medium text-secondary">Seule la dernière est exploitable nationalement.</strong>
          Les zones d'effets ne sortent d'aucune API. Le zonage rouge/bleu n'existe qu'en image (WMS Géorisques) ou éparpillé,
          un jeu par DDT. L'enveloppe, elle, est un flux unique : 664 périmètres de servitude PM3, Géoplateforme IGN.</p>
        <p class="mb-1.5 mt-0"><strong class="font-medium text-secondary">Le PPRT ne concerne que le seuil haut.</strong>
          Mesuré le 18/09/2026 : 79 % des 717 sites Seveso seuil haut ont un périmètre, contre 20 % des 610 sites seuil bas —
          qui n'y sont pas soumis. 137 sites seuil haut n'en ont aucun de publié : c'est un vrai manque, pas une règle.</p>
        <p class="m-0"><strong class="font-medium text-secondary">Comment les distinguer à l'écran :</strong>
          trait plein = périmètre publié par l'État, opposable. Trait tireté = zone que dentsu.explore calcule à partir du rayon
          choisi ci-dessus, sans valeur réglementaire.</p>
      </div>
    }
  `,
})
export class ProvenanceZonesComponent {
  protected readonly ouvert = signal(false);
}

/**
 * La section « Zones à risque industriel » du groupe Environnement — portage de
 * `app/map/_components/filter-panel/RisqueIndustrielSection.tsx` (lot 4, T12).
 *
 * Elle répond à trois questions, dans cet ordre (décision de React, pas mise en page) : ce que je vois (combien de
 * sites, combien ont un périmètre réel), ce qui fait foi (le périmètre PPRT), ce que j'ajoute moi-même (la zone
 * calculée). Chaque carte porte son tracé : plein pour le réglementaire, tireté pour le calculé. Les réglages (niveau,
 * type, halo, sites à l'arrêt) descendent dans des replis.
 *
 * « Analyser la population à risque → » ouvre le module risque (T13) : route ENFANT de la carte (`risques`, B2), dont
 * l'état `?risque=` garde ce qui était déjà réglé et reçoit en `natures` les types cochés ici (`risqueDepuisCalques`,
 * B4) — React les passait en prop à l'overlay.
 *
 * Écarts, défauts React corrigés : la section s'ouvre ET se replie au premier clic (React : `sectionsOpen` sans clé
 * `risqueIndustriel`, `!undefined` = `true`, le premier clic ne repliait rien) ; un échec de lecture (sites, PPRT) est
 * dit ici (React : carte vide, rien d'écrit).
 */
@Component({
  selector: 'mg-section-risque',
  imports: [CarteZoneComponent, EnteteFiltreComponent, ListeMultipleComponent, ProvenanceZonesComponent, RepliRisqueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'block pb-1' },
  template: `
    @if (!integre()) {
      <mg-entete-filtre libelle="Zones à risque industriel" [ouvert]="ouvert()" [compte]="r.actif() ? r.niveaux().length : 0"
        (basculer)="basculerSection()" />
    }
    @if (ouvert()) {
      <div class="fondu flex flex-col gap-[10px] px-[14px] pb-3 pt-2" data-contenu-risque>
        <!-- 1. Ce que je vois -->
        <label class="flex cursor-pointer items-center gap-2">
          <input type="checkbox" data-sites-classes [checked]="r.actif()" (change)="r.actif.set($any($event.target).checked)"
            class="cursor-pointer accent-[var(--brand-teal)]" />
          <span class="text-[12px] text-primary">Afficher les sites classés</span>
        </label>

        @if (r.actif()) {
          @if (sites.erreur(); as e) {
            <div data-erreur-risque class="text-[11px] text-danger">{{ e }}</div>
          }
          @if (lecture(); as l) {
            <div class="flex flex-col gap-[5px]" data-compte-risque>
              <div class="font-mono text-[11px] text-primary">{{ l.rendus }} {{ l.mot }} dans la vue@if (l.tronque) {<span class="text-tertiary"> sur {{ l.total }}</span>}</div>
              @if (l.part !== null) {
                <div class="text-[11px] text-secondary">{{ l.avecPprt }} avec un périmètre réglementaire</div>
                <!-- La barre rend la proportion lisible sans lire le chiffre ; --donnee-absente pour le reste. -->
                <div role="img" [attr.aria-label]="l.part + ' % des sites de la vue ont un périmètre réglementaire'"
                  class="flex h-1 overflow-hidden rounded-[2px] bg-[var(--donnee-absente)]">
                  <span class="bg-teal" [style.width.%]="l.part"></span>
                </div>
                <div class="font-mono text-[10px] text-tertiary">{{ l.part }} % couverts par un PPRT</div>
              }
              @if (l.tronque) {
                <div class="text-[10px] leading-[1.4] text-tertiary">
                  Liste tronquée — les sites les moins graves sont coupés en premier, jamais un Seveso. Zoomez pour les voir tous.
                </div>
              }
            </div>
          }
        }

        <!-- 2. Ce qui fait foi : HORS du bloc « actif », couche indépendante. -->
        <mg-carte-zone data-carte-pprt [tirete]="false" titre="Périmètre PPRT" sousTitre="Publié par l’État · opposable en urbanisme"
          [actif]="r.pprtActif()" (basculer)="r.pprtActif.set($event)">
          @if (r.pprtEtat()?.sousLePlancher) {
            <div data-plancher-pprt class="text-[10px] leading-[1.4] text-warning">
              Zoomez au niveau {{ plancher }} pour voir les périmètres — plus loin, une zone mesure moins d'un pixel.
            </div>
          }
          @if (pprt.erreur(); as e) {
            <div data-erreur-pprt class="text-[10px] text-danger">{{ e }}</div>
          }
          <div data-etat-pprt class="font-mono text-[10px] text-tertiary">{{ etatPprt() }}</div>
          <div class="flex flex-col gap-1">
            <span class="mb-1.5 text-[11px] font-medium text-secondary">Nature du périmètre</span>
            <mg-liste-multiple data-liste="pprt" libelle="Toutes les natures" [items]="itemsPprt" [selection]="r.pprtTypes()"
              (changer)="r.pprtTypes.set($event)" />
          </div>
        </mg-carte-zone>

        <!-- 3. Ce que j'ajoute moi-même -->
        @if (r.actif()) {
          <mg-carte-zone data-carte-calculee [tirete]="true" titre="Zone calculée" sousTitre="Rayon choisi ci-dessous · aucune valeur réglementaire"
            [actif]="r.rayonM() > 0" (basculer)="r.rayonM.set($event ? 500 : 0)">
            <div class="flex flex-wrap gap-1">
              @for (rayon of rayons; track rayon.valeur) {
                <button type="button" [attr.data-rayon]="rayon.valeur" [attr.aria-pressed]="r.rayonM() === rayon.valeur"
                  (click)="r.rayonM.set(rayon.valeur)"
                  class="cursor-pointer rounded-[6px] border-fin px-2 py-1 font-mono text-[10px] transition-[background-color,border-color,color] duration-200 ease-[var(--ease-out)]"
                  [class]="r.rayonM() === rayon.valeur ? 'border-teal bg-teal-10 text-teal' : 'border-subtle bg-transparent text-secondary'">{{ rayon.libelle }}</button>
              }
            </div>
            <div class="text-[10px] leading-[1.4] text-tertiary">
              Calculé en mètres réels autour du point, dessiné en tireté ({{ tirete }}). Ce n'est pas le périmètre réglementaire d'un PPRT.
            </div>
          </mg-carte-zone>
        }

        <!-- L'analyse : APRÈS les deux cartes de zone, dont elle dépend. Ouvre le module risque, route enfant de la carte (B2),
             avec les types cochés ici devenus ses natures (B4) — on ne redemande pas ce à quoi on vient de répondre. -->
        <button type="button" data-analyser (click)="analyser()"
          class="flex w-full cursor-pointer items-center justify-center gap-[7px] rounded-[8px] border-fin border-teal bg-transparent px-3 py-[9px] text-[12px] font-medium text-teal transition-[background-color] duration-200 ease-[var(--ease-out)] hover:bg-teal-10">
          Analyser la population à risque
          <span aria-hidden="true">&rarr;</span>
        </button>

        <!-- Réglages -->
        @if (r.actif()) {
          <div class="border-t-fin border-subtle pt-1.5">
            <mg-repli-risque titre="Filtrer les sites" [indice]="indiceNiveaux()">
              <div class="flex flex-col gap-1">
                <span class="mb-1.5 text-[11px] font-medium text-secondary">Niveau réglementaire</span>
                <mg-liste-multiple data-liste="niveaux" libelle="Aucun niveau" [items]="itemsNiveaux" [selection]="r.niveaux()"
                  (changer)="r.niveaux.set($event)" />
                <span class="text-[10px] text-tertiary">{{ recensementSites }}</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="mb-1.5 text-[11px] font-medium text-secondary">Type de risque</span>
                <mg-liste-multiple data-liste="types" libelle="Tous les types" [items]="itemsTypes" [selection]="r.typesRisque()"
                  (changer)="r.typesRisque.set($event)" />
                <!-- Ce qui est retenu SANS ouvrir le menu, dans la couleur que la carte peint. -->
                <div class="mt-0.5 flex flex-wrap gap-x-[10px] gap-y-[3px]">
                  @for (p of pastilles(); track p.type) {
                    <span [attr.data-pastille-type]="p.type" class="flex items-center gap-[5px]" [style.opacity]="p.retenu ? 1 : 0.35">
                      <span class="size-2 shrink-0 rounded-full" [style.background]="p.couleur"></span>
                      <span class="text-[10px] text-secondary">{{ p.libelle }}</span>
                    </span>
                  }
                </div>
              </div>
              <label class="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" data-inactifs [checked]="r.inclureInactifs()" (change)="r.inclureInactifs.set($any($event.target).checked)"
                  class="cursor-pointer accent-[var(--brand-teal)]" />
                <span class="text-[11px] text-secondary">Inclure les sites à l'arrêt</span>
              </label>
            </mg-repli-risque>
            <mg-repli-risque titre="Affichage">
              <label class="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" data-halo [checked]="r.afficherHalo()" (change)="r.afficherHalo.set($any($event.target).checked)"
                  class="cursor-pointer accent-[var(--brand-teal)]" />
                <span class="text-[11px] text-secondary">Halo autour des points</span>
              </label>
              <span class="text-[10px] leading-[1.4] text-tertiary">
                Aide de lecture à faible zoom, où une zone de 500 m ferait moins d'un pixel. Ce n'est pas une mesure.
              </span>
            </mg-repli-risque>
          </div>
        }

        <mg-provenance-zones />
      </div>
    }
  `,
})
export class SectionRisqueComponent {
  private readonly selections = inject(SelectionsCalquesService);
  private readonly router = inject(Router);
  /** La route de la carte : le panneau vit dans `CartePage`, le module est son enfant. */
  private readonly route = inject(ActivatedRoute);
  protected readonly r = inject(RisqueCarteService);
  protected readonly sites = inject(RisquesIndustrielsService);
  protected readonly pprt = inject(PprtService);

  protected readonly plancher = PPRT_ZOOM_PLANCHER;
  protected readonly tirete = TIRETE_ZONE_CALCULEE.join('/');
  protected readonly rayons = RAYONS.filter((r) => r > 0).map((valeur) => ({
    valeur, libelle: valeur < 1000 ? `${valeur} m` : `${valeur / 1000} km`,
  }));
  protected readonly itemsPprt: ElementListe[] = TYPES_ZONE_PPRT.map((t) => ({ id: t, label: LIBELLE_TYPE_ZONE_PPRT[t] }));
  protected readonly itemsNiveaux: ElementListe[] = NIVEAUX_RISQUE.map((n) => ({ id: n.id, label: n.label }));
  protected readonly itemsTypes: ElementListe[] = ORDRE_TYPES.map((t) => ({ id: t, label: LIBELLE_TYPE[t] }));
  protected readonly recensementSites = `${formaterNombre(RECENSEMENT.seveso)} sites Seveso en France sur `
    + `${formaterNombre(RECENSEMENT.icpe)} installations classées — recensé le ${RECENSEMENT.date}.`;

  /** Rendue dans une ligne de ② (parcours, lot 2) : la ligne porte déjà le nom, l'en-tête interne n'est pas rendu et le contenu reste ouvert. */
  readonly integre = input(false);
  /** `sectionsOpen.risqueIndustriel !== false` : ouverte à l'ouverture du panneau, comme React. */
  protected readonly ouvert = computed(() => this.integre() || this.selections.sections()['risqueIndustriel'] !== false);
  protected readonly indiceNiveaux = computed(() => `${this.r.niveaux().length}/${NIVEAUX_RISQUE.length}`);

  /** Le compte mis en mots (`RisqueIndustrielSection.tsx:316-385`) ; `null` sans compte. */
  protected readonly lecture = computed(() => {
    const c = this.r.compte();
    if (!c) return null;
    return {
      rendus: formaterNombre(c.rendus),
      mot: c.rendus > 1 ? 'sites' : 'site',
      total: formaterNombre(c.total),
      tronque: c.rendus !== c.total,
      avecPprt: formaterNombre(c.avecPprt),
      // La part des sites visibles qui reposent sur une donnée de l'État.
      part: c.rendus > 0 ? Math.round((c.avecPprt / c.rendus) * 100) : null,
    };
  });

  /** La ligne d'état du PPRT (`RisqueIndustrielSection.tsx:417-423`). */
  protected readonly etatPprt = computed(() => {
    const e = this.r.pprtEtat();
    if (e && !e.sousLePlancher) {
      return e.rendus === e.total
        ? `${formaterNombre(e.rendus)} périmètre${e.rendus > 1 ? 's' : ''} dans la vue`
        : `${formaterNombre(e.rendus)} affichés sur ${formaterNombre(e.total)} — les plus petits sont coupés`;
    }
    return `${formaterNombre(RECENSEMENT.pprt)} périmètres · ${RECENSEMENT.departementsAvecPprt} départements sur `
      + `${RECENSEMENT.departementsConcernes} — recensé le ${RECENSEMENT.date}`;
  });

  /** Les pastilles des types : la couleur que la carte peint (`var(--risque-*)`, le DOM résout le jeton). */
  protected readonly pastilles = computed(() => {
    const types = this.r.typesRisque();
    return ORDRE_TYPES.map((t) => ({
      type: t,
      libelle: LIBELLE_TYPE[t],
      couleur: `var(--${JETON_TYPE[t]})`,
      retenu: types.length === 0 || types.includes(t),
    }));
  });

  /** Ouvre le module : `risques` relatif à la carte, le `?risque=` courant gardé, ses natures celles de Calques. */
  protected analyser(): void {
    const brut = this.route.snapshot.queryParamMap.get(PARAM_RISQUE);
    // `merge` : l'étape du parcours (`etape`) suit dans l'URL du module ; le `risque` passé ici l'emporte sur l'ancien.
    void this.router.navigate(['risques'], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      queryParams: { [PARAM_RISQUE]: risqueDepuisCalques(brut, this.r.typesRisque()) },
    });
  }

  protected basculerSection(): void {
    this.selections.sections.update((s) => ({ ...s, risqueIndustriel: s['risqueIndustriel'] === false }));
  }
}
