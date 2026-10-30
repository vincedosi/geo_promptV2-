import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { type Subscription, catchError, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { ZonesCustomService } from '../../couches/zones-custom.service';
import { type FormatExportZone, type StatsZones, type ZoneCustomResume, ZonesCustomApi } from '../../data/zones-custom.api';
import { ZonesApi } from '../../data/zones.api';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { ExportZoneService } from '../../etat/export-zone.service';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import type { IndicateurRegistre } from '../../logique/analyses/score';
import {
  MESSAGE_REPONSE_PERDUE, avecId, estRefusReferencee, estReponsePerdue, issueDuplication, issueRecalcul, lignesDeZones, nomDeCopie, sansId,
} from '../../logique/zones/gestes-zone';
import { libelleSource } from '../../logique/zones/libelle-zone';
import { basculerDansSelection, selectionExistante } from '../../logique/zones/operations-zones';
import { messageErreurZone } from '../../logique/zones/perimetre-recette';
import { messageHttp, typesDeSource } from '../../logique/zones/zones-affichees';
import { CarteZoneComponent } from './carte-zone.component';
import { DialogueSuppressionZoneComponent } from './dialogue-suppression-zone.component';
import { OperationsZonesComponent } from './operations-zones.component';

/** L'anti-rebond de la recherche (`setTimeout(fetchAll, searchQuery ? 200 : 0)`, `ZonesOverlay.tsx:190`). */
const ANTI_REBOND_RECHERCHE_MS = 200;

/**
 * « Mes zones » — `components/map/overlays/ZonesOverlay.tsx` (lot 4, T14) : chiffres de l'organisation, recherche,
 * puces par type de source, opérations booléennes, cartes des zones, dialogue de suppression.
 *
 * ── CE QUI VIT ICI, CE QUI VIT AILLEURS ──────────────────────────────────
 * Monté dans l'outil « Mes zones » de la boîte à outils (depuis le 2026-10-13), à sa PREMIÈRE ouverture, puis gardé
 * (ruling AT-6) : liste, recherche, puces et sélection survivent à la fermeture du tiroir — React, lui, les remettait à
 * zéro à chaque ouverture de l'overlay. Les zones AFFICHÉES vivent dans `ZonesCustomService` (page) : elles restent sur
 * la carte tiroir fermé.
 *
 * ── LECTURES ─────────────────────────────────────────────────────────────
 * Liste ET chiffres ensemble (`Promise.all`, deux appels), avec l'organisation ACTIVE du profil (même source que le
 * panneau Filtre, T5) et un horodatage anti-cache. Relues à chaque changement de recherche (200 ms d'anti-rebond, 0 au
 * vidage), de type de source, après une opération, une suppression, ou une création (`rafraichir`, T16) ; la lecture
 * précédente est annulée. Un échec des chiffres n'empêche pas la liste, comme React.
 *
 * `rafraichir` est un DÉCLENCHEUR, jamais une clé de recréation : recréer ce composant ferait perdre la sélection.
 */
@Component({
  selector: 'mg-mes-zones',
  imports: [CarteZoneComponent, DialogueSuppressionZoneComponent, IconeComponent, OperationsZonesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Le catalogue d'indicateurs est celui de la PAGE (X4) : le même que ③ et Analyse, une seule lecture.
  host: { class: 'block' },
  template: `
    @if (org() === undefined) {
      <div data-etat class="p-4 text-[12px] text-tertiary">Chargement…</div>
    } @else if (org() === null) {
      <div data-etat class="p-4 text-[12px] text-tertiary">Aucun workspace actif.</div>
    } @else {
      <div class="flex flex-col gap-3 px-[14px] pb-4 pt-3">
        @if (stats(); as s) {
          <div data-stats class="flex gap-3.5 text-[11px] text-tertiary">
            <span><strong class="font-mono font-bold text-primary">{{ s.total }}</strong> {{ s.libelleZones }}</span>
            <span><strong class="font-mono font-bold text-teal">{{ s.iris }}</strong> IRIS</span>
            <span><strong class="font-mono font-bold">{{ s.cp }}</strong> CP</span>
          </div>
        }

        <div class="relative">
          <mg-icone nom="loupe" [taille]="12" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-tertiary" />
          <input
            data-recherche
            placeholder="Rechercher…"
            class="w-full rounded-[6px] border-fin border-subtle bg-elevated px-[26px] py-1.5 text-[12px] text-primary outline-none"
            [value]="recherche()"
            (input)="rechercher($any($event.target).value)"
          />
          @if (recherche()) {
            <button type="button" data-vider aria-label="Effacer la recherche" class="absolute right-1.5 top-1/2 flex -translate-y-1/2 cursor-pointer border-0 bg-transparent p-0 text-tertiary" (click)="rechercher('')">
              <mg-icone nom="croix" [taille]="11" />
            </button>
          }
        </div>

        @if (puces(); as liste) {
          <div data-puces class="flex flex-wrap gap-1">
            @for (p of liste; track p.id) {
              <button
                type="button"
                [attr.data-puce]="p.id ?? 'tous'"
                [attr.aria-pressed]="p.actif"
                class="cursor-pointer rounded-[4px] border-fin px-2 py-[3px] text-[10px] transition-all duration-150 ease-[var(--ease-hover)]"
                [class]="p.actif ? 'border-teal bg-teal-10 text-teal' : 'border-subtle bg-transparent text-tertiary'"
                [class.font-mono]="p.mono"
                (click)="typeSource.set(p.id)"
              >{{ p.libelle }}</button>
            }
          </div>
        }

        @if (erreur(); as e) {
          <div data-erreur role="alert" class="erreur rounded-[4px] p-2 text-[11px] text-danger">{{ e }}</div>
        }
        @if (avis(); as a) {
          <div data-avis role="status" class="rounded-[4px] border-fin border-subtle p-2 text-[11px] text-secondary">{{ a }}</div>
        }
        @if (chargement() && zones().length === 0) {
          <div data-etat class="p-4 text-[12px] text-tertiary">Chargement…</div>
        }
        @if (!chargement() && zones().length === 0) {
          <div data-vide class="px-1 py-3 text-[11px] leading-[1.6] text-tertiary">
            Aucune zone sauvegardée. Utilise le bouton « Sauvegarder la vue » pour créer ta première zone.
          </div>
        }

        <mg-operations-zones [selection]="selection()" [noms]="noms()" [org]="org()!" (termine)="apresOperation()" />

        <div class="flex flex-col gap-2">
          @for (l of lignes(); track l.zone.id) {
            <mg-carte-zone
              [zone]="l.zone"
              [couleur]="l.couleur"
              [enCours]="l.enCours"
              [recalculEnCours]="l.recalcul"
              [indicateurs]="indicateurs()"
              [rang]="l.rang"
              [referencee]="l.referencee"
              [duplicationEnCours]="l.duplication"
              (recalculer)="recalculer(l.zone.id)"
              (dupliquer)="dupliquer(l.zone)"
              (afficher)="affichage.afficher(l.zone)"
              (masquer)="affichage.masquer(l.zone.id)"
              (supprimer)="aSupprimer.set(l.zone)"
              (basculer)="basculer(l.zone.id)"
              (exporter)="exporter(l.zone.id, $event)"
            />
          }
        </div>
      </div>

      @if (aSupprimer(); as z) {
        <mg-dialogue-suppression-zone [nom]="z.name" [confirmer]="supprimer" (fermer)="aSupprimer.set(null)" />
      }
    }
  `,
  // rgba(255,87,87,0.08) de React : le jeton danger à 8 %.
  styles: `.erreur { background: color-mix(in srgb, var(--danger) 8%, transparent); }`,
})
export class MesZonesComponent {
  private readonly api = inject(ZonesCustomApi);
  private readonly zonesApi = inject(ZonesApi);
  private readonly catalogue = inject(CatalogueIndicateursService);
  private readonly exports = inject(ExportZoneService);
  protected readonly affichage = inject(ZonesCustomService);
  /** ⑤ (page) : averti d'un recalcul, il relit la date de sa zone. Facultatif : ce panneau se monte aussi sans ⑤ (tests). */
  private readonly jeu = inject(JeuZonesService, { optional: true });

  /** Incrémenté par le parent après une création de zone (T16) : relit la liste sans recréer ce composant. */
  readonly rafraichir = input(0);

  /** `undefined` tant que le profil est en lecture (« Chargement… »), `null` sans organisation active. */
  protected readonly org = signal<string | null | undefined>(undefined);
  protected readonly zones = signal<ZoneCustomResume[]>([]);
  private readonly statsBrutes = signal<StatsZones | null>(null);
  protected readonly chargement = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly recherche = signal('');
  protected readonly typeSource = signal<string | null>(null);
  /** Les zones cochées, dans l'ORDRE de cochage (la première est la base d'une soustraction). */
  protected readonly selection = signal<string[]>([]);
  protected readonly aSupprimer = signal<ZoneCustomResume | null>(null);
  /** Relecture demandée par ce composant (opération, suppression, recalcul), en plus de `rafraichir`. */
  private readonly relecture = signal(0);
  /** Les zones dont le recalcul est en vol (une à la fois par zone : le second clic est ignoré). */
  protected readonly recalculs = signal<ReadonlySet<string>>(new Set());
  /** Zones au dernier recalcul refusé (citées par un plan, 409) ; zones à la duplication en vol (second clic ignoré). */
  private readonly referencees = signal<ReadonlySet<string>>(new Set());
  private readonly duplications = signal<ReadonlySet<string>>(new Set());
  /** L'issue d'un geste réussi à dire : recalcul ou duplication incomplets (207), duplication faite. */
  protected readonly avis = signal<string | null>(null);
  /** La barre des opérations : sa réussite s'efface au geste suivant (preuve T7, D-5). */
  private readonly operations = viewChild(OperationsZonesComponent);

  /** Chaque carte avec ce qu'elle montre de l'affichage et de la sélection (aucune méthode appelée dans le gabarit). */
  protected readonly lignes = computed(() => lignesDeZones(this.zones(), {
    couleurs: this.affichage.couleurs(), enCours: this.affichage.enCours(), selection: this.selection(),
    recalculs: this.recalculs(), referencees: this.referencees(), duplications: this.duplications(),
  }));
  /**
   * Le catalogue d'indicateurs, pour nommer un seuil sur territoires : lu UNE fois, et seulement quand un tel seuil
   * est listé (aucune lecture à l'ouverture sinon — pas de préchargement, CLAUDE.md).
   */
  protected readonly indicateurs = signal<readonly IndicateurRegistre[]>([]);
  private readonly seuilListe = computed(() => this.zones().some((z) => z.recette?.type === 'seuil_territoire'));
  protected readonly noms = computed(() => new Map(this.zones().map((z) => [z.id, z.name])));
  protected readonly stats = computed(() => {
    const s = this.statsBrutes();
    if (!s) return null;
    const total = s.total ?? 0;
    return {
      total, libelleZones: `zone${total > 1 ? 's' : ''}`,
      iris: formaterNombre(s.total_iris ?? 0), cp: formaterNombre(s.total_cp ?? 0),
    };
  });
  /** « Tous » puis un type par puce, seulement à partir de deux types (`availableSourceTypes.length > 1`). */
  protected readonly puces = computed(() => {
    const types = typesDeSource(this.zones());
    if (types.length <= 1) return null;
    const actif = this.typeSource();
    return [
      { id: null, libelle: 'Tous', mono: false, actif: actif === null },
      ...types.map((t) => {
        const l = libelleSource(t);
        return { id: t, libelle: l.label, mono: !l.isReadable, actif: actif === t };
      }),
    ];
  });

  private lecture: Subscription | null = null;
  private lectureCatalogue: Subscription | null = null;
  private readonly vols = new Map<string, Subscription>();
  /** Les zones affichées recalculées dont la forme attend la liste relue pour être redessinée. */
  private readonly aRelire = new Set<string>();
  private minuterie: ReturnType<typeof setTimeout> | undefined;
  private detruit = false;

  constructor() {
    void inject(AuthService).lireProfil().then((p) => {
      if (!this.detruit) this.org.set(p?.organisation ?? null);
    });

    effect(() => {
      const org = this.org();
      const q = this.recherche();
      const type = this.typeSource();
      this.rafraichir();
      this.relecture();
      if (!org) return;
      clearTimeout(this.minuterie);
      this.minuterie = setTimeout(() => untracked(() => this.charger(org, q, type)), q ? ANTI_REBOND_RECHERCHE_MS : 0);
    });

    effect(() => {
      if (!this.seuilListe() || this.lectureCatalogue) return;
      this.lectureCatalogue = untracked(() => this.catalogue.charger().subscribe({
        next: (liste) => this.indicateurs.set(liste),
        // Sans catalogue, l'identifiant est affiché ; la prochaine liste qui porte un seuil relira.
        error: () => { this.lectureCatalogue = null; },
      }));
    });

    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      clearTimeout(this.minuterie);
      this.lecture?.unsubscribe();
      this.lectureCatalogue?.unsubscribe();
      for (const v of this.vols.values()) v.unsubscribe();
    });
  }

  /**
   * « Recalculer » (lot 3) : `POST /api/zones/[id]/recalculer`, une fois par zone à la fois. Réussite : liste relue, et
   * la zone, si elle est affichée, est redessinée avec sa nouvelle forme. Un 207 est une RÉUSSITE (la forme est
   * remplacée, seuls ses codes postaux n'ont pas été résolus) : il est dit, jamais renvoyé.
   *
   * Un échec est dit dans le bandeau (le message de la route : 409 « utilisée par un plan », 409 forme figée, 422…) et
   * ne touche pas à la liste. En particulier un 404 peut venir d'une zone MEMBRE supprimée d'une combinaison, et non de
   * la zone elle-même : on ne la retire donc pas de la liste sur la foi de ce statut.
   */
  protected recalculer(id: string): void {
    if (this.recalculs().has(id)) return;
    const zone = this.zones().find((z) => z.id === id);
    this.recalculs.update((s) => avecId(s, id));
    this.erreur.set(null);
    this.avis.set(null);
    this.operations()?.oublierMessage();
    this.vols.set(id, this.zonesApi.recalculer(id).subscribe({
      next: (r) => {
        this.retirerRecalcul(id);
        const avis = issueRecalcul(r, zone?.name ?? '');
        if (avis) this.avis.set(avis);
        // Affichée : redessinée EN PLACE (même teinte, même rang) à l'arrivée de la liste relue, qui porte le nom et
        // l'emprise frais de la zone — la zone d'avant le recalcul n'est plus la bonne.
        if (this.affichage.couleurs().has(id)) this.aRelire.add(id);
        this.relecture.update((n) => n + 1);
        // ⑤ ne doit pas montrer l'ancienne forme quand son extraction calculerait sur la nouvelle (revue finale lot 5).
        this.jeu?.zoneRecalculee(id);
      },
      error: (e: { status?: number; error?: unknown }) => {
        this.retirerRecalcul(id);
        if (estRefusReferencee(e)) this.referencees.update((s) => avecId(s, id));
        this.erreur.set(messageErreurZone(e));
      },
    }));
  }

  private retirerRecalcul(id: string): void {
    this.vols.delete(id);
    this.recalculs.update((s) => sansId(s, id));
  }

  /**
   * « Dupliquer » / « Recalculer dans une nouvelle zone » (③ finitions, T5) : `POST /api/zones/[id]/dupliquer`, une fois
   * par zone à la fois. Réussite (200, 207) ou réponse perdue (dite dans l'avis, que la relecture n'efface pas) : la
   * liste est relue, la zone existe peut-être. Un refus (404, 409, 422, 429) n'a rien écrit : il est dit, sans relecture.
   */
  protected dupliquer(zone: ZoneCustomResume): void {
    if (this.duplications().has(zone.id)) return;
    const nom = nomDeCopie(zone.name);
    const fin = (avis: string | null) => {
      this.vols.delete(`d:${zone.id}`); this.duplications.update((s) => sansId(s, zone.id));
      if (avis) { this.avis.set(avis); this.relecture.update((n) => n + 1); }
    };
    this.duplications.update((s) => avecId(s, zone.id));
    this.erreur.set(null); this.avis.set(null);
    this.operations()?.oublierMessage();
    this.vols.set(`d:${zone.id}`, this.zonesApi.dupliquer(zone.id, nom).subscribe({
      next: (r) => fin(issueDuplication(r, nom)),
      error: (e: { status?: number; error?: unknown }) => {
        fin(estReponsePerdue(e) ? MESSAGE_REPONSE_PERDUE : null);
        if (!estReponsePerdue(e)) this.erreur.set(messageErreurZone(e, 'Duplication impossible.'));
      },
    }));
  }

  protected rechercher(q: string): void {
    this.avis.set(null);
    this.recherche.set(q);
  }

  protected basculer(id: string): void {
    this.selection.update((s) => basculerDansSelection(s, id));
  }

  /** `onTermine` : sélection vidée, liste relue. */
  protected apresOperation(): void {
    this.avis.set(null);
    this.selection.set([]);
    this.relecture.update((n) => n + 1);
  }

  /** Ciblage TikTok : un échec s'affiche dans le bandeau d'erreur (React ne l'écrivait qu'en console). */
  protected exporter(id: string, format: FormatExportZone): void {
    void this.exports.exporter(id, format).then((echec) => {
      if (echec && !this.detruit) this.erreur.set(echec);
    });
  }

  /**
   * La suppression confirmée (`handleDelete`, `ZonesOverlay.tsx:301-308`) : la zone affichée quitte la carte, le
   * dialogue se ferme, la liste est relue. Un échec reste dans le dialogue. Le refus d'une zone CITÉE (409
   * `zone_referencee`, sql/253 : stratégie, jeu de zones, composite, combinaison, périmètre d'une recette) porte un
   * message français : il est affiché tel quel (React, et ce composant jusqu'au lot 3, disaient « HTTP 409 »), par
   * `messageErreurZone` comme les autres routes de zones ; les autres échecs gardent le message par statut de React
   * (« HTTP 404 »…), passé en défaut.
   */
  protected readonly supprimer = async (): Promise<string | null> => {
    const zone = this.aSupprimer();
    if (!zone) return null;
    try {
      await firstValueFrom(this.api.supprimer(zone.id));
    } catch (e) {
      return messageErreurZone(e as { status?: number; error?: unknown }, messageHttp(e, 'Échec de la suppression'));
    }
    this.avis.set(null);
    this.affichage.masquer(zone.id);
    this.aSupprimer.set(null);
    this.relecture.update((n) => n + 1);
    return null;
  };

  private charger(org: string, q: string, type: string | null): void {
    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.erreur.set(null);
    const horodatage = Date.now();
    const params = new URLSearchParams({ org_id: org, _t: String(horodatage) });
    if (type) params.set('source_type', type);
    if (q) params.set('q', q);
    this.lecture = forkJoin({
      liste: this.api.lister(params),
      // Comme React (`if (statsRes.ok)`) : des chiffres en échec gardent les précédents, sans faire échouer la liste.
      stats: this.api.stats(org, horodatage).pipe(map((s): StatsZones | null => s), catchError(() => of(null))),
    }).subscribe({
      next: ({ liste, stats }) => {
        const zones = liste.zones ?? [];
        this.zones.set(zones);
        for (const z of zones) {
          if (this.aRelire.delete(z.id)) this.affichage.relire(z);
        }
        const existants = new Set(zones.map((z) => z.id));
        this.selection.update((s) => selectionExistante(s, existants));
        if (stats) this.statsBrutes.set(stats);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageHttp(e, 'Erreur de chargement'));
        this.chargement.set(false);
      },
    });
  }
}
