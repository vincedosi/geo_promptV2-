# Spec — Onglet « API » : connexions DSP (DV360 d'abord)

> Date : 2026-06-22
> Statut : design validé, en attente de relecture utilisateur
> Périmètre : MAGELIAN — nouvel onglet API multi-DSP, première itération centrée DV360

---

## 1. Contexte & objectif

MAGELIAN dispose déjà d'une couche **bidding / code-generation** (`lib/prompting/code-generation/` :
`dv360.ts`, `ttd.ts`, `adform.ts`), des pages `/custom-bidding` et `/strategies`, et d'un
import **manuel CSV/XLSX** des campagnes DSP (`/admin/campaigns`). Il manque une **connexion
réelle aux APIs des DSP**.

Cette spec introduit un nouvel onglet **« API »** regroupant les connexions aux 4 DSP cibles
— **DV360, Meta, TikTok, The Trade Desk** — plus un onglet **Logs**. Cette première itération
construit l'interface complète et **câble la vraie authentification DV360** avec un appel réel
fonctionnel (test de connexion = liste des advertisers).

### Buts fonctionnels (validés)

- **Récupérer les données (reporting)** : à terme, rapatrier automatiquement les impressions /
  perfs par géo depuis DV360 (Bid Manager API) — *itération suivante*.
- **Pousser le custom bidding** : à terme, déployer vers DV360 le code de bidding généré
  (`customBiddingAlgorithms`) — *itération suivante*.
- **Cette itération** : interface + auth réelle + 1 appel réel (list advertisers), fondations
  posées pour reporting & push.

---

## 2. Décisions validées

| Sujet | Décision |
|---|---|
| Objectif DV360 | Reporting (pull) **et** push custom bidding (les deux, à terme) |
| Scope itération 1 | Interface complète + auth réelle DV360 + 1 appel réel (list advertisers) |
| Méthode d'auth | **Les deux** : Service Account JSON **et** OAuth2 utilisateur (l'utilisateur choisit) |
| Stockage credentials | **Par organisation, en DB** (table dédiée, RLS, secrets chiffrés) |
| Logs | Tout : appels API + événements connexion + jobs reporting/push ; filtre « erreurs uniquement » dans l'UI |
| Autres DSP | Meta / TikTok / TTD = placeholders « bientôt disponible » (structure prête) |

---

## 3. Navigation & structure UI

### Sidebar

Nouvelle section **« API »** dans `components/AppSidebar.tsx`, sous `Administration`.
Entrée unique : **« Connexions API »** → `/admin/api` (icône lucide `Plug` ou `Webhook`,
badge `Admin`).

### Routes imbriquées (deep-linkables, 1 fichier focalisé par provider)

```
app/admin/api/
├── layout.tsx          # barre de sous-onglets (logos) + garde admin côté page
├── page.tsx            # redirige vers /admin/api/dv360
├── dv360/page.tsx      # écran complet (cette itération)
├── meta/page.tsx       # placeholder « bientôt disponible »
├── tiktok/page.tsx     # placeholder
├── ttd/page.tsx        # placeholder
└── logs/page.tsx       # table de logs + filtres
```

Sous-onglets affichés : `DV360 · Meta · TikTok · The Trade Desk | Logs`.
Onglet actif = teal (`--brand-teal`), border-bottom 2px ; inactif = `--text-tertiary`
(cf. DESIGN_SYSTEM § Tabs).

### Écran DV360 (maquette)

```
┌────────────────────────────────────────────────────────────────┐
│  Connexions API                                          [Admin] │
├────────────────────────────────────────────────────────────────┤
│  ● DV360   ○ Meta   ○ TikTok   ○ The Trade Desk   │   Logs       │
├────────────────────────────────────────────────────────────────┤
│   [ logo DV360 ]   Statut : ● Connecté / ○ Déconnecté            │
│                                                                  │
│   Méthode d'auth :  ( ) Service Account   ( ) OAuth Google       │
│   ┌──────────────────────────────────────────────────────┐      │
│   │  Partner ID : [____________]                          │      │
│   │  Clé Service Account (JSON) : [ coller / upload ]      │      │
│   │  — ou —  [ Se connecter avec Google ]                 │      │
│   └──────────────────────────────────────────────────────┘      │
│   [ Tester la connexion ]   [ Enregistrer ]   [ Déconnecter ]    │
│                                                                  │
│   Advertisers détectés : 12  (après test réussi)                 │
└────────────────────────────────────────────────────────────────┘
```

- Le bloc de saisie s'adapte à la méthode choisie (SA → champ JSON ; OAuth → bouton Google).
- **Flux d'interaction** : « Enregistrer » persiste la connexion (chiffrée) en statut
  `disconnected` ; « Tester la connexion » exécute l'appel réel sur la connexion enregistrée
  et, si succès, passe le statut à `connected` + remplit les advertisers. La méthode OAuth
  remplace « Enregistrer » par « Se connecter avec Google » (le callback persiste la connexion).
  → Pour SA : enregistrer puis tester ; pour OAuth : connecter (callback) puis tester.
- **Placeholders Meta/TikTok/TTD** : logo + texte « Intégration bientôt disponible » +
  formulaire désactivé (même squelette visuel que DV360, inputs `disabled`).

### Logos

SVG dans `public/logos/` : `dv360.svg`, `meta.svg`, `tiktok.svg`, `ttd.svg`.
⚠️ Marques simples / wordmarks placeholder (les logos officiels ont des règles d'usage de
marque) — à remplacer par les assets officiels ultérieurement. Référencés via
`<img src="/logos/<provider>.svg" />`. **Pas de hardcode couleur** : conteneurs/labels via
tokens `var(--…)` du design system.

---

## 4. Modèle de données (Supabase — via MCP `apply_migration`)

> Toutes les migrations passent par MCP Supabase (`apply_migration`), jamais de SQL manuel.
> Impact I/O Nano : tables petites, accès par `organization_id` indexé, aucun full scan.

### Table `dsp_connections`

1 ligne par `(organization_id, provider)`.

| colonne | type | contraintes / note |
|---|---|---|
| `id` | uuid | pk, default `gen_random_uuid()` |
| `organization_id` | uuid | not null, fk organizations, **RLS** |
| `provider` | text | not null, check `in ('dv360','meta','tiktok','ttd')` |
| `auth_method` | text | check `in ('service_account','oauth')` |
| `status` | text | not null default `'disconnected'`, check `in ('disconnected','connected','error')` |
| `partner_id` | text | DV360 partner id (nullable pour autres providers) |
| `advertiser_ids` | jsonb | default `'[]'` — advertisers sélectionnés/détectés |
| `credentials_encrypted` | text | clé SA chiffrée AES-256-GCM (nullable) |
| `oauth_refresh_token_encrypted` | text | refresh token OAuth chiffré (nullable) |
| `token_expires_at` | timestamptz | expiration access token courant (nullable) |
| `last_error` | text | dernier message d'erreur (nullable) |
| `meta` | jsonb | default `'{}'` — spécifique provider |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()` (trigger maj) |
| `created_by` | uuid | profile id |

Index unique `(organization_id, provider)`. Index `(organization_id)`.

### Table `dsp_api_logs`

| colonne | type | note |
|---|---|---|
| `id` | uuid | pk |
| `organization_id` | uuid | not null, **RLS** |
| `provider` | text | `dv360\|meta\|tiktok\|ttd` |
| `category` | text | check `in ('api_call','connection','job')` |
| `level` | text | check `in ('info','warn','error')`, default `'info'` |
| `action` | text | ex : `auth_test`, `list_advertisers`, `oauth_callback`, `reporting_pull`, `bidding_push` |
| `status_code` | int | code HTTP (nullable) |
| `duration_ms` | int | durée de l'appel (nullable) |
| `message` | text | résumé lisible |
| `detail` | jsonb | résumé requête/réponse **sans secrets** (sanitisé) |
| `created_at` | timestamptz | default `now()` |

Index `(organization_id, created_at desc)`. Rétention : pas de purge auto en itération 1
(volumes faibles) — à prévoir plus tard si besoin.

### RLS

Policies par `organization_id` via le helper org existant (cf. `lib/auth/getSessionOrg`,
pattern des tables `dsp_campaigns`). Lecture/écriture réservées aux membres de l'org ;
écriture serveur via `createAdminClient()` dans les routes `requireAdmin`.

### Chiffrement des secrets

- `lib/crypto/secrets.ts` : `encryptSecret(plain)` / `decryptSecret(payload)` en **AES-256-GCM**
  (`node:crypto`). Clé symétrique `DSP_ENC_KEY` (32 bytes, base64) en variable d'environnement
  serveur. Format stocké : `iv:authTag:ciphertext` (base64) dans une seule colonne `text`.
- Secrets **jamais** renvoyés au client ; déchiffrés uniquement côté serveur au moment de
  l'appel DSP. `detail` des logs **ne contient jamais** de credential.
- *Alternative écartée* : Supabase Vault / pgsodium — pour rester self-contained sans extension
  DB et garder le déchiffrement dans le runtime Node.

---

## 5. Backend — authentification réelle DV360

### Dépendance

Ajouter **`google-auth-library`** (mint de tokens : JWT service account + OAuth2). Appels
DV360 en `fetch` REST direct (plus léger que le SDK `googleapis` complet).

### Lib `lib/dsp/dv360/`

- `auth.ts` — `getServiceAccountToken(saJson, scopes)` (JWT) ; helpers OAuth :
  `buildAuthUrl(state)`, `exchangeCode(code)`, `refreshAccessToken(refreshToken)`.
  Scopes : `https://www.googleapis.com/auth/display-video`
  (+ `https://www.googleapis.com/auth/doubleclickbidmanager` réservé au reporting, itération 2).
- `client.ts` — `getDv360AccessToken(connection)` : déchiffre la connexion, choisit SA vs OAuth,
  renvoie un access token valide (refresh si expiré). `listAdvertisers(token, partnerId)` :
  `GET https://displayvideo.googleapis.com/v3/advertisers?partnerId=…`.
- `types.ts` — types de connexion / réponses.

### Routes API

Toutes : `export const dynamic = 'force-dynamic'`, `requireAdmin(req)`, validation **Zod**,
`createAdminClient()`, et **logging** via `logDspEvent()` (succès comme échec).

| route | méthode | rôle |
|---|---|---|
| `/api/admin/dsp/connections` | GET | statut par provider pour l'org (sans secrets) |
| `/api/admin/dsp/dv360/connect` | POST | body : `auth_method`, `partner_id`, (`service_account_json` \| init OAuth) → valide, chiffre, upsert `dsp_connections` |
| `/api/admin/dsp/dv360/connect` | DELETE | déconnexion (status `disconnected`, nullify secrets) |
| `/api/admin/dsp/dv360/test` | POST | **appel réel** : `listAdvertisers(partnerId)` → met à jour `advertiser_ids` + status `connected` |
| `/api/admin/dsp/dv360/oauth/start` | GET | redirige vers l'écran de consentement Google (state signé) |
| `/api/admin/dsp/dv360/oauth/callback` | GET | échange le code, chiffre le refresh token, upsert, redirige vers `/admin/api/dv360` |
| `/api/admin/dsp/logs` | GET | logs paginés, filtres `provider`, `level`, `limit/offset` |

### Variables d'environnement (à documenter dans ARCHITECTURE.md)

| Variable | Rôle |
|---|---|
| `DSP_ENC_KEY` | clé AES-256 (base64, 32 bytes) pour chiffrer les secrets DSP — **obligatoire** |
| `DV360_OAUTH_CLIENT_ID` | client OAuth Google (méthode OAuth) |
| `DV360_OAUTH_CLIENT_SECRET` | secret OAuth Google |
| `DV360_OAUTH_REDIRECT_URI` | `…/api/admin/dsp/dv360/oauth/callback` |

La méthode Service Account ne requiert pas de variable d'env (clé fournie par l'utilisateur,
stockée chiffrée par org). La méthode OAuth requiert l'app OAuth Google ci-dessus.

---

## 6. Logs

- Helper `logDspEvent({ orgId, provider, category, level, action, statusCode, durationMs, message, detail })`
  → insert `dsp_api_logs` (best-effort, n'interrompt jamais la requête principale).
- Onglet **Logs** (`/admin/api/logs`) : table (date, provider, catégorie, action, statut,
  durée, message) triée desc, filtre **provider** + toggle **« erreurs uniquement »**
  (`level=error`), pagination simple.
- Couvre : appels API DV360, événements de connexion (connect/disconnect/oauth/test),
  et plus tard jobs reporting/push.

---

## 7. Périmètre de l'itération 1

### Inclus ✅

- Section sidebar « API » + page `/admin/api` + sous-onglets (DV360, Meta, TikTok, TTD, Logs) + logos.
- Écran DV360 complet : choix SA **ou** OAuth, saisie partner id + clé/JSON ou bouton Google,
  boutons Tester / Enregistrer / Déconnecter, affichage advertisers détectés.
- Tables `dsp_connections` + `dsp_api_logs` + RLS + helper de chiffrement.
- Auth réelle DV360 (SA + OAuth) et **appel réel testé** : `listAdvertisers`.
- Onglet Logs fonctionnel.
- Placeholders Meta / TikTok / TTD (« bientôt disponible »).

### Reporté ⏳ (fondations posées)

- Pull reporting géo (Bid Manager API → import vers `dsp_campaign_data`).
- Push custom bidding (`customBiddingAlgorithms` + upload de script).
- Intégrations Meta / TikTok / The Trade Desk.

---

## 8. Contraintes & garde-fous (rappel CLAUDE.md)

- **Supabase Nano** : aucune requête lourde ; tables DSP petites, accès indexé par org ;
  pas de `Promise.all` > 3 appels Supabase ; `EXPLAIN ANALYZE` non requis (pas de PostGIS ici).
- **Routes API** : `getSession()` (jamais `getUser()` sur `/api/*`), `force-dynamic`, Zod,
  `createAdminClient()`.
- **No hardcode** : pas de couleurs hex en dur (tokens `var(--…)`), pas d'IDs/URLs en dur
  hors constantes nommées ; endpoints/scopes Google centralisés dans `lib/dsp/dv360/`.
- **Design system** : dark minimal, sentence case, section headers bandeau `--bg-level-2` +
  dot teal, focus teal, boutons CTA blancs ou teal.
- **Fichiers protégés** : ne pas toucher `app/api/isochrone-battle/*`, `middleware.ts`,
  fonctions PostGIS battle.
- **Secrets** : jamais loggés, jamais renvoyés au client, chiffrés au repos.

---

## 9. Nouveaux éléments introduits

- **Dépendance** : `google-auth-library`.
- **Env** : `DSP_ENC_KEY` (obligatoire), `DV360_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` (si OAuth).
- **Tables** : `dsp_connections`, `dsp_api_logs`.
- **Libs** : `lib/crypto/secrets.ts`, `lib/dsp/dv360/{auth,client,types}.ts`, helper `logDspEvent`.
- **Pages** : `app/admin/api/` (layout + 5 sous-pages).
- **Routes** : `app/api/admin/dsp/**`.
- **Sidebar** : section « API ».
- **Assets** : `public/logos/{dv360,meta,tiktok,ttd}.svg`.
