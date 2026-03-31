import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const GITHUB_TOKEN = process.env.GITHUB_ACTIONS_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO; // format: "owner/repo"
const WORKFLOW     = 'generate-iris-pmtiles.yml';

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return NextResponse.json(
      { error: 'Variables manquantes : GITHUB_ACTIONS_TOKEN et GITHUB_REPO requis dans .env.local' },
      { status: 500 },
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization:          `Bearer ${GITHUB_TOKEN}`,
        Accept:                 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type':         'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `GitHub API ${res.status} — ${text}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Workflow "Generate IRIS PMTiles" déclenché. Durée estimée : 5-8 min.',
    workflow_url: `https://github.com/${GITHUB_REPO}/actions/workflows/${WORKFLOW}`,
  });
}
