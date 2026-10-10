import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { CouleursService } from '../../../core/theme/couleurs.service';
import {
  REGIME_CARTE, poserCouchesZones, repeindreCouchesZones, retirerCouchesZones,
} from '../../risques/cartes/couches-zones';
import { ZonesRisqueApi } from '../../risques/data/zones-risque.api';
import { codeProfil } from '../../risques/logique/code-profil';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import type { PontCarte, ZonesAAfficher } from '../etat/pont-carte';

/** Les teintes des zones : une par niveau, plus le halo des étiquettes (inversé entre thèmes). */
const JETONS_ZONES = { haut: 'niveau-haut', bas: 'niveau-bas', autres: 'niveau-autres', halo: 'halo-carte' } as const;

/** Marge du recadrage (`ZonesRisqueLayer.tsx:118-121`) : collées au cadre, on ne verrait plus que les zones s'arrêtent. */
const RECADRAGE = { padding: 48, duration: 900 } as const;

/**
 * Les zones de risque d'un profil sur la carte PRINCIPALE — portage de `app/map/_components/ZonesRisqueLayer.tsx`
 * (lot 4, T13). C'est aussi le pont que le module risque appelle (`PONT_CARTE`, arbitrage B3) : `CartePage` le fournit
 * sous ce jeton, et « Voir sur la carte » n'a affaire qu'à l'interface.
 *
 * ── RIEN N'EST RECOPIÉ DU MODULE ─────────────────────────────────────────
 * Source, couches, repeinture : `couches-zones.ts` du lot 3, tel quel, avec le régime de zoom de la carte principale
 * (`REGIME_CARTE` : chaque bande dès le plancher des tuiles, comme React). Les tuiles viennent de la MÊME adresse que
 * la carte du module (`urlTuilesZones`), natures comprises.
 *
 * ── DEUX DÉFAUTS DE REACT CORRIGÉS ───────────────────────────────────────
 * - Les natures : `ZonesRisqueLayer` demandait les tuiles du profil SEUL — la carte montrait les anneaux de toutes les
 *   natures sous un module filtré sur une seule (B3). Ici `natures` entre dans l'adresse des tuiles.
 * - Le dégradé : React ne réclamait jamais `zones-risque` (`onProfil` n'était pas branché), les zones s'empilaient donc
 *   avec l'IRIS ou les carreaux. Ici, les afficher RÉCLAME le dégradé — l'ancien est évincé et annoncé — et une
 *   éviction les éteint.
 *
 * ── CYCLE DE VIE ─────────────────────────────────────────────────────────
 * Un `effect` sur `carteCourante` re-pose la couche sur une carte recréée par un changement de fond (B11) ; une
 * bascule de thème ne fait que repeindre. Changer de profil RECRÉE la source : MapLibre ne réécrit pas l'URL d'une
 * source vectorielle, et la garder servirait les tuiles de l'ancien profil sous la légende du nouveau.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class ZonesRisqueService implements PontCarte {
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(ZonesRisqueApi);
  private readonly teintes = inject(CouleursService).palette(JETONS_ZONES);

  private readonly zones = signal<ZonesAAfficher | null>(null);
  /** Les zones affichées (profil et natures), `null` couche éteinte — lu par la légende. */
  readonly affichees = this.zones.asReadonly();

  /** L'adresse des tuiles : une chaîne, donc un nouveau profil au même code ne repose rien. */
  private readonly url = computed(() => {
    const z = this.zones();
    return z ? this.api.urlTuilesZones(codeProfil(z.profil), [...z.natures]) : null;
  });
  /** L'instance qui porte les couches — la repeinture n'écrit que là. */
  private readonly posee = signal<maplibregl.Map | null>(null);

  constructor() {
    // Évincée par un autre dégradé (IRIS, carreaux…) ou effacée par « Tout effacer » : la couche s'éteint. Effacer
    // remet le dégradé à zéro (`toutEffacer` de la page) ; laisser les zones peintes en ferait une couleur sans légende.
    this.etat.surEviction('zones-risque', () => this.zones.set(null));
    this.couches.inscrireEffacement('zones-risque', () => this.zones.set(null));

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const url = this.url();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      if (!url) {
        untracked(() => this.retirer(carte));
        return;
      }
      nettoyer(quandStyleCharge(carte, () => untracked(() => {
        poserCouchesZones(carte, {
          url, teintes: this.teintes(), profil: this.zones()!.profil, visible: true, regime: REGIME_CARTE,
        });
        this.posee.set(carte);
      })));
    });

    effect(() => {
      const carte = this.posee();
      if (carte) repeindreCouchesZones(carte, this.teintes());
    });
  }

  afficherZonesRisque(d: ZonesAAfficher | null): void {
    if (!d) {
      this.zones.set(null);
      this.etat.basculerDegrade('zones-risque', false);
      return;
    }
    // Le dégradé AVANT les zones : l'éviction de l'ancien part dans le même geste, son annonce aussi.
    this.etat.basculerDegrade('zones-risque', true);
    this.zones.set({ profil: d.profil, natures: [...d.natures] });
    const b = d.recadrer;
    if (b) this.couches.carteCourante()?.fitBounds([[b[0], b[1]], [b[2], b[3]]], RECADRAGE);
  }

  private retirer(carte: maplibregl.Map): void {
    retirerCouchesZones(carte);
    this.posee.set(null);
  }
}
