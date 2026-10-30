import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { injecterTiroirsAnalyse } from '../../etat/tiroirs-analyse';
import { formaterNombre } from '../../../../core/format/nombre';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { CouvertureService } from '../../couches/couverture.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import { dateFr } from '../../logique/analyses/commun';
import type { ZoneCustomResume } from '../../data/zones-custom.api';
import {
  CIBLE_PAR_DEFAUT, DECOUPAGES_ANALYSE, type DecoupageAnalyse, MESSAGES_REFUS_COUVERTURE, avertissementNonCarroye, libelleDecoupage, ligneHorsTerritoire, messageZoneVide,
  phraseReference,
} from '../../logique/analyses/couverture';
import { libellesPaliers } from '../../couches/couche-unites';
import { ChoixCibleComponent } from './choix-cible.component';
import { ChoixZoneAnalyseeComponent } from './choix-zone-analysee.component';
import { EnteteOutilComponent } from './entete-outil.component';
import { PastillesComponent } from './pastilles.component';
import {
  BOUTON_CALCUL, CORPS_ACCORDEON, ENCART_AVERTISSEMENT_LISIBLE, ENCART_ERREUR, LIBELLE_CHAMP, PASTILLE, PASTILLE_INACTIVE,
} from './styles-analyse';
import { PALIERS_CSS, TableauCouvertureZoneComponent } from './tableau-couverture-zone.component';

/**
 * ④ Analyse — l'outil « Couverture d'une zone » (lot 4, T8), en tête du panneau Analyse et ouvert par défaut : choisir
 * une zone enregistrée, la cible et le découpage, « Chiffrer la zone », lire les chiffres et les voir sur la carte
 * (`CouvertureService`). Sans équivalent React. Le bloc « Dans cette zone » (radio et trafic, T13) a été retiré le
 * 2026-10-26 (retours du 26/10, T5).
 *
 * ── HORS GARDE DE PÉRIMÈTRE ① ─────────────────────────────────────────────
 * La zone EST le périmètre : l'outil appelle `ZoneAnalyseeService.chiffrer()` lui-même, sans `verifierPerimetreOutil`.
 * La borne est côté serveur (≤ 100 000 km², ≤ 400 000 carreaux, 6/min) et revient en refus lisible. Déclaré dans
 * `tests/unit/angular/panneau-analyse-garde.test.ts`, comme la corrélation.
 *
 * ── AUCUNE LECTURE À L'OUVERTURE ──────────────────────────────────────────
 * Rien ne part avant « Chiffrer la zone ». Le catalogue des cibles est lu par `mg-choix-cible` à la première ouverture
 * du sélecteur — ou quand la cible venue de l'URL n'est pas la cible par défaut, pour la nommer (le panneau reste
 * monté, A1).
 *
 * ── Q-J : « HABITANTS CARROYÉS » PARTOUT ──────────────────────────────────
 * La phrase de référence (`phraseReference`) est la note du chiffre de tête ET suit le résultat dans les trois
 * découpages. Une zone sans carreau dit pourquoi (`messageZoneVide`) au lieu d'afficher « 0 ».
 */
@Component({
  selector: 'mg-outil-couverture',
  imports: [EnteteOutilComponent, PastillesComponent, ChoixCibleComponent, ChoixZoneAnalyseeComponent, KpiComponent, TableauCouvertureZoneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <mg-entete-outil titre="Couverture d’une zone" [ouvert]="ouvert()" (basculer)="tiroirs.basculer('couverture')" />
    @if (tiroirs.dejaOuvert('couverture')) {
      <div [class]="corps" [class.hidden]="!ouvert()" data-outil-couverture>
        <div class="text-[11px] leading-[1.5] text-tertiary">
          Combien de personnes de la cible vivent dans une zone enregistrée — telle quelle, ou territoire par territoire.
        </div>

        <mg-choix-zone-analysee [zoneId]="z.zoneId()" (choisie)="z.choisir($event)" (lue)="lue.set($event)" />

        <mg-choix-cible [cible]="z.cible()" (choisie)="z.regler({ cible: $event })" />

        <div>
          <div [class]="libelleChamp">Découpage</div>
          <mg-pastilles libelle="Découpage" [options]="decoupages" [valeur]="z.decoupage()" [inactives]="decoupagesInactifs()" (valeurChange)="z.regler({ decoupage: $event })" />
          @if (pays()) { <div data-iris-pays class="mt-1.5 text-[11px] leading-[1.5] text-tertiary">{{ irisPays }}</div> }
        </div>

        @if (z.erreur(); as e) { <div data-erreur role="alert" [class]="encartErreur">{{ e }}</div> }

        <button type="button" data-chiffrer [disabled]="!chiffrable()" (click)="z.chiffrer()" [class]="boutonCalcul">
          {{ z.enCours() ? 'Chiffrage…' : 'Chiffrer la zone' }}
        </button>
        @if (etape(); as e) {
          <div data-en-cours class="flex flex-col gap-1.5">
            <div role="progressbar" aria-busy="true" [attr.aria-label]="e.texte" class="relative h-[3px] overflow-hidden rounded-[2px] bg-overlay">
              <span class="curseur" aria-hidden="true"></span>
            </div>
            <div data-etape class="font-mono text-[11px] text-tertiary">{{ e.total > 1 ? 'Étape ' + e.n + '/' + e.total + ' · ' : '' }}{{ e.texte }}… {{ secondes() }} s</div>
          </div>
        }

        @if (z.resultat(); as r) {
          <div class="flex flex-col gap-[10px]" data-resultat>
            <!-- « Tout effacer » ou un autre dégradé ont retiré la couche : le chiffre reste, on le DIT (relecture T8, Q2). -->
            @if (c.masquee()) {
              <div data-couche-retiree class="flex items-center gap-2 text-[11px] text-tertiary">
                <span class="flex-1">Couche retirée de la carte.</span>
                <button type="button" data-afficher-couche (click)="c.afficher()" [class]="pastille + ' ' + pastilleInactive">Afficher sur la carte</button>
              </div>
            }
            @if (vide(); as v) {
              <div data-zone-vide [class]="encartAvertissement">{{ v }}</div>
              <div class="font-mono text-[11px] text-secondary">{{ nombre(surface()) }} km²</div>
            } @else {
              <div class="flex flex-wrap gap-6">
                <mg-kpi accent [taille]="22" [valeur]="nombre(r.population)" [libelle]="libelleTete()" [note]="reference()" />
                <mg-kpi [taille]="22" [valeur]="nombre(surface())" libelle="km²" note="surface de la zone" />
                @if (r.decoupage === 'forme') {
                  <mg-kpi [taille]="22" [valeur]="nombre(r.n_carreaux)" libelle="carreaux de 200 m" note="centre du carreau dans la zone" />
                } @else {
                  <mg-kpi [taille]="22" [valeur]="nombre(r.n_territoires)" [libelle]="r.decoupage === 'cp' ? 'codes postaux' : 'IRIS'" note="touchés par la zone" />
                }
              </div>
              @if (horsTerritoire(); as h) { <div data-hors-territoire class="text-[11px] leading-[1.5] text-secondary">{{ h }}</div> }
              @if (avertissement(); as a) { <div data-non-carroye [class]="encartAvertissement">{{ a }}</div> }
            }

            <p data-reference class="m-0 text-[11px] leading-[1.5] text-tertiary">
              {{ reference() }} : ménages fiscaux carroyés, pas la population légale.@if (r.decoupage !== 'forme') { La part rapporte chaque territoire à ses propres habitants carroyés.}
            </p>

            @if (r.decoupage !== 'forme' && r.lignes.length > 0) {
              @if (c.irisSousLeZoom()) { <div data-zoomer class="text-[11px] text-secondary">Zoomez pour voir les IRIS sur la carte (à partir du zoom 9).</div> }
              @if (c.contoursIndisponibles()) { <div class="text-[11px] text-tertiary">Contours indisponibles : le tableau reste juste, la carte ne montre que la zone.</div> }
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-tertiary" data-legende-part>
                <span>Part</span>
                @for (p of paliers; track $index) {
                  <span class="inline-flex items-center gap-1"><span class="inline-block size-2.5 rounded-[2px] border-fin border-[var(--text-tertiary)]" [style.background]="p.couleur"></span>{{ p.libelle }}</span>
                }
                <span class="inline-flex items-center gap-1"><span class="inline-block size-2.5 rounded-[2px] border-fin border-[var(--text-tertiary)] bg-[var(--donnee-absente)]"></span>sans total</span>
              </div>
              <mg-tableau-couverture-zone [lignes]="r.lignes" [decoupage]="r.decoupage" [actif]="c.survole()" (survol)="c.survoler($event)" />
            }

            <div data-calcule class="font-mono text-[10px] text-tertiary">Calculé le {{ date(r.calcule_le) }}@if (r.cache) { · en cache}</div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .curseur {
      position: absolute; top: 0; left: 0; height: 100%; width: 25%;
      background: var(--brand-teal);
      animation: glisse 1.1s ease-in-out infinite;
    }
    @keyframes glisse {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .curseur { animation: none; width: 100%; opacity: 0.45; }
    }
  `,
})
export class OutilCouvertureComponent {
  protected readonly z = inject(ZoneAnalyseeService);
  protected readonly c = inject(CouvertureService);
  /** Le sélecteur de cible : son libellé écrit le chiffre de tête. */
  private readonly choixCible = viewChild(ChoixCibleComponent);

  /**
   * Ouvert par défaut : c'est l'outil de tête de ④. Le panneau reste monté, l'état survit à ④ → ① → ④. Un tiroir de ④
   * (T7) : ouvrir un autre outil le replie. Replié, son corps est CACHÉ, pas détruit (A-12) : le choix de zone et le
   * sélecteur de cible lisent leurs listes une fois par composant — les détruire les ferait relire à la réouverture.
   */
  protected readonly tiroirs = injecterTiroirsAnalyse();
  protected readonly ouvert = computed(() => this.tiroirs.estOuvert('couverture'));

  protected readonly decoupages = DECOUPAGES_ANALYSE.map((d) => ({ cle: d, valeur: d, libelle: libelleDecoupage(d) }));
  protected readonly nombre = formaterNombre;
  protected readonly date = dateFr;
  protected readonly corps = CORPS_ACCORDEON;
  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly boutonCalcul = BOUTON_CALCUL;
  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly encartAvertissement = ENCART_AVERTISSEMENT_LISIBLE;
  protected readonly pastille = PASTILLE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  protected readonly paliers = libellesPaliers().map((libelle, i) => ({ couleur: PALIERS_CSS[i], libelle }));

  /** « habitants carroyés », ou « <cible> (carroyés) » : le chiffre de tête ne se lit jamais sans son dénominateur. */
  protected readonly libelleTete = computed(() => {
    const r = this.z.resultat();
    return r?.cible === CIBLE_PAR_DEFAUT ? 'habitants carroyés' : `${minusculeInitiale(this.choixCible()?.libelle() ?? r?.cible ?? '')} (carroyés)`;
  });
  protected readonly reference = computed(() => {
    const r = this.z.resultat();
    return r ? phraseReference(r) : '';
  });
  protected readonly vide = computed(() => {
    const r = this.z.resultat();
    return r ? messageZoneVide(r) : null;
  });
  protected readonly avertissement = computed(() => {
    const r = this.z.resultat();
    return r ? avertissementNonCarroye(r) : null;
  });
  protected readonly horsTerritoire = computed(() => {
    const r = this.z.resultat();
    return r ? ligneHorsTerritoire(r) : null;
  });
  protected readonly surface = computed(() => Math.round(this.z.resultat()?.surface_km2 ?? 0));

  /**
   * ④ finitions (T6, A-4) : la ligne de la zone choisie, rendue par `mg-choix-zone-analysee` (la liste qu'il lit déjà
   * pour la nommer : aucune lecture de plus). Une zone PAYS se reconnaît à sa recette : « Par IRIS » y est inactive
   * (48 872 lignes, refusé par la base sans lecture), et l'écran dit pourquoi.
   */
  protected readonly lue = signal<ZoneCustomResume | null>(null);
  protected readonly pays = computed(() => {
    const l = this.lue();
    return l !== null && l.id === this.z.zoneId() && l.recette?.type === 'pays';
  });
  protected readonly decoupagesInactifs = computed<readonly DecoupageAnalyse[]>(() => (this.pays() ? ['iris'] : []));
  protected readonly irisPays = MESSAGES_REFUS_COUVERTURE.decoupage_trop_fin_pays;
  /** Un lien arrivé sur « Par IRIS » ne chiffre pas une zone pays : la phrase est déjà à l'écran. */
  protected readonly chiffrable = computed(() => !!this.z.zoneId() && !this.z.enCours() && !(this.pays() && this.z.decoupage() === 'iris'));

  /**
   * L'étape en cours du chiffrage (retours du 26/10, arbitrage 1 de Vincent le 27/10 : ④ s'ouvre sur la couverture, une
   * barre de progression le temps du calcul). Le calcul est UN appel (`GET /api/zones/[id]/couverture`) sans avancement
   * intermédiaire : la barre est une barre d'attente, sans pourcentage inventé, qui nomme l'étape et le temps écoulé.
   * Par code postal, une deuxième étape suit : la lecture des contours CP (~3,8 Mo, une fois par page).
   */
  protected readonly etape = computed(() => {
    const total = this.z.decoupage() === 'cp' ? 2 : 1;
    if (this.z.enCours()) return { n: 1, total, texte: 'Calcul de la couverture' };
    if (this.z.resultat()?.decoupage === 'cp' && this.c.chargementContours()) return { n: 2, total, texte: 'Chargement des contours des codes postaux' };
    return null;
  });
  private readonly actif = computed(() => this.etape() !== null);
  /** Secondes depuis le début du chiffrage, les deux étapes comprises. */
  protected readonly secondes = signal(0);

  constructor() {
    effect((nettoyer) => {
      if (!this.actif()) return;
      const debut = Date.now();
      this.secondes.set(0);
      const t = setInterval(() => this.secondes.set(Math.floor((Date.now() - debut) / 1000)), 1000);
      nettoyer(() => clearInterval(t));
    });
  }
}

/** « Ménages pauvres » → « ménages pauvres » ; un sigle (« CSP+ ») garde ses capitales. */
function minusculeInitiale(s: string): string {
  return s.length > 1 && s[1] === s[1].toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
