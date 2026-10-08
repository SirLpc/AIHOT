import './setup.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { config } from '@aihot/backend/config';
import { fetchJsonList, readJsonList } from '@aihot/backend/sources/json-list';
import { fetchRss } from '@aihot/backend/sources/rss';
import { fetchDetail } from '@aihot/backend/sources/web-list';
import { admitListing } from '@aihot/backend/sources/filters';
import { decideTimeline } from '@aihot/backend/content/materials';
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/unityhot/${name}`,import.meta.url),'utf8');
const content = '<h2>团结引擎 1.10.4</h2><p>基于 Unity 2022.3.62f1。修复输入问题。</p>';
const pages:Record<string,string>={ '/tuanjie':fixture('tuanjie-releases.html'), '/lts':fixture('unity-lts.xml'), '/bad':'<script>window.__props__={data: dangerous()}</script>', '/shape':'<script>window.__props__={"data":{"tuanjieRelease":{"releases":{}}}}</script>', '/detail': `<script>window.__props__=${JSON.stringify({data:{cms:{content:{release:{contents:[{moduleName:'RichText',richText:content}]}}}}})}</script>` };
let etagHit=false;
const server=createServer((req,res)=>{if(req.url==='/releases'){if(req.headers['if-none-match']==='"release-v1"'){etagHit=true;res.writeHead(304);res.end();return;}res.setHeader('etag','"release-v1"');res.end(JSON.stringify([{id:1,name:'Input System 1.17.0',html_url:'https://github.com/Unity-Technologies/InputSystem/releases/tag/1.17.0',published_at:'2026-09-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',body:'Release notes',draft:false}]));return;}res.setHeader('content-type','application/atom+xml');res.end(pages[req.url??'']??'');});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
config.allowPrivateNetworkFetch=true;
after(()=>new Promise<void>(r=>server.close(()=>r())));
const source=(url:string,extra={})=>({id:'unityhot-fixture',config:{url,...extra},cursor:null,participation_mode:'editorial'} as never);
const tuanjie=(path='/tuanjie')=>source(base+path,{mode:'html_window_var',windowVar:'__props__',itemsPath:'data.tuanjieRelease.releases',adapter:'tuanjie_releases'});
test('Tuanjie mapping excludes globalRelease and preserves visible/build/tag identities',async()=>{
 const rows=await fetchJsonList(tuanjie());
 assert.equal(rows.length,2); assert.equal(rows[0]!.title,'团结引擎 1.10.4');
 assert.equal(rows[0]!.url,'https://unity.cn/editor1-10-4/release-note');
 assert.equal((rows[0]!.raw as Record<string,unknown>).hubDeepLink,'tuanjiehub://2022.3.62t16/ab17684acf1d');
 assert.equal((rows[1]!.raw as Record<string,unknown>).releaseTags,'LTS for HMI');
 assert.equal(rows[0]!.publishedAt!.getTime(),1790130784062);
});
test('malformed embedded scripts and shapes fail closed without execution',async()=>{
 await assert.rejects(fetchJsonList(tuanjie('/bad'))); await assert.rejects(fetchJsonList(tuanjie('/shape')));
});
test('Tuanjie detail reads CMS rich text as source evidence',async()=>{
 const result=await fetchDetail(base+'/detail',source(base+'/tuanjie',{detail:{adapter:'tuanjie_release'}}),{body:true,date:false,title:false,summary:false});
 assert.match(result.body!.text,/2022.3.62f1/); assert.match(result.body!.text,/1.10.4/);
});
test('RSS payload is parsed despite Atom MIME',async()=>{
 const result=await fetchRss(source(base+'/lts',{feedUrl:base+'/lts'}));
 assert.equal(result.candidates.length,2);assert.match(result.candidates[0]!.title,/Unity/);
});
test('future publications are deferred, old publications are historical, updates are not publication',()=>{
 const now=new Date('2026-10-08T00:00:00Z');
 const candidates=[{url:'https://example.com/future',title:'Unity release',publishedAt:new Date('2026-10-09T00:00:00Z')}];
 assert.equal(admitListing(candidates,source(base),+now).length,0);
 assert.equal(decideTimeline(new Date('2026-01-01T00:00:00Z'),now).backfill,true);
});
test('JSON releases support conditional reads and preserve updated time separately',async()=>{
 const s=source(base+'/releases',{titlePaths:['name'],urlTemplate:'{raw:html_url}',publishedAtPath:'published_at',updatedAtPath:'updated_at'});
 const first=await readJsonList(s);assert.equal(first.candidates[0]!.sourceUpdatedAt!.toISOString(),'2026-10-01T00:00:00.000Z');
 // Listing validators are stored by collection only after material storage succeeds.
 const second=await readJsonList({...s as object,cursor:{json:first.validator}} as never);
 assert.equal(second.candidates.length,0);assert.equal(etagHit,true);
});

test('Atom updated-only is not invented as publication time',async()=>{
 pages['/updated.atom']='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Unity rendering tutorial</title><link href="https://example.org/tutorial"/><updated>2026-10-08T00:00:00Z</updated></entry></feed>';
 const result=await fetchRss(source(base+'/updated.atom',{feedUrl:base+'/updated.atom'}));
 assert.equal(result.candidates[0]!.publishedAt,null);assert.equal(result.candidates[0]!.sourceUpdatedAt!.toISOString(),'2026-10-08T00:00:00.000Z');
});
