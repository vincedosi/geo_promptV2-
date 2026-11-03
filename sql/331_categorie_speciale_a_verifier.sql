-- ============================================================================
-- sql/331_categorie_speciale_a_verifier.sql — C29 round 1 (plan de corrections du découpage des zones, 2026-11-03) :
-- la borne Meta de catégorie d'annonces spéciale est « à vérifier ».
--
-- LA RAISON. La valeur de 15 000 m (sql/329) vient de la NOTE de la ligne (doc Special Ad Categories relue le 24/10),
-- pas d'un relevé fait dans un compte : même règle que les bornes DV360 de C28 (sql/328). La valeur est gardée ; le
-- paramètre `rayon_min_categorie_speciale` entre dans `parametres_a_verifier` (amendement E9, par paramètre), affiché
-- à côté de la valeur par l'écran et porté par l'avertissement du rayon (`a_verifier`).
--
-- Rejouable : le paramètre n'est ajouté que s'il manque. Aucun DROP.
-- ============================================================================

update public.plateformes_geo
   set parametres_a_verifier = parametres_a_verifier || array['rayon_min_categorie_speciale']::text[]
 where plateforme = 'meta' and maille = 'cercle' and limites ? 'rayon_min_categorie_speciale'
   and not ('rayon_min_categorie_speciale' = any (parametres_a_verifier));
