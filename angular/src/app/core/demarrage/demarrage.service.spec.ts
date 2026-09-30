import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '../config/config.service';
import { BASE_RESSOURCES } from '../ressources/ressource-distante';
import { DemarrageService } from './demarrage.service';

const BASE = 'https://distante.exemple/remotes/magelian/chunk-ABC.js';
const attendre = () => new Promise((r) => setTimeout(r, 0));

function lienStyles(): HTMLLinkElement | null {
  return document.head.querySelector('link[data-mg-styles]');
}

/** Simule le navigateur : la feuille globale finit de charger (ou échoue). */
async function feuille(evenement: 'load' | 'error'): Promise<void> {
  await attendre();
  lienStyles()!.dispatchEvent(new Event(evenement));
  await attendre();
}

function preparer(opts: { echecsConfig?: number } = {}) {
  const ordre: string[] = [];
  let echecsRestants = opts.echecsConfig ?? 0;
  const config = {
    charger: vi.fn(async () => {
      ordre.push('config');
      if (echecsRestants > 0) {
        echecsRestants--;
        throw new Error('Configuration locale introuvable.');
      }
    }),
  };
  const auth = { initialiser: vi.fn(async () => void ordre.push('session')) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ConfigService, useValue: config },
      { provide: AuthService, useValue: auth },
      { provide: BASE_RESSOURCES, useValue: BASE },
    ],
  });
  return { service: TestBed.inject(DemarrageService), config, auth, ordre };
}

describe('DemarrageService', () => {
  afterEach(() => lienStyles()?.remove());

  it('charge la feuille globale depuis l\'application distante, PUIS la configuration, PUIS la session', async () => {
    const { service, ordre, config } = preparer();
    const p = service.demarrer();
    await attendre();
    expect(lienStyles()?.getAttribute('href')).toBe('https://distante.exemple/remotes/magelian/magelian.css');
    // Rien ne part avant que la page ait ses styles.
    expect(config.charger).not.toHaveBeenCalled();
    await feuille('load');
    await p;
    expect(ordre).toEqual(['config', 'session']);
    expect(service.erreur()).toBeNull();
  });

  it('deux appels = une seule exécution (promesse partagée), une seule feuille posée', async () => {
    const { service, config, auth } = preparer();
    const a = service.demarrer();
    const b = service.demarrer();
    expect(a).toBe(b);
    await feuille('load');
    await Promise.all([a, b]);
    await service.demarrer();
    expect(config.charger).toHaveBeenCalledTimes(1);
    expect(auth.initialiser).toHaveBeenCalledTimes(1);
    expect(document.head.querySelectorAll('link[data-mg-styles]').length).toBe(1);
  });

  it('échec de la feuille globale : erreur() la nomme, ni configuration ni session', async () => {
    const { service, config, auth } = preparer();
    const p = service.demarrer();
    await feuille('error');
    await expect(p).resolves.toBeUndefined();
    expect(service.erreur()).toMatch(/magelian\.css/);
    expect(config.charger).not.toHaveBeenCalled();
    expect(auth.initialiser).not.toHaveBeenCalled();
  });

  it('échec de la configuration : erreur() porte le message ET dit comment réessayer ; la session n\'est jamais initialisée', async () => {
    const { service, auth } = preparer({ echecsConfig: 1 });
    const p = service.demarrer();
    await feuille('load');
    await expect(p).resolves.toBeUndefined();
    expect(service.erreur()).toBe('Configuration locale introuvable. Rechargez la page pour réessayer.');
    expect(auth.initialiser).not.toHaveBeenCalled();
  });

  it("ferme la phrase d'un message qui finit sur une commande avant d'enchaîner la consigne", async () => {
    const { service, config } = preparer();
    config.charger.mockRejectedValueOnce(new Error('Dans le dossier angular/, lancer : npm run config'));
    const p = service.demarrer();
    await feuille('load');
    await p;
    expect(service.erreur()).toBe('Dans le dossier angular/, lancer : npm run config. Rechargez la page pour réessayer.');
  });

  it('après un échec, le démarrage suivant RETENTE (pas d\'échec mis en cache) et efface l\'erreur s\'il réussit', async () => {
    const { service, config, auth } = preparer({ echecsConfig: 1 });
    const p = service.demarrer();
    await feuille('load');
    await p;
    expect(service.erreur()).not.toBeNull();

    await service.demarrer();
    expect(config.charger).toHaveBeenCalledTimes(2);
    expect(auth.initialiser).toHaveBeenCalledTimes(1);
    expect(service.erreur()).toBeNull();
    // La feuille, déjà chargée, n'est pas reposée.
    expect(document.head.querySelectorAll('link[data-mg-styles]').length).toBe(1);
  });
});
