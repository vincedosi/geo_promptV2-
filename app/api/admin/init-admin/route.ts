import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/auth";
import { lireCorps } from "@/lib/api/valider-corps";

export const dynamic = 'force-dynamic';

/**
 * Amorcage du premier compte. Les deux valeurs par defaut sont celles du code
 * d'origine : les changer casserait une installation qui s'appuie dessus.
 */
const InitAdminSchema = z.object({
  email: z.string().trim().min(1).default("admin@genesis.local"),
  password: z.string().min(1).default("changeme123"),
});

/**
 * POST /api/admin/init-admin
 *
 * Crée un compte admin via Supabase Auth si aucun utilisateur n'existe.
 */
export async function POST(request: Request) {
  try {
    const authKey = request.headers.get("x-admin-key");
    if (authKey !== process.env.ADMIN_INIT_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // `corpsAbsentTolere` : cette route d'amorcage s'appelle legitimement sans
    // corps — les deux champs ont une valeur par defaut. Un corps PRESENT mais
    // mal forme reste refuse : creer l'administrateur avec le mot de passe par
    // defaut alors que l'appelant croyait en avoir fourni un serait pire que
    // d'echouer.
    const corps = await lireCorps(request, InitAdminSchema, { corpsAbsentTolere: true });
    if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
    const { email, password } = corps.valeur;

    const supabase = createAdminClient();

    // Check if users exist via Supabase Auth admin API
    const { data: existingUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (existingUsers && existingUsers.users.length > 0) {
      return NextResponse.json(
        { error: "Des utilisateurs existent déjà.", userCount: existingUsers.users.length },
        { status: 400 }
      );
    }

    // Create admin user via Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Admin", role: "admin" },
    });

    if (error) throw error;

    return NextResponse.json({
      message: "Compte admin créé avec succès!",
      user: { id: data.user.id, email: data.user.email, role: "admin" },
    }, { status: 201 });
  } catch (error) {
    console.error("[INIT-ADMIN]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/init-admin
 * Liste les utilisateurs existants.
 * Protégé par la même clé x-admin-key que le POST.
 */
export async function GET(request: Request) {
  const authKey = request.headers.get("x-admin-key");
  if (authKey !== process.env.ADMIN_INIT_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 50 });
    if (error) throw error;

    return NextResponse.json({
      message: "État des utilisateurs",
      userCount: data.users.length,
      users: data.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.user_metadata?.full_name ?? null,
        role: u.user_metadata?.role ?? "user",
        verified: !!u.email_confirmed_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
