-- Track maximum guest capacity per session
ALTER TABLE sessions ADD COLUMN max_guests INTEGER DEFAULT 100;
