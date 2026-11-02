import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import type { ApercuZone } from '../../data/zones.api';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import type { IndicateurRegistre } from '../../logique/analyses/score';
import { PART_SIGNALEE } from '../../logique/zones/creation-zone';
import { type Recette, libelleRecette, mentionEstimatif } from '../../logique/zones/recette';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { STYLES_RECETTE } from './styles-recette';

/** Ce que `compte` compte, selon la recette prévisualisée. */
function libelleCompte(r: Recette | null, n: number): string | null {
  const s = n > 1 ? 's' : '';
  switch (r?.type) {
    case 'seuil_carreaux': return `${formaterNombre(n)} carreau${n > 1 ? 'x' : ''}`;
    case 'rayon_poi': return `${formaterNombre(n)} POI`;
    case 'seuil_territoire': return `${formaterNombre(n)} territoire${s}`;
    default: return null;
  }
}

/** « 3,2 km² · 505 carreaux · 41 230 habitants », et la part retenue quand le périmètre a découpé la forme. */
export function chiffresApercu(a: ApercuZone, r: Recette | null): { ligne: string; part: string | null } {
  const morceaux = [
    a.surface_km2 != null ? `${formaterNombre(Math.round(a.surface_km2 * 10) / 10)} km²` : null,
    a.compte != null ? libelleCompte(r, a.compte) : null,
    a.population != null ? `${formaterNombre(Math.round(a.population))} habitants` : null,
  ].filter((m): m is string => !!m);
  // Une recette bornée est découpée par le périmètre de ① ; une forme figée (dessin, import), par le territoire.
  const lieu = r && 'perimetre' in r ? 'dans le périmètre' : 'sur le territoire';
  const part = a.part_retenue != null && a.part_retenue < PART_SIGNALEE
    ? `${Math.round(a.part_retenue * 100)} % de la forme ${lieu}` : null;
  return { ligne: morceaux.join(' · '), part };
}

/**
 * Le pied commun des recettes de ③ (lot 3, arbitrage P4) : monté UNE fois sous les familles. Il reçoit la recette du
 * formulaire actif (`null` tant que sa garde refuse) et porte les trois gestes — « Aperçu », le nom, « Enregistrer la
 * zone » — en appelant `AtelierZoneService` lui-même ; les formulaires ne font que composer.
 *
 * - « Aperçu » relance l'atelier ; les chiffres affichés sont ceux de l'aperçu courant (`atelier.apercu()`).
 * - Le nom est réinitialisé au libellé de la recette PRÉVISUALISÉE à chaque nouvel aperçu (`linkedSignal`) ; le
 *   catalogue arrivé après coup ne remplace qu'un nom non touché.
 * - « Enregistrer la zone » se désactive DÈS le premier clic (`enCours`), et l'atelier se vide après succès : le
 *   serveur n'étant pas idempotent, deux clics ne font jamais deux zones. Un 207 n'est jamais renvoyé : le message le
 *   dit et, si la recette se recalcule, « Mes zones » est proposé.
 * - Réglages modifiés, formulaire disparu ou autre fichier depuis l'aperçu : l'enregistrement attend un nouvel aperçu (la zone écrite serait sinon celle
 *   de l'ANCIENNE recette, sous des champs qui en disent une autre).
 * - « Effacer » est inactif pendant un calcul ou une écriture (l'atelier l'ignorerait).
 */
@Component({
  selector: 'mg-pied-recette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 border-t-fin border-subtle px-3.5 py-3' },
  template: `
    @if (!recette() && !atelier.apercu()) {
      <p data-invite class="garde">Réglez une recette ci-dessus, puis lancez l’aperçu.</p>
    }
    <div class="flex gap-2">
      <button type="button" data-apercu class="cta-teal flex-1" [disabled]="!recette() || atelier.enCours()" (click)="apercevoir()">Aperçu</button>
      <button type="button" data-effacer class="neutre" [disabled]="atelier.enCours() || !aEffacer()" (click)="atelier.effacer()">Effacer</button>
    </div>

    @if (chiffres(); as c) {
      <p data-chiffres class="m-0 font-mono text-[11px] text-secondary">{{ c.ligne }}</p>
      @if (c.part) { <p data-part class="m-0 font-mono text-[11px] text-tertiary">{{ c.part }}</p> }
      <!-- Décision du 02/11 : un rayon sous le minimum d'activation se calcule, mais ses chiffres sont estimatifs. -->
      @if (estimatif(); as m) { <p data-estimatif class="garde">{{ m }}</p> }
    }
    @if (perime()) {
      <p data-perime class="garde">L’aperçu ne correspond plus aux réglages affichés : relancez-le avant d’enregistrer.</p>
    }

    <label class="libelle" for="pied-recette-nom">Nom de la zone</label>
    <input id="pied-recette-nom" data-nom type="text" maxlength="200" class="champ" [value]="nom()" (input)="nom.set($any($event.target).value)" />
    <button type="button" data-enregistrer class="cta-teal" [disabled]="!peutEnregistrer()" (click)="enregistrer()">{{ ecriture() ? 'Enregistrement…' : 'Enregistrer la zone' }}</button>

    @if (atelier.erreur(); as e) { <div data-erreur role="alert" class="erreur">{{ e }}</div> }
    @if (atelier.message(); as m) { <div data-message role="status" class="succes">{{ m }}</div> }
    @if (atelier.nonResolue()?.recalculable) {
      <button type="button" data-mes-zones class="neutre self-start" (click)="outils.ouvrir('zones')">Ouvrir « Mes zones » pour la recalculer</button>
    }
  `,
  styles: [STYLES_RECETTE],
})
export class PiedRecetteComponent {
  protected readonly atelier = inject(AtelierZoneService);
  protected readonly outils = inject(OutilsCarteService);

  /** La recette du formulaire actif, `null` si aucun ou si sa garde refuse. */
  readonly recette = input<Recette | null>(null);
  /** La forme d'une recette figée (import) : elle part avec la recette. */
  readonly geometrie = input<GeoJSON.Geometry | undefined>(undefined);

  private readonly catalogue = inject(CatalogueIndicateursService);
  /**
   * Le catalogue d'indicateurs du panneau (même service que le formulaire « Par seuil » : la lecture en vol ou déjà faite
   * est partagée, aucun appel de plus), pour que le nom par défaut d'un seuil sur territoires dise « taux de pauvreté
   * … %» et non l'identifiant. Lu seulement quand la recette prévisualisée est un tel seuil.
   */
  private readonly indicateurs = signal<readonly IndicateurRegistre[]>([]);
  private lectureCatalogue: Subscription | null = null;

  /**
   * Le nom proposé : réinitialisé quand la recette prévisualisée CHANGE ; l'arrivée du catalogue (seule) ne remplace
   * le nom que s'il n'a pas été touché — une saisie faite pendant la lecture du catalogue n'est jamais écrasée.
   */
  protected readonly nom = linkedSignal<{ r: Recette | null; catalogue: readonly IndicateurRegistre[] }, string>({
    source: () => ({ r: this.atelier.recette(), catalogue: this.indicateurs() }),
    computation: ({ r, catalogue }, precedent) => {
      const propose = r ? libelleRecette(r, catalogue).slice(0, 200) : '';
      if (!precedent || precedent.source.r !== r) return propose;
      const proposeAvant = r ? libelleRecette(r, precedent.source.catalogue).slice(0, 200) : '';
      return precedent.value === proposeAvant ? propose : precedent.value;
    },
  });
  protected readonly chiffres = computed(() => {
    const a = this.atelier.apercu();
    return a ? chiffresApercu(a, this.atelier.recette()) : null;
  });
  /** La mention « estimatif » de la recette prévisualisée (rayon trop fin pour être activé), `null` sinon. */
  protected readonly estimatif = computed(() => mentionEstimatif(this.atelier.recette()));
  /** La forme passée au dernier aperçu (import) : un autre fichier, même de même nom, est une autre lecture. */
  private readonly geometrieVue = signal<GeoJSON.Geometry | undefined>(undefined);
  /**
   * L'aperçu affiché n'est plus celui du formulaire actif : réglages changés, AUCUN formulaire actif (famille repliée,
   * ① passé à la France…), ou autre fichier importé (forme différente, même nom compris).
   */
  protected readonly perime = computed(() => {
    const vue = this.atelier.recette();
    if (!this.atelier.apercu() || !vue) return false;
    const actuelle = this.recette();
    return !actuelle || JSON.stringify(vue) !== JSON.stringify(actuelle) || this.geometrie() !== this.geometrieVue();
  });
  protected readonly ecriture = computed(() => this.atelier.enCours() && !!this.atelier.apercu());
  protected readonly peutEnregistrer = computed(() =>
    !!this.atelier.apercu() && this.nom().trim().length > 0 && !this.atelier.enCours() && !this.perime());
  protected readonly aEffacer = computed(() =>
    !!(this.atelier.recette() || this.atelier.apercu() || this.atelier.erreur() || this.atelier.message()));

  constructor() {
    effect(() => {
      if (this.atelier.recette()?.type !== 'seuil_territoire' || this.lectureCatalogue) return;
      this.lectureCatalogue = untracked(() => this.catalogue.charger().subscribe({
        next: (liste) => this.indicateurs.set(liste),
        // Sans catalogue, l'identifiant : la prochaine recette de ce type relira.
        error: () => { this.lectureCatalogue = null; },
      }));
    });
    inject(DestroyRef).onDestroy(() => this.lectureCatalogue?.unsubscribe());
  }

  protected apercevoir(): void {
    const r = this.recette();
    if (!r || this.atelier.enCours()) return;
    this.geometrieVue.set(this.geometrie());
    this.atelier.apercevoir(r, this.geometrie());
  }

  protected enregistrer(): void {
    if (this.peutEnregistrer()) this.atelier.enregistrer(this.nom());
  }
}
