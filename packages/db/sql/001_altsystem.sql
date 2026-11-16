-- Schema des Altsystems (Ist-Zustand). Primärschlüssel sind UUIDs.
-- Absichtlich OHNE Unique-Key auf (event_id, platz_nr): genau das erlaubt den Doppelverkauf.

CREATE TABLE IF NOT EXISTS event (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  beschreibung TEXT         NOT NULL,
  bild_url     VARCHAR(500) NULL,
  datum        DATETIME     NOT NULL,
  preis_cent   INT          NOT NULL,
  erstellt_am  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kontingent (
  id       CHAR(36) NOT NULL PRIMARY KEY,
  event_id CHAR(36) NOT NULL,
  gesamt   INT      NOT NULL,
  verkauft INT      NOT NULL DEFAULT 0,
  CONSTRAINT fk_kontingent_event FOREIGN KEY (event_id) REFERENCES event(id)
);

CREATE TABLE IF NOT EXISTS bestellung (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  event_id    CHAR(36)     NOT NULL,
  name        VARCHAR(200) NOT NULL,
  email       VARCHAR(320) NOT NULL,
  anzahl      INT          NOT NULL,
  summe_cent  INT          NOT NULL,
  status      VARCHAR(20)  NOT NULL,
  erstellt_am DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bestellung_event FOREIGN KEY (event_id) REFERENCES event(id)
);

CREATE TABLE IF NOT EXISTS ticket (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  bestellung_id CHAR(36)     NOT NULL,
  event_id      CHAR(36)     NOT NULL,
  platz_nr      INT          NOT NULL,
  pdf_pfad      VARCHAR(500) NULL,
  erstellt_am   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_bestellung FOREIGN KEY (bestellung_id) REFERENCES bestellung(id),
  CONSTRAINT fk_ticket_event FOREIGN KEY (event_id) REFERENCES event(id),
  KEY idx_ticket_event (event_id)
);
