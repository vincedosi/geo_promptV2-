Réponses à tes questions avant de commencer :



1\. ORDRE : Sprint 3 est considéré fait à 80%. Ordre = 0 → 1 → 2 → 4 → 5.

&#x20;  Ce qui manque du Sprint 3 se fera naturellement pendant Sprint 1.



2\. SPRINT 0 : Fais d'abord le diagnostic des variables CSS existantes.

&#x20;  Adapte le Sprint 0 en fonction de ce qui existe déjà — ne recrée pas 

&#x20;  ce qui est là.



3\. SPRINT 1 — STATE MANAGEMENT : Utilise Zustand (pas Context, pas props drilling).

&#x20;  Crée un store `useLayerStore` avec les états regroupés par catégorie :

&#x20;  - terrainLayers (panneaux, poi, transport, tmja, radio)

&#x20;  - socioLayers (iris, carreaux)

&#x20;  - mediaLayers (digital)

&#x20;  - analysisLayers (scoring, correlation, clustering, couverture)

&#x20;  Les callbacks carte (onDirectOOH, onToggleRadio, etc.) restent en props 

&#x20;  depuis map/page.tsx — le store gère l'état UI du panel, pas les actions carte.

&#x20;  

&#x20;  Pour casser les 3300 lignes : un composant par catégorie.

&#x20;  - components/map/layers/ContextSection.tsx

&#x20;  - components/map/layers/TerrainSection.tsx

&#x20;  - components/map/layers/SocioSection.tsx

&#x20;  - components/map/layers/MediaSection.tsx

&#x20;  - components/map/layers/AnalysisSection.tsx

&#x20;  Chaque section importe les LayerSwitch et les composants de contenu existants.



4\. SPRINT 2 : Le bon chemin est /map/analyse/digital/ (pas app/digital/).

&#x20;  SyncMap.tsx et use-digital-data.ts sont déjà bien extraits.



5\. SPRINT 4 — OBJET C : Migrer progressivement vers CSS variables.

&#x20;  L'objet C peut rester comme mapping intermédiaire mais chaque valeur 

&#x20;  doit pointer vers var(--xxx), plus de hex brut.



6\. SPECS VISUELLES : Lis .claude/skills/geomatik-product-vision/SKILL.md 

&#x20;  section 3 (Layer Manager) — c'est la spec du layout cible.

&#x20;  Le design system DESIGN\_SYSTEM.md couvre les tokens.

&#x20;  Pas de maquettes Figma — les specs textuelles font foi.



7\. RÉTROCOMPATIBILITÉ : Les pages admin (sidebar Administration/Système) 

&#x20;  ne sont PAS impactées par les sprints 0-2. Elles gardent leur layout.

&#x20;  Le Sprint 4 (thème) les affectera — on verra à ce moment.



8\. TESTS : npm run build + npm run lint sont le minimum.

&#x20;  Pas de tests visuels/snapshot pour l'instant — validation manuelle.



Commence par Sprint 0. Lance `make-plan` et soumets-moi le plan.

