import type { HttpResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked,
} from '@angular/core';
import type { Observable, Subscription } from 'rxjs';
import { formaterDecimal, formaterNombre, formaterNombreCourt } from '../../../../core/format/nombre';
import { CourbeComponent } from '../../../../graphiques/courbe.component';
import type { RepereCourbe, SerieCourbe } from '../../../../graphiques/option-courbe';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { type Extraction, JeuxZonesApi } from '../../data/jeux-zones.api';
import { SimulationApi } from '../../data/simulation.api';
import { type ReglagesSimulation, SimulationService } from '../../etat/simulation.service';
import { BoutonExportComponent } from '../../exports/bouton-export.component';
import { PARAMS_DEFAUT } from '../../logique/simulation/parametres';
import {
  LIBELLE_PERIODE, type Periode, type VueSimulation, constats, construireVue, etatSite,
} from '../../logique/simulation/vue';

/** Un réglage de la diffusion, ses bornes et son format (`PanneauCampagne.tsx:40-50`, MOT POUR MOT). */
interface Reglage {
  cle: keyof ReglagesSimulation;
  libelle: string;
  min: number;
  max: number;
  pas: number;
  format: (v: number) => string;
}

export const REGLAGES: readonly Reglage[] = [
  { cle: 'budget', libelle: 'Budget', min: 20_000, max: 1_000_000, pas: 10_000, format: (v) => `${formaterNombre(v)} €` },
  { cle: 'intensite', libelle: 'Effet inventaire', min: 1, max: 2.2, pas: 0.05, format: (v) => formaterDecimal(v, 2) },
  { cle: 'fuite', libelle: 'Fuite hors zone', min: 0, max: 0.15, pas: 0.005, format: (v) => `${formaterDecimal(v * 100, 1)} %` },
  { cle: 'bruit', libelle: 'Bruit journalier', min: 0, max: 0.5, pas: 0.02, format: (v) => `${formaterDecimal(v * 100, 0)} %` },
  { cle: 'amortissement', libelle: 'Force du recalage', min: 0, max: 1, pas: 0.05, format: (v) => `${formaterDecimal(v * 100, 0)} %` },
  { cle: 'graine', libelle: 'Graine', min: 1, max: 99_999, pas: 1, format: (v) => String(v) },
];

/** Les réglages initiaux (`PanneauCampagne.tsx:52-59`) : la graine ramenée sous le maximum du curseur. */
export const DEFAUTS: ReglagesSimulation = {
  budget: PARAMS_DEFAUT.budget,
  intensite: PARAMS_DEFAUT.intensite,
  fuite: PARAMS_DEFAUT.fuite,
  bruit: PARAMS_DEFAUT.bruit,
  amortissement: PARAMS_DEFAUT.amortissement,
  graine: PARAMS_DEFAUT.graine % 100_000,
};

const PERIODES: readonly Periode[] = ['v1', 'v2', 'tout'];
const pct = (x: number | null | undefined): string => (x == null ? '—' : `${formaterDecimal(x * 100, 1)} %`);

/** Les lignes du bilan avant / après (`Bilan`, `PanneauCampagne.tsx:327-360`). */
const LIGNES_BILAN: readonly [string, (v: VueSimulation) => string][] = [
  ['Alignement', (v) => (v.indicateurs.score == null ? 'non calculable' : String(Math.round(v.indicateurs.score)))],
  ['Part en zone', (v) => pct(v.indicateurs.part_en_zone)],
  ['Taux d’utile', (v) => pct(v.indicateurs.taux_utile_reel)],
  ['Coût par exposé touché', (v) => (v.indicateurs.cout_expose_touche == null ? '—' : `${formaterDecimal(v.indicateurs.cout_expose_touche, 3)} €`)],
];

const BOUTON = 'inline-flex items-center gap-[6px] rounded-[6px] border-fin bg-transparent px-3 py-[6px] text-[12px] font-medium';

/** Le style d'un bouton du panneau (`styleBouton`, `PanneauCampagne.tsx:537-546`) : teal s'il est principal. */
function classeBouton(principal: boolean, desactive: boolean): string {
  return `${BOUTON} ${principal ? 'border-teal text-teal' : 'border-default text-secondary'} ${desactive ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`;
}


/**
 * Le panneau de l'étape ⑤ Campagne — portage de `PanneauCampagne.tsx`.
 *
 * ── DE HAUT EN BAS, DANS L'ORDRE DU GESTE ─────────────────────────────────
 *
 * 1. **La campagne** : l'extraction qu'on fait diffuser, les réglages, puis Simuler, Recaler, Exporter, Purger.
 * 2. **La période** : v1, v2 ou la campagne entière — elle pilote TOUT l'écran, bandeau, carte et tableau compris.
 * 3. **L'alignement jour par jour**, avec le recalage annoté, et le bilan avant et après.
 * 4. **Ce qu'il faut corriger**, **les partenaires**, **les sites sous-servis**.
 *
 * ⚠ Aucun badge « Simulation » : arbitrage du 2026-09-24. Le drapeau vit en base (`dsp_campaigns.est_simulation`).
 *
 * Différence avec React, voulue (A8) : « Exporter en Excel » passe par `mg-bouton-export` (Bearer), là où React posait
 * un `<a href>` vers une route qui ne lit que l'en-tête `Authorization`.
 */
@Component({
  selector: 'mg-panneau-campagne',
  imports: [BoutonExportComponent, CourbeComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col gap-[18px] overflow-auto px-5 py-4' },
  template: `
    @if (jeuId() === null) {
      <div data-role="sans-jeu" class="flex flex-col gap-1">
        <p class="m-0 text-[12px] leading-[1.55] font-medium text-primary">Aucun jeu de zones ouvert</p>
        <p [class]="texte">Ouvrez un jeu enregistré à l’étape ④ Zones : la campagne diffuse sur le plan d’une de ses extractions.</p>
      </div>
    } @else {
      <section>
        <div [class]="entete"><span aria-hidden="true" [class]="point"></span><h3 [class]="titre">La campagne</h3></div>
        <div class="px-[2px]">
          @if (extractions()?.length === 0) {
            <div data-role="sans-extraction" class="flex flex-col gap-1">
              <p class="m-0 text-[12px] leading-[1.55] font-medium text-primary">Aucune extraction</p>
              <p [class]="texte">Extrayez d’abord le plan à l’étape ④ Zones (« Extractions pour le custom bidding ») : une campagne diffuse sur ce qui part au DSP, pas sur le jeu en cours de réglage.</p>
            </div>
          } @else {
            <div class="flex flex-col gap-[10px]">
              @if (sim(); as s) {
                <p data-role="resume" [class]="texte">Campagne de <strong [class]="fort">{{ s.jours }} jours</strong> depuis le {{ dateDebut() }}, diffusée sur la <strong [class]="fort">v{{ s.extraction_v1.version }}</strong>@if (s.extraction_v2; as v2) { puis, à partir du jour {{ s.jour_recalage }}, sur la <strong [class]="fort">v{{ v2.version }}</strong> recalée.} @else { — semaines 1 et 2. Recalez pour diffuser les semaines 3 et 4 sur un plan corrigé.}</p>
              }

              <div class="flex flex-wrap items-center gap-2">
                <label [class]="texte + ' flex items-center gap-[6px]'">
                  Extraction
                  <select data-role="extraction" (change)="choisirVersion($event)" [disabled]="occupe() || !extractions()"
                          class="rounded-[6px] border-fin border-subtle bg-elevated px-2 py-[5px] text-[12px] text-primary">
                    @for (e of optionsExtractions(); track e.id) {
                      <option [value]="e.version" [selected]="e.version === version()">{{ e.libelle }}</option>
                    }
                  </select>
                </label>
                <button type="button" data-role="simuler" (click)="simuler()" [disabled]="occupe() || version() === null"
                        [class]="boutonSimuler()">
                  <mg-icone nom="jouer" [taille]="12" />{{ sim() ? 'Relancer la simulation' : 'Simuler une campagne' }}
                </button>
              </div>

              <details>
                <summary [class]="texte + ' cursor-pointer'">Réglages de la diffusion</summary>
                <div class="mt-[10px] grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-4 gap-y-[10px]">
                  @for (r of reglagesAffiches(); track r.cle) {
                    <label class="flex flex-col gap-[3px]">
                      <span class="m-0 flex justify-between text-[11px] leading-[1.55] text-secondary">
                        <span>{{ r.libelle }}</span>
                        <span class="font-mono">{{ r.valeurTexte }}</span>
                      </span>
                      <input type="range" [attr.min]="r.min" [attr.max]="r.max" [attr.step]="r.pas" [value]="r.valeur"
                             [attr.aria-label]="r.libelle" [disabled]="occupe()" (input)="regler(r.cle, $event)"
                             class="accent-[var(--text-primary)]" />
                    </label>
                  }
                </div>
                <p [class]="note + ' mt-2'">L’effet inventaire dit combien l’offre publicitaire se concentre là où les gens vivent serrés. Aucun réglage ne fixe un score : l’alignement en découle.</p>
              </details>

              @if (sim(); as s) {
                <div class="flex flex-wrap gap-2">
                  @if (s.statut === 'v1') {
                    <button type="button" data-role="recaler" (click)="recaler()" [disabled]="occupe()" [class]="boutonPrincipal()">
                      <mg-icone nom="rafraichir" [taille]="12" />Recaler (v2)
                    </button>
                  }
                  <mg-bouton-export libelle="Exporter en Excel" nomRepli="simulation.xlsx" variante="panneau" [charger]="chargerExport" />
                  @if (confirmerPurge()) {
                    <button type="button" data-role="confirmer-purge" (click)="purger()" [disabled]="occupe()" [class]="boutonNeutre()">
                      <mg-icone nom="corbeille" [taille]="12" />Confirmer la purge
                    </button>
                    <button type="button" (click)="confirmerPurge.set(false)" [disabled]="occupe()" [class]="boutonNeutre()">Annuler</button>
                  } @else {
                    <button type="button" data-role="purger" (click)="confirmerPurge.set(true)" [disabled]="occupe()" [class]="boutonNeutre()">
                      <mg-icone nom="corbeille" [taille]="12" />Purger
                    </button>
                  }
                </div>
              }

              @if (progression(); as p) {
                <div role="status" data-role="progression" class="flex flex-col gap-1">
                  <div [class]="texte + ' flex justify-between gap-2'">
                    <span class="flex items-center gap-[6px]"><mg-icone nom="chargement" [taille]="12" class="animate-spin" /> {{ p.message }}</span>
                    @if (p.avancement; as a) {
                      <span data-role="pourcentage" class="font-mono">{{ a }}</span>
                    }
                  </div>
                  <div class="h-[3px] overflow-hidden rounded-[2px] bg-[var(--border-subtle)]">
                    <div class="h-full bg-teal transition-[width] duration-200 ease-out" [style.width.%]="p.pourcentage ?? 30"></div>
                  </div>
                </div>
              }
              @if (simulation.erreur(); as e) {
                <p role="alert" data-role="erreur" class="m-0 text-[12px] leading-[1.55] text-danger">{{ e }}</p>
              }
            </div>
          }
        </div>
      </section>

      @if (simulation.etat() === 'chargement' && !sim()) {
        <p data-role="lecture" [class]="texte + ' flex items-center gap-[6px]'"><mg-icone nom="chargement" [taille]="12" class="animate-spin" /> Lecture de la simulation…</p>
      }

      @if (sim(); as s) {
        @if (vue(); as v) {
          <section>
            <div [class]="entete"><span aria-hidden="true" [class]="point"></span><h3 [class]="titre">Période</h3></div>
            <div class="px-[2px]">
              <div role="group" aria-label="Période" class="flex flex-wrap gap-[2px]">
                @for (p of periodes; track p) {
                  <button type="button" (click)="simulation.periode.set(p)" [disabled]="p === 'v2' && s.statut !== 'v2'"
                          [attr.aria-pressed]="v.periode === p" [attr.title]="p === 'v2' && s.statut !== 'v2' ? 'Recalez d’abord la campagne' : null"
                          class="cursor-pointer rounded-[6px] border-fin border-default px-[10px] py-[5px] text-[11px]"
                          [class.opacity-[0.45]]="p === 'v2' && s.statut !== 'v2'"
                          [class.bg-teal-10]="v.periode === p" [class.text-teal]="v.periode === p"
                          [class.bg-transparent]="v.periode !== p" [class.text-secondary]="v.periode !== p">{{ libellePeriode[p] }}</button>
                }
              </div>
              @if (simulation.periode() === 'v2' && s.statut !== 'v2') {
                <p [class]="note">Pas encore de semaines 3 et 4 : l’écran montre la v1.</p>
              }
            </div>
          </section>

          <section>
            <div [class]="entete"><span aria-hidden="true" [class]="point"></span><h3 [class]="titre">Alignement jour par jour</h3></div>
            <div class="px-[2px]">
              @if (simulation.courbe().length === 0) {
                <p [class]="note">Aucun jour diffusé.</p>
              } @else {
                <mg-courbe libelle="Alignement jour par jour, sur la population exposée" [series]="seriesCourbe()" [hauteur]="180"
                           [legende]="false" [repere]="repere()" [domaineX]="domaineX()" [graduationsX]="graduationsX()"
                           [domaineY]="[0, 100]" [graduationsY]="[0, 25, 50, 75, 100]" [marges]="marges" [grillePleine]="true"
                           jetonFondInfobulle="bg-level-2" [formaterX]="formaterJour" [formaterY]="formaterScore"
                           [formaterTitre]="formaterTitre" [formaterValeur]="formaterArrondi" />
              }
              @if (bilan(); as b) {
                <table data-role="bilan" class="mt-[10px] w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      <th [class]="th + ' text-left'">Bilan</th>
                      <th [class]="th + ' text-right'">Semaines 1-2 · v1</th>
                      <th [class]="th + ' text-right'">Semaines 3-4 · v2</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (l of b; track l.nom) {
                      <tr>
                        <td [class]="td + ' text-left'">{{ l.nom }}</td>
                        <td [class]="td + ' text-right font-mono'">{{ l.v1 }}</td>
                        <td [class]="td + ' text-right font-mono'">{{ l.v2 }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </div>
          </section>

          <section>
            <div [class]="entete"><span aria-hidden="true" [class]="point"></span><h3 [class]="titre">Ce qu’il faut corriger</h3></div>
            <div class="px-[2px]" data-role="corriger">
              @if (corriger(); as c) {
                @if (c.aucun) {
                  <p [class]="texte">Toutes les zones tiennent leur plan à 10 % près sur cette période.</p>
                } @else {
                  <div class="flex flex-col gap-2">
                    @if (c.sur; as sur) {
                      <p [class]="texte"><strong [class]="fort">Sur-pression</strong> · {{ sur.noms }}. <span class="font-mono">{{ sur.impressions }}</span> impressions, soit <span class="font-mono">{{ sur.euros }} €</span>, à redéployer.</p>
                    }
                    @if (c.sous; as sous) {
                      <p [class]="texte"><strong [class]="fort">Sous-pression</strong> · {{ sous.noms }}. Il manque <span class="font-mono">{{ sous.impressions }}</span> impressions pour tenir le plan, soit <span class="font-mono">{{ sous.euros }} €</span>.</p>
                    }
                    @if (c.dilues; as d) {
                      <p [class]="texte"><strong [class]="fort">Codes postaux les plus dilués</strong> · {{ d }}. Chaque impression y touche surtout des habitants hors zone.</p>
                    }
                  </div>
                }
              }
            </div>
          </section>

          <section>
            <div [class]="entete"><span aria-hidden="true" [class]="point"></span><h3 [class]="titre">Partenaires</h3></div>
            <div class="px-[2px]">
              <table data-role="partenaires" class="w-full border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th [class]="th + ' text-left'">Partenaire</th>
                    <th [class]="th + ' text-right'">Impressions</th>
                    <th [class]="th + ' text-right'">CPM</th>
                    <th [class]="th + ' text-right'">Part en zone</th>
                    <th [class]="th + ' text-right'">Taux d’utile</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of partenaires(); track p.nom) {
                    <tr>
                      <td [class]="td + ' text-left'">{{ p.nom }}</td>
                      <td [class]="td + ' text-right font-mono'">{{ p.impressions }}</td>
                      <td [class]="td + ' text-right font-mono'">{{ p.cpm }}</td>
                      <td [class]="td + ' text-right font-mono'">{{ p.partEnZone }}</td>
                      <td [class]="td + ' text-right font-mono'">{{ p.tauxUtile }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div [class]="entete"><span aria-hidden="true" [class]="point"></span><h3 [class]="titre">Sites sous-servis</h3></div>
            <div class="px-[2px]" data-role="sous-servis">
              @if (sousServis(); as ss) {
                @if (ss.zones.length === 0) {
                  <p [class]="texte">Tous les sites reçoivent au moins 90 % de leur part.</p>
                } @else {
                  <div class="flex flex-col gap-[6px]">
                    <p [class]="texte"><span class="font-mono">{{ ss.nSites }}</span> sites dans <span class="font-mono">{{ ss.nBassins }}</span> bassins reçoivent moins de 90 % de leur part du plan. Sur la carte, leurs points sont rouges (sous 50) ou orange.</p>
                    <ul class="m-0 flex flex-col gap-[2px] pl-4">
                      @for (z of ss.zones; track z.id) {
                        <li [class]="texte"><button type="button" (click)="simulation.zoneActive.set(z.id)"
                                class="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-teal">{{ z.nom }}</button> · {{ z.sites }} · indice <span class="font-mono">{{ z.indice }}</span></li>
                      }
                    </ul>
                  </div>
                }
              }
            </div>
          </section>
        }
      }

      @if (sim() === null && simulation.etat() === 'pret' && (extractions()?.length ?? 0) > 0) {
        <p data-role="aucune-simulation" [class]="note">Aucune campagne simulée sur ce jeu. Choisissez une extraction et lancez la simulation : les semaines 1 et 2 diffusent sur son plan, avec l’effet inventaire qui pousse vers les zones denses.</p>
      }
    }
  `,
})
export class PanneauCampagneComponent {
  protected readonly simulation = inject(SimulationService);
  private readonly jeuxApi = inject(JeuxZonesApi);
  private readonly simulationApi = inject(SimulationApi);

  protected readonly texte = 'm-0 text-[12px] leading-[1.55] text-secondary';
  protected readonly note = 'm-0 text-[11px] leading-[1.55] text-tertiary';
  protected readonly fort = 'font-medium text-primary';
  protected readonly entete = 'mb-3 flex items-center gap-2 border-t border-subtle bg-elevated px-[14px] py-[10px]';
  protected readonly point = 'size-[6px] shrink-0 rounded-full bg-teal';
  protected readonly titre = 'm-0 text-[12px] font-medium text-primary';
  protected readonly th = 'whitespace-nowrap border-b-fin border-default px-[6px] py-[5px] font-normal text-tertiary';
  protected readonly td = 'whitespace-nowrap border-b-fin border-subtle px-[6px] py-[5px] text-primary';
  protected readonly periodes = PERIODES;
  protected readonly libellePeriode = LIBELLE_PERIODE;

  protected readonly jeuId = this.simulation.jeu;
  protected readonly sim = computed(() => this.simulation.reponse()?.simulation ?? null);
  protected readonly vue = this.simulation.vue;

  /** Les extractions du jeu : `null` tant qu'elles n'ont pas été lues. */
  protected readonly extractions = signal<Extraction[] | null>(null);
  protected readonly version = signal<number | null>(null);
  protected readonly reglages = signal<ReglagesSimulation>(DEFAUTS);
  protected readonly confirmerPurge = signal(false);
  protected readonly occupe = computed(() => this.simulation.progression() !== null);
  protected readonly boutonPrincipal = computed(() => classeBouton(true, this.occupe()));
  protected readonly boutonNeutre = computed(() => classeBouton(false, this.occupe()));
  protected readonly boutonSimuler = computed(() => classeBouton(true, this.occupe() || this.version() === null));

  protected readonly optionsExtractions = computed(() => (this.extractions() ?? []).map((e) => ({
    id: e.id,
    version: e.version,
    libelle: `v${e.version} · ${e.origine === 'recalage' ? 'recalage' : 'initiale'} · ${formaterNombre(e.n_retenus)} CP`,
  })));

  /** La barre du geste en cours : « 37 % · 31 000 / 83 977 lignes », rien quand l'avancement n'est pas mesurable. */
  protected readonly progression = computed(() => {
    const p = this.simulation.progression();
    if (!p) return null;
    const lignes = p.faites != null && p.total != null ? ` · ${formaterNombre(p.faites)} / ${formaterNombre(p.total)} lignes` : '';
    return { message: p.message, pourcentage: p.pourcentage, avancement: p.pourcentage === null ? null : `${p.pourcentage} %${lignes}` };
  });

  protected readonly reglagesAffiches = computed(() => {
    const g = this.reglages();
    return REGLAGES.map((r) => ({ ...r, valeur: g[r.cle], valeurTexte: r.format(g[r.cle]) }));
  });

  protected readonly dateDebut = computed(() => {
    const s = this.sim();
    return s ? new Date(`${s.date_debut}T00:00:00Z`).toLocaleDateString('fr-FR') : '';
  });

  /** « Exporter en Excel » : le classeur de la simulation, lu au clic (A8). */
  protected readonly chargerExport = (): Observable<HttpResponse<Blob>> =>
    this.simulationApi.exportSimulation(this.jeuId()!);

  // ── La courbe : deux séries et non une colorée par segment — la rupture EST l'information. ──
  protected readonly seriesCourbe = computed<SerieCourbe[]>(() => {
    const pts = this.simulation.courbe();
    return [
      { cle: 'v1', libelle: 'Alignement', jeton: 'diverge-sous-2', epaisseur: 2, marqueurs: true, points: pts.map((p) => [p.jour, p.version === 1 ? p.score : null] as const) },
      { cle: 'v2', libelle: 'Alignement', jeton: 'brand-teal', epaisseur: 2, marqueurs: true, points: pts.map((p) => [p.jour, p.version === 2 ? p.score : null] as const) },
    ];
  });
  protected readonly repere = computed<RepereCourbe | undefined>(() => {
    const s = this.sim();
    return s ? { x: s.jour_recalage, libelle: 'Recalage v2', jeton: 'text-tertiary', jetonLibelle: 'text-secondary' } : undefined;
  });
  protected readonly domaineX = computed<readonly [number, number]>(() => [1, this.sim()?.jours ?? 1]);
  protected readonly graduationsX = computed(() => [1, 7, 14, 21, 28].filter((t) => t <= (this.sim()?.jours ?? 0)));
  /** Recharts : marge {14, 8, 0, −18}, axe Y de 60 px (−18 + 60 = 42), axe X de 30 px. */
  protected readonly marges = { top: 14, right: 8, bottom: 30, left: 42 };
  protected readonly formaterJour = (v: number): string => `j${v}`;
  protected readonly formaterScore = (v: number): string => String(v);
  protected readonly formaterTitre = (v: number): string => `Jour ${v}`;
  protected readonly formaterArrondi = (v: number): string => String(Math.round(v));

  /** Le bilan avant / après, TOUJOURS sur v1 et v2, quelle que soit la période choisie. */
  protected readonly bilan = computed(() => {
    const r = this.simulation.reponse();
    const a = r ? construireVue(r, 'v1') : null;
    if (!r || !a) return null;
    const b = r.simulation?.statut === 'v2' ? construireVue(r, 'v2') : null;
    return LIGNES_BILAN.map(([nom, f]) => ({ nom, v1: f(a), v2: b ? f(b) : '—' }));
  });

  protected readonly corriger = computed(() => {
    const v = this.vue();
    const entrees = this.simulation.reponse()?.entrees;
    if (!v || !entrees) return null;
    const c = constats(v, entrees);
    type Ligne = (typeof c.sur)[number];
    const noms = (l: Ligne[]) => l.map((z) => `${z.nom} (${Math.round(z.indice)})`).join(', ');
    const somme = (l: Ligne[], k: 'impressions' | 'euros') => l.reduce((t, z) => t + z[k], 0);
    const bloc = (l: Ligne[]) => (l.length === 0 ? null : {
      noms: noms(l),
      impressions: formaterNombreCourt(Math.round(somme(l, 'impressions'))),
      euros: formaterNombre(Math.round(somme(l, 'euros'))),
    });
    return {
      aucun: c.sur.length === 0 && c.sous.length === 0,
      sur: bloc(c.sur),
      sous: bloc(c.sous),
      dilues: c.dilues.length === 0 ? null
        : c.dilues.map((d) => `${d.code_postal} (${formaterDecimal(d.part_en_zone, 1)} % d’exposés)`).join(', '),
    };
  });

  protected readonly partenaires = computed(() => (this.vue()?.partenaires ?? []).map((p) => ({
    nom: p.nom,
    impressions: formaterNombreCourt(p.impressions),
    cpm: p.cpm == null ? '—' : `${formaterDecimal(p.cpm, 2)} €`,
    partEnZone: pct(p.part_en_zone),
    tauxUtile: pct(p.taux_utile),
  })));

  protected readonly sousServis = computed(() => {
    const v = this.vue();
    if (!v) return null;
    const sous = v.zones
      .filter((z) => z.part_plan > 0 && etatSite(z.indice) !== 'servi')
      .sort((a, b) => (a.indice ?? 0) - (b.indice ?? 0));
    return {
      nSites: formaterNombre(sous.reduce((t, z) => t + z.n_sites, 0)),
      nBassins: formaterNombre(sous.length),
      zones: sous.slice(0, 8).map((z) => ({
        id: z.id,
        nom: z.nom,
        sites: `${formaterNombre(z.n_sites)} site${z.n_sites > 1 ? 's' : ''}`,
        indice: z.indice == null ? '—' : String(Math.round(z.indice)),
      })),
    };
  });

  private abonnementExtractions: Subscription | null = null;

  constructor() {
    // Les extractions du jeu : relues quand la simulation change, puisqu'un recalage en crée une
    // (`PanneauCampagne.tsx:71-88`, dépendances `[jeuId, sim?.id, sim?.statut]`).
    const cle = computed(() => {
      const s = this.sim();
      return { jeu: this.jeuId(), id: s?.id ?? null, statut: s?.statut ?? null };
    }, { equal: (a, b) => a.jeu === b.jeu && a.id === b.id && a.statut === b.statut });
    effect(() => {
      const { jeu } = cle();
      untracked(() => this.lireExtractions(jeu));
    });
    inject(DestroyRef).onDestroy(() => this.abonnementExtractions?.unsubscribe());
  }

  private lireExtractions(jeu: string | null): void {
    this.abonnementExtractions?.unsubscribe();
    if (!jeu) {
      this.extractions.set(null);
      return;
    }
    this.abonnementExtractions = this.jeuxApi.extractions(jeu).subscribe({
      next: (d) => {
        const liste = d?.extractions ?? [];
        this.extractions.set(liste);
        // Par défaut, la dernière extraction INITIALE : une v2 de recalage est un produit de simulation, pas un plan
        // qu'on a décidé.
        this.version.update((v) => v ?? liste.find((e) => e.origine === 'initiale')?.version ?? liste[0]?.version ?? null);
      },
      // Comme React : une liste illisible se lit « aucune extraction ».
      error: () => this.extractions.set([]),
    });
  }


  protected choisirVersion(ev: Event): void {
    this.version.set(Number((ev.target as HTMLSelectElement).value));
  }

  protected regler(cle: keyof ReglagesSimulation, ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value);
    this.reglages.update((g) => ({ ...g, [cle]: v }));
  }

  protected simuler(): void {
    const v = this.version();
    if (v !== null) void this.simulation.simuler(v, this.reglages());
  }

  protected recaler(): void {
    void this.simulation.recaler();
  }

  protected purger(): void {
    this.confirmerPurge.set(false);
    void this.simulation.purger();
  }
}
