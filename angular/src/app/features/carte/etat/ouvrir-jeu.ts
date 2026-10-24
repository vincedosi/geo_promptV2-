import type { ActivatedRoute, Router } from '@angular/router';
import { PARAM_RISQUE } from '../../risques/etat/etat-risque.service';
import { risqueDuJeu } from '../logique/entree-module-risque';
import { PARAM_EXTRACTION, PARAM_JEU, PARAM_MAILLES, PARAM_ZONE_JEU } from '../logique/jeu/mailles-url';
import { PARAM_ETAPE } from '../logique/parcours';
import { ecrireParametres } from './ecrire-parametres';

/**
 * Ouvre un jeu de la liste `GET /api/zones/jeux` selon son TYPE (lot 5, T12) — une seule règle pour « Mes zones »
 * (boîte à outils) et la bibliothèque de ⑤ :
 * - un jeu RISQUE ouvre le module, route enfant `risques`, à l'étape ④ sur ce jeu (`ouvrirJeuDeZones`,
 *   `page.tsx:232-240`, A-12) — l'URL du module est écrite PAR la navigation même ;
 * - un jeu de ZONE ouvre ⑤ sur `?jeu=` (`JeuZonesService` le relit), sans zone ni choix en cours (ils sont dans le jeu).
 * Par `ecrireParametres`, seul écrivain de paramètres (P-g).
 */
export function ouvrirJeuListe(router: Router, route: ActivatedRoute, jeu: { id: string; type: 'risque' | 'zone' }): Promise<boolean> {
  if (jeu.type === 'risque') return ecrireParametres(router, route, { [PARAM_RISQUE]: risqueDuJeu(jeu.id) }, ['risques']);
  return ecrireParametres(router, route, {
    [PARAM_JEU]: jeu.id, [PARAM_ETAPE]: 'jeu', [PARAM_ZONE_JEU]: null, [PARAM_MAILLES]: null, [PARAM_EXTRACTION]: null,
  });
}
