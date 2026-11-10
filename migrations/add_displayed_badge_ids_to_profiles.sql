-- Equipped profile badges shown next to the display name (max 2).
-- NULL = never customized (auto: rarest earned). '{}' = intentionally show none.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS displayed_badge_ids TEXT[] DEFAULT NULL;

COMMENT ON COLUMN profiles.displayed_badge_ids IS 'Up to 2 badge ids next to the profile name. NULL = auto (rarest earned). Empty array = show none.';
