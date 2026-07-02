# DV360 — obtenir les credentials Google

> Le code MAGELIAN est prêt (routes, chiffrement, UI). Ce qui manque pour une
> connexion fonctionnelle, ce sont des credentials Google. Deux chemins, les
> deux nécessitent un accès Google Cloud Console.

Page de connexion : `/admin/api/dv360` · Partner ID actuel : `1941139`

---

## Chemin A — Service Account (recommandé, serveur-à-serveur)

Pas de flux OAuth, pas de consentement utilisateur, pas de problème SSO au runtime.

### 1. Créer le Service Account (Google Cloud Console)

1. <https://console.cloud.google.com> → sélectionner (ou créer) un projet.
2. **APIs & Services → Library** → activer **Display & Video 360 API**.
3. **IAM & Admin → Service Accounts → Create service account**.
   - Nom : `magelian-dv360` (libre).
   - Aucun rôle IAM projet requis (l'accès se donne côté DV360, pas côté GCP).
4. Ouvrir le SA créé → onglet **Keys → Add key → Create new key → JSON** → télécharger le fichier.

### 2. Inviter le SA dans DV360

1. <https://displayvideo.google.com> → **Settings → User management** (droits admin partner requis).
2. **Invite user** avec l'email du SA (`magelian-dv360@<projet>.iam.gserviceaccount.com`).
3. Accès : **Partner** `1941139` · rôle **Read only** (suffisant pour `advertisers.list`).

### 3. Connecter dans MAGELIAN

1. `/admin/api/dv360` → méthode **Service Account**.
2. Partner ID + coller le JSON complet de la clé → **Enregistrer**.
3. **Tester la connexion** → doit lister les advertisers.

Le JSON est chiffré AES-256-GCM (`DSP_ENC_KEY`) avant stockage dans `dsp_connections`.

---

## Chemin B — OAuth (compte utilisateur Google)

À utiliser si on ne peut pas inviter un SA dans DV360 (le token porte alors les
droits DV360 de l'utilisateur qui consent).

### 1. Créer le client OAuth (Google Cloud Console)

1. Même projet GCP, **Display & Video 360 API** activée.
2. **APIs & Services → OAuth consent screen** (nouvelle UI « Google Auth Platform ») :
   - App name `Magelian`, support email, audience **External**, contact, accepter.
   - Tant que l'app est en **Testing** : ajouter l'utilisateur qui va consentir dans **Test users**.
3. **Credentials → Create credentials → OAuth client ID** :
   - Type : **Web application**.
   - **Authorized redirect URI** : celle affichée dans le panneau *Diagnostic* de
     `/admin/api/dv360` (dérivée de `NEXT_PUBLIC_APP_URL`, ex.
     `http://localhost:3000/api/admin/dsp/dv360/oauth/callback`). Doit matcher exactement.
4. Récupérer **Client ID** (`…apps.googleusercontent.com`) et **Client Secret** (`GOCSPX-…`).

> ⚠️ Si la console est bloquée par le SSO corporate : créer le projet sur un
> compte Google perso — le client OAuth fonctionne indépendamment du compte
> qui l'héberge ; seul l'utilisateur qui **consent** doit avoir accès DV360.

### 2. Connecter dans MAGELIAN

1. `/admin/api/dv360` → méthode **OAuth Google**.
2. Partner ID + Client ID + Client Secret → **Enregistrer la config OAuth**
   (secret chiffré, stocké par organisation — prime sur les env vars).
3. **Se connecter avec Google** → consentement → retour automatique avec toast.
4. **Tester la connexion** (actif seulement une fois le refresh token obtenu).

### Variables d'env (optionnelles, fallback global)

| Variable | Rôle |
|----------|------|
| `DV360_OAUTH_CLIENT_ID` / `DV360_OAUTH_CLIENT_SECRET` | Client OAuth global si non saisi par org |
| `DV360_OAUTH_REDIRECT_URI` | Override explicite ; sinon dérivée de `NEXT_PUBLIC_APP_URL` |

---

## Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| `redirect_uri_mismatch` au consentement | L'URI dans la console Google ≠ celle du diagnostic (copier-coller exact, http/https compris) |
| `access_denied` au consentement | Utilisateur absent des **Test users** (app en Testing) |
| `oauth=error&reason=no_refresh_token` | Consentement déjà accordé sans nouveau token — révoquer l'accès sur <https://myaccount.google.com/permissions> puis recommencer |
| `403 PERMISSION_DENIED` au test | Le SA/l'utilisateur n'a pas été invité dans DV360 sur ce partner, ou l'API DV360 n'est pas activée sur le projet |
| `Config OAuth DV360 manquante` | Ni client par org (formulaire) ni env vars — voir le panneau Diagnostic |
