import fs from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'
import {pool} from './db.js'

const root=path.resolve(new URL('../../',import.meta.url).pathname.replace(/^\/(.:)/,'$1'))
const libraries=[
  {code:'PRIMARY',name:'小学',file:'小学-2026.txt'},
  {code:'JUNIOR',name:'初中',file:'初中-2026.txt'},
  {code:'SENIOR',name:'高中',file:'高中-2026.txt'},
  {code:'POSTGRAD',name:'研究生',file:'研究生-2026.txt'}
]
function parse(source){return source.split(/\r?\n/).map(line=>{const a=line.indexOf(','),b=line.indexOf(',',a+1);return a>0&&b>a?{word:line.slice(0,a).trim(),phonetic:line.slice(a+1,b).trim(),meaning:line.slice(b+1).trim()}:null}).filter(Boolean)}
for(const item of libraries){
  await pool.execute('INSERT INTO word_libraries(code,name,library_type) VALUES(?,?,"SYSTEM") ON DUPLICATE KEY UPDATE name=VALUES(name)',[item.code,item.name])
  const [[library]]=await pool.query('SELECT id FROM word_libraries WHERE code=?',[item.code]),words=parse(await fs.readFile(path.join(root,item.file),'utf8'))
  for(let i=0;i<words.length;i+=500){const chunk=words.slice(i,i+500),marks=chunk.map(()=>'(?,?,?,? ,"LOCAL")').join(','),values=chunk.flatMap(word=>[library.id,word.word,word.phonetic,word.meaning]);await pool.query(`INSERT INTO words(library_id,word,phonetic,meaning,source) VALUES ${marks} ON DUPLICATE KEY UPDATE phonetic=VALUES(phonetic),meaning=VALUES(meaning),source="LOCAL"`,values)}
  console.log(`${item.name}词库：${words.length} 个单词`)
}
await pool.end()
