-- Seed 001: known_places — ONLY localities named in SURVEY.md (§2 routes table).
--
-- COORDINATES: intentionally NULL. They must come from a real Nominatim query and be recorded
-- with source_query + queried_on (2026-11-19). Nothing is written from memory.
-- TODO (owner): fill latitude/longitude/source/source_query/queried_on for every row, e.g.
--   UPDATE known_places SET latitude=?, longitude=?, source='OpenStreetMap/Nominatim',
--     source_query='<exact query>', queried_on='2026-11-19' WHERE city=? AND name=?;
-- Rows still marked source='TODO-fill-from-Nominatim' are the ones left to fill.
--
-- Idempotent: re-running never duplicates rows and never overwrites filled-in coordinates.
INSERT INTO known_places (city, name) VALUES
  -- Study / origin cities
  ('Timișoara', 'Timișoara'),
  ('Cluj-Napoca', 'Cluj-Napoca'),
  ('Sibiu', 'Sibiu'),
  ('București', 'București'),
  ('Reșița', 'Reșița'),
  ('Râmnicu Vâlcea', 'Râmnicu Vâlcea'),
  ('Bacău', 'Bacău'),
  ('Hunedoara', 'Hunedoara'),
  ('Vulcan', 'Vulcan'),
  ('Sântana', 'Sântana'),
  ('Zalău', 'Zalău'),
  ('Mediaș', 'Mediaș'),
  -- Intermediate localities
  ('Bocșa', 'Bocșa'),
  ('Gătaia', 'Gătaia'),
  ('Voiteg', 'Voiteg'),
  ('Alba Iulia', 'Alba Iulia'),
  ('Turda', 'Turda'),
  ('Sebeș', 'Sebeș'),
  ('Călimănești', 'Călimănești'),
  ('Câineni', 'Câineni'),
  ('Boița', 'Boița'),
  ('Tălmaciu', 'Tălmaciu'),
  ('Focșani', 'Focșani'),
  ('Buzău', 'Buzău'),
  ('Ploiești', 'Ploiești'),
  ('Adjud', 'Adjud'),
  ('Mărășești', 'Mărășești'),
  ('Mizil', 'Mizil'),
  ('Deva', 'Deva'),
  ('Caransebeș', 'Caransebeș'),
  ('Arad', 'Arad'),
  ('Vinga', 'Vinga'),
  ('Orțișoara', 'Orțișoara'),
  ('Zimbor', 'Zimbor'),
  ('Copșa Mică', 'Copșa Mică'),
  ('Șura Mare', 'Șura Mare')
ON DUPLICATE KEY UPDATE city = city;
