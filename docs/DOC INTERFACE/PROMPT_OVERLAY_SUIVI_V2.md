# REMPLACEMENT TOTAL DE L'ONGLET SUIVI DANS L'OVERLAY MAGELIAN

Lis `CLAUDE.md`, `ARCHITECTURE.md` et `DESIGN_SYSTEM.md` avant toute chose.

## SKILLS OBLIGATOIRES
@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## PERIMETRE

Cible : l'onglet **Suivi** de l'overlay MAGELIAN, celui qui affiche aujourd'hui « Vue d'ensemble » et « Carte de dérive » avec le sélecteur `Acteurs`.

Ce n'est pas une refonte cosmétique. **L'écran actuel est supprimé et remplacé.** Aucun de ses blocs ne survit tel quel.

### A supprimer, code compris

- les quatre encadrés PACING / CPM / PRESSION / OBJECTIF alignés au même niveau
- les deux bandeaux d'alerte génériques du type « Pacing en retard de 10 points » et « 161 CP cibles sous 70 % du plan »
- le sélecteur `Acteurs : Tous les acteurs`
- les sous-onglets `Vue d'ensemble` et `Carte de dérive`
- le tableau `Par acteur` et son histogramme
- le bloc `Réconciliation DSP` avec son encadré `TAUX DE MESURE` et son bouton `Actualiser depuis les DSP` en position haute
- les deux graphiques `Budget cumulé vs idéal` et `CPM quotidien vs prévu` en position haute
- le tableau `Zones, triées du pire indice au meilleur` avec ses colonnes `TENUE DU PLAN` et `ATTEINTE OBJECTIF` et son bouton `Afficher plus (76 départements restants)`
- la colonne fixe `Interroger la campagne` collée à droite dans le suivi

Supprimer les composants, les hooks et les requêtes qui ne servaient qu'à ces blocs. Ne pas laisser de code mort ni de feature flag. L'assistant reste accessible, mais par le tiroir latéral global de l'application, pas en colonne fixe dans le suivi.

### Maquette de référence

`magelian-suivi.html`, fournie dans le repo, autonome et ouvrable dans un navigateur. **Elle fait foi pour la hiérarchie de l'information, la structure, les libellés et les micro-textes.** Les couleurs, la typographie et les rayons suivent `DESIGN_SYSTEM.md` : en cas de divergence, le design system gagne.

## 1. L'INDICATEUR SIGNATURE

Le **score d'alignement géographique** est l'indicateur propriétaire du produit. Il occupe le coin haut gauche de l'onglet, en très grand, avec sa variation sur 7 jours et une échelle de positionnement.

**Ce qu'il mesure** : est-ce que la pression réelle respecte le plan, zone par zone. Il pénalise les deux sens, la sous-pression comme la sur-pression. Ne jamais le présenter comme un indicateur de ciblage : on vise rarement une partie seulement de la France, le produit sert à éviter de sur-presser ou sous-presser des zones par rapport au plan.

**Règle non négociable : le score est toujours calculé à la maille code postal**, la granularité d'achat du DSP, quelle que soit la maille affichée à l'écran. Sinon il monterait mécaniquement en vue Région, l'agrégation lissant les écarts internes. Une mention sous le score le dit explicitement à l'utilisateur.

**Trois composantes** affichées sous le score : zones conformes, sous-pression (volume manquant), sur-pression (volume en trop, chiffré en euros déplaçables).

**Deux paramètres, jamais en dur**, stockés en base au niveau de la campagne ou de l'espace de travail : `tolerance_pct` (marge de conformité, défaut 10) et `overpressure_weight` (poids de la sur-pression, défaut 1.0). Le score doit rester recalculable à l'identique depuis les données brutes.

## 2. STRUCTURE DU NOUVEL ONGLET

### Barre de maille, tout en haut

- Fil d'Ariane à gauche : `France entière`, puis la région ou le département sélectionné, cliquable pour remonter.
- Sélecteur de maille à droite : **Région / Département / Code postal**, plus le compte d'unités affichées.
- Changer de maille met à jour **toute la page** : graphique, trois cartes, tableau, compteurs. Le score, lui, ne bouge pas.
- Cliquer une ligne du tableau ou une zone d'une carte descend d'un niveau et met à jour le fil d'Ariane.

### Rangée 1

- **A gauche** : le score, sa variation, l'échelle, la mention de la maille de calcul.
- **A droite** : le bandeau d'avancement, trois barres sur la même échelle, temps écoulé, budget consommé, volume livré, avec un repère vertical marquant la position du temps sur les deux barres du bas. A droite du bandeau, une phrase chiffrée sur ce que le retard implique en fin de campagne.

### Rangée 2

- **A gauche, le graphique qui explique le score.**
  - En maille Région ou Département : courbe du plan en pointillés, courbe du réel en plein, deux surfaces d'écart colorées, une pour la sous-pression, une pour la sur-pression. Seules les zones les plus déréglées sont annotées.
  - En maille Code postal : la courbe n'a plus de sens, elle est remplacée par un **histogramme de dispersion des écarts au plan**, en tranches, avec la tranche conforme au centre et les couleurs divergentes de part et d'autre.
- **A droite, trois cartes de France côte à côte**, même projection et même cadrage, chacune avec sa mini-échelle :
  1. **Impressions** : où la campagne a réellement diffusé, échelle séquentielle.
  2. **Variable du plan** : la donnée qui a servi à construire le plan, échelle séquentielle. Cette variable est **portée par la stratégie de la campagne**, jamais codée en dur : taux d'abstention pour une campagne électorale, revenu médian, âge ou densité de points de vente ailleurs. Un sélecteur permet d'en afficher une autre parmi les indicateurs disponibles.
  3. **Alignement géographique** : l'écart au plan, échelle divergente, rouge pour la sous-pression, neutre pour la conformité, bleu pour la sur-pression.
  - Les trois cartes suivent la maille active et le fil d'Ariane : hors périmètre, les zones sont grisées, pas masquées.
  - Un clic sur une carte ouvre la vue Diffusion en plein écran avec le calque correspondant déjà actif.
  - Pas d'annotations de noms sur ces vignettes, elles sont trop petites : les noms restent sur la grande carte.

### Suite de la page

3. **Les trois composantes** du score.
4. **Ce qu'il faut corriger** : trois constats maximum, rédigés en français, chacun avec une action. Ces constats sont **calculés, pas écrits en dur** : concentration de la sous-pression, concentration de la sur-pression, canal le plus cher. Un constat qui ne s'applique pas ne s'affiche pas.
5. **Coût et rythme** : CPM moyen contre plan, impressions livrées, coût du déséquilibre en euros.
6. **Tableau des unités déréglées** : barre divergente centrée sur le plan, bascule sous-pression et sur-pression, sept lignes maximum, titre et en-tête qui suivent la maille, lien vers la table complète chargée à la demande.
7. **Qui a diffusé** : barres compactes par partenaire, CPM signalé quand il dépasse nettement la moyenne.
8. **Détail technique**, replié par défaut : budget cumulé contre trajectoire idéale, réconciliation DSP contre ad server.

## 3. CONTEXTE PARTAGE ENTRE L'OVERLAY ET LA CARTE

Aujourd'hui, passer du suivi à la carte fait tout reperdre. **La carte et l'overlay sont deux vues de la même session de travail, pas deux écrans.**

### Session campagne

Un store unique, par exemple `useCampaignSession`, porte : `campaignId`, `period`, `tab`, `level` (la maille), `parent` (le fil d'Ariane), `selectedUnit`, `sortMode`, `mapCamera`, `scroll`. C'est la seule source de vérité, aucune vue ne garde sa copie.

### Règles

- **La bascule est un changement de vue, pas une navigation.** L'overlay n'est pas démonté quand on passe à la carte, il est masqué. Au retour : même onglet, même maille, même fil d'Ariane, même tri, même défilement, mêmes blocs dépliés.
- **La carte garde sa caméra**, aucun recadrage sur la France au retour.
- **Une barre de contexte identique dans les deux vues** : campagne, DSP, période, score d'alignement, bascule. Le sélecteur de campagne y est, donc changer de campagne ne demande jamais de rouvrir un écran, et conserve la vue courante.
- **Bascule en un clic ou par `Alt+C`**, depuis n'importe quel point.
- **Sélection synchronisée dans les deux sens** : cliquer une zone sur la carte la met en évidence et la fait remonter dans le tableau ; l'épingle d'une ligne bascule sur la carte, centre dessus et garde la sélection. Au retour, la ligne est visible et mise en évidence.
- **La maille est partagée** : passer en Région dans le suivi met la carte en Région, et l'inverse.
- **Chargement sans écran blanc** : pendant qu'une nouvelle campagne ou une nouvelle maille charge, les chiffres précédents restent affichés en état atténué avec un indicateur discret. Jamais de remise à zéro visuelle.
- **URL et reprise de session** : campagne, vue, onglet, maille, parent et unité sélectionnée sont dans l'URL. Un lien partagé ouvre exactement la même chose. Au retour dans l'application, la dernière session est restaurée. Si la campagne n'existe plus ou n'est plus accessible, afficher un état clair proposant d'en choisir une, pas une erreur brute.

### Ce que la carte affiche en mode campagne

La **diffusion** : pression réelle comparée au plan, en carreaux, sur tout le territoire, échelle divergente. Les zones les plus déréglées sont annotées. Le score est rappelé dans une carte flottante avec le retour au suivi. La valeur d'un CP est appliquée à ses carreaux et la légende le dit : **ne jamais désagréger sous le code postal**.

## 4. CONTRAINTES TECHNIQUES

- **Rien en dur** : campagnes, périodes, mailles, indicateurs, seuils, pondérations et variable du plan viennent tous de la base. Aucun enum figé, aucune liste de départements ou de régions codée dans le front.
- **Maille code postal et volumétrie** : environ 6 000 CP pour la France entière. Interdiction de tout charger pour dessiner une vignette. Deux garde-fous à implémenter :
  - l'agrégation et le score se calculent **côté base**, jamais en ramenant les lignes au client ;
  - en maille CP sur la France entière, ne charger que les N unités les plus déréglées pour le tableau et le graphique, et servir les cartes depuis une agrégation pré-calculée. Si le volume reste trop lourd, demander un périmètre (région ou département) avant d'autoriser la maille CP, avec un message clair plutôt qu'un calcul qui s'effondre.
- **Limites Supabase du projet** : pas de scan bbox France entière, pas de requête multi-colonnes massive, trois appels parallèles maximum, inserts par lots bornés.
- MapLibre n'accepte pas les variables CSS dans les propriétés `paint` : valeurs hexadécimales littérales.
- Fichiers protégés, non modifiés : `/api/isochrone-battle/route.ts`, les fonctions PostGIS `battle_*`, `middleware.ts`.
- Accessibilité : `aria-pressed` sur la bascule de vue et sur le sélecteur de maille, focus clavier visible, en-têtes de tableau associés, mouvement réduit respecté, contraste suffisant.
- La palette divergente doit rester lisible pour un daltonien : le sens se lit aussi par la position sur la barre divergente, pas seulement par la teinte.

## 5. METHODE

1. `@smart-explore` : cartographier l'onglet Suivi actuel, ses composants, ses hooks, ses requêtes, et tout ce qui lit la campagne active, la période ou la maille. Produire la liste exacte de ce qui sera supprimé.
2. `@make-plan` : plan de remplacement écrit, avec le schéma du store de session, les requêtes d'agrégation par maille, la stratégie de volumétrie en maille CP, et la liste des composants créés et supprimés. **Me montrer ce plan avant de coder.**
3. Ordre de construction, un commit atomique par lot :
   - store de session partagé et synchronisation avec l'URL
   - barre de contexte commune, bascule sans démontage, partage de la maille
   - calcul du score et de ses trois composantes côté base, au CP
   - agrégations par maille et requêtes associées
   - nouvel onglet Suivi, bloc par bloc, dans l'ordre de la section 2
   - les trois cartes et leur synchronisation avec la maille et le fil d'Ariane
   - carte en mode diffusion et synchronisation de sélection dans les deux sens
   - suppression de l'ancien écran et de tout son code mort
4. `@test-driven-development` sur : le calcul du score, l'invariance du score au changement de maille, la tolérance, la pondération de la sur-pression, la persistance de la session à la bascule.
5. Build vert, aucun `any` introduit, aucun `catch` non typé.
6. Rapport final : ce qui a été remplacé, ce qui a été supprimé, les requêtes ajoutées et leur coût mesuré, les points restés ouverts.

## POST-LIVRAISON

Après le dernier commit, lance @cleanup-geomatik Partie 2 + Partie 3 sur les fichiers modifiés uniquement. Rapport rapide : failles sécu + any introduits + catch non typés. Corrige avant de considérer la tâche terminée.
