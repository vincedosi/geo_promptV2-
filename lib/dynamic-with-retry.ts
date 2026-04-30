/**
 * Helper pour `next/dynamic` qui retry l'import 1× et recharge la page en
 * dernier recours. Couvre le ChunkLoadError typique en dev/prod après deploy
 * où le browser tente de charger un chunk avec un hash invalidé par la
 * recompilation.
 *
 * Usage :
 *   const Modal = dynamic(retryImport(() => import('./Modal').then(m => ({ default: m.Modal }))), { ssr: false });
 */
type Importer<T> = () => Promise<T>;

export function retryImport<T>(importer: Importer<T>, retries = 1): Importer<T> {
  return async () => {
    try {
      return await importer();
    } catch (err: unknown) {
      const isChunkError =
        err instanceof Error &&
        (err.name === 'ChunkLoadError' ||
          /Loading chunk \S+ failed/.test(err.message) ||
          /Failed to fetch dynamically imported module/.test(err.message));

      if (isChunkError && retries > 0) {
        // Retry une fois après 300ms — couvre la fenêtre HMR/recompile
        await new Promise(r => setTimeout(r, 300));
        return retryImport(importer, retries - 1)();
      }

      // Last resort : reload de la page pour récupérer les nouveaux chunks
      // Marquer dans sessionStorage pour éviter les boucles de reload infinies.
      if (isChunkError && typeof window !== 'undefined') {
        const flag = 'chunk_reload_attempted';
        if (!sessionStorage.getItem(flag)) {
          sessionStorage.setItem(flag, Date.now().toString());
          window.location.reload();
          // Bloque la promise — la page reload de toute façon
          return new Promise<T>(() => {});
        }
        // Déjà tenté un reload récemment, ne pas boucler
        sessionStorage.removeItem(flag);
      }
      throw err;
    }
  };
}
