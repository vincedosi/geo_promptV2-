import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import type { ApercuZone } from '../../data/zones.api';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { type Recette, libelleRecette } from '../../logique/zones/recette';
import { STYLES_RECETTE } from './styles-recette';

/** Sous cette part, la découpe par le périmètre est dite (même seuil que les créateurs : les arrondis restent au-dessus). */
const PART_SIGNALEE = 0.98;

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
 * - Le nom est réinitialisé au libellé de la recette PRÉVISUALISÉE à chaque nouvel aperçu (`linkedSignal`).
 * - « Enregistrer la zone » se désactive DÈS le premier clic (`enCours`), et l'atelier se vide après succès : le
 *   serveur n'étant pas idempotent, deux clics ne font jamais deux zones. Un 207 n'est jamais renvoyé : le message le
 *   dit et, si la recette se recalcule, « Mes zones » est proposé.
 * - Réglages modifiés depuis l'aperçu : l'enregistrement attend un nouvel aperçu (la zone écrite serait sinon celle
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
    }
    @if (perime()) {
      <p data-perime class="garde">Les réglages ont changé depuis l’aperçu : relancez-le avant d’enregistrer.</p>
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

  protected readonly nom = linkedSignal({
    source: this.atelier.recette,
    computation: (r: Recette | null) => (r ? libelleRecette(r).slice(0, 200) : ''),
  });
  protected readonly chiffres = computed(() => {
    const a = this.atelier.apercu();
    return a ? chiffresApercu(a, this.atelier.recette()) : null;
  });
  /** L'aperçu affiché n'est plus celui des réglages du formulaire actif. */
  protected readonly perime = computed(() => {
    const vue = this.atelier.recette();
    const actuelle = this.recette();
    return !!this.atelier.apercu() && !!vue && !!actuelle && JSON.stringify(vue) !== JSON.stringify(actuelle);
  });
  protected readonly ecriture = computed(() => this.atelier.enCours() && !!this.atelier.apercu());
  protected readonly peutEnregistrer = computed(() =>
    !!this.atelier.apercu() && this.nom().trim().length > 0 && !this.atelier.enCours() && !this.perime());
  protected readonly aEffacer = computed(() =>
    !!(this.atelier.recette() || this.atelier.apercu() || this.atelier.erreur() || this.atelier.message()));

  protected apercevoir(): void {
    const r = this.recette();
    if (r && !this.atelier.enCours()) this.atelier.apercevoir(r, this.geometrie());
  }

  protected enregistrer(): void {
    if (this.peutEnregistrer()) this.atelier.enregistrer(this.nom());
  }
}
