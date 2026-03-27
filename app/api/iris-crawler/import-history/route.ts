import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export interface ImportHistoryEntry {
  id: string;
  created_at: string;
  filename: string;
  total_rows: number;
  inserted_rows: number;
  updated_rows: number;
  error_rows: number;
  status: 'pending' | 'processing' | 'success' | 'partial' | 'error';
  user_id: string | null;
  column_mapping: Record<string, string> | null;
  error_details: Array<{ batch?: number; message: string }> | null;
}

// GET /api/iris-crawler/import-history
export async function GET(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from('iris_import_history')
    .select('id, created_at, filename, total_rows, inserted_rows, updated_rows, error_rows, status, user_id, column_mapping, error_details')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    // Si la table n'existe pas encore, retourner un tableau vide
    if (error.code === '42P01') {
      return NextResponse.json({ entries: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: data as ImportHistoryEntry[] });
}
