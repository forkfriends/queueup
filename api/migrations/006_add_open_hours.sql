-- Track optional open/close times for the session
ALTER TABLE sessions ADD COLUMN open_time TEXT;
ALTER TABLE sessions ADD COLUMN close_time TEXT;
