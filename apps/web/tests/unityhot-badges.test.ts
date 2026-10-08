import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { chromium, type Browser } from '@playwright/test';
import { startWebServer, type WebServer } from './web-server.ts';
const at='2026-10-08T00:00:00Z';
const products=['unity_global','tuanjie','both','unknown'];
const labels=['Unity 国际版','团结引擎','Unity 国际版 + 团结引擎','产品待确认'];
const items=products.map((p,i)=>({id:'engine-'+i,title:'版本与技术更新 '+i,summary:'中文摘要，保留版本与适用范围。',reason:null,source:{name:'官方来源'},publishedAt:at,timelineAt:at,category:'engine',tags:['引擎发布',`engine:${p}`],score:80,selected:true,channel:'news',x:null}));
const api=createServer((req,res)=>{
 const p=new URL(req.url!,'http://local').pathname;res.setHeader('content-type','application/json');
 if(p==='/api/site/meta')return res.end(JSON.stringify({changelogVersion:'fixture'}));
 if(p==='/api/site/timeline')return res.end(JSON.stringify({filters:{channel:'all',category:null,tag:null},cards:items.map(item=>({key:item.id,anchorAt:at,item,group:null})),nextCursor:null,hot:null,dayCounts:{'2026-10-08':4}}));
 if(p==='/api/site/reports/daily/latest-page'){
  const citation={itemId:items[0]!.id,title:items[0]!.title,summary:items[0]!.summary,tags:items[0]!.tags,sourceName:'官方来源',sourceUrl:'https://example.org/release',sourceIconUrl:null,firstParty:true,publishedAt:at,available:true};
  return res.end(JSON.stringify({index:[],report:{kind:'daily',key:'2026-10-08',issueNumber:1,title:'开发日报',generatedAt:at,lead:null,leadItemId:citation.itemId,overview:null,highlights:[],sections:[{label:'引擎与包',summary:null,items:[citation]}],flashes:[],cover:null,metrics:{},readingMinutes:1,prev:null,next:null}}));
 }
 if(p==='/api/site/track'){res.statusCode=204;return res.end();}
 res.statusCode=404;res.end('{}');
});
let web:WebServer;let browser:Browser;
before(async()=>{web=await startWebServer(api);});
after(async()=>{await browser?.close();await web?.stop();});
for(const width of [390,1280])test(`product badges remain visible at ${width}px with optional tags hidden`,async()=>{
 browser ??= await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const page=await browser.newPage({viewport:{width,height:1000}});
 await page.goto(web.origin);await page.locator('[data-item-id="engine-0"]').waitFor();
 for(let i=0;i<products.length;i++){
  const badge=page.locator(`[data-item-id="engine-${i}"] [data-engine-product]`);
  assert.equal(await badge.textContent({timeout:5000}),labels[i]);assert.ok(await badge.isVisible());
 }
 assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>window.innerWidth),false);
 await page.screenshot({path:`.local-runtime/unityhot-${width}.png`,fullPage:true});
 await page.close();
});

test('SSR cards include product identity without enabling optional tag display',async()=>{
 const html=await (await fetch(web.origin)).text();
 for(const p of products)assert.ok(html.includes(`data-engine-product="${p}"`));
});

test('one-item report lead has a product badge even when removed from section cards',async()=>{
 const html=await (await fetch(web.origin+'/daily')).text();assert.ok(html.includes('data-engine-product="unity_global"'));
});
