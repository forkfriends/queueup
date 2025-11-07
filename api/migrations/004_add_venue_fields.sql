ALTER TABLE sessions ADD COLUMN call_timeout_seconds INTEGER NOT NULL DEFAULT 120;
ALTER TABLE sessions ADD COLUMN venue_label TEXT;
ALTER TABLE sessions ADD COLUMN venue_lat REAL;
ALTER TABLE sessions ADD COLUMN venue_lng REAL;
ALTER TABLE sessions ADD COLUMN venue_radius_m REAL;
