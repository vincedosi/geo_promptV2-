import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '../config/config.service';
import { CONSTRUIRE_FEUILLE, LIRE_FEUILLE } from '../ressources/feuille-ombre';
import { BASE_RESSOURCES } from '../ressources/ressource-distante';
import { DemarrageService } from './demarrage.service';

const BASE = 'https://distante.exemple/remotes/magelian/chunk-ABC.js';
const attendre = () => new Promise((r) => setTimeout(r, 0));

/** Les polices : un <link> dans le <head> du DOCUMENT (une @font-face est ignorée dans une racine d'ombre). */
function lienPolices(): HTMLLinkElement | null {
  return document.head.querySelector('link[data-mg-polices]');
}

type Reponse = { ok: boolean; text(): Promise<string> };
let lectureEnAttente: ((r: Reponse) => void) | null = null;

/**
 * Simule le navigateur : les polices finissent de charger, et la lecture de
 * magelian.css (le `fetch` de la feuille construite) aboutit — ou échoue.
 */
async function feuilles(issue: 'load' | 'error' | 'erreur-polices'): Promise<void> {
  await attendre();
  lienPolices()?.dispatchEvent(new Event(issue === 'erreur-polices' ? 'error' : 'load'));
  lectureEnAttente?.({ ok: issue !== 'error', text: async () => '.a{color:red}' });
  lectureEnAttente = null;
  await attendre();
  await attendre();
}

function preparer(opts: { echecsConfig?: number } = {}) {
  const ordre: string[] = [];
  const lire = vi.fn((_href: string) => new Promise<Reponse>((r) => (lectureEnAttente = r)));
  const construite = { construite: true } as unknown as CSSStyleSheet;
  const construire = vi.fn(async (_texte: string, _href: string) => construite);
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
      { provide: LIRE_FEUILLE, useValue: lire },
      { provide: CONSTRUIRE_FEUILLE, useValue: construire },
    ],
  });
  return { service: TestBed.inject(DemarrageService), config, auth, ordre, lire, construire, construite };
}

describe('DemarrageService', () => {
  afterEach(() => {
    lienPolices()?.remove();
    lectureEnAttente = null;
  });

  it('charge polices et feuille globale depuis l\'application distante, PUIS la configuration, PUIS la session', async () => {
    const { service, ordre, config, lire, construire, construite } = preparer();
    const p = service.demarrer();
    await attendre();
    expect(lienPolices()?.getAttribute('href')).toBe('https://distante.exemple/remotes/magelian/magelian-polices.css');
    expect(lire).toHaveBeenCalledWith('https://distante.exemple/remotes/magelian/magelian.css');
    // magelian.css n'est JAMAIS posée dans le document : elle est construite, puis adoptée par les racines d'ombre.
    expect(document.querySelector('link[href$="/magelian.css"]')).toBeNull();
    // Rien ne part avant que la page ait ses styles.
    expect(config.charger).not.toHaveBeenCalled();
    expect(service.feuille()).toBeNull();
    await feuilles('load');
    await p;
    expect(construire).toHaveBeenCalledWith('.a{color:red}', 'https://distante.exemple/remotes/magelian/magelian.css');
    expect(service.feuille()).toBe(construite);
    expect(ordre).toEqual(['config', 'session']);
    expect(service.erreur()).toBeNull();
  });

  it('deux appels = une seule exécution (promesse partagée), une seule lecture, un seul lien de polices', async () => {
    const { service, config, auth, lire } = preparer();
    const a = service.demarrer();
    const b = service.demarrer();
    expect(a).toBe(b);
    await feuilles('load');
    await Promise.all([a, b]);
    await service.demarrer();
    expect(config.charger).toHaveBeenCalledTimes(1);
    expect(auth.initialiser).toHaveBeenCalledTimes(1);
    expect(lire).toHaveBeenCalledTimes(1);
    expect(document.head.querySelectorAll('link[data-mg-polices]').length).toBe(1);
  });

  it('échec de la feuille globale : erreur() la nomme, ni configuration ni session', async () => {
    const { service, config, auth } = preparer();
    const p = service.demarrer();
    await feuilles('error');
    await expect(p).resolves.toBeUndefined();
    expect(service.erreur()).toMatch(/magelian\.css/);
    expect(service.feuille()).toBeNull();
    expect(config.charger).not.toHaveBeenCalled();
    expect(auth.initialiser).not.toHaveBeenCalled();
  });

  it("échec des polices : NON bloquant — repli sur les polices système, avertissement console qui nomme le fichier, démarrage mené à bien", async () => {
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { service, config, auth, construite } = preparer();
      const p = service.demarrer();
      await feuilles('erreur-polices');
      await p;
      expect(service.erreur()).toBeNull();
      expect(service.feuille()).toBe(construite);
      expect(config.charger).toHaveBeenCalledTimes(1);
      expect(auth.initialiser).toHaveBeenCalledTimes(1);
      expect(avertir).toHaveBeenCalledTimes(1);
      expect(String(avertir.mock.calls[0][0])).toMatch(/magelian-polices\.css/);
    } finally {
      avertir.mockRestore();
    }
  });

  it('échec de la configuration : erreur() porte le message ET dit comment réessayer ; la session n\'est jamais initialisée', async () => {
    const { service, auth } = preparer({ echecsConfig: 1 });
    const p = service.demarrer();
    await feuilles('load');
    await expect(p).resolves.toBeUndefined();
    expect(service.erreur()).toBe('Configuration locale introuvable. Rechargez la page pour réessayer.');
    expect(auth.initialiser).not.toHaveBeenCalled();
  });

  it("ferme la phrase d'un message qui finit sur une commande avant d'enchaîner la consigne", async () => {
    const { service, config } = preparer();
    config.charger.mockRejectedValueOnce(new Error('Dans le dossier angular/, lancer : npm run config'));
    const p = service.demarrer();
    await feuilles('load');
    await p;
    expect(service.erreur()).toBe('Dans le dossier angular/, lancer : npm run config. Rechargez la page pour réessayer.');
  });

  it('après un échec, le démarrage suivant RETENTE (pas d\'échec mis en cache) et efface l\'erreur s\'il réussit', async () => {
    const { service, config, auth, lire } = preparer({ echecsConfig: 1 });
    const p = service.demarrer();
    await feuilles('load');
    await p;
    expect(service.erreur()).not.toBeNull();

    await service.demarrer();
    expect(config.charger).toHaveBeenCalledTimes(2);
    expect(auth.initialiser).toHaveBeenCalledTimes(1);
    expect(service.erreur()).toBeNull();
    // La feuille, déjà construite, n'est pas relue ; les polices ne sont pas reposées.
    expect(lire).toHaveBeenCalledTimes(1);
    expect(document.head.querySelectorAll('link[data-mg-polices]').length).toBe(1);
  });
});
