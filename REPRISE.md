# Reprendre dentsu.explore sur un poste neuf (Windows)

Tout tourne **en local** : il n'y a plus de serveur hébergé ni de base en ligne.
L'application, c'est ce dépôt + une base Supabase dans Docker, restaurée depuis
un export.

## Ce qu'on vous a transmis

| Quoi | Par où |
|---|---|
| Le code | ce dépôt GitHub, branche `main` |
| `dentsu-explore-public-AAAA-MM-JJ.dump` (≈ 3-4 Go) et `dentsu-explore-auth-AAAA-MM-JJ.dump` | lien OneDrive privé |
| `env.local.pour-collegue` → à renommer `.env.local` (clés ORS, chiffrement DSP, admin, compte de connexion automatique) | à part, par un canal privé — **jamais dans git** |

Le `.env.local` porte aussi `DEV_CONNEXION_AUTO_EMAIL` / `_MOT_DE_PASSE` : c'est
ce qui ouvre la session tout seul en développement. Ne pas les mettre dans
`.env.development.local`, que `04-env-local.sh` réécrit en entier.

## 1. Installer (une fois)

- **Git for Windows** (fournit Git Bash : tous les scripts sont en bash).
- **Node.js 20** (`node -v` → v20.x).
- **Docker Desktop**, moteur **WSL 2** (Settings › General › « Use the WSL 2
  based engine »). Le moteur Hyper-V ne démarre pas faute de RAM sur les postes
  testés.
- Prévoir **≈ 30 Go libres** et 16 Go de RAM : la base pèse ≈ 8 Go une fois
  restaurée, et la machine virtuelle de Docker en garde ≈ 1,5 Go.

La CLI Supabase n'a pas à être installée : elle vient avec `npm install`.

## 2. Monter le projet (≈ 45 min, surtout de l'attente)

Dans **Git Bash** :

```bash
git clone https://github.com/vincedosi/geo_promptV2-.git dentsu-explore
cd dentsu-explore
npm install
(cd angular && npm install)

# Copier ici le .env.local reçu à part (à la racine du dépôt).

bash scripts/local/00-docker-up.sh       # démarre Docker
bash scripts/local/01-supabase-up.sh     # base locale (1er lancement : téléchargement des images)
bash scripts/local/14-restaurer-export.sh /c/chemin/vers/le/dossier/des/dumps
bash scripts/local/04-env-local.sh       # écrit .env.development.local (clés de la base locale)
```

`14-restaurer-export.sh` termine par un tableau de contrôle et
« ✓ Export restauré ». S'il s'arrête sur « Restauration INCOMPLÈTE », le journal
indiqué dit pourquoi.

## 3. Lancer

Deux terminaux :

```bash
npm run dev                  # API Next.js — http://localhost:3000
cd angular && npm start      # interface — http://localhost:4200
```

Ouvrir **http://localhost:4200** : en local, la connexion est automatique.
Toutes les pages sont sous `/app` (exemple : module risque =
http://localhost:4200/app/carte/risques).

⚠ **Premier affichage lent.** Base froide, certains calculs (population du
module risque) dépassent le délai de 8 s de l'API et affichent « — ». Recharger
la page une fois : les données sont alors en mémoire.

## 4. Au quotidien

| Commande | Rôle |
|---|---|
| `npm run sante` | dit quelle couche est en panne quand l'app répond « Failed to fetch » |
| `npm run sauvegarder` | sauvegarde vérifiée de la base (à faire après tout gros calcul) |
| `npm test` | tests unitaires puis d'intégration (base locale) |
| `bash scripts/local/13-optimisation-up.sh` | service Python d'optimisation (facultatif) |

## 5. À lire ensuite

- `CLAUDE.md` — les règles qui ont chacune évité une panne réelle (troncature
  PostgREST à 1 000 lignes, I/O, auth des routes API).
- `ARCHITECTURE.md` — la référence, très longue : la lire **par recherche** sur
  le nom d'une route, d'une table ou d'une fonction, pas d'un bout à l'autre.
- `DESIGN_SYSTEM.md` — avant toute modification d'interface.
