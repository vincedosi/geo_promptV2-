\# ANALYSE V2 — Nouvelle vue analytique (bouton parallèle, sans écraser l'ancienne)



\## SKILLS OBLIGATOIRES

@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design



\## LECTURE PRÉALABLE — OBLIGATOIRE AVANT TOUTE LIGNE DE CODE

1\. DESIGN\_SYSTEM.md

2\. .claude/skills/geomatik-product-vision/SKILL.md

3\. .claude/skills/geomatik-ux/SKILL.md

4\. .claude/skills/geomatik-metier/SKILL.md

5\. .claude/skills/frontend-design/SKILL.md

6\. .claude/skills/emil-design-eng/SKILL.md  ← animations et micro-interactions

7\. .claude/skills/cleanup-geomatik/SKILL.md



\## POINT DE SAUVEGARDE

```bash

git add -A \&\& git commit -m "checkpoint: avant Analyse V2"

git checkout -b feat/analyse-v2

```



\## STRATÉGIE — NE PAS ÉCRASER L'ANCIENNE VUE



L'ancienne vue "Analyse détaillée" reste intacte.

On ajoute un bouton toggle "V2 ✦" en haut à droite de la page d'analyse.

\- État par défaut : ancienne vue

\- Clic "V2 ✦" : bascule vers la nouvelle vue

\- Clic "V1" : revient à l'ancienne



Une fois validée visuellement, on supprimera l'ancienne dans un sprint dédié.



```bash

grep -rn "Analyse détaillée\\|AnalysisPanel\\|analyse.\*detail\\|DetailedAnalysis" \\

&#x20; --include="\*.tsx" app/map/ components/

```



Créer `components/digital/AnalyseV2.tsx` — composant autonome.

Le toggle V1/V2 vit dans le composant parent qui monte l'un ou l'autre.



\## PHASE 1 : RECONNAISSANCE



```bash

\# Les données disponibles dans l'analyse actuelle

grep -rn "digitalStats\\|campaignData\\|ratioData\\|impressions\\|population\\|ecart\\|bidding" \\

&#x20; --include="\*.tsx" app/map/analyse/digital/ components/digital/



\# Les composants existants réutilisables

grep -rn "MediaHeatmap\\|RegiesHeatmap\\|BiddingTable\\|SurServis\\|SousServis\\|AnalyseIA" \\

&#x20; --include="\*.tsx" app/map/analyse/digital/\_components/



\# Les props passées au composant d'analyse

grep -rn "AnalysisPanel\\|onOpenAnalysis\\|analysisProps" --include="\*.tsx" \\

&#x20; app/map/page.tsx app/map/\_components/

```



Fais un make-plan. Identifier :

\- Quelles données sont disponibles (props, hooks, context)

\- Quels composants existants sont réutilisables (heatmap, tables, IA)

\- Comment l'Analyse IA et le Copilote IA sont actuellement montés



\## PHASE 2 : ARCHITECTURE V2 — 3 ACTES



\### Structure globale



```

┌─────────────────────────────────────────────┐

│  \[← Retour]  Analyse : FR MAR. — 25-49 ans  │  ← Breadcrumb + contexte

│              France > Bretagne > Finistère  │

│                                  \[V1] \[V2✦] │  ← Toggle version

├─────────────────────────────────────────────┤

│                                             │

│  KPI BAND — 5 métriques + score qualité     │  ← Toujours visible

│                                             │

├─────────────────────────────────────────────┤

│  \[Diagnostic]  \[Recommandations]  \[IA]      │  ← Tabs shadcn

├─────────────────────────────────────────────┤

│                                             │

│  Contenu du tab actif (pas de scroll tabs)  │

│                                             │

└─────────────────────────────────────────────┘

```



\### Breadcrumb fil d'Ariane en haut

Réutiliser le railroad stepper existant en mode "lecture seule" (pas interactif).

Afficher : Campagne → Cible → Vue géo → Régies → Focus

Chaque étape est clickable pour revenir au niveau de configuration.



\## PHASE 3 : KPI BAND (toujours visible)



5 métriques dans une bande horizontale + le score qualité IA.



```tsx

const KPI\_ITEMS = \[

&#x20; { label: 'Impressions', value: '948.2k', icon: 'Eye', color: 'var(--text-primary)' },

&#x20; { label: 'Pop. cible', value: '479.4k', icon: 'Users', color: 'var(--text-primary)' },

&#x20; { label: 'Ratio moy.', value: '1961.3', icon: 'TrendingUp', color: 'var(--text-primary)' },

&#x20; { label: 'Couverture', value: '100%', icon: 'Globe', color: 'var(--success)' },

&#x20; { label: 'Top 10% CP', value: '53% imp.', icon: 'Award', color: 'var(--brand-teal)' },

&#x20; { label: 'Score qualité', value: '60/100', icon: 'Star', color: '#f7b731' },  // le score IA ici

];

```



Style KPI band :

```

\- Background : var(--elevated) #111

\- Border-bottom : 0.5px solid var(--border-subtle)

\- Padding : 16px 24px

\- Display : flex, gap 32px

\- Chaque KPI : label 11px #8a8a8a + valeur 22px Inter 500

\- Le score qualité : badge coloré (vert >75, orange 50-75, rouge <50)

\- Animation : les valeurs countent up au montage (0 → valeur finale, 600ms ease-out)

&#x20; → Utilise emil-design-eng pour cette animation

```



\## PHASE 4 : TAB "DIAGNOSTIC"



Répond à la question : "C'est quoi la situation ?"



\### Layout 2 colonnes (côte à côte)



\*\*Colonne gauche (60%) — Graphique écart imp vs pop\*\*



Refonte du bar chart horizontal :

\- Librairie : Recharts (déjà installé)

\- Les barres positives (sur-servis) en rouge dégradé `#ff5757` → `#ff8a80`

\- Les barres négatives (sous-servis) en bleu `#5b9bd5` → `#82b4e0`

\- Axe X : labels en JetBrains Mono 11px

\- Ligne 0 centrale marquée (médiane)

\- \*\*Hover sur une barre :\*\* tooltip card qui slide depuis la droite de la barre

&#x20; avec : zone, impression, pop cible, écart exact, ratio

&#x20; → Animation : Framer Motion `AnimatePresence` + slide X 150ms

\- Titre de section : "Écart impressions vs population" — pas "Écart imp. vs pop."

\- Sous-titre : niveau géo actif (Codes postaux / Départements / Régions)



\*\*Colonne droite (40%) — Heatmap régies × géographie\*\*



Refonte de la heatmap existante :

\- Fond de cellule : dégradé divergent bleu-blanc-rouge (existant, garder)

\- \*\*Hover sur cellule :\*\* tooltip enrichi avec régie + zone + écart + interprétation

&#x20; "Antivoise sur-sert l'IDF de +8.5 pts"

\- Scroll horizontal si trop de colonnes, colonne régies fixe à gauche (sticky)

\- Taille minimum cellule : 44px × 36px — plus large qu'actuellement

\- Légende : sous la heatmap, 5px compact, pas un bloc plein



\### Résumé exécutif (sous les 2 colonnes)

3 lignes maximum générées par l'IA :

```

┌─────────────────────────────────────────────────────┐

│ ⚡ Lecture rapide                                    │

│ La campagne couvre 100% de la population cible mais │

│ concentre 53% des impressions dans le top 10% des   │

│ zones. L'IDF est sur-servie de +8.5 pts, la         │

│ Bretagne est sous-servie de -3.4 pts.               │

└─────────────────────────────────────────────────────┘

```

Style : background rgba(78,205,196,0.04), border-left 3px teal, padding 12px 16px



\## PHASE 5 : TAB "RECOMMANDATIONS"



Répond à la question : "Quoi faire ?"



\### Layout split horizontal



\*\*Section "Sur-servis" et "Sous-servis"\*\*



Refonte des tables :

\- Tabs internes "Sur-servis (N) | Sous-servis (N)" — shadcn Tabs

\- Colonnes : Zone | Impressions | Pop. cible | Écart | Action suggérée

\- La colonne "Action" est nouvelle : chip coloré

&#x20; - Sur-servi : chip rouge "Réduire" 

&#x20; - Sous-servi : chip bleu "Augmenter"

\- Tri par écart absolu par défaut

\- Hover row : background var(--elevated)

\- Click row : sélectionne la zone sur la carte (si possible via callback)



\*\*Section "Recommandation bidding"\*\*



Refonte du slider + table :

\- Le slider "Intensité du bid" : plus grand, avec des repères (Faible / Modéré / Fort)

&#x20; et une description live qui change : "Modifie les coefficients de ±15%"

\- La table des coefficients : colonnes Zone | Ratio actuel | Écart | Coefficient recommandé

\- Les coefficients en JetBrains Mono, colorés : vert si >1 (boost), rouge si <1 (réduction)

\- \*\*Bouton "Appliquer les coefficients" :\*\* style teal CTA — déclenche le Copilote

\- \*\*Bouton "Exporter CSV" :\*\* outline neutre



\### Le Copilote IA — visible après "Appliquer"



Le Copilote IA (coefficients + script) n'est PAS affiché par défaut.

Il apparaît DANS cette section après clic sur "Appliquer les coefficients" :

```

┌─────────────────────────────────────────────┐

│ ✓ Script Custom Bidding généré              │

│                                             │

│ \[Copier le script] \[Télécharger .txt]       │

│                                             │

│ COEFFICIENTS = {                            │  ← code block JetBrains Mono

│   29470 : 2.92, ...                         │

│ }                                           │

│                                             │

│ \[Voir le tableau final ∨]                   │  ← accordion discret

└─────────────────────────────────────────────┘

```

Animation d'apparition : fade + slide up 200ms (Framer Motion ou CSS).



\## PHASE 6 : TAB "IA"



Répond à la question : "Qu'est-ce que l'IA en pense ?"



Ce tab contient l'Analyse IA complète — mais restructurée.



\### Score qualité en haut (prominent)



```

┌──────────────────────────────────────────┐

│  Score de qualité géographique           │

│                                          │

│  ████████████████░░░░░░░  60/100         │  ← Progress bar animée

│                                          │

│  "Distribution correcte mais            │

│   optimisation possible."               │

└──────────────────────────────────────────┘

```



Progress bar animée (0 → 60 en 800ms, ease-out) avec couleur dynamique :

\- 0-49 : rouge `var(--danger)`

\- 50-74 : orange `var(--warning)`

\- 75-100 : vert `var(--success)`

→ Utilise `emil-design-eng` pour cette animation



\### Diagnostic IA en accordéons



Les 4 sections (Diagnostic, Analyse par régie, Recommandations, Score) 

deviennent des accordéons collapsibles :



```

▾ #1 Diagnostic

&#x20; \[texte du diagnostic — max 3 lignes visible, "Lire plus" si plus long]



▸ #2 Analyse par régie

▸ #3 Recommandations

▸ #4 Score de qualité géographique

```



\- Seul #1 ouvert par défaut

\- Les autres collapsés — l'utilisateur ouvre ce qui l'intéresse

\- Style accordéon : pattern DESIGN\_SYSTEM (bandeau #111 + chevron)



\### Bouton "Relancer l'analyse IA"

Style outline neutre, en haut à droite du tab.

Déclenche un nouveau fetch de l'Analyse IA avec un loading skeleton pendant la génération.

Loading : 3 lignes skeleton animées (pulse) pendant le fetch.



\### Le Copilote IA — section séparée dans ce tab



Après le diagnostic accordéon, une section "Copilote IA" :

```

● COPILOTE IA



Décrivez votre objectif d'optimisation...

\[input texte long]                         \[Analyser →]



\[Résultats du copilote — si disponibles]

```



\## PHASE 7 : GRAPHIQUES — SPECS TECHNIQUES



\### Bar chart horizontal (Recharts)

```tsx

<BarChart

&#x20; layout="vertical"

&#x20; data={data}

&#x20; margin={{ left: 140, right: 40, top: 8, bottom: 8 }}

>

&#x20; <XAxis type="number" domain={\['auto', 'auto']} />

&#x20; <YAxis type="category" dataKey="zone" width={130} tick={{ fontSize: 11 }} />

&#x20; <ReferenceLine x={0} stroke="var(--border-default)" strokeWidth={1} />

&#x20; <Bar

&#x20;   dataKey="ecart"

&#x20;   radius={\[0, 4, 4, 0]}

&#x20;   fill="..."  // couleur dynamique par valeur (rouge si >0, bleu si <0)

&#x20; >

&#x20;   <LabelList dataKey="ecart" position="right" style={{ fontSize: 11 }} />

&#x20; </Bar>

&#x20; <Tooltip content={<CustomTooltip />} />

</BarChart>

```



Les barres ont des couleurs individuelles selon la valeur :

```tsx

const getBarColor = (value: number) => {

&#x20; if (value > 0) return '#ff5757';

&#x20; if (value < 0) return '#5b9bd5';

&#x20; return 'var(--border-default)';

};

```



\### Progress bar score

```tsx

// Animation CSS ou Framer Motion

const \[displayScore, setDisplayScore] = useState(0);

useEffect(() => {

&#x20; const timer = setTimeout(() => {

&#x20;   // count up animation 0 → score en 800ms

&#x20; }, 100);

&#x20; return () => clearTimeout(timer);

}, \[score]);

```



\### Count-up animation sur les KPI

```tsx

// Utiliser requestAnimationFrame pour fluidité

// Valeur finale, durée 600ms, easing ease-out

// Formater avec Intl.NumberFormat pour les grands nombres

```



\## PHASE 8 : TOGGLE V1/V2



\### Dans le composant parent



```tsx

const \[useV2, setUseV2] = useState(false);



return (

&#x20; <div>

&#x20;   <div className="flex justify-end mb-4">

&#x20;     <button

&#x20;       onClick={() => setUseV2(!useV2)}

&#x20;       className="..."

&#x20;     >

&#x20;       {useV2 ? 'Vue classique' : 'Nouvelle vue ✦'}

&#x20;     </button>

&#x20;   </div>

&#x20;   

&#x20;   {useV2 ? (

&#x20;     <AnalyseV2 {...sharedProps} />

&#x20;   ) : (

&#x20;     <AnalyseV1 {...sharedProps} />

&#x20;   )}

&#x20; </div>

);

```



Style du bouton toggle :

\- Vue classique → V2 : background teal, texte #050505, border-radius 6px

\- V2 → Vue classique : outline neutre, texte var(--text-secondary)

\- Transition : fade 150ms entre les deux vues (Framer Motion AnimatePresence)



\## PHASE 9 : DARK/LIGHT MODE



Vérifier que tous les éléments de AnalyseV2 utilisent les CSS variables.

Les exceptions data-driven (couleurs des barres, heatmap) restent en hex — documenté.



```bash

grep -rn "#\[0-9a-f]{6}\\|#\[0-9a-f]{3}" components/digital/AnalyseV2.tsx \\

&#x20; | grep -v "ff5757\\|5b9bd5\\|4ecdc4\\|f7b731\\|3dffa0"  # exceptions data-driven légitimes

```



\## PHASE 10 : VÉRIFICATION



1\. `npm run build` — 0 erreurs nouvelles

2\. L'ancienne vue (V1) est INTACTE — aucun composant existant modifié

3\. Le bouton toggle V1/V2 est visible en haut à droite de la page analyse

4\. Tab Diagnostic : bar chart animé + heatmap + résumé exécutif

5\. Tab Recommandations : tables sur/sous-servis + slider bidding + CTA Appliquer

6\. Le Copilote IA s'affiche APRÈS clic "Appliquer", pas par défaut

7\. Tab IA : score animé + accordéons diagnostic + input copilote

8\. Count-up animations sur les KPI (600ms)

9\. Progress bar animée sur le score (800ms)

10\. Hover tooltips sur les barres et la heatmap

11\. Fonctionne en dark ET light mode

12\. Pas de régression sur l'ancienne vue



\## POST-LIVRAISON — CLEANUP OBLIGATOIRE

1\. Lance `@cleanup-geomatik` Partie 2 (lint + types) sur les fichiers modifiés

2\. Lance `@cleanup-geomatik` Partie 3 (sécurité)

3\. Rapport : failles sécu + `any` introduits + catch non typés

4\. Corrige TOUT avant de considérer la tâche terminée

5\. Commit : `chore(cleanup): lint + types + sécurité post-analyse-v2`

6\. Utilise `requesting-code-review` pour le résumé

7\. Utilise `timeline-report` pour le rapport



\## INTERDIT

\- Ne PAS modifier AnalyseV1 ni aucun composant de l'ancienne vue

\- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle\_\*

\- Ne PAS hardcoder les données (campagne, zones, régies) — tout vient des props

\- Ne PAS utiliser de violet (#a855f7)

\- Ne PAS utiliser de gradients sur les éléments UI (seulement sur les barres data)



Commit final : `feat(analyse): Analyse V2 — 3 tabs Diagnostic/Recommandations/IA + animations`

Tag : `git tag analyse-v2-$(date +%Y%m%d)`

