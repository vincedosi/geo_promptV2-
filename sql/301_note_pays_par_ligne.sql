-- sql/301 — La note des lignes `pays` ne parle plus de « France entière » (⑤ finitions, relecture 2 du groupe B ; plan
-- `docs/superpowers/plans/2026-10-30-carte-en-parcours-jeu-de-zones.md`).
--
-- POURQUOI. sql/300 a écrit dans `note` de chaque ligne `pays` la réserve propre à « France entière » (« Les DROM sont
-- des pays distincts… France entière = FR + 5 codes »). Or `note` vaut pour la LIGNE, quelle que soit la recette : sur
-- une zone « France métropolitaine », l'infobulle « À vérifier » de TTD (ligne entière `a_verifier`) parlait des DROM,
-- que la métropole ne cible pas. La réserve « France entière » a déjà sa place : `pays_a_verifier` (sql/300) et la
-- phrase `NOTE_PAYS_A_VERIFIER` (lib/zones/conversion.ts, copie Angular), ajoutée par l'écran pour la seule recette FR.
-- La note de ligne ne dit donc plus que ce qui vaut pour la ligne.
--
-- REJOUABLE : l'`update` ne touche que les lignes `pays` dont la note est ENCORE celle du seed de sql/300 — une note
-- corrigée à la main depuis (mode d'édition prévu par Q-7) n'est pas écrasée ; rejouer ne change rien. Aucun DROP,
-- aucune contrainte, 4 lignes au plus (17 lignes en table, une page). Appliquer par `psql -1`.

update public.plateformes_geo
   set note = 'Ciblage par pays natif : la France (FR) pour la métropole.'
 where maille = 'pays'
   and plateforme in ('dv360', 'meta', 'tiktok')
   and note = 'Les DROM sont des pays distincts chez la plupart des plateformes : France entière = FR + 5 codes ; à confirmer dans un compte.';

update public.plateformes_geo
   set note = 'Ciblage par pays natif : la France (FR) pour la métropole. Doc derrière connexion : à confirmer dans un compte.'
 where maille = 'pays'
   and plateforme = 'ttd'
   and note = 'Les DROM sont des pays distincts chez la plupart des plateformes : France entière = FR + 5 codes ; à confirmer dans un compte. Doc derrière connexion.';
