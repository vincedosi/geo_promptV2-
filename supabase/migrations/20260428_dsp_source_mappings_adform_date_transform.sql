-- Fix follow-up A1 : la colonne `date` Adform reçoit du DD/MM/YYYY (format EU)
-- mais le seed A1 ne posait pas la transform `parse_eu_date`. Le nouveau
-- parser (chantier A2 — lib/dsp-mapping/parser.ts) cast strictement
-- YYYY-MM-DD en date — donc les dates Adform étaient toutes rejetées.
-- Cette correction aligne le seed sur la réalité du fichier Adform.
UPDATE public.dsp_source_mappings
SET transform = 'parse_eu_date',
    notes = 'Migration depuis column-mappings.ts (Adform exporte DD/MM/YYYY → parse_eu_date)'
WHERE dsp_source = 'adform'
  AND source_column = 'date'
  AND transform IS NULL;
