# GEOMATIK — AUDIT CIBLÉ + FIX : système filtre territoire + mask + capture

Réfère-toi à CLAUDE.md et DESIGN_SYSTEM.md.

SKILLS OBLIGATOIRES : @systematic-debugging @verification-before-completion @smart-explore @executing-plans @writing-plans @do @make-plan @subagent-driven-development @dispatching-parallel-agents @frontend-design @geomatik-metier

BUGS CONSTATÉS :
1. Bouton Sauvegarder grisé même avec layers valides + nom rempli
2. Filtre RÉGION ne déclenche ni le toggle ni le mask (sélection "Bretagne" dans Régions ne fait rien)
3. Filtre département marche partiellement
4. Carreaux débordent du mask
5. Contraste visuel insuffisant

RPC côté Supabase TOUTES VALIDÉES (ne pas toucher) :
- get_territory_mask_geometry('region', ['53']) → MultiPolygon Bretagne OK
- get_territory_mask_geometry('departement', ['43']) → MultiPolygon OK
- get_carreaux_capture_geometry avec admin_scope → OK
- Toutes grants OK, pas d'anon

Le bug est 100% côté FRONT.

FICHIERS À AUDITER :
- app/map/layout.tsx
- app/map/page.tsx
- app/map/_components/FilterPanel.tsx
- app/map/_components/CaptureLayers.tsx
- lib/custom-geo/CustomGeoCaptureContext.tsx
- lib/custom-geo/useCustomGeoLayer.ts
- components/custom-geo/CustomGeoCaptureButton.tsx
- components/custom-geo/CustomGeoCaptureModal.tsx
- app/api/custom-geo/source/admin/route.ts
- app/api/map/territory-mask/route.ts

PHASE 0 — AUDIT SANS CODER

Lance 3 agents en parallèle via @dispatching-parallel-agents :

Agent 1 — FilterPanel : tracer la chaîne user clique Régions → state → adminScale → setActiveScope → toggle visible. Vérifier que la SÉLECTION RÉGION SEULE active bien le toggle (pas juste département).

Agent 2 — Custom Geo Context + Modal : vérifier orgId extrait via session?.user?.organizationId, vérifier canSubmit, vérifier resolve async des géométries.

Agent 3 — Cohérence API↔RPC : pour chaque route /api/custom-geo/source/* vérifier que les params envoyés matchent les args de la RPC.

LIVRER UN RAPPORT /mnt/user-data/outputs/AUDIT_TERRITORY_CAPTURE.md AVEC :
- Bugs identifiés (preuves code avec fichier:ligne)
- Non-bugs (ce qui marche)
- Fix recommandés ordonnés par criticité
- Questions ouvertes

STOP APRÈS AUDIT. Ne code PAS. Partage le rapport, attends validation.

INTERDIT : toucher RPC Supabase, /app/api/isochrone-battle, fonctions battle_*.