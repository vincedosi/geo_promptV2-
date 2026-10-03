import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ETAT_DEFAUT } from '../logique/etat-url';
import { PROFIL_DEFAUT } from '../logique/profil';
import { EtatRisqueService, PARAM_RISQUE } from './etat-risque.service';

/** Le service tel que l'écran le construit, sur une URL donnée (`?risque=<brut>`). */
function creer(brut?: string) {
  const navigate = vi.fn(async () => true);
  const initial = convertToParamMap(brut === undefined ? {} : { [PARAM_RISQUE]: brut });
  // Comme le vrai `ActivatedRoute` : une valeur courante (`snapshot`) ET un flux qui la rejoue à l'abonnement.
  const queryParamMap = new BehaviorSubject(initial);
  const route = { snapshot: { queryParamMap: initial }, queryParamMap };
  TestBed.configureTestingModule({
    providers: [
      EtatRisqueService,
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const service = TestBed.inject(EtatRisqueService);
  TestBed.tick();
  return { service, navigate, route, queryParamMap };
}

describe('EtatRisqueService', () => {
  it('(a) lit `?risque=etape%3Drayon` : étape ② ouverte, aucune navigation à l’ouverture', () => {
    // Le routeur rend la valeur DÉCODÉE : `etape%3Drayon` dans l'adresse se lit `etape=rayon`.
    const { service, navigate } = creer('etape=rayon');
    expect(service.etat().etape).toBe('rayon');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('(b) une modification écrit `?risque=` par le Router : relative, fusionnée, en remplacement', () => {
    const { service, navigate, route } = creer();
    service.maj({ cible: 'pop_65_plus' });
    TestBed.tick();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: { [PARAM_RISQUE]: 'cible=pop_65_plus' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  it('(c) deux modifications identiques : UNE seule navigation', () => {
    const { service, navigate } = creer();
    service.maj({ cible: 'pop_65_plus' });
    TestBed.tick();
    service.maj({ cible: 'pop_65_plus' });
    TestBed.tick();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('(d) retour au défaut : le paramètre est RETIRÉ (null), jamais écrit vide', () => {
    const { service, navigate } = creer();
    service.maj({ cible: 'pop_65_plus' });
    TestBed.tick();
    service.reinitialiser();
    TestBed.tick();
    expect(navigate).toHaveBeenCalledTimes(2);
    const [, options] = navigate.mock.calls[1] as unknown as [unknown[], { queryParams: Record<string, unknown> }];
    expect(options.queryParams[PARAM_RISQUE]).toBeNull();
    expect(service.etat()).toEqual(ETAT_DEFAUT);
  });

  it('(e) URL malformée : état PARTIELLEMENT récupéré — alias hérité gardé, profil et jeu au défaut', () => {
    const { service, navigate } = creer('profil=illisible&onglet=territoires&jeu=x');
    expect(service.etat().etape).toBe('couverture');
    expect(service.etat().profil).toEqual(PROFIL_DEFAUT);
    expect(service.etat().jeu).toBeNull();
    // L'alias est réécrit UNE fois sous sa forme courante.
    expect(navigate).toHaveBeenCalledTimes(1);
    const [, options] = navigate.mock.calls[0] as unknown as [unknown[], { queryParams: Record<string, unknown> }];
    expect(options.queryParams[PARAM_RISQUE]).toBe('etape=couverture');
  });

  it("l'écran RÉUTILISÉ relit un `?risque=` venu d'ailleurs, et ignore la valeur qu'il vient d'écrire", () => {
    const { service, navigate, queryParamMap } = creer('etape=rayon');
    // Notre propre écriture revient par le flux : déjà notée, elle ne relit rien et ne renavigue pas.
    service.maj({ cible: 'pop_65_plus' });
    TestBed.tick();
    expect(navigate).toHaveBeenCalledTimes(1);
    const [, options] = navigate.mock.calls[0] as unknown as [unknown[], { queryParams: Record<string, string> }];
    queryParamMap.next(convertToParamMap({ [PARAM_RISQUE]: options.queryParams[PARAM_RISQUE] }));
    TestBed.tick();
    expect(service.etat().cible).toBe('pop_65_plus');
    expect(navigate).toHaveBeenCalledTimes(1);
    // Un lien suivi depuis l'écran ouvert (retour, shell) : même route, autre `?risque=` → l'état suit.
    queryParamMap.next(convertToParamMap({ [PARAM_RISQUE]: 'etape=zones' }));
    TestBed.tick();
    expect(service.etat().etape).toBe('zones');
    expect(service.etat().cible).toBe(ETAT_DEFAUT.cible);
    expect(navigate).toHaveBeenCalledTimes(1);
    // Le paramètre retiré : retour au défaut, toujours sans navigation.
    queryParamMap.next(convertToParamMap({}));
    TestBed.tick();
    expect(service.etat()).toEqual(ETAT_DEFAUT);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('`fusion=oui` (tronqué ou fantaisiste) retombe sur la lecture fusionnée', () => {
    const { service } = creer('fusion=oui&etape=zones');
    expect(service.etat().fusionner).toBe(true);
    expect(service.etat().etape).toBe('zones');
  });
});
