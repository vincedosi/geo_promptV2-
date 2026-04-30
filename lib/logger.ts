/**
 * Logger léger GEOMATIK (chantier A4.6.2 sous-phase B).
 *
 * Wrapper minimaliste autour de console avec :
 *  - timestamps ISO
 *  - levels (debug / info / warn / error)
 *  - scopes (préfixe `[scope]`)
 *  - debug suppressed en production
 *
 * Usage :
 *   import { logger } from '@/lib/logger';
 *   logger.info('agent', 'analyze_drift completed', { drift_id, tokens });
 *   logger.warn('coverage-stats', 'cache miss', { key });
 *   logger.error('modal', err);
 *
 * Pas de dépendance externe (winston/pino over-kill pour ce projet).
 * Si besoin d'un logger structuré pour de la prod sérieuse :
 * remplacer le contenu de ce fichier sans changer l'API publique.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function ts(): string {
  return new Date().toISOString();
}

function format(scope: string, level: LogLevel, msg: string, data?: unknown): string {
  const base = `${ts()} [${level.toUpperCase()}] [${scope}] ${msg}`;
  if (data === undefined) return base;
  try {
    return `${base} ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  } catch {
    return `${base} <unserializable>`;
  }
}

export const logger = {
  /**
   * Debug : silencieux en production.
   * Utiliser pour les diagnostics dev qui ne valent pas la peine d'être
   * conservés en prod.
   */
  debug(scope: string, msg: string, data?: unknown): void {
    if (IS_PROD) return;
    // eslint-disable-next-line no-console
    console.log(format(scope, 'debug', msg, data));
  },

  /** Info : conservé en prod. Pour les événements importants. */
  info(scope: string, msg: string, data?: unknown): void {
    // eslint-disable-next-line no-console
    console.log(format(scope, 'info', msg, data));
  },

  /** Warn : anomalie non bloquante. Conservé en prod. */
  warn(scope: string, msg: string, data?: unknown): void {
    console.warn(format(scope, 'warn', msg, data));
  },

  /** Error : erreur bloquante ou exception. Conservé en prod. */
  error(scope: string, msgOrError: string | Error | unknown, data?: unknown): void {
    if (msgOrError instanceof Error) {
      console.error(format(scope, 'error', msgOrError.message, data ?? { stack: msgOrError.stack }));
      return;
    }
    if (typeof msgOrError === 'string') {
      console.error(format(scope, 'error', msgOrError, data));
      return;
    }
    console.error(format(scope, 'error', 'Unknown error', msgOrError));
  },
};

export type Logger = typeof logger;
