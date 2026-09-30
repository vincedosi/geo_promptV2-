import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '../config/config.service';
import { DemarrageService } from './demarrage.service';

function preparer(opts: { echecConfig?: boolean } = {}) {
  const ordre: string[] = [];
  const config = {
    charger: vi.fn(async () => {
      ordre.push('config');
      if (opts.echecConfig) throw new Error('Configuration locale introuvable.');
    }),
  };
  const auth = { initialiser: vi.fn(async () => void ordre.push('session')) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ConfigService, useValue: config },
      { provide: AuthService, useValue: auth },
    ],
  });
  return { service: TestBed.inject(DemarrageService), config, auth, ordre };
}

describe('DemarrageService', () => {
  it('charge la configuration PUIS la session', async () => {
    const { service, ordre } = preparer();
    await service.demarrer();
    expect(ordre).toEqual(['config', 'session']);
    expect(service.erreur()).toBeNull();
  });

  it('deux appels = une seule exécution (promesse partagée)', async () => {
    const { service, config, auth } = preparer();
    const a = service.demarrer();
    const b = service.demarrer();
    expect(a).toBe(b);
    await Promise.all([a, b]);
    await service.demarrer();
    expect(config.charger).toHaveBeenCalledTimes(1);
    expect(auth.initialiser).toHaveBeenCalledTimes(1);
  });

  it('échec de la configuration : erreur() porte le message, la session n\'est jamais initialisée', async () => {
    const { service, auth } = preparer({ echecConfig: true });
    await expect(service.demarrer()).resolves.toBeUndefined();
    expect(service.erreur()).toBe('Configuration locale introuvable.');
    expect(auth.initialiser).not.toHaveBeenCalled();
  });
});
