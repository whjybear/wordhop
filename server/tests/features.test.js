import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
const source = await fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8');
function setup(code, results = []) {
  const routes = [], calls = [];
  const app = Object.fromEntries(['get','post','put','delete'].map(method => [method, (...args) => routes.push({ method, path: args[0], handler: args.at(-1), middleware: args.slice(1,-1) })]));
  const pool = Object.fromEntries(['query','execute'].map(method => [method, async (sql, params) => { calls.push({sql,params}); assert.ok(results.length, 'unexpected database call'); return results.shift(); }]));
  const requireUser = () => {};
  new Function('app','pool','z','sanitizeHtml','requireUser','requireAdmin','jsonArray','logEvent',code)(app,pool,z,sanitizeHtml,requireUser,()=>{},v=>typeof v==='string'?JSON.parse(v):v,async()=>{});
  return { routes, calls, requireUser };
}
function response() { return { statusCode:200, status(n){this.statusCode=n;return this}, json(data){this.data=data;return this} }; }
const notesCode = source.slice(source.indexOf('const noteBody ='), source.indexOf('app.put("/api/admin/words/:id/audio"'));
test('notebook creation sanitizes active HTML and stores the authenticated owner', async () => {
  const ctx=setup(notesCode, [[{insertId:7}]]), res=response();
  const route=ctx.routes.find(r=>r.method==='post');
  assert.equal(route.middleware[0],ctx.requireUser);
  await route.handler({session:{userId:12},body:{title:' 标题 ',content:'<h2>正文</h2><script>alert(1)</script><a href="javascript:alert(1)">链接</a>'}},res);
  assert.equal(res.statusCode,201);
  assert.deepEqual(res.data,{id:7});
  assert.deepEqual(ctx.calls[0].params,[12,'标题','<h2>正文</h2><a>链接</a>']);
});
test('note read/update/delete always scope by owner and reject inaccessible notes', async () => {
  for(const method of ['get','put','delete']) {
    const ctx=setup(notesCode,[method==='get'?[[]]:[{affectedRows:0}]]),res=response();
    const route=ctx.routes.find(r=>r.method===method && r.path==='/api/notes/:id');
    await route.handler({session:{userId:13},params:{id:'7'},body:{title:'Title',content:'<p>Text</p>'}},res);
    assert.equal(res.statusCode,404);
    assert.match(ctx.calls[0].sql,/id=\? AND user_id=\?/);
    assert.deepEqual(ctx.calls[0].params.slice(-2),['7',13]);
  }
});
test('note pagination is ten per page with a stable order',async()=>{
  const ctx=setup(notesCode,[[[{total:21}]],[[]]]),res=response();
  await ctx.routes.find(r=>r.path==='/api/notes').handler({session:{userId:12},query:{page:'2'}},res);
  assert.deepEqual(ctx.calls[1].params,[12,10]);
  assert.match(ctx.calls[1].sql,/LIMIT 10 OFFSET/);
  assert.equal(res.data.pages,3);
});
test('PK list returns three entries per page',async()=>{
  const code=source.slice(source.indexOf('app.get("/api/pk-challenges",'),source.indexOf('app.post("/api/pk-challenges",'));
  const ctx=setup(code,[[[{total:7}]],[[]]]),res=response();
  await ctx.routes[0].handler({session:{userId:12},query:{page:'2'}},res);
  assert.match(ctx.calls[1].sql,/LIMIT 3 OFFSET/);
  assert.deepEqual(ctx.calls[1].params,[12,3]);
  assert.equal(res.data.pages,3);
});
test('PK restart resets start time and previous completion and score',async()=>{
  const code=source.slice(source.indexOf('app.post("/api/pk-challenges/:id/start"'),source.indexOf('app.post("/api/pk-challenges/:id/complete"'));
  const ctx=setup(code,[[[{id:1,wordIds:[8],startAt:new Date(Date.now()-10000),endAt:new Date(Date.now()+60000)}]],[{}],[[{startedAt:new Date(),completedAt:null}]],[[{id:8,word:'hello'}]]]),res=response();
  await ctx.routes[0].handler({session:{userId:12},params:{id:'1'}},res);
  assert.match(ctx.calls[1].sql,/ON DUPLICATE KEY UPDATE started_at=UTC_TIMESTAMP\(\),completed_at=NULL,total_ms=2147483647/);
  assert.equal(res.data.words[0].word,'hello');
});
test('local pronunciation is reused without downloading; invalid cached files are retried', async () => {
  const code=source.slice(source.indexOf('function audioFilename('),source.indexOf('async function lookupExample('));
  const mp3=Buffer.alloc(600); mp3.write('ID3');
  let downloads=0;
  const mockFs={stat:async()=>({size:600}),readFile:async()=>mp3,mkdir:async()=>{},writeFile:async()=>{},rename:async()=>{}};
  const make=()=>new Function('fs','path','crypto','fetch','Buffer','AbortSignal',`const audioDirectory='cache',audioLocks=new Map(); ${code}; return {ensureWordAudio,looksLikeMp3};`)(mockFs,{join:(...v)=>v.join('/')},{randomUUID:()=> 'test'},async()=>{downloads++;return {ok:true,arrayBuffer:async()=>mp3}},Buffer,AbortSignal);
  const helpers=make();
  assert.equal(helpers.looksLikeMp3(Buffer.from('<html>Error</html>')),false);
  assert.equal(helpers.looksLikeMp3(mp3),true);
  assert.deepEqual(await helpers.ensureWordAudio('Hello'),{audioUrl:'/audio/words/hello.mp3',downloaded:false});
  assert.equal(downloads,0);
  mockFs.readFile=async()=>Buffer.alloc(600);
  assert.equal((await helpers.ensureWordAudio('Hello')).downloaded,true);
  assert.equal(downloads,1);
});
