Option A. Merge dans main puis push.

Pour le working tree dirty, voici mes décisions :

## À COMMITER
- Les 22 fichiers modifiés → oui, tous
- Les 13 fichiers supprimés (docs/PROMPT_*.md, audits, BiddingCopilot.tsx, bidding-chat/route.ts) → oui, commit les suppressions
- app/map/custom-geo/_components/ZoneAudienceStats.tsx → oui
- lib/dynamic-with-retry.ts → oui
- ETAT_DES_LIEUX_DSP_PILOT.md, INSPECTION_DSP_IMPORT.md, docs/chantier_a4_5_audit_prompting_existant.md → oui

## À IGNORER (ajouter au .gitignore)
- server.log
- .playwright-mcp/
- .claude/skills/agent-browser/
- Tous les .png screenshots de tests (~30 fichiers)

## PROCÉDURE

1. Ajouter au .gitignore :
server.log
.playwright-mcp/
.claude/skills/agent-browser/
*.png
Attention : le *.png ne doit PAS être global si on a des PNG légitimes dans le repo. Vérifie d'abord si des PNG sont déjà versionnés (logo, assets). Si oui, utilise un pattern plus précis pour ignorer seulement les screenshots (ex: screenshots/*.png ou docs/*.png selon où ils sont).

2. git add les fichiers à commiter (modifiés + supprimés + nouveaux .tsx/.ts/.md)
3. git commit -m "chore: clean working tree — remove obsolete docs, add zone audience stats, dynamic retry"
4. git checkout main
5. git merge feat/analyse-v2 --no-edit
6. git push origin main

Montre-moi le git log --oneline -5 après le push pour confirmer.