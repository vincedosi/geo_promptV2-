import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IrisService } from '../../couches/iris.service';
import { SanteService } from '../../couches/sante.service';
import type { EchelleSante, JeuSante } from '../../logique/sante';
import { AGE_MAX_JOURS, ageEnJours } from '../../logique/sante';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { FicheSanteComponent } from './fiche-sante.component';
import { SelectionsCalquesService } from './selections-calques.service';

/** Couches nationales disponibles (`HEALTH_LAYERS`, `CivicHealthSection.tsx:21`). */
const COUCHES: ReadonlyArray<readonly [JeuSante, string]> = [['pollen', '🌾 Allergènes'], ['atmo', '🌬️ Qualité de l’air']];
/** Échelles de zones (`HEALTH_SCALES`, `CivicHealthSection.tsx:24`). */
const ECHELLES: ReadonlyArray<readonly [EchelleSante, string]> = [['departement', 'Département'], ['cp', 'Code postal']];
/** Les options du sélecteur de métrique, textes de React (`CivicHealthSection.tsx:239-257`). */
const METRIQUES: Record<JeuSante, ReadonlyArray<readonly [string, string]>> = {
  pollen: [['global', 'Indice global'], ['ambroisie', 'Ambroisie'], ['armoise', 'Armoise'], ['aulne', 'Aulne'],
    ['bouleau', 'Bouleau'], ['graminees', 'Graminées'], ['olivier', 'Olivier']],
  atmo: [['global', 'Indice global'], ['no2', 'Dioxyde d\'azote (NO₂)'], ['o3', 'Ozone (O₃)'], ['pm10', 'Particules PM10'],
    ['pm25', 'Particules fines PM2.5'], ['so2', 'Dioxyde de soufre (SO₂)']],
};
/** Les seuils (`CivicHealthSection.tsx:275-288`). */
const SEUILS: Record<JeuSante, ReadonlyArray<readonly [number, string]>> = {
  pollen: [[0, 'Tous les niveaux'], [3, '≥ modéré'], [4, '≥ élevé'], [5, '≥ très élevé']],
  atmo: [[0, 'Tous les niveaux'], [3, '≥ dégradé'], [4, '≥ mauvais'], [5, '≥ très mauvais']],
};

const BOUTON = 'flex-1 cursor-pointer rounded-[6px] border-fin font-medium transition-[background-color,border-color,color] duration-150 ease-[var(--ease-hover)]';
const ACTIF = 'border-teal text-teal bg-teal-10';
const INACTIF = 'border-default text-secondary bg-transparent';
/** Le bandeau d'avertissement : `rgba(247,183,49,0.1|0.2)` de React, en jeton `--warning`. */
const BANDEAU = 'rounded-[6px] border-fin border-[color-mix(in_srgb,var(--warning)_20%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-[10px] py-2';
const BOUTON_INGESTION = 'rounded-[6px] border-fin border-teal bg-transparent px-3 py-1.5 text-[11px] font-medium text-teal';

/**
 * La section « Santé environnementale » du groupe Environnement — portage de `filter-panel/CivicHealthSection.tsx`.
 *
 * Repliée à l'ouverture du panneau (`DEFAULT_CLOSED`), elle s'ouvre d'elle-même au premier IRIS sélectionné (règle de
 * `use-filter-sections.ts`, portée dans `mg-panneau-calques`). En tête, la fiche de la commune de l'IRIS ; puis le choix
 * de la couche nationale (re-cliquer masque), et, la couche active : échelle, avertissements de donnée absente ou
 * PÉRIMÉE (avec le bouton d'ingestion, à la condition EXACTE de React : au code postal seulement, table vide ou donnée
 * de plus de trois jours — la route refuse tout autre qu'un administrateur), métrique, seuil, chargement, source.
 *
 * La fiche commune est `mg-fiche-sante` (portage de `HealthIndicatorCard`, revue 1). Écarts : fonds `rgba(78,205,196,0.1)` et `rgba(247,183,49,…)` en jetons.
 */
@Component({
  selector: 'mg-section-sante',
  imports: [EnteteFiltreComponent, FicheSanteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    @if (!integre()) {
      <mg-entete-filtre libelle="Santé environnementale" [ouvert]="ouvert()" [compte]="compte()"
        (basculer)="selections.basculerSection('civicHealth')" />
    }
    @if (ouvert()) {
      <div class="fondu flex flex-col gap-[10px]">
        <mg-fiche-sante [codeCommune]="codeCommune()" [nomCommune]="nomCommune()" />

        <div data-couches-sante>
          <div class="mb-1 text-[11px] font-medium text-secondary">Couche nationale</div>
          <div class="flex gap-1.5">
            @for (l of couches; track l[0]) {
              <button type="button" [attr.data-jeu]="l[0]" [attr.aria-pressed]="s.jeu() === l[0]"
                [title]="s.jeu() === l[0] ? 'Masquer la couche' : 'Afficher la couche'"
                (click)="s.choisirJeu(s.jeu() === l[0] ? null : l[0])"
                class="px-[10px] py-2 text-[12px]" [class]="s.jeu() === l[0] ? actif : inactif">{{ l[1] }}</button>
            }
          </div>
        </div>

        @if (s.jeu(); as jeu) {
          <div class="fondu flex flex-col gap-2">
            <div>
              <div class="mb-1 text-[11px] font-medium text-secondary">Échelle</div>
              <div class="flex gap-1.5">
                @for (e of echelles; track e[0]) {
                  <button type="button" [attr.data-echelle]="e[0]" [attr.aria-pressed]="s.echelle() === e[0]"
                    (click)="s.choisirEchelle(e[0])"
                    class="px-[10px] py-1.5 text-[11px]" [class]="s.echelle() === e[0] ? actif : inactif">{{ e[1] }}</button>
                }
              </div>
            </div>

            @if (sansDonnee()) {
              <div data-sans-donnee class="{{ bandeau }}">
                <div class="mb-1.5 text-[11px] text-warning">Aucune donnée nationale — l'ingestion quotidienne n'a pas encore tourné.</div>
                <button type="button" (click)="s.ingerer()" [disabled]="s.ingestion().running"
                  class="{{ boutonIngestion }}" [class.cursor-wait]="s.ingestion().running" [class.opacity-60]="s.ingestion().running"
                  [class.cursor-pointer]="!s.ingestion().running"
                >{{ s.ingestion().running ? 'Ingestion en cours…' : 'Lancer l’ingestion (admin)' }}</button>
              </div>
            }
            @if (perimeJours(); as age) {
              <div data-perime class="{{ bandeau }}">
                <div class="mb-1.5 text-[11px] text-warning">
                  Données vieilles de {{ age }} jours (du {{ s.dateCp() }}) — l'ingestion
                  quotidienne ne tourne plus. Les niveaux affichés ne sont pas ceux d'aujourd'hui.
                </div>
                <button type="button" (click)="s.ingerer()" [disabled]="s.ingestion().running"
                  class="{{ boutonIngestion }}" [class.cursor-wait]="s.ingestion().running" [class.opacity-60]="s.ingestion().running"
                  [class.cursor-pointer]="!s.ingestion().running"
                >{{ s.ingestion().running ? 'Ingestion en cours…' : 'Rafraîchir maintenant (admin)' }}</button>
              </div>
            }
            @if (messageIngestion(); as m) {
              <div data-ingestion class="font-mono text-[10px]" [class.text-danger]="!!s.ingestion().error"
                [class.text-tertiary]="!s.ingestion().error">{{ m }}</div>
            }

            <div>
              <div class="mb-1 text-[11px] font-medium text-secondary">{{ jeu === 'pollen' ? 'Allergène' : 'Polluant' }}</div>
              <select data-metrique [attr.aria-label]="jeu === 'pollen' ? 'Allergène' : 'Polluant'"
                [value]="s.metrique()" (change)="s.metrique.set($any($event.target).value)"
                class="w-full cursor-pointer rounded-[6px] border-fin border-subtle bg-elevated px-[11px] py-[7px] text-[12px] text-primary outline-none">
                @for (o of metriques(); track o[0]) {
                  <option [value]="o[0]" [selected]="o[0] === s.metrique()">{{ o[1] }}</option>
                }
              </select>
            </div>

            <div>
              <div class="mb-1 text-[11px] font-medium text-secondary">Niveau minimum affiché</div>
              <select data-seuil aria-label="Niveau minimum affiché"
                [value]="s.seuil()" (change)="s.seuil.set(+$any($event.target).value)"
                class="w-full cursor-pointer rounded-[6px] border-fin bg-elevated px-[11px] py-[7px] text-[12px] outline-none"
                [class.border-teal]="s.seuil() > 0" [class.text-teal]="s.seuil() > 0"
                [class.border-subtle]="s.seuil() === 0" [class.text-primary]="s.seuil() === 0">
                @for (o of seuils(); track o[0]) {
                  <option [value]="o[0]" [selected]="o[0] === s.seuil()">{{ o[1] }}</option>
                }
              </select>
            </div>

            @if (texteChargement(); as t) {
              <div data-chargement-sante class="font-mono text-[10px] text-tertiary">{{ t }}</div>
            }
            @if (s.erreur(); as e) {
              <!-- Revue 1 : un échec est DIT (React : console.error, carte vide muette). -->
              <div data-erreur-sante class="text-[11px] text-danger">{{ e }}</div>
            }

            <div class="font-mono text-[9px] italic text-tertiary">{{ source() }}</div>
          </div>
        }
      </div>
    }
  `,
})
export class SectionSanteComponent {
  protected readonly selections = inject(SelectionsCalquesService);
  protected readonly s = inject(SanteService);
  private readonly iris = inject(IrisService);
  protected readonly couches = COUCHES;
  protected readonly echelles = ECHELLES;
  protected readonly actif = `${BOUTON} ${ACTIF}`;
  protected readonly inactif = `${BOUTON} ${INACTIF}`;
  protected readonly bandeau = BANDEAU;
  protected readonly boutonIngestion = BOUTON_INGESTION;

  /** Rendue dans une ligne de ② (parcours, lot 2) : la ligne porte déjà le nom, l'en-tête interne n'est pas rendu et le contenu reste ouvert. */
  readonly integre = input(false);
  /** `sectionsOpen.civicHealth === true` (`CivicHealthSection.tsx:104`). */
  protected readonly ouvert = computed(() => this.integre() || this.selections.sections()['civicHealth'] === true);
  /** La commune de l'IRIS sélectionné (`selectedIrisData?.code_commune`, `page.tsx:1020`). */
  protected readonly codeCommune = computed(() => this.iris.detail()?.code_commune ?? null);
  protected readonly nomCommune = computed(() => this.iris.detail()?.nom_commune ?? null);
  protected readonly compte = computed(() => (this.codeCommune() ? 1 : 0) + (this.s.jeu() ? 1 : 0));
  protected readonly metriques = computed(() => METRIQUES[this.s.jeu() ?? 'pollen']);
  protected readonly seuils = computed(() => SEUILS[this.s.jeu() ?? 'pollen']);

  protected readonly sansDonnee = computed(() => this.s.echelle() === 'cp' && this.s.statutCp() === 'no_data');
  /** L'âge de la donnée, s'il dépasse `AGE_MAX_JOURS` au code postal ; sinon `null`. */
  protected readonly perimeJours = computed(() => {
    if (this.s.echelle() !== 'cp') return null;
    const age = ageEnJours(this.s.dateCp());
    return age !== null && age > AGE_MAX_JOURS ? age : null;
  });
  protected readonly messageIngestion = computed(() => this.s.ingestion().error ?? this.s.ingestion().message);
  /** « Chargement… n/t départements » pendant le flux, sinon « Chargement de la couche… » (`CivicHealthSection.tsx:293-301`). */
  protected readonly texteChargement = computed(() => {
    const p = this.s.progression();
    if (this.s.echelle() === 'departement' && p && p.done < p.total) return `Chargement… ${p.done}/${p.total} départements`;
    return this.s.chargement() ? 'Chargement de la couche…' : null;
  });
  protected readonly source = computed(() => {
    const cp = this.s.echelle() === 'cp';
    const date = this.s.dateCp();
    const zone = cp ? `max des communes par code postal${date ? ` · données du ${date}` : ''}` : '1 commune par département';
    return `Source : Atmo France et les AASQA (ODbL) — ${zone} · clic sur une zone pour le détail ${this.s.jeu() === 'pollen' ? 'par espèce' : 'par polluant'}`;
  });
}
