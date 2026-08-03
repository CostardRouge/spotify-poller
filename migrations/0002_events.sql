-- Table d'événements canonique. Photos et activités s'y ajouteront
-- sans changement de schéma (spec §4.2).
CREATE TABLE events (
  id           TEXT PRIMARY KEY,   -- clé déterministe (dédup = INSERT OR IGNORE, invariant I2)
  ts_utc       TEXT NOT NULL,      -- ISO8601 avec Z, toujours renseigné
  ts_local     TEXT,               -- NULL au démarrage, rempli plus tard via l'oracle photos (§10)
  tz           TEXT,               -- nom IANA, NULL si inconnu
  type         TEXT NOT NULL,      -- 'listen' | 'like' | 'photo' | 'activity'
  source       TEXT NOT NULL,      -- 'spotify' | 'photos' | 'strava'
  duration_s   INTEGER,
  lat          REAL,
  lon          REAL,
  title        TEXT,               -- dénormalisé pour l'affichage calendrier
  subtitle     TEXT,
  payload      TEXT NOT NULL,      -- JSON spécifique à la source
  ingested_at  TEXT NOT NULL
);

CREATE INDEX idx_events_ts      ON events(ts_utc);
CREATE INDEX idx_events_type_ts ON events(type, ts_utc);
