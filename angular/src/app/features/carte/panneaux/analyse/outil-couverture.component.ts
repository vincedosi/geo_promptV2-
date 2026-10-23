import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { CouvertureService } from '../../couches/couverture.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import { dateFr } from '../../logique/analyses/commun';
import {
  CIBLE_PAR_DEFAUT, DECOUPAGES, avertissementNonCarroye, libelleDecoupage, ligneHorsTerritoire, messageZoneVide,
  phraseReference,
} from '../../logique/analyses/couverture';
import { BORNES_PART } from '../../couches/couche-couverture';
import { ChoixCibleComponent } from './choix-cible.component';
import { ChoixZoneAnalyseeComponent } from './choix-zone-analysee.component';
import { CroisementsZoneComponent } from './croisements-zone.component';
import {
  BOUTON_CALCUL, CORPS_ACCORDEON, ENCART_AVERTISSEMENT_LISIBLE, ENCART_ERREUR, ENTETE_ACCORDEON, LIBELLE_CHAMP, PASTILLE, PASTILLE_INACTIVE,
  PASTILLE_PRIMAIRE_ACTIVE,
} from './styles-analyse';
import { PALIERS_CSS, TableauCouvertureZoneComponent } from './tableau-couverture-zone.component';

/**
 * ④ Analyse — l'outil « Couverture d'une zone » (lot 4, T8), en tête du panneau Analyse et ouvert par défaut : choisir
 * une zone enregistrée, la cible et le découpage, « Chiffrer la zone », lire les chiffres et les voir sur la carte
 * (`CouvertureService`) ; dessous, sa radio et son trafic (`mg-croisements-zone`, T13). Sans équivalent React.
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
  imports: [ChoixCibleComponent, ChoixZoneAnalyseeComponent, CroisementsZoneComponent, KpiComponent, TableauCouvertureZoneComponent],
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

        <mg-choix-cible [cible]="z.cible()" (choisie)="z.regler({ cible: $event })" />

        <div>
          <div [class]="libelleChamp">Découpage</div>
          <div class="flex gap-[5px]" role="group" aria-label="Découpage">
            @for (d of decoupages; track d) {
              <button type="button" [attr.data-decoupage]="d" [attr.aria-pressed]="z.decoupage() === d" (click)="z.regler({ decoupage: d })"
                [class]="pastille + ' flex-1 text-center ' + (z.decoupage() === d ? pastilleActive : pastilleInactive)">{{ libelle(d) }}</button>
            }
          </div>
        </div>

        <!-- Un refus radio/trafic qui retire la zone démonte son bloc : son message s'affiche ici (T13, ronde 2). -->
        @if (z.erreur() ?? (z.zoneId() ? null : z.croisements.erreur()); as e) { <div data-erreur role="alert" [class]="encartErreur">{{ e }}</div> }

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
              @if (c.chargementContours()) { <div class="font-mono text-[11px] text-tertiary">Chargement des contours…</div> }
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

        <!-- Hors du résultat : ni la cible ni le découpage ne changent la radio et le trafic de la zone (T13). -->
        @if (z.zoneId()) { <mg-croisements-zone /> }
      </div>
    }
  `,
})
export class OutilCouvertureComponent {
  protected readonly z = inject(ZoneAnalyseeService);
  protected readonly c = inject(CouvertureService);
  /** Le sélecteur de cible : son libellé écrit le chiffre de tête. */
  private readonly choixCible = viewChild(ChoixCibleComponent);

  /** Ouvert par défaut : c'est l'outil de tête de ④. Le panneau reste monté, l'état survit à ④ → ① → ④. */
  protected readonly ouvert = signal(true);

  protected readonly decoupages = DECOUPAGES;
  protected readonly libelle = libelleDecoupage;
  protected readonly nombre = formaterNombre;
  protected readonly date = dateFr;
  protected readonly entete = ENTETE_ACCORDEON;
  protected readonly corps = CORPS_ACCORDEON;
  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly boutonCalcul = BOUTON_CALCUL;
  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly encartAvertissement = ENCART_AVERTISSEMENT_LISIBLE;
  protected readonly pastille = PASTILLE;
  protected readonly pastilleActive = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  protected readonly paliers = PALIERS_CSS.map((couleur, i) => ({
    couleur,
    libelle: i === 0 ? `< ${BORNES_PART[0]} %` : i === PALIERS_CSS.length - 1 ? `≥ ${BORNES_PART[i - 1]} %` : `${BORNES_PART[i - 1]}-${BORNES_PART[i]} %`,
  }));

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
}

/** « Ménages pauvres » → « ménages pauvres » ; un sigle (« CSP+ ») garde ses capitales. */
function minusculeInitiale(s: string): string {
  return s.length > 1 && s[1] === s[1].toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
