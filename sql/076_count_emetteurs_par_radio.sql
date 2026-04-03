-- RPC: count emitters per radio (reliable replacement for embedded count)
-- Used by /api/radio/stations to get nb_emetteurs per radio
CREATE OR REPLACE FUNCTION count_emetteurs_par_radio()
RETURNS TABLE(radio_id uuid, nb bigint)
LANGUAGE sql STABLE
AS $$
  SELECT radio_id, COUNT(*) as nb
  FROM emetteurs_radio
  WHERE radio_id IS NOT NULL
  GROUP BY radio_id;
$$;
