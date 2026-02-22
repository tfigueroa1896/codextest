PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('color', 'object')),
  target_value TEXT NOT NULL,
  animal_name TEXT NOT NULL,
  animal_image_url TEXT NOT NULL,
  audio_prompt_url TEXT
);

CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL,
  challenge_id INTEGER NOT NULL,
  is_unlocked INTEGER NOT NULL DEFAULT 0 CHECK (is_unlocked IN (0, 1)),
  unlocked_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, challenge_id),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_challenges_type ON challenges(type);
CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
