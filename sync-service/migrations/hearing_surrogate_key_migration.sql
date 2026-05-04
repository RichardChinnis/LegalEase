-- Migration: Add surrogate primary key to hearing table
-- This allows multiple hearings with the same jacket_number but different chambers
-- Run as a single transaction

BEGIN;

-- ============================================
-- STEP 1: Add hearing_id column to hearing table
-- ============================================
ALTER TABLE hearing ADD COLUMN hearing_id SERIAL;

-- Populate hearing_id for existing records (already done by SERIAL)
-- Verify all have IDs
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM hearing WHERE hearing_id IS NULL) THEN
        RAISE EXCEPTION 'Some hearing records do not have hearing_id';
    END IF;
END $$;

-- ============================================
-- STEP 2: Add hearing_id column to child tables
-- ============================================
ALTER TABLE hearing_date ADD COLUMN hearing_id INTEGER;
ALTER TABLE hearing_committee ADD COLUMN hearing_id INTEGER;
ALTER TABLE hearing_format ADD COLUMN hearing_id INTEGER;
ALTER TABLE hearing_meeting ADD COLUMN hearing_id INTEGER;

-- ============================================
-- STEP 3: Populate hearing_id in child tables
-- ============================================
UPDATE hearing_date hd
SET hearing_id = h.hearing_id
FROM hearing h
WHERE hd.hearing_jacket_number = h.jacket_number;

UPDATE hearing_committee hc
SET hearing_id = h.hearing_id
FROM hearing h
WHERE hc.hearing_jacket_number = h.jacket_number;

UPDATE hearing_format hf
SET hearing_id = h.hearing_id
FROM hearing h
WHERE hf.hearing_jacket_number = h.jacket_number;

UPDATE hearing_meeting hm
SET hearing_id = h.hearing_id
FROM hearing h
WHERE hm.hearing_jacket_number = h.jacket_number;

-- Verify all child records have hearing_id
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM hearing_date WHERE hearing_id IS NULL) THEN
        RAISE EXCEPTION 'Some hearing_date records do not have hearing_id';
    END IF;
    IF EXISTS (SELECT 1 FROM hearing_committee WHERE hearing_id IS NULL) THEN
        RAISE EXCEPTION 'Some hearing_committee records do not have hearing_id';
    END IF;
    IF EXISTS (SELECT 1 FROM hearing_format WHERE hearing_id IS NULL) THEN
        RAISE EXCEPTION 'Some hearing_format records do not have hearing_id';
    END IF;
    IF EXISTS (SELECT 1 FROM hearing_meeting WHERE hearing_id IS NULL) THEN
        RAISE EXCEPTION 'Some hearing_meeting records do not have hearing_id';
    END IF;
END $$;

-- ============================================
-- STEP 4: Drop old FK constraints from child tables
-- ============================================
ALTER TABLE hearing_date DROP CONSTRAINT hearing_date_hearing_jacket_number_fkey;
ALTER TABLE hearing_committee DROP CONSTRAINT fk_hearing_committee_hearing;
ALTER TABLE hearing_format DROP CONSTRAINT fk_hearing_format_hearing;
ALTER TABLE hearing_meeting DROP CONSTRAINT fk_hearing_meeting_hearing;

-- ============================================
-- STEP 5: Drop old UNIQUE constraints that include hearing_jacket_number
-- ============================================
ALTER TABLE hearing_date DROP CONSTRAINT uq_hearing_date;
ALTER TABLE hearing_committee DROP CONSTRAINT uq_hearing_committee_association;
ALTER TABLE hearing_format DROP CONSTRAINT uq_hearing_format_type;
ALTER TABLE hearing_meeting DROP CONSTRAINT uq_hearing_meeting_association;

-- ============================================
-- STEP 6: Change PK in hearing from jacket_number to hearing_id
-- ============================================
ALTER TABLE hearing DROP CONSTRAINT hearing_pkey;
ALTER TABLE hearing ADD CONSTRAINT hearing_pkey PRIMARY KEY (hearing_id);

-- ============================================
-- STEP 7: Add UNIQUE constraint on (jacket_number, chamber) in hearing
-- ============================================
ALTER TABLE hearing ADD CONSTRAINT uq_hearing_jacket_chamber UNIQUE (jacket_number, chamber);

-- ============================================
-- STEP 8: Make hearing_id NOT NULL in child tables and create new FK constraints
-- ============================================
ALTER TABLE hearing_date ALTER COLUMN hearing_id SET NOT NULL;
ALTER TABLE hearing_committee ALTER COLUMN hearing_id SET NOT NULL;
ALTER TABLE hearing_format ALTER COLUMN hearing_id SET NOT NULL;
ALTER TABLE hearing_meeting ALTER COLUMN hearing_id SET NOT NULL;

ALTER TABLE hearing_date
    ADD CONSTRAINT fk_hearing_date_hearing
    FOREIGN KEY (hearing_id) REFERENCES hearing(hearing_id) ON DELETE CASCADE;

ALTER TABLE hearing_committee
    ADD CONSTRAINT fk_hearing_committee_hearing_id
    FOREIGN KEY (hearing_id) REFERENCES hearing(hearing_id) ON DELETE CASCADE;

ALTER TABLE hearing_format
    ADD CONSTRAINT fk_hearing_format_hearing_id
    FOREIGN KEY (hearing_id) REFERENCES hearing(hearing_id) ON DELETE CASCADE;

ALTER TABLE hearing_meeting
    ADD CONSTRAINT fk_hearing_meeting_hearing_id
    FOREIGN KEY (hearing_id) REFERENCES hearing(hearing_id) ON DELETE CASCADE;

-- ============================================
-- STEP 9: Create new UNIQUE constraints using hearing_id
-- ============================================
ALTER TABLE hearing_date
    ADD CONSTRAINT uq_hearing_date UNIQUE (hearing_id, date);

ALTER TABLE hearing_committee
    ADD CONSTRAINT uq_hearing_committee_association UNIQUE (hearing_id, committee_system_code);

ALTER TABLE hearing_format
    ADD CONSTRAINT uq_hearing_format_type UNIQUE (hearing_id, format_type);

ALTER TABLE hearing_meeting
    ADD CONSTRAINT uq_hearing_meeting_association UNIQUE (hearing_id, meeting_event_id);

-- ============================================
-- STEP 10: Drop hearing_jacket_number columns from child tables
-- ============================================
ALTER TABLE hearing_date DROP COLUMN hearing_jacket_number;
ALTER TABLE hearing_committee DROP COLUMN hearing_jacket_number;
ALTER TABLE hearing_format DROP COLUMN hearing_jacket_number;
ALTER TABLE hearing_meeting DROP COLUMN hearing_jacket_number;

-- ============================================
-- STEP 11: Create index on jacket_number for lookup performance
-- ============================================
CREATE INDEX idx_hearing_jacket_number ON hearing(jacket_number);

-- ============================================
-- STEP 12: Create index on hearing_id in child tables for join performance
-- ============================================
CREATE INDEX idx_hearing_date_hearing_id ON hearing_date(hearing_id);
CREATE INDEX idx_hearing_committee_hearing_id ON hearing_committee(hearing_id);
CREATE INDEX idx_hearing_format_hearing_id ON hearing_format(hearing_id);
CREATE INDEX idx_hearing_meeting_hearing_id ON hearing_meeting(hearing_id);

COMMIT;

-- Verify final state
SELECT 'hearing' as table_name, COUNT(*) as count FROM hearing
UNION ALL
SELECT 'hearing_date', COUNT(*) FROM hearing_date
UNION ALL
SELECT 'hearing_committee', COUNT(*) FROM hearing_committee
UNION ALL
SELECT 'hearing_format', COUNT(*) FROM hearing_format
UNION ALL
SELECT 'hearing_meeting', COUNT(*) FROM hearing_meeting;
