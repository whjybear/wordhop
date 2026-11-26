-- WordHop fresh database schema and library definitions.
-- Select an empty database before importing. Does not include accounts or personal data.
-- Run pnpm db:init afterwards to import repository vocabulary and create your own admin.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255) NULL UNIQUE,
  email_verified_at TIMESTAMP NULL,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER',
  status ENUM('PENDING','ACTIVE','DISABLED') NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP NULL,
  approved_by BIGINT UNSIGNED NULL,
  last_login_at TIMESTAMP NULL,
  last_library_id BIGINT UNSIGNED NULL,
  score INT UNSIGNED NOT NULL DEFAULT 0,
  study_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  redeemed_pets INT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_user_status(status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) PRIMARY KEY,
  data JSON NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX idx_session_expires(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS word_libraries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  library_type ENUM('SYSTEM','USER') NOT NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_library(owner_user_id),
  INDEX idx_library_type(library_type),
  CONSTRAINT fk_library_owner FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS words (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  library_id BIGINT UNSIGNED NOT NULL,
  word VARCHAR(120) NOT NULL,
  phonetic VARCHAR(255) NULL,
  meaning TEXT NOT NULL,
  example_en TEXT NULL,
  example_cn TEXT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'LOCAL',
  audio_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_library_word(library_id,word),
  INDEX idx_word_lookup(word),
  CONSTRAINT fk_word_library FOREIGN KEY(library_id) REFERENCES word_libraries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS learning_progress (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  unit_size INT NOT NULL DEFAULT 20,
  last_unit INT NOT NULL DEFAULT 0,
  streak INT NOT NULL DEFAULT 0,
  mastered_json JSON NOT NULL,
  wrong_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_progress_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS library_progress (
  user_id BIGINT UNSIGNED NOT NULL,
  library_id BIGINT UNSIGNED NOT NULL,
  unit_size INT NOT NULL DEFAULT 20,
  last_unit INT NOT NULL DEFAULT 0,
  streak INT NOT NULL DEFAULT 0,
  mastered_json JSON NOT NULL,
  wrong_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,library_id),
  CONSTRAINT fk_lp_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_lp_library FOREIGN KEY(library_id) REFERENCES word_libraries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS answer_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  library_id BIGINT UNSIGNED NULL,
  word_id INT NOT NULL,
  mode ENUM('memory','dictation','quiz','spelling') NOT NULL,
  unit_index INT NOT NULL,
  answer VARCHAR(255) NULL,
  correct BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_attempt_library(user_id,library_id),
  INDEX idx_attempt_user_time(user_id,created_at),
  INDEX idx_attempt_word(user_id,word_id),
  CONSTRAINT fk_attempt_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  session_id VARCHAR(128) NULL,
  event_type VARCHAR(50) NOT NULL,
  path VARCHAR(255) NULL,
  metadata JSON NULL,
  ip_hash CHAR(64) NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_user_time(user_id,created_at),
  INDEX idx_event_type_time(event_type,created_at),
  CONSTRAINT fk_event_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_send_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  purpose ENUM('VERIFY','PASSWORD_RESET') NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_purpose_time(email,purpose,sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_type ENUM('EMAIL_VERIFY') NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token_user_type(user_id,token_type),
  INDEX idx_token_expires(expires_at),
  CONSTRAINT fk_token_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unit_perfect_counts (
  user_id BIGINT UNSIGNED NOT NULL,
  library_id BIGINT UNSIGNED NOT NULL,
  unit_size INT UNSIGNED NOT NULL,
  unit_index INT UNSIGNED NOT NULL,
  mode ENUM('dictation','quiz','spelling') NOT NULL,
  perfect_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,library_id,unit_size,unit_index,mode),
  CONSTRAINT fk_upc_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_upc_library FOREIGN KEY(library_id) REFERENCES word_libraries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  content VARCHAR(200) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_message_time(created_at),
  CONSTRAINT fk_message_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pk_challenges (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  creator_user_id BIGINT UNSIGNED NOT NULL,
  library_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  word_count INT UNSIGNED NOT NULL,
  word_ids JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pk_time(start_at,end_at),
  CONSTRAINT fk_pk_creator FOREIGN KEY(creator_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_pk_library FOREIGN KEY(library_id) REFERENCES word_libraries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pk_participants (
  challenge_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  total_ms BIGINT UNSIGNED NOT NULL DEFAULT 2147483647,
  PRIMARY KEY(challenge_id,user_id),
  INDEX idx_pk_rank(challenge_id,total_ms,completed_at),
  CONSTRAINT fk_pkp_challenge FOREIGN KEY(challenge_id) REFERENCES pk_challenges(id) ON DELETE CASCADE,
  CONSTRAINT fk_pkp_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_notes_user_created(user_id,created_at,id),
  CONSTRAINT fk_notes_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO word_libraries(code,name,library_type) VALUES
  ('PRIMARY','小学','SYSTEM'),
  ('JUNIOR','初中','SYSTEM'),
  ('SENIOR','高中','SYSTEM'),
  ('POSTGRAD','研究生','SYSTEM'),
  ('IELTS','雅思','SYSTEM'),
  ('CET6','六级','SYSTEM'),
  ('CET4','四级','SYSTEM')
ON DUPLICATE KEY UPDATE name=VALUES(name);
