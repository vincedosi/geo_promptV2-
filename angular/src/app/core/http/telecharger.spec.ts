import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { enregistrerFichier, nomDeFichier } from './telecharger';

const reponse = (cd?: string) =>
  new HttpResponse<Blob>({
    body: new Blob(['x']),
    headers: cd ? new HttpHeaders({ 'content-disposition': cd }) : undefined,
  });

describe('nomDeFichier', () => {
  it('lit filename="…"', () => {
    expect(nomDeFichier(reponse('attachment; filename="jeu.xlsx"'), 'repli.xlsx')).toBe('jeu.xlsx');
  });
  it("lit filename*=UTF-8''… et le décode", () => {
    expect(nomDeFichier(reponse("attachment; filename*=UTF-8''Jeu%20%C3%A9t%C3%A9.xlsx"), 'repli.xlsx')).toBe('Jeu été.xlsx');
  });
  it('sans en-tête : le repli', () => {
    expect(nomDeFichier(reponse(), 'repli.xlsx')).toBe('repli.xlsx');
  });
});

describe('enregistrerFichier', () => {
  it("crée une ancre NON attachée, nommée, la clique, puis révoque l'URL", () => {
    vi.useFakeTimers();
    const creer = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoquer = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const ancres: HTMLAnchorElement[] = [];
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      ancres.push(this);
    });
    enregistrerFichier(document, reponse('attachment; filename="a.xlsx"'), 'repli.xlsx');
    expect(creer).toHaveBeenCalledTimes(1);
    expect(clic).toHaveBeenCalledTimes(1);
    expect(ancres[0].isConnected).toBe(false);
    expect(ancres[0].download).toBe('a.xlsx');
    expect(ancres[0].href).toBe('blob:x');
    vi.runAllTimers();
    expect(revoquer).toHaveBeenCalledWith('blob:x');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
