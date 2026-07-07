# Design — Suivi campagne : bilan + chat IA, nettoyage du cockpit

> Date : 2026-07-07 · Branche : `feat/magelian-overlay` · Statut : validé (approche A)

## Objectif

Dans l'overlay MAGELIAN :
1. **Création campagne** ne garde que le wizard 5 étapes (Cible → Lancement). Les phases
   « Pilotage » et « Bilan » disparaissent du fil d'Ariane et du cockpit.
2. **Suivi campagne** (aujourd'hui placeholder « À venir ») accueille le **bilan** de la
   campagne et un **chat IA** pour interroger ce qu'il s'est passé (perfs géo, décisions
   de stratégie, contexte IRIS).
3. Le **sélecteur de campagne** remonte au-dessus des tabs de l'overlay : la campagne
   sélectionnée est partagée entre Création et Suivi.

Décisions utilisateur : Pilotage supprimé complètement du cockpit (le composant
`StrategyDetail` continue de vivre dans `PilotageOverlay` carte — non touché). Chat basé
sur un **nouveau endpoint** (pattern du chat stratégie existant), contexte = stats géo
campagne + décisions/pacing stratégie + croisement IRIS.

## 1. Nettoyage cockpit — `components/campaign/CampaignCockpit.tsx`

- Supprimer `COCKPIT_PHASES`, la vue `pilotage` et la vue `bilan`
  (`CockpitView` = `'overview' | 'prog'`).
- Supprimer les imports devenus morts : `StrategyDetail` (PilotageOverlay),
  `FinalReport` (custom-bidding), et le helper `CockpitLockedState`.
- Supprimer `unlockedPiloter`, le bouton « Voir la stratégie » du header overview.
- Deep-link `?view=` : ne garder que `prog` (et `overview` implicite). `pilotage`/`bilan`
  → repli silencieux sur `overview`.
- `StepLancement.onCompleted` : `fetchStrategy()` puis `setView('overview')`
  (au lieu de `setView('pilotage')`).
- `fetchStrategy`/`strategyId` restent : le wizard en a besoin (préremplissage,
  re-programmation, `existingStrategyId`).
- Ce nettoyage vaut partout : overlay **et** page `/campaigns/[id]` (composant partagé).

### `app/campaigns/[id]/_components/FilAriane.tsx`

- Prop `phases` rendue optionnelle (défaut `[]`) ; `unlockedPiloter` optionnelle aussi.
- Quand `phases` est vide : pas de séparateur vertical, pas de nodes de phase.
- Aucun autre consommateur que le cockpit (vérifié par grep).

## 2. Overlay — `components/magelian/MagelianOverlay.tsx`

- Le bloc sélecteur de campagne (label + `<select>`) sort de l'onglet `creation` et
  s'installe entre la tab bar et le body, visible pour les deux onglets.
- Onglet `creation` : inchangé sinon (`CampaignCockpit key={selectedId} embedded`).
- Onglet `suivi` : remplace le placeholder par `<CampaignSuivi key={selectedId} campaignId={selectedId} />`
  (mêmes états vides que Création si aucune campagne).

## 3. Nouveau composant — `components/campaign/CampaignSuivi.tsx`

Composant client réutilisable (overlay aujourd'hui, page demain si besoin).

- **Résolution stratégie** : même pattern que le cockpit — `GET /api/bidding/strategies`,
  match sur `campaign_id`, on garde `strategyId` + `status`.
- **Layout 2 colonnes** (stack vertical < 900px) :
  - **Gauche — Bilan** :
    - stratégie `completed` → `<FinalReport strategyId={...} />` (réutilisé tel quel) ;
    - sinon → carte d'état « Le bilan sera disponible à la fin de la campagne » +
      rappel des KPI campagne (tracked ads, lignes, période, statut) depuis
      `GET /api/admin/campaigns/[id]` (déjà chargée par le cockpit ; appel léger).
  - **Droite — Chat IA** (`geo.prompt` de la campagne) :
    - fil de messages (user / assistant) avec rendu streaming ;
    - input + bouton send teal (DESIGN_SYSTEM : cercle `--brand-teal`, icône `--bg-primary`) ;
    - 3–4 suggestions de démarrage génériques (« Quelles zones ont le mieux performé ? »,
      « Résume les décisions de pilotage », « Où le budget a-t-il été le plus efficace ? ») —
      jamais d'exemple de marque ;
    - historique **éphémère** : état React local, envoyé au serveur à chaque tour,
      perdu à la fermeture (assumé, v1).
- Design tokens exclusivement en `var(--…)`, Inter + JetBrains Mono, flat, sentence case.

## 4. Nouveau endpoint — `app/api/digital/[campaignId]/campaign-chat/route.ts`

`POST` uniquement. `export const dynamic = 'force-dynamic'`, `maxDuration = 60`,
`requireAuth()` (cohérent avec les autres routes `/api/digital/*`), validation Zod.

**Body** : `{ message: string (≤ 2000), history: Array<{ role: 'user'|'assistant', content: string }> (≤ 20 derniers tours, tronqué serveur) }`.

**Construction du contexte (injecté dans le system prompt, pas de function calling)** —
même philosophie que `/api/bidding/strategies/[id]/chat` :

1. **Campagne + stats géo** : ligne `dsp_campaigns` + RPC `get_dsp_campaign_stats`
   + breakdowns pays/région/département (mêmes requêtes que le détail admin campagne).
   Agrégats déjà calculés → coût I/O négligeable.
2. **Stratégie (si elle existe)** : `bidding_strategies` par `campaign_id` ; si trouvée,
   journal des décisions borné (dernières ~50 entrées, mêmes requêtes que la route
   `journal`) et données du rapport final si `completed`.
3. **Croisement IRIS** : RPC `get_digital_analysis_breakdown` (+ indicateurs disponibles
   via `get_digital_available_indicators`) — une seule RPC déjà bornée, PAS de boucle
   `cp-detail` par code postal. Aucune nouvelle requête PostGIS ; si l'implémentation en
   ajoute une, `EXPLAIN ANALYZE` obligatoire.

⚠️ **Budget I/O Nano** : le contexte est reconstruit à chaque message. Toutes les
sources sont des agrégats bornés (RPC existantes) ; jamais plus de 3 requêtes Supabase
en parallèle ; aucun scan de `dsp_campaign_data` brut.

**LLM** : `createModel()` (`lib/chat/providers.ts`, Gemini 2.5 Flash par défaut),
`streamText`, réponse en stream texte (même mécanique de consommation côté client que
le chat stratégie). System prompt en français : analyste média qui répond UNIQUEMENT à
partir du contexte fourni, chiffres sourcés, dit « je n'ai pas cette donnée » plutôt
qu'inventer.

## 5. Hors périmètre

- Persistance de l'historique du chat en base (v2 éventuelle).
- Le tableau de bord pacing temps réel annoncé par l'ancien placeholder Suivi.
- Toute modification de `StrategyDetail`, `PilotageOverlay`, `FinalReport` (réutilisé
  tel quel), routes bidding existantes, `middleware.ts`, `isochrone-battle`.
- La page `/campaigns/[id]` ne gagne pas d'onglet Suivi (elle reste le cockpit seul) ;
  `CampaignSuivi` est conçu réutilisable pour plus tard.

## 6. Gestion d'erreurs

- Endpoint : 400 (body invalide), 401 (non auth), 404 (campagne introuvable),
  502 relayé proprement si le provider LLM échoue ; le client affiche un message
  d'erreur dans le fil (pas de toast bloquant) avec bouton « réessayer ».
- `CampaignSuivi` : états chargement / campagne sans données / stratégie absente
  explicitement rendus (jamais d'écran vide).

## 7. Tests & vérification

- `npx tsc --noEmit` + `npm run lint` propres.
- Test unitaire Vitest sur la validation Zod du body et la troncature d'historique.
- Vérification manuelle navigateur (overlay `/campaigns` et `/map`) : plus de
  Pilotage/Bilan dans Création ; sélecteur partagé ; chat qui streame sur la campagne
  démo ; bilan visible sur une stratégie `completed`.
- Grep final : plus aucune référence `pilotage`/`bilan` dans `CampaignCockpit`.
