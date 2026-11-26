import fs from 'node:fs/promises'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import 'dotenv/config'
import {pool} from './db.js'

const sql=await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8')
for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await pool.query(statement)

const [lastLibraryColumn]=await pool.query("SHOW COLUMNS FROM users LIKE 'last_library_id'")
if(!lastLibraryColumn.length) await pool.query('ALTER TABLE users ADD COLUMN last_library_id BIGINT UNSIGNED NULL AFTER last_login_at')
const [emailColumn]=await pool.query("SHOW COLUMNS FROM users LIKE 'email'")
if(!emailColumn.length) await pool.query('ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER phone, ADD UNIQUE KEY uk_user_email(email)')
const [verifiedColumn]=await pool.query("SHOW COLUMNS FROM users LIKE 'email_verified_at'")
if(!verifiedColumn.length) await pool.query('ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL AFTER email')
const [scoreColumn]=await pool.query("SHOW COLUMNS FROM users LIKE 'score'")
if(!scoreColumn.length) await pool.query('ALTER TABLE users ADD COLUMN score INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_login_at')
const [studySecondsColumn]=await pool.query("SHOW COLUMNS FROM users LIKE 'study_seconds'")
if(!studySecondsColumn.length) await pool.query('ALTER TABLE users ADD COLUMN study_seconds INT UNSIGNED NOT NULL DEFAULT 0 AFTER score')
const [redeemedPetsColumn]=await pool.query("SHOW COLUMNS FROM users LIKE 'redeemed_pets'")
if(!redeemedPetsColumn.length) await pool.query('ALTER TABLE users ADD COLUMN redeemed_pets INT UNSIGNED NOT NULL DEFAULT 0 AFTER study_seconds')
const [attemptLibraryColumn]=await pool.query("SHOW COLUMNS FROM answer_attempts LIKE 'library_id'")
if(!attemptLibraryColumn.length) await pool.query('ALTER TABLE answer_attempts ADD COLUMN library_id BIGINT UNSIGNED NULL AFTER user_id, ADD INDEX idx_attempt_library(user_id,library_id)')
const [audioUrlColumn]=await pool.query("SHOW COLUMNS FROM words LIKE 'audio_url'")
if(!audioUrlColumn.length) await pool.query('ALTER TABLE words ADD COLUMN audio_url VARCHAR(500) NULL AFTER source')

if(process.env.ADMIN_USERNAME&&process.env.ADMIN_PASSWORD){
  const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12)
  await pool.execute('INSERT INTO users(username,name,phone,email,email_verified_at,password_hash,role,status,approved_at) VALUES(?,?,?,?,NOW(),?,"ADMIN","ACTIVE",NOW()) ON DUPLICATE KEY UPDATE role="ADMIN",status="ACTIVE",password_hash=VALUES(password_hash),email=COALESCE(VALUES(email),email),email_verified_at=NOW()',[process.env.ADMIN_USERNAME,process.env.ADMIN_NAME||'系统管理员',process.env.ADMIN_PHONE||'13800000000',process.env.ADMIN_EMAIL||null,hash])
}

const baseLibraries=[
  {code:'PRIMARY',name:'小学',file:'小学-2026.txt'},
  {code:'JUNIOR',name:'初中',file:'初中-2026.txt'},
  {code:'SENIOR',name:'高中',file:'高中-2026.txt'},
  {code:'POSTGRAD',name:'研究生',file:'研究生-2026.txt'},
  {code:'IELTS',name:'雅思',file:'IELTS-2026-selenium.txt'},
  {code:'CET6',name:'六级',file:'cet6-2026-selenium.txt'},
  {code:'CET4',name:'四级',file:'cet4-2026-selenium.txt'}
]
const root=path.resolve(new URL('../../',import.meta.url).pathname.replace(/^\/(.:)/,'$1'))
function parse(source){return source.split(/\r?\n/).map(line=>{const a=line.indexOf(','),b=line.indexOf(',',a+1);return a>0&&b>a?{word:line.slice(0,a).trim(),phonetic:line.slice(a+1,b).trim(),meaning:line.slice(b+1).trim()}:null}).filter(Boolean)}
for(const item of baseLibraries){
  await pool.execute('INSERT INTO word_libraries(code,name,library_type) VALUES(?,?,"SYSTEM") ON DUPLICATE KEY UPDATE name=VALUES(name)',[item.code,item.name])
  const [[library]]=await pool.query('SELECT id FROM word_libraries WHERE code=?',[item.code])
  const words=parse(await fs.readFile(path.join(root,item.file),'utf8'))
  for(let i=0;i<words.length;i+=500){
    const chunk=words.slice(i,i+500),placeholders=chunk.map(()=>'(?,?,?,?,"LOCAL")').join(','),values=chunk.flatMap(w=>[library.id,w.word,w.phonetic,w.meaning])
    await pool.query(`INSERT INTO words(library_id,word,phonetic,meaning,source) VALUES ${placeholders} ON DUPLICATE KEY UPDATE phonetic=VALUES(phonetic),meaning=VALUES(meaning),source="LOCAL"`,values)
  }
  console.log(`${item.name}词库：${words.length} 个单词`)
}
const [users]=await pool.query('SELECT id FROM users')
for(const user of users) await pool.execute('INSERT INTO word_libraries(code,name,library_type,owner_user_id) VALUES(?,"用户库","USER",?) ON DUPLICATE KEY UPDATE name="用户库"',[`USER-${user.id}`,user.id])
await pool.query("UPDATE users u SET last_library_id=(SELECT id FROM word_libraries WHERE code='IELTS') WHERE last_library_id IS NULL")
console.log('WordHop 数据库及基础词库初始化完成')
await pool.end()
