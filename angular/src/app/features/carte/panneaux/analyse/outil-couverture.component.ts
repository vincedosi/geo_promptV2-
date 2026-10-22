import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { type Cible, ProfilRisqueApi } from '../../../risques/data/profil-risque.api';
import { CouvertureService } from '../../couches/couverture.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import { dateFr, messageErreurRequete } from '../../logique/analyses/commun';
import {
  CIBLE_PAR_DEFAUT, DECOUPAGES, avertissementNonCarroye, libelleDecoupage, ligneHorsTerritoire, messageZoneVide,
  phraseReference,
} from '../../logique/analyses/couverture';
import { BORNES_PART } from '../../couches/couche-couverture';
import { ChoixZoneAnalyseeComponent } from './choix-zone-analysee.component';
import {
  BOUTON_CALCUL, CORPS_ACCORDEON, ENCART_AVERTISSEMENT, ENCART_ERREUR, ENTETE_ACCORDEON, LIBELLE_CHAMP, PASTILLE, PASTILLE_INACTIVE,
  PASTILLE_PRIMAIRE_ACTIVE,
} from './styles-analyse';
import { PALIERS_CSS, TableauCouvertureZoneComponent } from './tableau-couverture-zone.component';

/** Le libellé de la cible par défaut tant que le catalogue n'est pas lu (`cibles_exposition`, rang 1). */
const LIBELLE_CIBLE_DEFAUT = 'Population totale';

/**
 * ④ Analyse — l'outil « Couverture d'une zone » (lot 4, T8), en tête du panneau Analyse et ouvert par défaut : choisir
 * une zone enregistrée, la cible et le découpage, « Chiffrer la zone », lire les chiffres et les voir sur la carte
 * (`CouvertureService`). Sans équivalent React.
 *
 * ── HORS GARDE DE PÉRIMÈTRE ① ─────────────────────────────────────────────
 * La zone EST le périmètre : l'outil appelle `ZoneAnalyseeService.chiffrer()` lui-même, sans `verifierPerimetreOutil`.
 * La borne est côté serveur (≤ 100 000 km², ≤ 400 000 carreaux, 6/min) et revient en refus lisible. Déclaré dans
 * `tests/unit/angular/panneau-analyse-garde.test.ts`, comme la corrélation.
 *
 * ── AUCUNE LECTURE À L'OUVERTURE ──────────────────────────────────────────
 * Rien ne part avant « Chiffrer la zone ». Le catalogue des cibles (`GET /api/risques/exposition/cibles`) est lu à la
 * première ouverture du sélecteur de cible — ou quand la cible venue de l'URL n'est pas la cible par défaut, pour la
 * nommer —, une fois par composant (le panneau reste monté, A1).
 *
 * ── Q-J : « HABITANTS CARROYÉS » PARTOUT ──────────────────────────────────
 * La phrase de référence (`phraseReference`) est la note du chiffre de tête ET suit le résultat dans les trois
 * découpages. Une zone sans carreau dit pourquoi (`messageZoneVide`) au lieu d'afficher « 0 ».
 */
@Component({
  selector: 'mg-outil-couverture',
  imports: [ChoixZoneAnalyseeComponent, KpiComponent, TableauCouvertureZoneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button type="button" data-entete-outil [attr.aria-expanded]="ouvert()" (click)="ouvert.set(!ouvert())" [class]="entete">
      <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
      <span class="flex-1 text-left text-[12px] font-medium text-primary">Couverture d’une zone</span>
      <span class="text-[10px] text-tertiary">{{ ouvert() ? '▲' : '▼' }}</span>
    </button>
    @if (ouvert()) {
      <div [class]="corps" data-outil-couverture>
        <div class="text-[11px] leading-[1.5] text-tertiary">
          Combien de personnes de la cible vivent dans une zone enregistrée — telle quelle, ou territoire par territoire.
        </div>

        <mg-choix-zone-analysee [zoneId]="z.zoneId()" (choisie)="z.choisir($event)" />

        <div data-choix-cible>
          <div [class]="libelleChamp">Cible</div>
          @if (!cibleOuverte()) {
            <button type="button" data-ouvrir-cible (click)="ouvrirCibles()" [class]="pastille + ' ' + pastilleInactive">{{ libelleCible() }} ▾</button>
          } @else {
            @if (chargementCibles()) { <div class="font-mono text-[11px] text-tertiary">Chargement…</div> }
            @if (erreurCibles(); as e) { <div class="text-[11px] text-danger" role="alert">{{ e }}</div> }
            <div class="flex max-h-[220px] flex-col gap-2 overflow-y-auto" data-liste-cibles>
              @for (g of familles(); track g.famille) {
                <div>
                  <div class="mb-1 text-[10px] text-tertiary">{{ g.famille }}</div>
                  <div class="flex flex-wrap gap-[5px]">
                    @for (c of g.cibles; track c.code) {
                      <button type="button" [attr.data-cible]="c.code" [attr.aria-pressed]="c.code === z.cible()" (click)="choisirCible(c.code)"
                        [class]="pastille + ' ' + (c.code === z.cible() ? pastilleActive : pastilleInactive)">{{ c.libelle }}</button>
                    }
                  </div>
                </div>
              }
            </div>
            <button type="button" data-fermer-cible (click)="cibleOuverte.set(false)" [class]="pastille + ' ' + pastilleInactive + ' mt-1.5'">Fermer</button>
          }
        </div>

        <div>
          <div [class]="libelleChamp">Découpage</div>
          <div class="flex gap-[5px]" role="group" aria-label="Découpage">
            @for (d of decoupages; track d) {
              <button type="button" [attr.data-decoupage]="d" [attr.aria-pressed]="z.decoupage() === d" (click)="z.regler({ decoupage: d })"
                [class]="pastille + ' flex-1 text-center ' + (z.decoupage() === d ? pastilleActive : pastilleInactive)">{{ libelle(d) }}</button>
            }
          </div>
        </div>

        @if (z.erreur(); as e) { <div data-erreur role="alert" [class]="encartErreur">{{ e }}</div> }

        <button type="button" data-chiffrer [disabled]="!z.zoneId() || z.enCours()" (click)="z.chiffrer()" [class]="boutonCalcul">
          {{ z.enCours() ? 'Chiffrage…' : 'Chiffrer la zone' }}
        </button>
        @if (z.enCours()) {
          <div data-en-cours role="progressbar" aria-label="Chiffrage de la zone en cours" class="h-[3px] overflow-hidden rounded-[2px] bg-overlay">
            <div class="h-full w-1/3 animate-pulse bg-teal"></div>
          </div>
        }

        @if (z.resultat(); as r) {
          <div class="flex flex-col gap-[10px]" data-resultat>
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
              @if (c.irisSousLeZoom()) { <div data-zoomer class="text-[11px] text-warning">Zoomez pour voir les IRIS sur la carte (à partir du zoom 9).</div> }
              @if (c.chargementContours()) { <div class="font-mono text-[11px] text-tertiary">Chargement des contours…</div> }
              @if (c.contoursIndisponibles()) { <div class="text-[11px] text-tertiary">Contours indisponibles : le tableau reste juste, la carte ne montre que la zone.</div> }
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-tertiary" data-legende-part>
                <span>Part</span>
                @for (p of paliers; track $index) {
                  <span class="inline-flex items-center gap-1"><span class="inline-block size-2.5 rounded-[2px]" [style.background]="p.couleur"></span>{{ p.libelle }}</span>
                }
                <span class="inline-flex items-center gap-1"><span class="inline-block size-2.5 rounded-[2px] bg-[var(--donnee-absente)]"></span>sans total</span>
              </div>
              <mg-tableau-couverture-zone [lignes]="r.lignes" [decoupage]="r.decoupage" [actif]="c.survole()" (survol)="c.survoler($event)" />
            }

            <div data-calcule class="font-mono text-[10px] text-tertiary">Calculé le {{ date(r.calcule_le) }}@if (r.cache) { · en cache}</div>
          </div>
        }
      </div>
    }
  `,
})
export class OutilCouvertureComponent {
  protected readonly z = inject(ZoneAnalyseeService);
  protected readonly c = inject(CouvertureService);
  private readonly cibles = inject(ProfilRisqueApi);

  /** Ouvert par défaut : c'est l'outil de tête de ④. Le panneau reste monté, l'état survit à ④ → ① → ④. */
  protected readonly ouvert = signal(true);
  protected readonly cibleOuverte = signal(false);
  private readonly catalogue = signal<Cible[]>([]);
  protected readonly chargementCibles = signal(false);
  protected readonly erreurCibles = signal<string | null>(null);

  protected readonly decoupages = DECOUPAGES;
  protected readonly libelle = libelleDecoupage;
  protected readonly nombre = formaterNombre;
  protected readonly date = dateFr;
  protected readonly entete = ENTETE_ACCORDEON;
  protected readonly corps = CORPS_ACCORDEON;
  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly boutonCalcul = BOUTON_CALCUL;
  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly encartAvertissement = ENCART_AVERTISSEMENT;
  protected readonly pastille = PASTILLE;
  protected readonly pastilleActive = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  protected readonly paliers = PALIERS_CSS.map((couleur, i) => ({
    couleur,
    libelle: i === 0 ? `< ${BORNES_PART[0]} %` : i === PALIERS_CSS.length - 1 ? `≥ ${BORNES_PART[i - 1]} %` : `${BORNES_PART[i - 1]}-${BORNES_PART[i]} %`,
  }));

  /** Les cibles regroupées par famille, dans l'ordre du catalogue (rang de population). */
  protected readonly familles = computed(() => {
    const g = new Map<string, Cible[]>();
    for (const c of this.catalogue()) g.set(c.famille, [...(g.get(c.famille) ?? []), c]);
    return [...g].map(([famille, cibles]) => ({ famille, cibles }));
  });
  protected readonly libelleCible = computed(() => {
    const code = this.z.cible();
    return this.catalogue().find((c) => c.code === code)?.libelle ?? (code === CIBLE_PAR_DEFAUT ? LIBELLE_CIBLE_DEFAUT : code);
  });
  /** « habitants carroyés », ou « <cible> (carroyés) » : le chiffre de tête ne se lit jamais sans son dénominateur. */
  protected readonly libelleTete = computed(() => {
    const r = this.z.resultat();
    return r?.cible === CIBLE_PAR_DEFAUT ? 'habitants carroyés' : `${this.libelleCible().toLowerCase()} (carroyés)`;
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

  private lecture: Subscription | null = null;
  private demandee = false;

  constructor() {
    // Une cible venue de l'URL qui n'est pas la cible par défaut : le catalogue est lu pour la NOMMER.
    effect(() => {
      if (this.z.cible() !== CIBLE_PAR_DEFAUT) untracked(() => this.chargerCibles());
    });
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
  }

  protected ouvrirCibles(): void {
    this.cibleOuverte.set(true);
    this.chargerCibles();
  }

  protected choisirCible(code: string): void {
    this.cibleOuverte.set(false);
    this.z.regler({ cible: code });
  }

  /** Une lecture par composant ; un échec se relit à la prochaine ouverture. */
  private chargerCibles(): void {
    if (this.demandee) return;
    this.demandee = true;
    this.chargementCibles.set(true);
    this.erreurCibles.set(null);
    this.lecture = this.cibles.cibles().subscribe({
      next: (r) => {
        this.catalogue.set(Array.isArray(r.cibles) ? r.cibles : []);
        this.chargementCibles.set(false);
      },
      error: (e: unknown) => {
        this.chargementCibles.set(false);
        this.erreurCibles.set(messageErreurRequete(e));
        this.demandee = false;
      },
    });
  }
}
