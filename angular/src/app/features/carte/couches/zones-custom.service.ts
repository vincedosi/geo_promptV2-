import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import type { Subscription } from 'rxjs';
import { type ZoneCustomResume, ZonesCustomApi } from '../data/zones-custom.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { bboxDeZone, couleurZone, messageHttp } from '../logique/zones/zones-affichees';
import { poserZoneCustom, retirerZoneCustom } from './couche-zones-custom';

/** Le recadrage sur une zone affichée (`ZonesOverlay.tsx:245`). */
const RECADRAGE = { padding: 50, duration: 800 } as const;

/** Une zone sur la carte : ce que React gardait dans `loadedZones`, plus la donnée à re-poser après un changement de fond. */
interface ZoneAffichee {
  id: string;
  name: string;
  couleur: string;
  entite: GeoJSON.Feature;
}

/**
 * Les zones enregistrées affichées sur la carte principale — l'affichage de `ZonesOverlay.tsx` (« Afficher »,
 * « Masquer », `onLoadedZonesChange`), sorti du panneau (lot 4, T14).
 *
 * ── L'ÉTAT VIT ICI, PAS DANS LE PANNEAU ──────────────────────────────────
 * React gardait `loadedZones` dans l'overlay, démonté à chaque fermeture, et le RECONSTRUISAIT au montage en relisant
 * les sources `custom-zone-*` du style MapLibre (`ZonesOverlay.tsx:118-142`). Ici le service est fourni par la page :
 * fermer le panneau ne perd rien, il n'y a rien à reconstruire.
 *
 * ── UNE RÉCONCILIATION, PAS DES ORDRES ───────────────────────────────────
 * Un seul `effect` rend la carte conforme à `zones` : il pose ce qui manque et retire ce qui n'y est plus. Il couvre
 * d'un même geste « Afficher », « Masquer », « Tout effacer » et la carte recréée par un changement de fond (B11), où
 * les zones reviennent dans l'ordre où elles avaient été affichées (même empilement que React).
 *
 * ── DÉFAUT DE REACT CORRIGÉ ──────────────────────────────────────────────
 * « Tout effacer » retirait les couches mais laissait `loadedZones` intact : la carte de zone affichait encore
 * « Masquer » devant une zone disparue, et le plan média la comptait toujours. Ici l'état et la carte s'effacent
 * ensemble, et une lecture de géométrie encore en vol est abandonnée.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class ZonesCustomService {
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(ZonesCustomApi);

  private readonly zones = signal<readonly ZoneAffichee[]>([]);
  /** Les zones affichées, dans l'ordre d'affichage — ce que le plan média lit (`onLoadedZonesChange`, T15). */
  readonly zonesAffichees = computed(() => this.zones().map(({ id, name }) => ({ id, name })));
  /** La teinte de chaque zone affichée (point et bordure de sa carte dans le panneau). */
  readonly couleurs = computed(() => new Map(this.zones().map((z) => [z.id, z.couleur])));
  /** La zone dont la géométrie est en lecture (`pendingZoneId`). */
  readonly enCours = signal<string | null>(null);
  /** Le dernier échec d'affichage (`setError` de l'overlay), affiché par le panneau. */
  readonly erreur = signal<string | null>(null);

  private readonly lectures = new Map<string, Subscription>();
  /** L'instance qui porte les couches et les zones qui y sont posées — pour retirer sans relire le style. */
  private instance: maplibregl.Map | null = null;
  private readonly posees = new Set<string>();

  constructor() {
    this.couches.inscrireEffacement('zones-custom', () => this.effacer());

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const zones = this.zones();
      if (carte !== this.instance) {
        this.instance = carte;
        this.posees.clear();
      }
      if (!carte) return;
      nettoyer(quandStyleCharge(carte, () => untracked(() => this.synchroniser(carte, zones))));
    });

    inject(DestroyRef).onDestroy(() => this.abandonnerLectures());
  }

  /**
   * « Afficher » (`showZoneOnMap`, `ZonesOverlay.tsx:203-259`) : lit la géométrie, prend la teinte suivante, ajoute la
   * zone puis recadre sur son emprise. Sans carte, ou zone déjà affichée ou en lecture : rien, comme React.
   */
  afficher(zone: ZoneCustomResume): void {
    if (!this.couches.carteCourante() || this.lectures.has(zone.id) || this.zones().some((z) => z.id === zone.id)) return;
    this.enCours.set(zone.id);
    const lecture = this.api.geometrie(zone.id).subscribe({
      next: (f) => {
        this.terminer(zone.id);
        this.zones.update((zs) => [...zs, {
          id: zone.id,
          name: zone.name,
          couleur: couleurZone(zs.length),
          entite: {
            type: 'Feature',
            properties: { name: zone.name, source_type: zone.source_type, ...f.properties },
            geometry: f.geometry as GeoJSON.Geometry,
          },
        }]);
        const b = bboxDeZone(zone.bbox, f.geometry);
        if (b) this.couches.carteCourante()?.fitBounds([[b[0], b[1]], [b[2], b[3]]], RECADRAGE);
      },
      error: (e: unknown) => {
        this.terminer(zone.id);
        this.erreur.set(messageHttp(e, 'Erreur affichage zone'));
      },
    });
    this.lectures.set(zone.id, lecture);
  }

  /** « Masquer » (`hideZoneFromMap`). */
  masquer(id: string): void {
    this.zones.update((zs) => zs.filter((z) => z.id !== id));
  }

  /** « Tout effacer », changement d'organisation : plus aucune zone, ni sur la carte ni en lecture. */
  effacer(): void {
    this.abandonnerLectures();
    this.zones.set([]);
  }

  private terminer(id: string): void {
    this.lectures.delete(id);
    if (this.enCours() === id) this.enCours.set(null);
  }

  private abandonnerLectures(): void {
    for (const l of this.lectures.values()) l.unsubscribe();
    this.lectures.clear();
    this.enCours.set(null);
  }

  private synchroniser(carte: maplibregl.Map, zones: readonly ZoneAffichee[]): void {
    const voulues = new Set(zones.map((z) => z.id));
    for (const id of [...this.posees]) {
      if (voulues.has(id)) continue;
      retirerZoneCustom(carte, id);
      this.posees.delete(id);
    }
    for (const z of zones) {
      poserZoneCustom(carte, z.id, z.entite, z.couleur);
      this.posees.add(z.id);
    }
  }
}
