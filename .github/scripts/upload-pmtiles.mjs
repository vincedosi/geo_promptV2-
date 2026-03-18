/**
 * Upload carreaux_filosofi.pmtiles → Supabase Storage (bucket "tiles")
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, statSync } from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FILE = 'carreaux_filosofi.pmtiles';
const BUCKET = 'tiles';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const size = statSync(FILE).size;
  console.log(`[upload] ${FILE} (${(size / 1024 / 1024).toFixed(1)} MB)`);

  // Créer le bucket s'il n'existe pas
  const { error: bucketErr } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 500 * 1024 * 1024, // 500 MB
  });
  if (bucketErr && !bucketErr.message.includes('already exists')) {
    throw bucketErr;
  }

  const fileBuffer = readFileSync(FILE);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(FILE, fileBuffer, {
      contentType: 'application/x-protobuf',
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(FILE);
  console.log(`[upload] OK → ${data.publicUrl}`);
  console.log(`\nMets cette URL dans CarreauxPMTilesLayer.tsx :\nconst PMTILES_URL = '${data.publicUrl}';`);
}

main().catch((e) => { console.error(e); process.exit(1); });
