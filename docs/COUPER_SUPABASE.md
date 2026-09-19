# Couper le Supabase cloud — audit du 2026-09-19

> Objectif : ne garder que le stack Supabase LOCAL en conteneurs, et abandonner
> le projet hébergé `vkkdbygwbrxyogqosten`.
>
> Audit en lecture seule. Une seule requête a été émise vers la production :
> quatre `count(*)` (§3), parce que c'est précisément ce qu'on ne peut plus
> vérifier après la coupure.

---

## Verdict

**Faisable, mais PAS aujourd'hui sans perdre des données.** Un blocage de
données et une décision produit doivent être réglés d'abord.

Côté code, il n'y a **rien à réécrire** : l'application ne consomme que deux
services Supabase, et les deux tournent déjà en conteneur.

| Service | Usage dans le dépôt | Disponible en local |
|---|---|---|
| Base / PostgREST | 538 `.from(` · 162 `.rpc(` · 257 fichiers | oui |
| Auth / GoTrue | connexion, middleware, 5 routes d'admin | oui |
| **Storage** | **0 occurrence** applicative | sans objet |
| **Realtime** | **0 occurrence** | sans objet |
| **Edge Functions** | **0 occurrence**, pas de dossier `functions/` | sans objet |
| Webhooks base / `pg_cron` | **aucun** (aucune fonction ne fait d'appel HTTP) | sans objet |

Aucune URL cloud n'est écrite en dur dans du code exécuté en production : tout
passe par `NEXT_PUBLIC_SUPABASE_URL`.

---

## 1. Le blocage de données — radio

Mesuré le 2026-09-19, production contre local :

| Table | Production | Local | Écart |
|---|---:|---:|---|
| `emetteur_radio_stations` | **569 698** | **40 496** | **−529 202 (−93 %)** |
| `emetteurs_radio` | 11 836 | **12 630** | local en avance (+794) |
| `radios` | 1 175 | 1 175 | identiques |
| `comptages_routiers` | 408 030 | 0 | −408 030 |

Le local a **plus** d'émetteurs et **93 % de liaisons en moins**. La lecture la
plus probable : un import ANFR a été rejoué en local (qui reconstruit
`emetteurs_radio`) sans relancer le matching Arcom qui peuple la table N:N.

`ARCHITECTURE.md` affirmait pourtant une parité vérifiée « une à une » sur dix
tables le 17/09, `emetteur_radio_stations` à 569 698 comprise. **La parité a
donc été perdue depuis, en local, sans que rien ne le signale.**

⚠ `emetteur_radio_stations` est décrite dans `ARCHITECTURE.md` comme « la
**seule** liaison exploitable » entre émetteurs et radios — `radios_id` étant
NULL partout. Couper maintenant casse la fonctionnalité radio.

**À faire avant de couper** : re-dumper les trois tables radio depuis la
production vers le local.

## 2. La décision produit — le déploiement Vercel

Le projet `geo-prompt-v2` est lié (`.vercel/project.json`) et l'intégration Git
sur `main` est active. **Une fonction Vercel ne peut pas joindre
`127.0.0.1:54321`** : couper le cloud rend la production morte, base et
authentification comprises.

Ce n'est pas une question technique, c'est un arbitrage : **cette production
sert-elle quelqu'un ?** S'il n'y a que des comptes de test (la base en compte 5
au total), la réponse est probablement non, et il suffit de mettre le projet en
pause. Sinon, il faut une base hébergée ailleurs — et ce n'est pas l'affaire
d'une journée.

*Non vérifié : le trafic réel du déploiement.*

---

## 3. État du local — complet, à une table près

**17 tables vides sur 103**, et une seule est un vrai manque :

| Vides, mais attendu | Pourquoi |
|---|---|
| `activation_cibles`, `activation_lots` | aucune poussée DSP effectuée |
| `agent_chat_messages`, `agent_recommendations`, `agent_autonomy_settings`, `adaptive_model_state` | agent jamais lancé ici |
| `bidding_curve_history`, `bidding_daily_state`, `bidding_simulations`, `bidding_drift_events`, `bidding_strategy_subzones` | **sans écrivain applicatif**, documenté |
| `clustering_jobs`, `campaign_plan_snapshot`, `saved_maps` | aucune donnée produite |
| `seveso_exposition` | cache alimenté à la demande |
| `laposte_hexasmal` | **vide en production aussi** |
| **`comptages_routiers`** | **seul vrai manque** (701 Mo) — mais 99,7 % en est du proxy OSM à 11 valeurs constantes, pas du TMJA mesuré. Arbitrage déjà ouvert. |

Le reste est complet, et sur un point **meilleur que la production** :
`carreaux_filosofi` porte 2 324 577 lignes en local contre 2 298 582 en prod
(la Martinique et La Réunion en plus, chargées depuis l'INSEE).

Stack local : PostgreSQL 17.6 + PostGIS 3.3.7 (versions de la prod), 103
tables, 143 policies (le compte exact de la prod), 7 conteneurs sains.

**L'authentification n'est pas un blocage** : les 5 comptes vivent dans
`auth.users` en local, avec les empreintes bcrypt de la production — le mot de
passe de prod ouvre la session locale. `generateLink` n'exige pas de SMTP, et
les mails locaux atterrissent dans inbucket (port 54324).

---

## 4. Ce qui casse, par ordre de gravité

| # | Ce qui casse | Gravité |
|---|---|---|
| 1 | La fonctionnalité **radio** perd 93 % de ses liaisons (§1) | 🔴 perte de données |
| 2 | Le **déploiement Vercel** meurt (§2) | 🔴 si la prod sert |
| 3 | `npm run build` / `npm start` lisent `.env.local` → cloud. Aucun `.env.production.local` n'existe. | 🟠 |
| 4 | **Modal** (`modal/bidding_ml/`) lit son propre secret et ne joindra jamais un conteneur local → `/api/bidding/train` tombe | 🟠 |
| 5 | `scripts/local/02-dump-prod.sh` et les trois scripts de rapatriement deviennent inopérants | 🟠 |
| 6 | Les 2 workflows GitHub Actions PMTiles (seul usage de Supabase **Storage** du dépôt) | 🟢 déjà morts |
| 7 | 7 scripts Python avec l'URL cloud en dur | 🟢 hors chemin applicatif |
| 8 | Le MCP Supabase devient inerte | 🟢 c'est le but |

**Non impacté** : le rate limiting (Upstash n'est pas configuré, le moteur réel
est `consommer_quota` en base), les fonds de carte, ORS, Gemini, Géorisques,
IGN, Open-Meteo, Atmo. Inngest casse avec Vercel, pas avec Supabase.

---

## 5. Deux fragilités à connaître

**Le garde-fou local est un fichier non versionné.** Le choix cloud/local se
fait uniquement par la précédence des fichiers `.env` de Next.js — aucun
drapeau, aucune branche de code. Supprimer ou renommer `.env.development.local`
remet silencieusement le dev **et** les tests d'intégration sur la production,
avec la clé `service_role`. Un `git clean -x` suffirait.

**`.env.local` ne porte pas que Supabase.** Il contient aussi `ORS_API_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `DSP_ENC_KEY`,
`ADMIN_INIT_KEY`. Le supprimer casserait l'IA, les isochrones et le chiffrement
DSP en plus de Supabase. **N'y remplacer que les quatre variables Supabase.**

---

## 6. Ordre des opérations pour couper

1. **Re-dumper les trois tables radio** depuis la production (§1). C'est la
   seule perte de données identifiée, et elle est irréversible.
2. **Trancher le sort de Vercel** (§2) : pause du projet, ou maintien d'une
   base hébergée.
3. **Prendre un dernier dump complet.** Celui de `C:/GENESIS/_dump_prod` date
   du 17/09 et ne contient pas les migrations d'exposition déployées depuis.
4. **Sauvegarder ce dossier hors du poste** : le volume Docker devient sinon la
   seule copie existante.
5. **Créer `.env.production.local`** pointant sur le local, sinon `npm run
   build` reste silencieusement sur le cloud.
6. **Décider pour `comptages_routiers`** : recharger, ou assumer que le calque
   flux routier est mort.
7. Accepter la perte de `/api/bidding/train` (Modal) et du bouton PMTiles, ou
   les débrancher proprement.
8. **Révoquer la clé `service_role`** du projet cloud. Elle est dans
   l'historique git (dette déjà ouverte). Supprimer le projet la neutralise ;
   une simple mise en pause, non.
