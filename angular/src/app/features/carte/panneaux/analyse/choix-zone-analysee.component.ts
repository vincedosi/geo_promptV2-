import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { from, map, switchMap, throwError } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { plierTexte } from '../../../../core/format/texte';
import { ZonesCustomApi, type ZoneCustomResume } from '../../data/zones-custom.api';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { LectureAnnulable } from '../../etat/lecture-annulable';
import type { IndicateurRegistre } from '../../logique/analyses/score';
import { messageErreurRequete } from '../../logique/analyses/commun';
import { libelleRecette } from '../../logique/zones/recette';
import { LIBELLE_CHAMP, LISTE_CHAMP, PASTILLE, PASTILLE_INACTIVE } from './styles-analyse';

/**
 * ④ Analyse — choisir la zone analysée parmi les zones enregistrées de l'espace (lot 4, T7). Monté par l'outil
 * « Couverture d'une zone » (T8), qui relie `choisie` à `ZoneAnalyseeService.choisir`.
 *
 * ── AUCUNE LECTURE À L'OUVERTURE DE ④ ─────────────────────────────────────
 * La liste (`GET /api/custom-geo/list`, l'espace actif, plafond de la route) n'est lue qu'au PREMIER clic sur
 * « Choisir une zone », une seule fois par composant (le panneau reste monté, A1). Exception : une zone arrive déjà
 * choisie (lien `?zoneAnalyse=`) — son nom et sa recette sont dans cette même liste, lue alors une fois pour les dire.
 *
 * La zone choisie affiche son nom, le libellé de sa recette (`libelleRecette`), « Changer » et « Retirer ». Un seuil
 * sur territoires est nommé par le catalogue d'indicateurs de la PAGE (`CatalogueIndicateursService`, X4 — le même que
 * ③, le score et « Mes zones », lecture partagée) : lu seulement quand la liste porte un tel seuil (T8, réserve 4 de T7).
 * Si la liste ne peut pas être lue alors qu'une zone est déjà choisie (lien), l'échec est dit SOUS la zone, sans
 * ouvrir la liste (relecture de T7).
 */
const SANS_ESPACE = 'Aucun espace actif : impossible de lister les zones.';

@Component({
  selector: 'mg-choix-zone-analysee',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-1.5" data-choix-zone>
      <div [class]="LIBELLE_CHAMP">Zone analysée</div>
      @if (zoneId() && !ouvert()) {
        <div class="flex flex-col gap-1 rounded-[6px] border-fin border-subtle bg-elevated px-[10px] py-2" data-zone-choisie>
          <span class="text-[12px] text-primary">{{ zoneChoisie()?.name ?? (chargement() ? 'Chargement…' : 'Zone enregistrée') }}</span>
          @if (recetteChoisie(); as r) { <span class="text-[11px] text-tertiary">{{ r }}</span> }
          <!-- La liste n'a pas pu être lue : le nom manque, et on le DIT sans attendre qu'on ouvre la liste (relecture T7). -->
          @if (erreur(); as e) { <span class="text-[11px] text-danger" role="alert" data-erreur-liste>Nom indisponible : {{ e }}</span> }
          <div class="mt-1 flex gap-1.5">
            <button type="button" [class]="PASTILLE + ' ' + PASTILLE_INACTIVE" (click)="ouvrir()" data-changer>Changer</button>
            <button type="button" [class]="PASTILLE + ' ' + PASTILLE_INACTIVE" (click)="choisie.emit(null)" data-retirer>Retirer</button>
          </div>
        </div>
      } @else if (!ouvert()) {
        <button type="button" [class]="PASTILLE + ' ' + PASTILLE_INACTIVE + ' self-start'" (click)="ouvrir()" data-ouvrir>Choisir une zone</button>
      } @else {
        <div class="flex flex-col gap-1.5" data-liste-zones>
          <input
            type="search" [class]="LISTE_CHAMP + ' cursor-text'" placeholder="Filtrer par nom" aria-label="Filtrer les zones par nom"
            [value]="filtre()" (input)="filtre.set($any($event.target).value)"
          />
          @if (chargement()) { <div class="font-mono text-[11px] text-tertiary">Chargement…</div> }
          @if (erreur(); as e) { <div class="text-[11px] text-danger" role="alert">{{ e }}</div> }
          @if (!chargement() && !erreur() && zones().length === 0) {
            <div class="text-[11px] text-tertiary">Aucune zone enregistrée dans cet espace.</div>
          } @else if (!chargement() && zones().length > 0 && zonesFiltrees().length === 0) {
            <div class="text-[11px] text-tertiary">Aucune zone ne correspond.</div>
          }
          <div class="flex max-h-[240px] flex-col gap-1 overflow-y-auto">
            @for (l of zonesFiltrees(); track l.z.id) {
              @let z = l.z;
              <button
                type="button" [attr.data-zone]="z.id" [attr.aria-pressed]="z.id === zoneId()"
                (click)="choisir(z.id)"
                class="flex w-full cursor-pointer flex-col items-start gap-[2px] rounded-[4px] border-fin px-[10px] py-2 text-left text-[12px]"
                [class]="z.id === zoneId() ? 'border-teal text-primary' : 'border-subtle text-secondary hover:text-primary'"
              >
                <span>{{ z.name }}</span>
                @if (l.libelle) { <span class="text-[10px] text-tertiary">{{ l.libelle }}</span> }
              </button>
            }
          </div>
          <button type="button" [class]="PASTILLE + ' ' + PASTILLE_INACTIVE + ' self-start'" (click)="ouvert.set(false)" data-fermer>Fermer</button>
        </div>
      }
    </div>
  `,
})
export class ChoixZoneAnalyseeComponent {
  private readonly api = inject(ZonesCustomApi);
  private readonly auth = inject(AuthService);
  private readonly catalogue = inject(CatalogueIndicateursService);

  /** La zone analysée courante (`ZoneAnalyseeService.zoneId()`), lue en fonction (P-d). */
  readonly zoneId = input<string | null>(null);
  /** L'id choisi, ou `null` (« Retirer »). */
  readonly choisie = output<string | null>();

  protected readonly LIBELLE_CHAMP = LIBELLE_CHAMP;
  protected readonly LISTE_CHAMP = LISTE_CHAMP;
  protected readonly PASTILLE = PASTILLE;
  protected readonly PASTILLE_INACTIVE = PASTILLE_INACTIVE;

  protected readonly ouvert = signal(false);
  protected readonly filtre = signal('');
  private readonly lecture = new LectureAnnulable<ZoneCustomResume[]>((e) => (e === SANS_ESPACE ? SANS_ESPACE : messageErreurRequete(e)));
  protected readonly zones = computed(() => this.lecture.resultat() ?? []);
  protected readonly chargement = this.lecture.enCours.asReadonly();
  protected readonly erreur = this.lecture.erreur.asReadonly();
  /** Le catalogue d'indicateurs, pour nommer un seuil sur territoires (sinon l'identifiant s'affiche ; un échec se tait). */
  private readonly lectureIndicateurs = new LectureAnnulable<readonly IndicateurRegistre[]>(() => '');
  private readonly indicateurs = computed(() => this.lectureIndicateurs.resultat() ?? []);
  private readonly seuilListe = computed(() => this.zones().some((z) => z.recette?.type === 'seuil_territoire'));

  /** Les zones dont le nom contient le filtre (sans casse ni accents), avec le libellé de leur recette. */
  protected readonly zonesFiltrees = computed(() => {
    const f = plierTexte(this.filtre());
    return this.zones()
      .filter((z) => !f || plierTexte(z.name).includes(f))
      .map((z) => ({ z, libelle: z.recette ? libelleRecette(z.recette, this.indicateurs()) : null }));
  });
  protected readonly zoneChoisie = computed(() => {
    const id = this.zoneId();
    return id ? this.zones().find((z) => z.id === id) ?? null : null;
  });
  protected readonly recetteChoisie = computed(() => {
    const z = this.zoneChoisie();
    return z?.recette ? libelleRecette(z.recette, this.indicateurs()) : null;
  });


  constructor() {
    // Une zone déjà choisie (lien) : la liste est lue pour dire son nom. Aucune zone : rien n'est lu.
    effect(() => {
      if (this.zoneId()) untracked(() => this.charger());
    });
    // Le patron de « Mes zones » : une lecture, seulement si un seuil sur territoires est listé.
    effect(() => {
      if (this.seuilListe()) untracked(() => this.lectureIndicateurs.chargerUneFois(() => this.catalogue.charger()));
    });
  }

  protected ouvrir(): void {
    this.ouvert.set(true);
    this.charger();
  }

  protected choisir(id: string): void {
    this.ouvert.set(false);
    this.filtre.set('');
    this.choisie.emit(id);
  }

  /** Une lecture par composant, et seulement avec un espace. */
  private charger(): void {
    this.lecture.chargerUneFois(() => from(this.auth.lireProfil()).pipe(
      switchMap((p) => (p?.organisation
        ? this.api.lister(new URLSearchParams({ org_id: p.organisation, _t: String(Date.now()) })).pipe(map((r) => r.zones ?? []))
        : throwError(() => SANS_ESPACE))),
    ));
  }
}
