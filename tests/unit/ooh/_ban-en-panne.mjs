// Préchargé par `node --import` dans `importer-plan-cli.test.ts` : remplace `fetch` dans le processus du script.
// La BAN répond 503 (panne transitoire : le géocodeur reprend, puis abandonne) ; tout autre hôte — la base locale
// comprise — est INTERDIT, consigné sur stderr et refusé. Aucun appel ne sort de la machine.
globalThis.fetch = async (entree) => {
  const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
  if (url.startsWith('https://api-adresse.data.gouv.fr/')) return new Response('panne simulée', { status: 503 });
  process.stderr.write(`APPEL-INTERDIT ${url}\n`);
  throw new Error(`appel réseau interdit pendant le test : ${url}`);
};
