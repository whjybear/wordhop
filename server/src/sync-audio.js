import fs from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'
import {pool} from './db.js'

const directory=process.env.AUDIO_WORDS_DIR||path.resolve('shared/audio/words')
const [columns]=await pool.query("SHOW COLUMNS FROM words LIKE 'audio_url'")
if(!columns.length)await pool.query('ALTER TABLE words ADD COLUMN audio_url VARCHAR(500) NULL AFTER source')

let files=[]
try{files=await fs.readdir(directory)}catch(error){console.error(`音频目录不可用：${directory}`);await pool.end();process.exit(1)}
const candidates=files.filter(file=>/\.mp3$/i.test(file)),audioFiles=[]
let invalidFiles=0
for(const file of candidates){const stat=await fs.stat(path.join(directory,file));if(stat.size>=500)audioFiles.push(file);else invalidFiles++}
// Preserve administrator uploads and existing associations when the file is valid.
const [associated] = await pool.query("SELECT id,audio_url AS audioUrl FROM words WHERE audio_url IS NOT NULL")
for (const item of associated) {
  if (!item.audioUrl.startsWith('/audio/words/')) continue
  try {
    const filename = decodeURIComponent(item.audioUrl.slice('/audio/words/'.length))
    if (path.basename(filename) !== filename) throw new Error('Invalid filename')
    const stat = await fs.stat(path.join(directory,filename))
    if (stat.size >= 500) continue
  } catch {}
  await pool.execute('UPDATE words SET audio_url=NULL WHERE id=?',[item.id])
}
let matchedFiles=0,matchedRows=0
for(const file of audioFiles){
  const word=path.basename(file,path.extname(file)).trim().toLowerCase()
  if(!word)continue
  const url=`/audio/words/${encodeURIComponent(file)}`
  const [result]=await pool.execute("UPDATE words SET audio_url=? WHERE LOWER(word)=? AND (audio_url IS NULL OR audio_url='')",[url,word])
  if(result.affectedRows){matchedFiles++;matchedRows+=result.affectedRows}
}
console.log(`音频同步完成：有效文件 ${audioFiles.length}，无效/过小 ${invalidFiles}，匹配文件 ${matchedFiles}，更新单词记录 ${matchedRows}`)
await pool.end()
