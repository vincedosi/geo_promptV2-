"""
Import IRIS contours (GeoPackage IGN 2025) → Supabase table `iris`
Via RPC `import_iris_batch` (PostGIS côté serveur)
Usage: python scripts/import_iris.py
"""
import time, json
import geopandas as gpd
import shapely.geometry as sg
from supabase import create_client

GPKG = (
    r"C:/Users/vsidol01/Downloads/IRIS_extract"
    r"/CONTOURS-IRIS-PE_3-0__GPKG_WGS84G_FRA_2025-01-01"
    r"/CONTOURS-IRIS-PE/1_DONNEES_LIVRAISON_2025-09-00132"
    r"/CONTOURS-IRIS-PE_3-0_GPKG_WGS84G_FRA-ED2025-01-01"
    r"/contours-iris-pe.gpkg"
)
SUPABASE_URL = "https://vkkdbygwbrxyogqosten.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZra2RieWd3YnJ4eW9ncW9zdGVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTE4OTk2MCwiZXhwIjoyMDg2NzY1OTYwfQ.hZQcgjx8AbkDF6o1oETQYURnQB9hHi7p0nuXKFjyFrU"
BATCH = 50

def code_dept(code_commune):
    if not code_commune:
        return None
    return code_commune[:3] if str(code_commune).startswith('97') else str(code_commune)[:2]

def run():
    print("Lecture du GeoPackage...")
    gdf = gpd.read_file(GPKG)
    total = len(gdf)
    print(f"  {total} IRIS chargés — CRS: {gdf.crs}")

    print("Connexion Supabase (service role)...")
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Vider la table
    sb.rpc("import_iris_batch", {"batch": []}).execute()  # warm up
    sb.table("iris").delete().neq("code_iris", "____").execute()
    print("  Table iris vidée")

    print("Import en cours (via RPC + PostGIS)...")
    buf = []
    inserted = 0
    errors = 0
    t0 = time.time()

    for _, row in gdf.iterrows():
        try:
            code_comm = str(row.code_insee).strip() if row.code_insee else None
            geom_geojson = json.dumps(sg.mapping(row.geometry)) if (row.geometry and not row.geometry.is_empty) else None
            buf.append({
                "code_iris":    str(row.code_iris).strip(),
                "nom_iris":     str(row.nom_iris).strip() if row.nom_iris else None,
                "code_commune": code_comm,
                "nom_commune":  str(row.nom_commune).strip() if row.nom_commune else None,
                "code_dept":    code_dept(code_comm),
                "type_iris":    str(row.type_iris).strip() if row.type_iris else None,
                "geom":         geom_geojson,
            })
        except Exception as e:
            errors += 1
            continue

        if len(buf) >= BATCH:
            try:
                result = sb.rpc("import_iris_batch", {"batch": buf}).execute()
                inserted += len(buf)
            except Exception as e:
                errors += len(buf)
                print(f"\n  Erreur batch #{inserted//BATCH}: {e}")
            buf = []
            elapsed = time.time() - t0
            print(f"  {inserted}/{total} ({inserted/total*100:.0f}%) — {elapsed:.1f}s", end='\r')

    if buf:
        try:
            sb.rpc("import_iris_batch", {"batch": buf}).execute()
            inserted += len(buf)
        except Exception as e:
            errors += len(buf)

    elapsed = time.time() - t0
    print(f"\nTerminé : {inserted}/{total} insérés, {errors} erreurs — {elapsed:.1f}s")

if __name__ == '__main__':
    run()
