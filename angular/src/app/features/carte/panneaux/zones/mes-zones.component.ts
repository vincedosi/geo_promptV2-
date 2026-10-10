import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { type Subscription, catchError, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { ZonesCustomService } from '../../couches/zones-custom.service';
import { type FormatExportZone, type StatsZones, type ZoneCustomResume, ZonesCustomApi } from '../../data/zones-custom.api';
import { ExportZoneService } from '../../etat/export-zone.service';
import { basculerDansSelection, selectionExistante } from '../../logique/zones/operations-zones';
import { getSourceTypeLabel } from '../../logique/zones/source-type-labels';
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
 * Recréé à chaque ouverture du panneau, comme l'overlay de React : liste, recherche, puces et sélection repartent de
 * zéro. Les zones AFFICHÉES, elles, vivent dans `ZonesCustomService` (page) : elles restent sur la carte panneau fermé
 * et chaque carte les retrouve à la réouverture.
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
              [rang]="l.rang"
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
  private readonly exports = inject(ExportZoneService);
  protected readonly affichage = inject(ZonesCustomService);

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
  /** Relecture demandée par ce composant (opération, suppression), en plus de `rafraichir`. */
  private readonly relecture = signal(0);

  /** Chaque carte avec ce qu'elle montre de l'affichage et de la sélection (aucune méthode appelée dans le gabarit). */
  protected readonly lignes = computed(() => {
    const couleurs = this.affichage.couleurs();
    const enCours = this.affichage.enCours();
    const selection = this.selection();
    return this.zones().map((zone) => ({
      zone, couleur: couleurs.get(zone.id) ?? null, enCours: enCours === zone.id, rang: selection.indexOf(zone.id),
    }));
  });
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
        const l = getSourceTypeLabel(t);
        return { id: t, libelle: l.label, mono: !l.isReadable, actif: actif === t };
      }),
    ];
  });

  private lecture: Subscription | null = null;
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

    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      clearTimeout(this.minuterie);
      this.lecture?.unsubscribe();
    });
  }

  protected rechercher(q: string): void {
    this.recherche.set(q);
  }

  protected basculer(id: string): void {
    this.selection.update((s) => basculerDansSelection(s, id));
  }

  /** `onTermine` : sélection vidée, liste relue. */
  protected apresOperation(): void {
    this.selection.set([]);
    this.relecture.update((n) => n + 1);
  }

  /** Script DV360 ou ciblage TikTok : un échec s'affiche dans le bandeau d'erreur (React ne l'écrivait qu'en console). */
  protected exporter(id: string, format: FormatExportZone): void {
    void this.exports.exporter(id, format).then((echec) => {
      if (echec && !this.detruit) this.erreur.set(echec);
    });
  }

  /**
   * La suppression confirmée (`handleDelete`, `ZonesOverlay.tsx:301-308`) : la zone affichée quitte la carte, le
   * dialogue se ferme, la liste est relue. Un échec reste dans le dialogue (« HTTP 409 » quand une stratégie ou un
   * composite la référence encore, comme React).
   */
  protected readonly supprimer = async (): Promise<string | null> => {
    const zone = this.aSupprimer();
    if (!zone) return null;
    try {
      await firstValueFrom(this.api.supprimer(zone.id));
    } catch (e) {
      return messageHttp(e, 'Échec de la suppression');
    }
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
