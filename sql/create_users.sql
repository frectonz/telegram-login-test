CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  auth_date INTEGER NOT NULL,
  first_name TEXT NULL,
  last_name TEXT NULL,
  photo_url TEXT NULL
);