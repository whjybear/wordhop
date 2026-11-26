import fs from 'node:fs/promises'
import path from 'node:path'
const file=path.resolve(new URL('../../cet4-2026-selenium.txt',import.meta.url).pathname.replace(/^\/(.:)/,'$1'))
export async function loadWords(){const source=await fs.readFile(file,'utf8');return source.split(/\r?\n/).map((line,id)=>{const a=line.indexOf(','),b=line.indexOf(',',a+1);return a>0&&b>a?{id,word:line.slice(0,a).trim(),phonetic:line.slice(a+1,b).trim(),meaning:line.slice(b+1).trim()}:null}).filter(Boolean)}
