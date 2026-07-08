# Design — Étape « Canaux » du wizard de création de campagne

> Date : 2026-07-08 · Statut : validé (V1 déclarative)
> Cadrage validé avec Vincent : déclarer DSP / réseaux sociaux / ad server d'une
> campagne, rattachés aux connexions existantes, pour piloter (plus tard)
> l'export/push et fermer la boucle DSP↔ad server. Voir [[roadmap-campagne]],
> [[project_boucle_dsp_adserver]].

## 1. Objectif & périmètre

Ajouter une étape **« Canaux »** au wizard : Cible → **Canaux** → Budget →
Stratégie → Lancement (5 étapes). Le planner y déclare **où** la campagne diffuse
(DSP + réseaux sociaux) et **avec quel ad server** on mesure.

**V1 = déclarative** : on choisit, on rattache aux connexions, on **stocke** sur la
campagne. L'export/push et le bilan les LISENT plus tard. Aucune nouvelle plomberie
de push ni d'ingest ad server dans cette V1.

Hors périmètre V1 : le push réel du ciblage vers les DSP, la réconciliation
delivery ad server, tout nouveau connecteur (Meta…). Ces briques consommeront le
champ `channels` quand elles existeront.

## 2. Modèle de données

**3 catégories distinctes** (choix Vincent) :
- **DSP** : multi-sélection (DV360, The Trade Desk…).
- **Réseaux sociaux** : multi-sélection (Meta, TikTok…).
- **Ad server** : sélection unique (Adform, CM360, Xandr…).

**Catalogue de référence** — nouvelle table `dsp_channel_registry` (dynamique, jamais
de liste en dur, pattern `cible_indicator_registry`) :

| Colonne | Type | Exemple |
|---|---|---|
| `code` | text PK | `dv360`, `meta`, `tiktok`, `adform`, `cm360` |
| `label` | text | Google DV360, Meta, Adform |
| `category` | text CHECK in ('dsp','social','adserver') | `dsp` |
| `connection_provider` | text nullable | `dv360` (clé de jointure avec `dsp_connections.provider`), null si pas de connecteur |
| `active` | boolean | true |
| `created_at` | timestamptz | |

RLS : lecture `authenticated`. Seed initial : dv360 (dsp), ttd (dsp), meta (social),
tiktok (social), adform (adserver), cm360 (adserver).

**Règle d'affichage** (choix Vincent : « un canal doit être connecté, sinon il
n'apparaît pas ; en démo tous dispo ») :
- Campagne **réelle** : une option n'est proposée QUE si l'org possède une
  `dsp_connections` active dont `provider = registry.connection_provider`. Les ad
  servers (sans connecteur, `connection_provider = null`) n'apparaissent donc pas en
  réel V1 — assumé (pas de connexion ad server aujourd'hui) ; le champ ad server
  reste sélectionnable en démo.
- Campagne **démo** (`dsp_campaigns.is_demo = true`) : tout le catalogue `active` est
  proposé, badge « démo » au lieu de « connecté ».

**Stockage** — sous-clé namespacée `dsp_campaigns.geo_strategy.channels` (même
mécanique que `geo_strategy.media_plan`, jamais d'écrasement des autres clés,
aucune migration de colonne) :

```json
{ "channels": { "dsps": ["dv360"], "socials": ["tiktok"], "ad_server": "adform" } }
```

## 3. Routes API

- **`GET /api/campaigns/[campaignId]/channels`** → `{ catalog, connected, is_demo, selected }`
  - `catalog` : lignes `dsp_channel_registry` actives, groupées par category.
  - `connected` : set des `code` dont la connexion org est active (jointure
    `dsp_connections`). En démo : tous marqués disponibles.
  - `selected` : le `channels` déjà stocké (ou `{dsps:[],socials:[],ad_server:null}`).
  - Auth : `requireAuth` + scope org campagne (`checkCampaignAccess`).
- **`PUT /api/campaigns/[campaignId]/channels`** body `{ dsps, socials, ad_server }`
  - Valide Zod : chaque code existe dans le registry et (hors démo) est connecté ;
    catégorie cohérente ; `ad_server` unique/nullable.
  - Écrit `geo_strategy.channels` sans toucher aux autres sous-clés (merge, pattern
    media-plan). Scope org (`checkCampaignAccess`). 404 hors org, 400 code invalide/non connecté.

Toutes deux : `export const dynamic = 'force-dynamic'`, `createAdminClient`,
validation Zod, tokens `var(--…)` côté UI.

## 4. UI — `StepCanaux`

Nouveau `app/campaigns/[id]/_components/steps/StepCanaux.tsx`, structure identique
aux autres steps (`StepShell`, `FieldBlock`, `OptsList`, `StandardFooter`, memo).

- 3 blocs (DSP / Réseaux sociaux / Ad server). DSP et Social = liste d'options
  multi-cochables ; Ad server = choix unique (radio).
- Chaque option : label + badge « connecté » (teal) ou « démo » (neutre) ; les
  options ni connectées ni démo n'apparaissent pas.
- État vide expliqué : « Aucun canal connecté — configure une connexion dans
  Administration → Connexions API » (avec lien).
- Écrit dans le brouillon `ProgDraft.channels` (nouveau champ, défaut
  `{dsps:[],socials:[],ad_server:null}`), persisté au **Lancement** via le PUT
  (comme les autres steps qui ne persistent qu'au Lancement).
- Étape franchissable sans sélection (national/aucun canal possible en brouillon) ;
  la **validation dure** est au Lancement.

## 5. Wizard & consommation

- `types.ts` : `ProgDraft.channels: { dsps: string[]; socials: string[]; ad_server: string | null }`, défaut vide.
- `CampaignCockpit` : `COCKPIT_STEPS`/`PROG_STEP_ORDER` passent à 5 —
  `['cible','canaux','budget','strategie','lancement']` ; rendu `{progStep === 'canaux' && <StepCanaux …>}`.
- `StepLancement` :
  - **Validation** : au moins 1 DSP OU 1 réseau requis (sinon 400 UX « choisis au
    moins un canal de diffusion »). Ad server optionnel (warning doux si vide).
  - **Persistance** : après création/maj stratégie, appelle le PUT channels.
  - **Récap** : liste les canaux choisis (« DV360, TikTok · ad server Adform »).
- **Aperçu** (`CampaignOverview`) : afficher une ligne « Canaux » (lecture seule)
  depuis `geo_strategy.channels`.
- Préremplissage édition : le brouillon recharge `channels` depuis le stocké.

## 6. Erreurs & bords

- Registry vide / fetch échoué → message + étape non bloquante (draft vide).
- Code sélectionné puis connexion retirée → au PUT, rejet 400 (hors démo) avec le
  code fautif ; UI le désélectionne.
- Campagne démo : tout dispo, aucun rejet de connexion.
- `geo_strategy` legacy non-objet → traité comme `{}` avant merge (ne jamais écraser
  `media_plan`/autres clés).

## 7. Tests

- Vitest : validation Zod du body PUT (codes/catégories/connecté), merge
  `geo_strategy` préservant les autres clés, logique « connecté vs démo » (fonction
  pure `resolveChannelAvailability(registry, connectedProviders, isDemo)`).
- Navigateur : wizard 5 étapes ; StepCanaux affiche les canaux connectés (badge),
  démo affiche tout ; sélection persistée au Lancement ; Aperçu montre les canaux ;
  validation « au moins un canal » au Lancement.
- `EXPLAIN` non requis (registry ~6 lignes, jointure triviale).
