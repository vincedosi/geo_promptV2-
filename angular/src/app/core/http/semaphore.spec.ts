import { creerSemaphore } from './semaphore';

describe('creerSemaphore', () => {
  it('accorde immédiatement jusqu\'au plafond, puis met en attente', async () => {
    const s = creerSemaphore(2);
    await s.acquerir();
    await s.acquerir();
    let troisieme = false;
    void s.acquerir().then(() => (troisieme = true));
    await Promise.resolve();
    expect(s.enVol()).toBe(2);
    expect(s.enAttente()).toBe(1);
    expect(troisieme).toBe(false);
  });

  it('libérer passe la main au suivant, dans l\'ordre d\'arrivée', async () => {
    const s = creerSemaphore(1);
    const liberer = await s.acquerir();
    const ordre: string[] = [];
    void s.acquerir().then(() => ordre.push('a'));
    void s.acquerir().then(() => ordre.push('b'));
    liberer();
    await Promise.resolve();
    await Promise.resolve();
    expect(ordre).toEqual(['a']);
    expect(s.enVol()).toBe(1);
  });

  it('libérer deux fois ne libère qu\'une place', async () => {
    const s = creerSemaphore(1);
    const liberer = await s.acquerir();
    liberer();
    liberer();
    expect(s.enVol()).toBe(0);
  });
});
