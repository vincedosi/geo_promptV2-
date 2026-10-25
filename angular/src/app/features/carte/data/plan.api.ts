import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { ExecutionMode } from '../logique/plan/brouillon';
import type { CampaignChannels, ChannelBudgets, ChannelRow, StoredChannels } from '../logique/plan/canaux';
import type { CpExtraction } from '../logique/plan/impressions';
import type { DspLinks } from '../logique/plan/liens-plateformes';

/**
 * ⑥ Plan — les routes du plan de campagne vues de l'écran (lot 6, T2) : campagnes, canaux, stratégie-conteneur,
 * brouillon autosauvé, ressources DV360, mode démo, et les deux routes de T1 (`rattacher` avec extraction, CP d'une
 * extraction). Chaque type est écrit d'après la route LUE (seuls les champs que ⑥ lit sont typés).
 * La liste des jeux et de leurs extractions passe par `JeuxApi` (lot 5) : aucune méthode recopiée ici.
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`, `app.routes.ts`), jamais à la racine : un service racine recevrait le
 * `HttpClient` du shell, sans nos intercepteurs.
 */

/** Une ligne de `GET /api/admin/campaigns` (`dsp_campaigns.*` + organisation + agrégats), la plus récente d'abord. */
export interface CampagneListe {
  id: string;
  name: string;
  dsp_source: string;
  advertiser: string | null;
  product: string | null;
  date_start: string | null;
  date_end: string | null;
  organization_id: string | null;
  organization_name: string | null;
  is_demo: boolean;
  status_override: 'paused' | 'ended' | 'archived' | null;
  created_at: string;
  total_rows: number;
  last_data_date: string | null;
}

/** `campaign` de `GET /api/admin/campaigns/[id]` (`dsp_campaigns.*`) ; les stats et lignes de la réponse ne sont pas lues. */
export interface Campagne {
  id: string;
  name: string;
  advertiser: string | null;
  product: string | null;
  date_start: string | null;
  date_end: string | null;
  organization_id: string | null;
  is_demo: boolean;
}

/** `PATCH /api/admin/campaigns/[id]` : identité déclarée ; chaîne vide = effacement. */
export interface CorpsCampagne {
  name?: string;
  advertiser?: string | null;
  product?: string | null;
}

/** `GET /api/admin/campaigns/[id]/organizations`. */
export interface OrganisationsCampagne {
  owner_organization_id: string | null;
  organizations: Array<{ id: string; name: string; slug: string; added_at: string; is_owner: boolean }>;
}

/** `GET /api/campaigns/[campaignId]/channels`. */
export interface CanauxCampagne {
  catalog: ChannelRow[];
  connectedProviders: string[];
  is_demo: boolean;
  selected: StoredChannels;
}

/** `PUT /api/campaigns/[campaignId]/channels` (`ChannelsPutSchema`) : une sous-clé absente garde sa valeur serveur. */
export interface CorpsCanaux extends CampaignChannels {
  budgets?: ChannelBudgets;
  cpm_prevus?: ChannelBudgets;
  links?: DspLinks;
}

export type StatutStrategie = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

/** Une ligne de `GET /api/bidding/strategies?campaign_id=` : la plus récente de la campagne, seule. */
export interface StrategieListe {
  id: string;
  name: string;
  campaign_id: string;
  status: StatutStrategie;
  created_at: string;
}

/** `strategy` de `GET /api/bidding/strategies/[id]` (`FULL_SELECT`), réduite aux champs que ⑥ lit. */
export interface Strategie {
  id: string;
  campaign_id: string;
  status: StatutStrategie;
  objective_code: string;
  execution_mode: ExecutionMode;
  start_date: string | null;
  end_date: string | null;
  total_budget: number | null;
  forecast_cpm: number | null;
  kpi_target: number | null;
  in_zone_weights: Record<string, unknown> | null;
}

/** `PATCH /api/bidding/strategies/[id]` (E2) : ces champs ne régénèrent pas `bidding_zone_configs`. */
export interface CorpsStrategie {
  total_budget?: number | null;
  forecast_cpm?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  kpi_target?: number | null;
}

/** Une ligne de `bidding_strategy_drafts` (`GET /api/bidding/strategies/drafts`, non consommée, la plus récente d'abord). */
export interface BrouillonServeur {
  id: string;
  campaign_id: string;
  current_step: number;
  draft_data: unknown;
  last_saved_at: string;
  expires_at: string | null;
  created_at: string;
}

/** `POST /api/bidding/strategies/drafts` : upsert par (utilisateur, campagne). `current_step` de 1 à 5. */
export interface CorpsBrouillon {
  campaign_id: string;
  current_step: number;
  draft_data: Record<string, unknown>;
}

/** `GET /api/dsp/dv360/resources` : un niveau de la cascade annonceur → campagne → insertion order. */
export interface RessourcesDv360 {
  level: 'advertisers' | 'campaigns' | 'insertion_orders';
  items: Array<{ id: string; name: string }>;
}

/** `GET /api/user/demo-mode`. */
export interface ModeDemo {
  demo_mode: boolean;
  can_toggle: boolean;
}

/** `POST /api/zones/jeux/[id]/rattacher` (201). `extraction` et `extraction_version` sur le chemin extraction (T1). */
export interface PlanRattache {
  jeu: string;
  version: number;
  strategie: string;
  codes_postaux: number;
  mode_plan: string;
  part_plan_en_zone: number | null;
  taux_utile: number | null;
  n_retenus: number;
  anciennes_archivees: boolean;
  extraction?: string;
  extraction_version?: number;
}

/** `GET /api/zones/jeux/[id]/extractions/[version]/cp` : les CP achetés (d'une plateforme si demandée). */
export interface CpDExtraction {
  cp: CpExtraction[];
  total: number;
}

@Injectable()
export class PlanApi extends HttpBaseService {
  private campagneUrl(id: string, suite = ''): string {
    return `${this.baseUrl}/admin/campaigns/${encodeURIComponent(id)}${suite}`;
  }

  campagnes(): Observable<CampagneListe[]> {
    return this.httpClient.get<CampagneListe[]>(`${this.baseUrl}/admin/campaigns`);
  }

  /** Sans nom, le serveur en donne un par défaut ; l'espace est celui de la session. */
  creerCampagne(name?: string): Observable<{ campaign: { id: string; name: string } }> {
    return this.httpClient.post<{ campaign: { id: string; name: string } }>(`${this.baseUrl}/admin/campaigns`, name ? { name } : {});
  }

  /** `?page=1` comme React : la route pagine les lignes de diffusion, que ⑥ ne lit pas. */
  campagne(id: string): Observable<{ campaign: Campagne }> {
    return this.httpClient.get<{ campaign: Campagne }>(this.campagneUrl(id, '?page=1'));
  }

  modifierCampagne(id: string, corps: CorpsCampagne): Observable<{ success: true }> {
    return this.httpClient.patch<{ success: true }>(this.campagneUrl(id), corps);
  }

  supprimerCampagne(id: string): Observable<{ success: true; deleted: number }> {
    return this.httpClient.delete<{ success: true; deleted: number }>(this.campagneUrl(id));
  }

  organisationsCampagne(id: string): Observable<OrganisationsCampagne> {
    return this.httpClient.get<OrganisationsCampagne>(this.campagneUrl(id, '/organizations'));
  }

  canaux(campagne: string): Observable<CanauxCampagne> {
    return this.httpClient.get<CanauxCampagne>(`${this.baseUrl}/campaigns/${encodeURIComponent(campagne)}/channels`);
  }

  ecrireCanaux(campagne: string, corps: CorpsCanaux): Observable<{ ok: true }> {
    return this.httpClient.put<{ ok: true }>(`${this.baseUrl}/campaigns/${encodeURIComponent(campagne)}/channels`, corps);
  }

  /** La SEULE stratégie la plus récente de la campagne (`?campaign_id=`, `limit(1)` côté route, relecture 1). */
  strategies(campagne: string): Observable<{ strategies: StrategieListe[] }> {
    const p = new URLSearchParams({ campaign_id: campagne });
    return this.httpClient.get<{ strategies: StrategieListe[] }>(`${this.baseUrl}/bidding/strategies?${p.toString()}`);
  }

  strategie(id: string): Observable<{ strategy: Strategie }> {
    return this.httpClient.get<{ strategy: Strategie }>(`${this.baseUrl}/bidding/strategies/${encodeURIComponent(id)}`);
  }

  modifierStrategie(id: string, corps: CorpsStrategie): Observable<{ strategy: Strategie }> {
    return this.httpClient.patch<{ strategy: Strategie }>(`${this.baseUrl}/bidding/strategies/${encodeURIComponent(id)}`, corps);
  }

  brouillons(campagne: string): Observable<{ drafts: BrouillonServeur[] }> {
    const p = new URLSearchParams({ campaign_id: campagne });
    return this.httpClient.get<{ drafts: BrouillonServeur[] }>(`${this.baseUrl}/bidding/strategies/drafts?${p.toString()}`);
  }

  sauverBrouillon(corps: CorpsBrouillon): Observable<{ draft: { id: string; current_step: number; last_saved_at: string } }> {
    return this.httpClient.post<{ draft: { id: string; current_step: number; last_saved_at: string } }>(
      `${this.baseUrl}/bidding/strategies/drafts`, corps,
    );
  }

  brouillon(id: string): Observable<{ draft: BrouillonServeur }> {
    return this.httpClient.get<{ draft: BrouillonServeur }>(`${this.baseUrl}/bidding/strategies/drafts/${encodeURIComponent(id)}`);
  }

  supprimerBrouillon(id: string): Observable<{ deleted: true; id: string }> {
    return this.httpClient.delete<{ deleted: true; id: string }>(`${this.baseUrl}/bidding/strategies/drafts/${encodeURIComponent(id)}`);
  }

  /** Sans annonceur : les annonceurs ; avec : ses campagnes ; avec les deux : les insertion orders. */
  ressourcesDv360(campagne: string, advertiserId?: string, dv360CampaignId?: string): Observable<RessourcesDv360> {
    const p = new URLSearchParams({ campaignId: campagne });
    if (advertiserId) p.set('advertiserId', advertiserId);
    if (advertiserId && dv360CampaignId) p.set('dv360CampaignId', dv360CampaignId);
    return this.httpClient.get<RessourcesDv360>(`${this.baseUrl}/dsp/dv360/resources?${p.toString()}`);
  }

  modeDemo(): Observable<ModeDemo> {
    return this.httpClient.get<ModeDemo>(`${this.baseUrl}/user/demo-mode`);
  }

  basculerModeDemo(on: boolean): Observable<{ demo_mode: boolean }> {
    return this.httpClient.post<{ demo_mode: boolean }>(`${this.baseUrl}/user/demo-mode`, { on });
  }

  /** Donne l'EXTRACTION figée d'un jeu comme plan à la campagne (T1, A-4) : le serveur recopie, rien n'est recalculé. */
  rattacher(jeu: string, corps: { campagne: string; extraction: string }): Observable<PlanRattache> {
    return this.httpClient.post<PlanRattache>(`${this.baseUrl}/zones/jeux/${encodeURIComponent(jeu)}/rattacher`, corps);
  }

  cpExtraction(jeu: string, version: number, plateforme?: string): Observable<CpDExtraction> {
    const suite = plateforme ? `?${new URLSearchParams({ plateforme }).toString()}` : '';
    return this.httpClient.get<CpDExtraction>(
      `${this.baseUrl}/zones/jeux/${encodeURIComponent(jeu)}/extractions/${version}/cp${suite}`,
    );
  }
}
