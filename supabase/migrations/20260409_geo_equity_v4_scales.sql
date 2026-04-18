-- Geo-Equity v4: Aggregated scales (commune, département, région)

-- 1. Populate code_region from code_dept
UPDATE iris SET code_region = CASE
  WHEN code_dept IN ('01','03','07','15','26','38','42','43','63','69','73','74') THEN '84'
  WHEN code_dept IN ('21','25','39','58','70','71','89','90') THEN '27'
  WHEN code_dept IN ('22','29','35','56') THEN '53'
  WHEN code_dept IN ('18','28','36','37','41','45') THEN '24'
  WHEN code_dept IN ('2A','2B') THEN '94'
  WHEN code_dept IN ('08','10','51','52','54','55','57','67','68','88') THEN '44'
  WHEN code_dept IN ('02','59','60','62','80') THEN '32'
  WHEN code_dept IN ('75','77','78','91','92','93','94','95') THEN '11'
  WHEN code_dept IN ('14','27','50','61','76') THEN '28'
  WHEN code_dept IN ('16','17','19','23','24','33','40','47','64','79','86','87') THEN '75'
  WHEN code_dept IN ('09','11','12','30','31','32','34','46','48','65','66','81','82') THEN '76'
  WHEN code_dept IN ('44','49','53','72','85') THEN '52'
  WHEN code_dept IN ('04','05','06','13','83','84') THEN '93'
  WHEN code_dept IN ('971') THEN '01'
  WHEN code_dept IN ('972') THEN '02'
  WHEN code_dept IN ('973') THEN '03'
  WHEN code_dept IN ('974') THEN '04'
  WHEN code_dept IN ('976') THEN '06'
  ELSE NULL
END WHERE code_dept IS NOT NULL;

-- 2. Reference tables with pre-computed geometries
CREATE TABLE IF NOT EXISTS ref_regions (
  code_region TEXT PRIMARY KEY,
  nom_region TEXT NOT NULL,
  geom GEOMETRY
);
CREATE INDEX IF NOT EXISTS idx_ref_regions_geom ON ref_regions USING GIST(geom);

CREATE TABLE IF NOT EXISTS ref_departements (
  code_dept TEXT PRIMARY KEY,
  code_region TEXT,
  geom GEOMETRY
);
CREATE INDEX IF NOT EXISTS idx_ref_dept_geom ON ref_departements USING GIST(geom);

CREATE TABLE IF NOT EXISTS ref_communes (
  code_commune TEXT PRIMARY KEY,
  nom_commune TEXT,
  code_dept TEXT,
  code_region TEXT,
  geom GEOMETRY
);
CREATE INDEX IF NOT EXISTS idx_ref_communes_geom ON ref_communes USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_ref_communes_dept ON ref_communes(code_dept);

-- Note: ref tables populated via batch INSERT from iris geom_z7/geom_z10
-- See deployment script for batch population commands
