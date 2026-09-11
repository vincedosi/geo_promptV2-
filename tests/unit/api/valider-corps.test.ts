import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  lireCorps, messageAnomalies, lireFormulaire,
  fichierDeFormulaire, fichiersDeFormulaire,
} from '@/lib/api/valider-corps';

/**
 * `SEC-001` — la brique de validation partagée par les routes API.
 *
 * Ce qui est vérifié ici est ce dont dépend la promesse « comportement de
 * sortie constant » : le helper ne lève JAMAIS, et il ne fabrique aucune
 * réponse — chaque route garde sa forme d'erreur (`{ error }` pour les unes,
 * `{ success: false, error }` pour les autres).
 */

const requete = (corps: unknown) =>
  new Request('http://local/t', { method: 'POST', body: JSON.stringify(corps) });

/** Corps qui n'est pas du JSON : c'est ce qui faisait lever `request.json()`. */
const requeteIllisible = () =>
  new Request('http://local/t', { method: 'POST', body: '{ceci n est pas du json' });

const Schema = z.object({
  email: z.string().min(1),
  organization_id: z.string().uuid().nullable(),
});

describe('lireCorps', () => {
  it('rend la valeur analysee quand le corps est conforme', async () => {
    const r = await lireCorps(requete({ email: 'a@b.fr', organization_id: null }), Schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valeur.email).toBe('a@b.fr');
  });

  it('ne leve pas sur un corps qui n est pas du JSON — il repond', async () => {
    // Sans ce filet, `await request.json()` remonte jusqu'a Next et la route
    // repond 500 alors que la faute est celle de l'appelant.
    const r = await lireCorps(requeteIllisible(), Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('Corps JSON invalide');
  });

  it('ne leve pas sur un corps vide', async () => {
    const vide = new Request('http://local/t', { method: 'POST' });
    await expect(lireCorps(vide, Schema)).resolves.toMatchObject({ ok: false });
  });

  it('accepte un corps absent UNIQUEMENT si la route le demande', async () => {
    // `/api/admin/init-admin` s'appelle legitimement sans corps : tous ses
    // champs ont une valeur par defaut.
    const Tolerant = z.object({ email: z.string().default('admin@local') });
    const vide = () => new Request('http://local/t', { method: 'POST' });

    const sansOption = await lireCorps(vide(), Tolerant);
    expect(sansOption.ok).toBe(false);

    const avecOption = await lireCorps(vide(), Tolerant, { corpsAbsentTolere: true });
    expect(avecOption.ok).toBe(true);
    if (avecOption.ok) expect(avecOption.valeur.email).toBe('admin@local');
  });

  it('refuse un corps MAL FORME meme quand l absence est toleree', async () => {
    // Distinction capitale : accepter du JSON casse reviendrait a executer la
    // route sur des valeurs par defaut que l'appelant croyait avoir remplacees.
    const r = await lireCorps(requeteIllisible(), z.object({ a: z.string().default('x') }),
      { corpsAbsentTolere: true });
    expect(r.ok).toBe(false);
  });

  it('nomme le champ fautif — une erreur sans nom de champ oblige a deviner', async () => {
    const r = await lireCorps(requete({ email: '', organization_id: 'pas-un-uuid' }), Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('email');
      expect(r.message).toContain('organization_id');
    }
  });

  it('accepte null la ou le schema l autorise, et le distingue de l absence', async () => {
    // `switch-org` s'appuie sur cette distinction : `null` = « toutes les orgs ».
    const avecNull = await lireCorps(requete({ email: 'a@b.fr', organization_id: null }), Schema);
    expect(avecNull.ok).toBe(true);
    const sansCle = await lireCorps(requete({ email: 'a@b.fr' }), Schema);
    expect(sansCle.ok).toBe(false);
  });

  it('laisse le schema decider de la tolerance aux champs inconnus', async () => {
    // Zod ignore les cles en trop par defaut : une route qui en recevait
    // continue de fonctionner. C'est la condition du mode permissif.
    const r = await lireCorps(requete({ email: 'a@b.fr', organization_id: null, inattendu: 1 }), Schema);
    expect(r.ok).toBe(true);
  });
});

describe('messageAnomalies', () => {
  it('borne le message a trois anomalies et annonce le reste', async () => {
    // Un message qui enumere quarante champs est illisible dans un toast.
    const large = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string() });
    const echec = large.safeParse({});
    expect(echec.success).toBe(false);
    if (!echec.success) {
      const m = messageAnomalies(echec.error);
      expect(m).toContain('(et 2 autres)');
      expect(m.split(' ; ')).toHaveLength(3);
    }
  });

  it('ne prefixe pas d un nom de champ une anomalie a la racine', async () => {
    // Le corps n'est pas un objet : il n'y a aucun champ a nommer. Le message
    // ne doit donc PAS commencer par « <champ> : ».
    const echec = z.object({ a: z.string() }).safeParse('une chaine');
    expect(echec.success).toBe(false);
    if (!echec.success) {
      const m = messageAnomalies(echec.error);
      expect(m).not.toMatch(/^[A-Za-z_][\w.]* : /);
      expect(m).toBe('type inattendu (attendu : object)');
    }
  });
});

describe('messageAnomalies — messages en francais', () => {
  it('traduit les anomalies courantes de Zod', async () => {
    // Ces messages finissent dans un toast vu par l'utilisateur. Les traduire
    // ici evite d'ecrire un message sur mesure dans chacun des 39 schemas.
    const S = z.object({
      a: z.string(),
      b: z.string().uuid(),
      c: z.enum(['x', 'y']),
      d: z.string().min(1),
    });
    const e = S.safeParse({ b: 'zzz', c: 'w', d: '' });
    expect(e.success).toBe(false);
    if (!e.success) {
      const m = messageAnomalies(e.error);
      expect(m).toContain('a : requis');
      expect(m).toContain('doit être un UUID');
    }
    const e2 = z.object({ c: z.enum(['x', 'y']) }).safeParse({ c: 'w' });
    if (!e2.success) expect(messageAnomalies(e2.error)).toContain('attendu : x, y');
    const e3 = z.object({ d: z.string().min(1) }).safeParse({ d: '' });
    if (!e3.success) expect(messageAnomalies(e3.error)).toContain('ne peut pas être vide');
  });

  it('laisse intact un message ecrit a la main dans le schema', async () => {
    const e = z.object({ name: z.string().trim().min(1, 'Nom requis') }).safeParse({ name: ' ' });
    if (!e.success) expect(messageAnomalies(e.error)).toBe('name : Nom requis');
  });
});

describe('lireFormulaire et les fichiers', () => {
  function formulaire(entrees: [string, string | File][]) {
    const f = new FormData();
    for (const [c, v] of entrees) f.append(c, v);
    return new Request('http://local/t', { method: 'POST', body: f });
  }

  const fichier = (nom: string, contenu = 'a,b\n1,2') =>
    new File([contenu], nom, { type: 'text/csv' });

  it('valide les champs texte et rend le formulaire pour les fichiers', async () => {
    const S = z.object({ encoding: z.string().default('utf-8') });
    const r = await lireFormulaire(formulaire([['file', fichier('x.csv')], ['encoding', 'latin1']]), S);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.champs.encoding).toBe('latin1');
      expect(fichierDeFormulaire(r.formulaire, 'file')?.name).toBe('x.csv');
    }
  });

  it('applique les valeurs par defaut quand le champ est absent', async () => {
    const S = z.object({ encoding: z.string().default('utf-8') });
    const r = await lireFormulaire(formulaire([['file', fichier('x.csv')]]), S);
    if (r.ok) expect(r.champs.encoding).toBe('utf-8');
  });

  it('ne soumet PAS les entrees fichier au schema', async () => {
    // Un fichier deposé sous le nom d'un champ texte ne doit pas etre pris pour
    // sa valeur — sinon le schema validerait un objet File comme une chaine.
    const S = z.object({ encoding: z.string().default('utf-8') });
    const r = await lireFormulaire(formulaire([['encoding', fichier('piege.csv')]]), S);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.champs.encoding).toBe('utf-8');
  });

  it('ne leve pas quand le corps n est pas un formulaire', async () => {
    const pasUnFormulaire = new Request('http://local/t', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    const r = await lireFormulaire(pasUnFormulaire, z.object({}));
    expect(r.ok).toBe(false);
  });

  it('fichierDeFormulaire rend null pour une valeur texte — pas un faux fichier', async () => {
    // C'est le defaut que ce helper ferme : `formData.get('file') as File` sur
    // une chaine donnait un objet dont `.name` est `undefined`, et un 500 plus
    // loin au premier `.toLowerCase()`.
    const r = await lireFormulaire(formulaire([['file', 'je-suis-du-texte']]), z.object({}));
    expect(r.ok).toBe(true);
    if (r.ok) expect(fichierDeFormulaire(r.formulaire, 'file')).toBeNull();
  });

  it('fichiersDeFormulaire ecarte les entrees non-fichier', async () => {
    const r = await lireFormulaire(
      formulaire([['files', fichier('a.csv')], ['files', 'texte'], ['files', fichier('b.csv')]]),
      z.object({}),
    );
    if (r.ok) {
      const noms = fichiersDeFormulaire(r.formulaire, 'files').map(f => f.name);
      expect(noms).toEqual(['a.csv', 'b.csv']);
    }
  });
});
