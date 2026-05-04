-- Migration: Create bill_ai_summary table
-- Purpose: Store AI-generated summaries for bills (short, optimistic, cynical, realistic)
-- Version: 001
-- Date: 2024-12

-- Create the bill_ai_summary table
CREATE TABLE IF NOT EXISTS bill_ai_summary (
    summary_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(50) NOT NULL,
    summary_type VARCHAR(20) NOT NULL,  -- 'short', 'optimistic', 'cynical', 'realistic'
    content TEXT NOT NULL,
    text_version_code VARCHAR(20),       -- Track which bill text version (IH, RH, EAS, ENR, etc.)
    model_used VARCHAR(50) DEFAULT 'claude-3-5-haiku',
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one summary per type per bill
    UNIQUE(bill_id, summary_type)
);

-- Add foreign key constraint (with ON DELETE CASCADE so summaries are removed if bill is deleted)
-- Note: Only add if bill table exists and has bill_id column
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bill' AND column_name = 'bill_id'
    ) THEN
        -- Check if constraint already exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'fk_bill_ai_summary_bill'
        ) THEN
            ALTER TABLE bill_ai_summary
            ADD CONSTRAINT fk_bill_ai_summary_bill
            FOREIGN KEY (bill_id) REFERENCES bill(bill_id) ON DELETE CASCADE;
        END IF;
    END IF;
END $$;

-- Create index for fast lookups by bill_id
CREATE INDEX IF NOT EXISTS idx_bill_ai_summary_bill_id ON bill_ai_summary(bill_id);

-- Create index for querying by summary type (useful for batch operations)
CREATE INDEX IF NOT EXISTS idx_bill_ai_summary_type ON bill_ai_summary(summary_type);

-- Create index for finding stale summaries (where text version doesn't match current)
CREATE INDEX IF NOT EXISTS idx_bill_ai_summary_version ON bill_ai_summary(text_version_code);

-- Create index for finding recently generated summaries
CREATE INDEX IF NOT EXISTS idx_bill_ai_summary_generated ON bill_ai_summary(generated_at DESC);

-- Add check constraint for valid summary types
ALTER TABLE bill_ai_summary DROP CONSTRAINT IF EXISTS chk_summary_type;
ALTER TABLE bill_ai_summary ADD CONSTRAINT chk_summary_type
    CHECK (summary_type IN ('short', 'optimistic', 'cynical', 'realistic'));

-- Create trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_bill_ai_summary_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trg_bill_ai_summary_updated_at ON bill_ai_summary;
CREATE TRIGGER trg_bill_ai_summary_updated_at
    BEFORE UPDATE ON bill_ai_summary
    FOR EACH ROW
    EXECUTE FUNCTION update_bill_ai_summary_updated_at();

-- Create helper function to get all summaries for a bill
CREATE OR REPLACE FUNCTION get_bill_summaries(p_bill_id VARCHAR(50))
RETURNS TABLE (
    summary_type VARCHAR(20),
    content TEXT,
    text_version_code VARCHAR(20),
    model_used VARCHAR(50),
    generated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.summary_type,
        s.content,
        s.text_version_code,
        s.model_used,
        s.generated_at
    FROM bill_ai_summary s
    WHERE s.bill_id = p_bill_id
    ORDER BY
        CASE s.summary_type
            WHEN 'short' THEN 1
            WHEN 'realistic' THEN 2
            WHEN 'optimistic' THEN 3
            WHEN 'cynical' THEN 4
        END;
END;
$$ LANGUAGE plpgsql;

-- Create helper function to check if summaries need regeneration
-- Returns true if bill's text_version_code differs from stored summaries
CREATE OR REPLACE FUNCTION bill_summaries_need_update(p_bill_id VARCHAR(50))
RETURNS BOOLEAN AS $$
DECLARE
    v_bill_version VARCHAR(20);
    v_summary_version VARCHAR(20);
BEGIN
    -- Get current bill text version
    SELECT bill_text_version_code INTO v_bill_version
    FROM bill
    WHERE bill_id = p_bill_id;

    -- Get stored summary version (use any summary type, they should all be same version)
    SELECT text_version_code INTO v_summary_version
    FROM bill_ai_summary
    WHERE bill_id = p_bill_id
    LIMIT 1;

    -- If no summaries exist, they need to be generated
    IF v_summary_version IS NULL THEN
        RETURN TRUE;
    END IF;

    -- If bill has no version code, don't regenerate
    IF v_bill_version IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Compare versions
    RETURN v_bill_version != v_summary_version;
END;
$$ LANGUAGE plpgsql;

-- Create helper function to upsert a summary
CREATE OR REPLACE FUNCTION upsert_bill_summary(
    p_bill_id VARCHAR(50),
    p_summary_type VARCHAR(20),
    p_content TEXT,
    p_text_version_code VARCHAR(20) DEFAULT NULL,
    p_model_used VARCHAR(50) DEFAULT 'claude-3-5-haiku'
)
RETURNS bill_ai_summary AS $$
DECLARE
    v_result bill_ai_summary;
BEGIN
    INSERT INTO bill_ai_summary (bill_id, summary_type, content, text_version_code, model_used)
    VALUES (p_bill_id, p_summary_type, p_content, p_text_version_code, p_model_used)
    ON CONFLICT (bill_id, summary_type)
    DO UPDATE SET
        content = EXCLUDED.content,
        text_version_code = EXCLUDED.text_version_code,
        model_used = EXCLUDED.model_used,
        updated_at = NOW()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Add comment to table
COMMENT ON TABLE bill_ai_summary IS 'Stores AI-generated summaries for bills with multiple perspective types (short, optimistic, cynical, realistic). Summaries are regenerated when bill text version changes.';

COMMENT ON COLUMN bill_ai_summary.summary_type IS 'Type of summary: short (one-sentence), optimistic (angel take), cynical (devil take), realistic (balanced)';
COMMENT ON COLUMN bill_ai_summary.text_version_code IS 'Bill text version code when summary was generated (IH=Introduced House, RH=Reported House, EAS=Engrossed Amendment Senate, ENR=Enrolled, etc.)';
COMMENT ON COLUMN bill_ai_summary.model_used IS 'AI model used to generate summary (e.g., claude-3-5-haiku)';

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON bill_ai_summary TO congress_admin;
-- GRANT USAGE, SELECT ON SEQUENCE bill_ai_summary_summary_id_seq TO congress_admin;
