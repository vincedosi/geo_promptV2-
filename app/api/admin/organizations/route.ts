/**
 * GENESIS — API Route — /api/admin/organizations
 * GET  : Liste toutes les organisations
 * POST : Crée une organisation
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export async function GET() {
  try {
    const supabase = createAdminClient();

    const { data: orgs, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Enrich with member count + source count
    const enriched = await Promise.all(
      (orgs || []).map(async (org) => {
        const [members, sources] = await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
          supabase.from('data_sources').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).neq('status', 'deleted'),
        ]);
        return {
          ...org,
          member_count: members.count || 0,
          source_count: sources.count || 0,
        };
      })
    );

    return NextResponse.json({ success: true, organizations: enriched });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = createAdminClient();

    if (!body.name?.trim()) {
      return NextResponse.json({ success: false, error: 'Nom requis' }, { status: 400 });
    }

    const slug = body.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const { data, error } = await supabase
      .from('organizations')
      .insert({
        name: body.name.trim(),
        slug,
        logo_url: body.logo_url || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[ORGS] Insert error:', error.message, error.code);
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: 'Une organisation avec ce nom existe deja' }, { status: 409 });
      }
      return NextResponse.json({
        success: false,
        error: `${error.message} (code: ${error.code})`,
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, organization: data });
  } catch (err: unknown) {
    console.error('[ORGS] Exception:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
