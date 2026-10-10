import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { BatailleService } from '../couches/bataille.service';
import { ZonesCustomApi } from '../data/zones-custom.api';
import { CATEGORIE_ZONE, PARAM_ZONE_LIEN, creneauDepuisZone, zoneDeCle } from '../logique/zones/zone-du-lien';
import { messageHttp } from '../logique/zones/zones-affichees';
import { AnnonceService } from './annonce.service';
import { CouchesCarteService } from './couches-carte.service';

/** Le recadrage sur la zone du lien (`page.tsx:832`). */
const RECADRAGE = { padding: 60, duration: 1000 } as const;
/** Le nom de repli du bouton « Script bidding DV360 » (`page.tsx:1380`). */
const NOM_REPLI = 'zone custom';

/**
 * Le lien `?customZone=<id>` de la carte — portage de `app/map/page.tsx:771-839` (lot 4, T14), arbitrage B9 : le seul
 * état de carte que React lise dans l'URL, avec `risque`.
 *
 * ── LU UNE FOIS, CARTE PRÊTE ─────────────────────────────────────────────
 * La géométrie n'est demandée qu'une fois la carte publiée (`mapReady`), et une seule fois par id
 * (`customZoneLoadedRef`) : une autre navigation de requête (le module risque écrit `risque=`), un changement de fond
 * qui recrée la carte, ne la redemandent pas. La zone REMPLIT le créneau de bataille — groupe unique, palier 1, clé
 * `cg__<id>` — puis la carte se recadre sur son emprise (60 px, 1 s).
 *
 * ── LE BOUTON « SCRIPT BIDDING DV360 » ───────────────────────────────────
 * `zoneDuLien` n'existe que tant que le créneau porte une clé `cg__` : une bataille qui le remplace (T17), « Tout
 * effacer », le font disparaître — comme `battleCacheKey?.startsWith('cg__')` dans React.
 *
 * ── « TOUT EFFACER » NETTOIE L'URL ───────────────────────────────────────
 * Comme React (`page.tsx:760-763`), pour qu'un rechargement ne rouvre pas la zone. Seul `customZone` est retiré
 * (navigation relative, `replaceUrl`) : les autres paramètres ne sont pas à la carte.
 *
 * Défaut de React corrigé : une zone introuvable ne laissait qu'un `console.warn` ; ici une annonce le dit.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class LienZoneService {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ZonesCustomApi);
  private readonly couches = inject(CouchesCarteService);
  private readonly bataille = inject(BatailleService);
  private readonly annonce = inject(AnnonceService);

  /** L'id demandé par l'URL, à chaque navigation. */
  private readonly demande = signal<string | null>(null);
  /** `customZoneLoadedRef` : le dernier id lu — jamais deux lectures pour le même. */
  private derniere: string | null = null;
  private lecture: Subscription | null = null;

  /** La zone du créneau quand elle vient d'un lien : de quoi poser et nommer le bouton DV360. */
  readonly zoneDuLien = computed(() => {
    const id = zoneDeCle(this.bataille.cle());
    return id ? { id, nom: this.bataille.pois()[0]?.nom ?? NOM_REPLI } : null;
  });

  constructor() {
    const parametres = this.route.queryParamMap.subscribe((p) => this.demande.set(p.get(PARAM_ZONE_LIEN)));

    effect(() => {
      const carte = this.couches.carteCourante();
      const id = this.demande();
      if (!carte || !id || id === this.derniere) return;
      this.derniere = id;
      untracked(() => this.charger(id));
    });

    this.couches.inscrireEffacement('lien-custom-zone', () => this.retirerDeLUrl());

    inject(DestroyRef).onDestroy(() => {
      parametres.unsubscribe();
      this.lecture?.unsubscribe();
    });
  }

  /** Changement d'organisation : la zone du lien appartient à l'ancienne — le créneau et l'URL la lâchent. */
  oublier(): void {
    if (!this.zoneDuLien()) return;
    this.bataille.effacer();
    this.retirerDeLUrl();
  }

  private charger(id: string): void {
    this.lecture?.unsubscribe();
    this.lecture = this.api.geometrie(id).subscribe({
      next: (f) => {
        const c = creneauDepuisZone(f);
        if (!c) return;
        this.bataille.appliquer({ anneaux: c.anneaux, pois: [c.poi], cle: c.cle, categorie: CATEGORIE_ZONE });
        const b = c.bbox;
        if (b) this.couches.carteCourante()?.fitBounds([[b[0], b[1]], [b[2], b[3]]], RECADRAGE);
      },
      error: (e: unknown) => this.annonce.annoncer(`La zone du lien n’a pas pu être chargée (${messageHttp(e, 'erreur réseau')}).`),
    });
  }

  private retirerDeLUrl(): void {
    if (!untracked(this.demande)) return;
    void this.router.navigate([], {
      relativeTo: this.route, queryParams: { [PARAM_ZONE_LIEN]: null }, queryParamsHandling: 'merge', replaceUrl: true,
    });
  }
}
