-- Couche brute : le JSON tel que reçu, écrit AVANT tout parsing (invariant I3).
CREATE TABLE raw_spotify (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  collector    TEXT    NOT NULL,   -- 'recently_played' | 'liked_tracks'
  fetched_at   TEXT    NOT NULL,   -- ISO8601 UTC, heure de l'appel
  http_status  INTEGER NOT NULL,   -- 0 si erreur réseau (pas de réponse)
  request_url  TEXT    NOT NULL,
  payload      TEXT                -- corps intégral, NULL si erreur réseau
);

CREATE INDEX idx_raw_fetched ON raw_spotify(collector, fetched_at);
