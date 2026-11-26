import "dotenv/config";
import { pool } from "./db.js";
const [column] = await pool.query(
  "SHOW COLUMNS FROM users LIKE 'redeemed_pets'",
);
if (!column.length)
  await pool.query(
    "ALTER TABLE users ADD COLUMN redeemed_pets INT UNSIGNED NOT NULL DEFAULT 0 AFTER study_seconds",
  );
const [audioColumn] = await pool.query(
  "SHOW COLUMNS FROM words LIKE 'audio_url'",
);
if (!audioColumn.length)
  await pool.query(
    "ALTER TABLE words ADD COLUMN audio_url VARCHAR(500) NULL AFTER source",
  );
const [ipColumn] = await pool.query(
  "SHOW COLUMNS FROM user_events LIKE 'ip_address'",
);
if (!ipColumn.length)
  await pool.query(
    "ALTER TABLE user_events ADD COLUMN ip_address VARCHAR(45) NULL AFTER ip_hash",
  );
await pool.query(`CREATE TABLE IF NOT EXISTS email_send_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  purpose ENUM('VERIFY','PASSWORD_RESET') NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_purpose_time(email,purpose,sent_at)
)`);
const [phoneIndexes] = await pool.query(
  "SHOW INDEX FROM users WHERE Column_name='phone' AND Non_unique=0 AND Key_name!='PRIMARY'",
);
for (const index of phoneIndexes)
  await pool.query(`ALTER TABLE users DROP INDEX \`${index.Key_name}\``);
await pool.query(
  "ALTER TABLE answer_attempts MODIFY COLUMN mode ENUM('memory','dictation','quiz','spelling') NOT NULL",
);
await pool.query(`CREATE TABLE IF NOT EXISTS unit_perfect_counts (
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
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS pk_challenges (
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
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS pk_participants (
  challenge_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  total_ms BIGINT UNSIGNED NOT NULL DEFAULT 2147483647,
  PRIMARY KEY(challenge_id,user_id),
  INDEX idx_pk_rank(challenge_id,total_ms,completed_at),
  CONSTRAINT fk_pkp_challenge FOREIGN KEY(challenge_id) REFERENCES pk_challenges(id) ON DELETE CASCADE,
  CONSTRAINT fk_pkp_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS notes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_notes_user_created(user_id,created_at,id),
  CONSTRAINT fk_notes_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
)`);
console.log("数据库增量结构同步完成");
await pool.end();
