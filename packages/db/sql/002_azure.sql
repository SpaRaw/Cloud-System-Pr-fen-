-- Erweiterung für das Zielsystem. Läuft NACH dem Import der Altdaten.
-- 1) Verkaufszeitraum für Events (steuert, welche Events Redis aufbaut).
ALTER TABLE event
  ADD COLUMN verkauf_ab  DATETIME NULL,
  ADD COLUMN verkauf_bis DATETIME NULL;
UPDATE event SET verkauf_ab = erstellt_am, verkauf_bis = datum WHERE verkauf_ab IS NULL;
ALTER TABLE event
  MODIFY verkauf_ab  DATETIME NOT NULL,
  MODIFY verkauf_bis DATETIME NOT NULL;

-- 2) Zweite Sicherung gegen Überverkauf: ein Platz pro Event höchstens einmal.
--    Schlägt fehl, wenn die Altdaten schon doppelt verkaufte Plätze enthalten (siehe docs/MIGRATION.md).
ALTER TABLE ticket ADD CONSTRAINT uq_ticket_platz UNIQUE (event_id, platz_nr);

-- 3) Ein Kontingent pro Event.
ALTER TABLE kontingent ADD CONSTRAINT uq_kontingent_event UNIQUE (event_id);
