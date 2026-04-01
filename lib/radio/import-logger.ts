/**
 * ImportLogger — structured logging for radio imports
 *
 * Writes each log entry to radio_import_log_entries (persistent)
 * AND streams it via NDJSON callback (real-time UI).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface LogEntry {
  level: LogLevel;
  phase: string;
  message: string;
  details?: Record<string, unknown>;
  duration_ms?: number;
  timestamp?: string;
}

type StreamCallback = (event: Record<string, unknown>) => void;

export class ImportLogger {
  private importLogId: string;
  private supabase: SupabaseClient;
  private onLog?: StreamCallback;

  constructor(supabase: SupabaseClient, importLogId: string, onLog?: StreamCallback) {
    this.supabase = supabase;
    this.importLogId = importLogId;
    this.onLog = onLog;
  }

  // ── Core log method ─────────────────────────────────────────────────────────

  private async log(level: LogLevel, phase: string, message: string, details?: Record<string, unknown>, duration_ms?: number): Promise<void> {
    const ts = new Date().toISOString();

    // 1. Write to DB (fire-and-forget — don't block the import)
    this.supabase
      .from('radio_import_log_entries')
      .insert({
        import_log_id: this.importLogId,
        level,
        phase,
        message,
        details: details ?? {},
        duration_ms: duration_ms ?? null,
      })
      .then(() => {}); // Never fail the import because of logging

    // 2. Stream to UI
    const levelIcon = { debug: '·', info: '▸', warn: '⚠', error: '✗', success: '✓' }[level];
    this.onLog?.({
      type: level === 'error' ? 'error' : level === 'success' ? 'done' : 'status',
      level,
      phase,
      message: `[${ts.slice(11, 19)}] [${level.toUpperCase().padEnd(7)}] [${phase.padEnd(12)}] ${levelIcon} ${message}`,
      raw_message: message,
      details,
      duration_ms,
      timestamp: ts,
    });
  }

  // ── Convenience methods ─────────────────────────────────────────────────────

  async debug(phase: string, message: string, details?: Record<string, unknown>) {
    return this.log('debug', phase, message, details);
  }

  async info(phase: string, message: string, details?: Record<string, unknown>) {
    return this.log('info', phase, message, details);
  }

  async warn(phase: string, message: string, details?: Record<string, unknown>) {
    return this.log('warn', phase, message, details);
  }

  async error(phase: string, message: string, details?: Record<string, unknown>) {
    return this.log('error', phase, message, details);
  }

  async success(phase: string, message: string, details?: Record<string, unknown>, duration_ms?: number) {
    return this.log('success', phase, message, details, duration_ms);
  }

  // ── Phase wrapper — auto-logs start/end/duration/error ──────────────────────

  async phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    await this.info(name, `Phase ${name} démarrée`);

    try {
      const result = await fn();
      const ms = Date.now() - t0;
      await this.success(name, `Phase ${name} terminée (${this.fmtDuration(ms)})`, undefined, ms);
      return result;
    } catch (err) {
      const ms = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      await this.error(name, `Phase ${name} échouée : ${msg}`, { stack, duration_ms: ms });
      throw err;
    }
  }

  private fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
  }
}
