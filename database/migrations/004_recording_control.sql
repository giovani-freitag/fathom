-- Which contracts a supervisor should be recording, and how much disk the whole
-- recording may occupy. Both live here rather than in the environment because
-- they are decisions a reader makes while watching, not settings a deploy fixes.

ALTER TABLE instrument_registry
    ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Everything already registered was, by definition, being recorded.
UPDATE instrument_registry SET is_enabled = TRUE WHERE is_enabled IS NULL;

CREATE TABLE IF NOT EXISTS recording_budget (
    -- One row. The primary key exists to say so.
    id                 BOOLEAN     PRIMARY KEY DEFAULT TRUE,
    maximum_bytes      BIGINT      NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT recording_budget_is_single_row CHECK (id),
    CONSTRAINT recording_budget_is_positive   CHECK (maximum_bytes > 0)
);

-- Ten gigabytes: roughly nine months of three contracts at the default grid,
-- and small enough that a laptop never notices it.
INSERT INTO recording_budget (id, maximum_bytes)
VALUES (TRUE, 10737418240)
ON CONFLICT (id) DO NOTHING;
