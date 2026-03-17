/**
 * GENESIS — instrumentation.ts
 * Exécuté une fois au démarrage du serveur Next.js.
 * Warm-up Supabase : prime le schema cache PostgREST pour poi_france
 * (vue, pas chargée dans le cache initial → erreur schema cache au premier appel).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { createAdminClient } = await import('@/lib/auth');
      const supabase = createAdminClient();
      // Prime le schema cache pour poi_france — ignore les erreurs (env sans DB par ex.)
      await supabase.from('poi_france').select('id').limit(1);
      console.log('[warmup] poi_france schema cache primed');
    } catch {
      // Silencieux — ne pas bloquer le démarrage
    }
  }
}
