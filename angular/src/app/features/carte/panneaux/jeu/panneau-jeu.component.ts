import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { EnteteSectionComponent } from '../../../../ui/entete-section/entete-section.component';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { ModePlanComponent } from '../../../risques/etapes/zones/mode-plan.component';
import type { ZoneCustomResume } from '../../data/zones-custom.api';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { ParcoursService } from '../../etat/parcours.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import { NOM_PLATEFORME } from '../../logique/jeu/ecran';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { PLATEFORMES, type Plateforme } from '../../logique/jeu/plateformes';
import { phraseMinimumMenages } from '../../logique/analyses/couverture';
import { refusActivation } from '../../logique/zones/recette';
import { ChoixCibleComponent } from '../analyse/choix-cible.component';
import { ChoixZoneAnalyseeComponent } from '../analyse/choix-zone-analysee.component';
import { ENCART_ERREUR } from '../analyse/styles-analyse';
import { BibliothequeJeuxComponent } from './bibliotheque-jeux.component';
import { ColonnePlateformeComponent } from './colonne-plateforme.component';
import { EnregistrerJeuComponent } from './enregistrer-jeu.component';
import { ExtractionsJeuComponent } from './extractions-jeu.component';

/** Largeur de panneau (px) à partir de laquelle les quatre colonnes tiennent côte à côte. */
const LARGEUR_COLONNES = 900;

/**
 * ⑤ Jeu de zones — le panneau de l'étape (lot 5, T10 ; spec § 16) : une zone enregistrée, traduite dans la maille
 * de CHAQUE plateforme, avec ce que la traduction perd. Aucun équivalent React (hors module risque).
 *
 * ── SOURCE ────────────────────────────────────────────────────────────────
 * `mg-choix-zone-analysee` de ④, RÉUTILISÉ (champ « Zone ») ; la zone analysée en ④ est PROPOSÉE, jamais prise
 * d'office (A-13). Quand la liste des zones nomme la zone choisie, sa recette et sa date de mise à jour passent à
 * `JeuZonesService.choisirZone` (exactitude, défauts, cache) ; une zone recalculée dans « Mes zones » fait relire la
 * liste (`relire`), et sa NOUVELLE date vide les conversions de l'ancienne forme, que l'effet redemande. La cible (`mg-choix-cible`, ④) et le mode de plan
 * (`mg-mode-plan`, module risque) se choisissent avant enregistrement ; un jeu ouvert garde sa zone et sa cible.
 *
 * ── UNE COLONNE PAR PLATEFORME ───────────────────────────────────────────
 * Côte à côte dès 900 px de panneau (largeur MESURÉE par un `ResizeObserver` sur l'hôte : la poignée du panneau
 * d'étape la change, pas la fenêtre) ; plus étroit, empilées, une seule dépliée. Seules les colonnes OUVERTES
 * demandent leur conversion (`valider`, effet unique) : une zone choisie ne lit que la maille de la colonne ouverte ;
 * l'effet repasse quand le registre arrive (T9) et quand un choix change — sans requête pour un seuil territorial
 * (calcul en mémoire), avec une requête au relâchement pour un cercle.
 *
 * ── AUCUNE LECTURE À L'OUVERTURE ─────────────────────────────────────────
 * Sans zone, rien ne part : ni registre, ni liste, ni couverture (P-h). Le panneau reste MONTÉ (P-e) et l'état vit
 * dans le service de la page : ⑤ → ① → ⑤ retrouve tout.
 *
 * Pied (T12) : enregistrer (`mg-enregistrer-jeu`), extraire (`mg-extractions-jeu`, jeu enregistré), bibliothèque des
 * jeux de l'espace (`mg-bibliotheque-jeux`, lue à sa première ouverture).
 */
@Component({
  selector: 'mg-panneau-jeu',
  imports: [
    BibliothequeJeuxComponent, ChoixCibleComponent, ChoixZoneAnalyseeComponent, ColonnePlateformeComponent, EnregistrerJeuComponent, EnteteSectionComponent,
    ExtractionsJeuComponent, KpiComponent, ModePlanComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col', 'data-panneau-jeu': '' },
  template: `
    <mg-entete-section libelle="Source" />
    <div class="flex flex-col gap-3 px-4 py-3">
      <mg-choix-zone-analysee libelle="Zone" [zoneId]="jeu.zoneId()" [proposee]="proposee()" [relire]="jeu.relectureZone()" [revision]="outils.revisionZones()" (choisie)="jeu.choisirZone($event)" (lue)="zoneLue($event)" />
      @if (jeu.zoneId() && (population() !== null || surface() !== null)) {
        <div data-forme class="font-mono text-[11px] text-secondary">{{ formeTexte() }}</div>
      }
      @if (jeu.zoneId() && minimumMenages(); as m) {
        <!-- A5 (ARB-4) : le minimum de ménages appliqué à la conversion et les carreaux qu'il écarte (avant / après). -->
        <div data-min-menages class="text-[11px] leading-[1.5] text-tertiary">{{ m }}</div>
      }
      @if (jeu.jeuId()) {
        <p class="m-0 text-[11px] leading-[1.5] text-tertiary">La zone et la cible d’un jeu enregistré ne changent pas : choisir une autre zone ouvre un nouveau jeu.</p>
      } @else {
        <mg-choix-cible [cible]="jeu.cible()" (choisie)="jeu.choisirCible($event)" />
      }
      <mg-mode-plan [mode]="jeu.modePlan()" (modeChange)="jeu.choisirMode($event)" />
      @if (jeu.erreur(); as e) { <div data-erreur-jeu role="alert" [class]="encartErreur">{{ e }}</div> }
    </div>

    @if (jeu.zoneId() && tropFin(); as t) {
      <!-- Décision du 02/11 : un rayon sous le minimum d'activation reste à l'analyse — aucune maille, aucun jeu, aucune extraction. -->
      <div class="px-4 pb-4"><div data-refus-activation role="alert" [class]="encartErreur">{{ t }}</div></div>
    } @else if (!jeu.zoneId()) {
      <p data-jeu-vide class="m-0 px-4 pb-4 text-[12px] leading-[1.6] text-tertiary">
        Aucune zone : choisissez une zone enregistrée, ou
        <button type="button" data-vers-zones (click)="parcours.choisir('zones')" class="cursor-pointer bg-transparent p-0 text-[12px] text-secondary underline hover:text-primary">créez-en une à l’étape ③</button>.
      </p>
    } @else {
      <div data-kpi-jeu class="flex flex-wrap gap-6 px-4 pb-3">
        <mg-kpi [taille]="22" [valeur]="nomZone()" libelle="zone" note="la forme exacte est la vérité" />
        <mg-kpi [taille]="22" [valeur]="reglees()" libelle="plateformes chiffrées" note="une maille choisie par plateforme" />
        <mg-kpi accent [taille]="22" [valeur]="meilleur().valeur" libelle="meilleur taux d’utile" [note]="meilleur().note" />
        <mg-kpi [taille]="22" [valeur]="version()" libelle="extraction" [note]="jeu.jeuId() ? 'version désignée' : 'jeu non enregistré'" />
      </div>
      <mg-entete-section libelle="Par plateforme" />
      <div data-colonnes class="gap-2 px-4 py-3" [class.grid]="large()" [class.grid-cols-4]="large()" [class.flex]="!large()" [class.flex-col]="!large()">
        @for (p of plateformes; track p) {
          <mg-colonne-plateforme [plateforme]="p" [ouverte]="large() || ouverte() === p" [repliable]="!large()" (basculer)="ouverte.set(p)" />
        }
      </div>
      <p data-reference class="m-0 px-4 pb-4 text-[11px] leading-[1.5] text-tertiary">Habitants carroyés (Filosofi 2021) ; la part rapporte chaque territoire à ses propres habitants carroyés.</p>
      <!-- T12 : enregistrer le jeu, puis l'extraire (un jeu enregistré seulement). -->
      <mg-entete-section libelle="Enregistrer et extraire" />
      <mg-enregistrer-jeu [nomPropose]="nomZone() === '—' ? '' : nomZone()" />
      @if (jeu.jeuId()) { <mg-extractions-jeu /> }
    }
    <mg-bibliotheque-jeux />
  `,
})
export class PanneauJeuComponent {
  protected readonly jeu = inject(JeuZonesService);
  protected readonly parcours = inject(ParcoursService);
  private readonly analyse = inject(ZoneAnalyseeService);
  /** `revisionZones` : une zone créée en ③ (ou supprimée) entre dans la liste de « Zone » à sa prochaine ouverture. */
  protected readonly outils = inject(OutilsCarteService);

  protected readonly plateformes = PLATEFORMES;
  protected readonly encartErreur = ENCART_ERREUR;
  /** Les colonnes tiennent côte à côte (mesure de l'hôte). */
  protected readonly large = signal(false);
  /** La colonne dépliée quand elles s'empilent. */
  protected readonly ouverte = signal<Plateforme>(PLATEFORMES[0]);
  /** La ligne de la liste pour la zone choisie (nom), tant que c'est la zone courante. */
  private readonly ligneZone = signal<ZoneCustomResume | null>(null);

  /** A-13 : la zone analysée en ④ est proposée tant qu'aucune zone n'est choisie ici. */
  protected readonly proposee = computed(() => (this.jeu.zoneId() ? null : this.analyse.zoneId()));
  /** Décision du 02/11 : le refus d'activer une zone de rayon trop fin (valeur dite), `null` sinon — même règle qu'au serveur. */
  protected readonly tropFin = computed(() => refusActivation(this.jeu.recette()));
  /** Les colonnes qui demandent leur conversion. */
  private readonly ouvertes = computed<readonly Plateforme[]>(() => (this.large() ? PLATEFORMES : [this.ouverte()]));

  /** Population et surface de la forme, lues dans n'importe quelle conversion déjà là (aucune requête de plus). */
  private readonly lecture = computed(() => Object.values(this.jeu.couvertures())[0] ?? null);
  protected readonly population = computed(() => this.lecture()?.population ?? Object.values(this.jeu.cercles())[0]?.population ?? null);
  protected readonly surface = computed(() => this.lecture()?.surface_km2 ?? null);
  /** A5 : la même cible pour toutes les conversions de la zone, donc le même minimum — lu dans n'importe laquelle. */
  protected readonly minimumMenages = computed(() => {
    const r = this.lecture() ?? Object.values(this.jeu.cercles())[0] ?? null;
    return r ? phraseMinimumMenages(r) : null;
  });
  protected readonly formeTexte = computed(() => [
    this.population() === null ? null : `${formaterNombre(this.population())} habitants carroyés`,
    this.surface() === null ? null : `${formaterNombre(Math.round(this.surface() ?? 0))} km²`,
  ].filter(Boolean).join(' · '));

  protected readonly nomZone = computed(() => {
    const ligne = this.ligneZone();
    return this.jeu.jeu()?.zone.nom ?? (ligne?.id === this.jeu.zoneId() ? ligne.name : null) ?? '—';
  });
  protected readonly reglees = computed(() => `${Object.keys(this.jeu.resumes()).length} / ${PLATEFORMES.length}`);
  protected readonly meilleur = computed(() => {
    let best: { p: Plateforme; t: number } | null = null;
    for (const p of PLATEFORMES) {
      const t = this.jeu.resumes()[p]?.resume.taux_utile ?? null;
      if (t !== null && (!best || t > best.t)) best = { p, t };
    }
    return best ? { valeur: `${formaterDecimal(best.t)} %`, note: NOM_PLATEFORME[best.p] } : { valeur: '—', note: 'aucune plateforme chiffrée' };
  });
  protected readonly version = computed(() => {
    const x = this.jeu.extraction();
    return x === null ? '—' : `v${x}`;
  });

  constructor() {
    // P-a : l'effet LIT la zone, sa date, les choix et les colonnes ouvertes ; `valider` (qui lit et écrit l'état) est
    // hors suivi. La date : une zone recalculée vide les conversions sans changer aucun choix — sans elle, rien ne repart.
    effect(() => {
      const ouvertes = this.ouvertes();
      // Une zone non activable ne demande aucune conversion (décision du 02/11).
      if (!this.jeu.zoneId() || this.tropFin()) return;
      this.jeu.maj();
      this.jeu.choix();
      this.jeu.cible();
      untracked(() => { for (const p of ouvertes) this.jeu.valider(p); });
    });
    const hote = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let observateur: ResizeObserver | null = null;
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      observateur = new ResizeObserver(([e]) => this.large.set((e?.contentRect.width ?? 0) >= LARGEUR_COLONNES));
      observateur.observe(hote);
    });
    inject(DestroyRef).onDestroy(() => observateur?.disconnect());
  }

  /** La liste nomme la zone : sa recette et sa date vont à l'état (un jeu ouvert porte déjà les siennes). */
  protected zoneLue(z: ZoneCustomResume): void {
    this.ligneZone.set(z);
    if (!this.jeu.jeuId() && z.id === this.jeu.zoneId()) this.jeu.choisirZone(z.id, z.recette ?? null, z.updated_at ?? null);
  }
}
