-- Add category 'P' (Service public) for Arcom ODS reference file
ALTER TABLE radios DROP CONSTRAINT IF EXISTS radios_categorie_arcom_check;
ALTER TABLE radios ADD CONSTRAINT radios_categorie_arcom_check
  CHECK (categorie_arcom IN ('A', 'B', 'C', 'D', 'E', 'P'));
