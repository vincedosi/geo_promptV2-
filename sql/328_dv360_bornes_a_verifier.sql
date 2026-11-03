-- ============================================================================
-- sql/328_dv360_bornes_a_verifier.sql — C28 (plan de corrections du découpage des zones, lot 3, 2026-11-03) :
-- le registre DV360 dit les bornes qu'il ne connaît pas.
--
-- LE CONSTAT. `plateformes_geo` ne porte, pour DV360, ni le nombre maximal de CP par liste (ligne `cp`), ni le
-- nombre maximal de cercles par liste de proximité, ni le rayon maximal (ligne `cercle`) : des limites absentes se
-- lisent « aucune limite connue », sans que rien ne dise qu'elles restent à relever.
--
-- LES VALEURS. Aucune n'est connue dans le dépôt (cherché le 03/11 dans lib/dsp/dv360, lib/digital, docs) : AUCUNE
-- valeur n'est posée. Le seul nombre approchant, `MAX_GEO_IDS_PER_PUSH = 2000` (lib/dsp/dv360/pousser-ciblage.ts), est
-- un garde-fou du produit par poussée, pas une limite relevée chez DV360 : il n'est pas recopié comme telle.
--
-- LE CORRECTIF. Les paramètres sont déclarés « à vérifier » (amendement E9, par paramètre) sans valeur :
--   - DV360 / cp     : `max_unites` (CP par liste) ;
--   - DV360 / cercle : `max_unites` (cercles par liste de proximité) et `rayon_max_m` (rayon maximal).
-- La note de chaque ligne le dit. Un `max_unites` à vérifier rend la maille non « sûre » (`mailleSure`,
-- conversion-defaut.ts) : CP et cercle DV360 le deviennent tous deux, leur ordre relatif ne change pas.
--
-- Rejouable : chaque paramètre n'est ajouté que s'il manque, la note n'est complétée qu'une fois (marque « C28 ») ;
-- une ligne corrigée depuis par `update` (valeur relevée, paramètre retiré de la liste) garde sa correction tant que
-- la note porte la marque. Aucun DROP.
-- ============================================================================

update public.plateformes_geo
   set parametres_a_verifier = parametres_a_verifier
         || array(select p from unnest(array['max_unites']::text[]) p where p <> all (parametres_a_verifier)),
       note = note || ' Nombre maximal de CP par liste : non relevé, à vérifier dans un compte (C28). Les 2 000 geo IDs '
                   || 'par poussée sont un garde-fou du produit, pas une limite DV360.'
 where plateforme = 'dv360' and maille = 'cp' and coalesce(note, '') not like '%C28%';

update public.plateformes_geo
   set parametres_a_verifier = parametres_a_verifier
         || array(select p from unnest(array['max_unites', 'rayon_max_m']::text[]) p where p <> all (parametres_a_verifier)),
       note = note || ' Nombre maximal de cercles par liste de proximité et rayon maximal : non relevés, à vérifier dans '
                   || 'un compte (C28).'
 where plateforme = 'dv360' and maille = 'cercle' and coalesce(note, '') not like '%C28%';
