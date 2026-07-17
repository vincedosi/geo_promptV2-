# Overlay MAGELIAN — hall de création + consultation (design)

> Validé par Vincent le 2026-07-17. Problème : le sélecteur de campagne global
> gouverne les trois onglets, alors que « Création campagne » n'a pas de
> campagne préalable à sélectionner — l'overlay mélange deux logiques
> (consulter vs produire) avec un sélecteur unique.

## Décisions

- **Option A retenue** : deux espaces distincts dans l'overlay.
- **Partage strict** : Suivi/Aperçu ne listent que les campagnes consultables
  (données OU stratégie) ; le hall Création porte les coquilles en création et
  l'entrée « Modifier » des campagnes lancées.
- Une campagne lancée apparaît des deux côtés (consultable ET reprogrammable) —
  deux intentions différentes sur le même objet, c'est voulu.

## Structure

- Header inchangé (MAGELIAN · Mode démo · Fermer).
- Barre d'onglets directement sous le header : **Création campagne** ·
  **Suivi campagne** · **Aperçu**. Onglet par défaut à l'ouverture : Suivi.
  Deep-links `?campaign=&tab=creation|suivi|apercu` inchangés.
- Le sélecteur global et le bouton « + Nouvelle campagne » disparaissent du
  bandeau supérieur.

### Suivi / Aperçu — consultation

- Ligne « Campagne : [sélecteur] » sous la barre d'onglets, partagée par les
  deux onglets (même sélection).
- Contenu du sélecteur : campagnes avec `total_tracked_ads > 0` OU une
  stratégie de bidding. Préférence démo conservée à l'initialisation.
- État vide : « Aucune campagne à consulter — crée ta première campagne dans
  l'onglet Création campagne. »

### Création — le hall

Deux états internes (`creationCampaignId: string | null`) :

1. **Hall** (`null`, par défaut) — composant `CreationHall.tsx` :
   - CTA principal « Nouvelle campagne » → POST /api/admin/campaigns (Task 6)
     puis wizard sur la campagne créée.
   - Section « Reprendre une création » : coquilles `dsp_source='magelian'`
     sans stratégie et sans données. Carte = nom + badge teal « brouillon » +
     date de sauvegarde si un autosave (bidding_strategy_drafts de
     l'utilisateur) existe. Action « Supprimer » par carte (ConfirmModal,
     DELETE /api/admin/campaigns/[id]) — nécessaire car ces coquilles ne sont
     plus visibles dans Aperçu.
   - Section « Modifier une campagne lancée » : campagnes avec stratégie →
     wizard en reprogrammation (comportement cockpit inchangé).
2. **Wizard** : `CampaignCockpit wizardOnly` sur la campagne choisie, surmonté
   de « ← Choisir une autre campagne » (retour hall) et du titre
   « Création — {nom} » ou « Modification — {nom} » (selon présence de
   stratégie).

Deep-link `?campaign=X&tab=creation` → wizard direct sur X (pas le hall).

## Données & I/O (Supabase Nano)

- À la première ouverture : 3 appels, une seule fois (ref, pas de polling) :
  `GET /api/admin/campaigns` (contient déjà `dsp_source`,
  `total_tracked_ads`), `GET /api/bidding/strategies` (présence de stratégie
  par campagne), `GET /api/bidding/strategies/drafts` (badges brouillon).
- Aucun nouvel endpoint. Mises à jour locales après création/suppression/
  lancement (pas de refetch global).
- Partition pure extraite dans `lib/campaigns/overlay-partition.ts`
  (testable) : `consultables` / `shells` / `launched`.

## Hors périmètre

`CampaignSuivi`, `CampaignOverview`, `CampaignCockpit`, wizard, mode démo,
Esc/click-outside/animations : inchangés.

## Plan d'implémentation

1. `lib/campaigns/overlay-partition.ts` + test unitaire (TDD).
2. `components/magelian/CreationHall.tsx` (affichage + actions locales).
3. Restructuration `MagelianOverlay.tsx` (onglets, sélecteur contextuel,
   états création, deep-links, fetch stratégies/brouillons).
4. Vérif browser : hall, création, reprise avec badge brouillon, suppression
   de coquille, sélecteur Suivi/Aperçu sans coquilles, deep-links.
5. tsc + suite verte + commit.
