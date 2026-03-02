/**
 * GENESIS — API Route — POST /api/admin/sources/[id]/summary
 * Génère un résumé IA via Mistral pour une data source
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const supabase = createAdminClient();
    const { id } = params;

    // Fetch source details
    const { data: source, error } = await supabase
      .from('data_sources')
      .select('*, organizations(name)')
      .eq('id', id)
      .single();

    if (error || !source) {
      return NextResponse.json({ success: false, error: 'Source non trouvee' }, { status: 404 });
    }

    // Build prompt for Mistral
    const prompt = buildSummaryPrompt(source);

    // Call Mistral API
    const mistralKey = process.env.MISTRAL_API_KEY;
    if (!mistralKey) throw new Error('MISTRAL_API_KEY manquant');

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mistralKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          {
            role: 'system',
            content: 'Tu es un assistant qui genere des resumes concis de sources de donnees geographiques. Reponds en francais, en 2-3 phrases maximum. Sois factuel et precis.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      throw new Error(`Mistral API error: ${response.status}`);
    }

    const result = await response.json();
    const summary = result.choices?.[0]?.message?.content?.trim() || 'Resume non disponible';

    // Save summary to data_sources
    await supabase
      .from('data_sources')
      .update({ ai_summary: summary })
      .eq('id', id);

    return NextResponse.json({ success: true, summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur generation resume';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function buildSummaryPrompt(source: Record<string, unknown>): string {
  const org = (source as any).organizations?.name || 'Inconnue';
  const parts = [
    `Source de donnees: "${source.name}"`,
    `Type: ${source.type}${source.category ? ` (categorie: ${source.category})` : ''}${source.regie ? ` (regie: ${source.regie})` : ''}`,
    `Organisation: ${org}`,
    `Fichier: ${source.original_filename || 'inconnu'} (format: ${source.file_format || 'inconnu'})`,
    `Lignes importees: ${source.valid_count || 0} valides sur ${source.row_count || 0} total (${source.error_count || 0} erreurs)`,
    `Date d'import: ${source.import_date ? new Date(source.import_date as string).toLocaleDateString('fr-FR') : 'inconnue'}`,
  ];

  if (source.mapping && Object.keys(source.mapping as object).length > 0) {
    const mappingKeys = Object.entries(source.mapping as Record<string, string>)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}→${v}`)
      .join(', ');
    if (mappingKeys) parts.push(`Colonnes mappees: ${mappingKeys}`);
  }

  return `Genere un resume en francais de cette source de donnees geographiques :\n${parts.join('\n')}`;
}
