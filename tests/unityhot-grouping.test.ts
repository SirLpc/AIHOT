import { stub, embeddingsStub, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { groupArticle } from '@aihot/backend/events/group';
import { consolidate } from '@aihot/backend/events/consolidate';
import { publishArticle } from '@aihot/backend/publication/publish';
import { stopBoss } from '@aihot/backend/jobs/queue';
const T=tag();
const provider=await stub((_hit,request)=>{
 const text=JSON.parse(request.body).messages[1].content as string;
 const content=text.includes('【报道 A】')?{a:'a',b:'b',relation:'SAME_OCCURRENCE',confidence:1,difference:''}:{query:'fixture',decisions:[...text.matchAll(/【候选 (C\d+)】/g)].map(m=>({id:m[1],relation:'SAME_OCCURRENCE',confidence:1,note:''})),selection:{addsValue:true,reason:'new evidence'}};
 return {choices:[{message:{content:JSON.stringify(content)}}]};
});
for(const name of ['DEEPSEEK','XIAOMI_MIMO']){process.env[`${name}_BASE_URL`]=`${provider.url}/v1`;process.env[`${name}_API_KEY`]='test-key';}
const embedding=await embeddingsStub();
after(async()=>{await provider.close();await embedding.close();await stopBoss();await closeDb();});
let n=0;
async function report(title:string,engine:string, signal=false, xPost:unknown=null){
 const sourceId=`unityhot-${T}-${++n}`;
 await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,next_fetch_at) VALUES(${sourceId},'UnityHot fixture','rss','T1',${signal?'hot_signal':'editorial'},'2100-01-01')`;
 const {articleId}=await upsertMaterial({sourceId,url:`https://example.org/${T}/${n}`,title,bodyText:title+' 渲染功能与稳定性更新，完整版本发布说明。',bodyStatus:'ok',via:'fetch',publishedAt:new Date(),xPost:xPost as never});
 await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,score,selected,output) VALUES(${articleId},1,'rule','pass','engine',${['引擎发布',`engine:${engine}`]},${title},${title+' 渲染功能与稳定性更新'},90,true,${sql.json({scope:'single',fact:{title,subject:'Unity',action:'发布',object:title}})})`;
 await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${articleId}`;await publishArticle(articleId);
 return articleId;
}
test('model SAME_OCCURRENCE cannot merge products or versions, nor consolidate their roots',async()=>{
 const a=await groupArticle(await report('Unity 6000.3.2f1 引擎版本发布','unity_global'));
 const b=await groupArticle(await report('团结引擎 6000.3.2t1 引擎版本发布','tuanjie'));
 const c=await groupArticle(await report('Unity 6000.3.3f1 引擎版本发布','unity_global'));
 assert.notEqual(a.storyId,b.storyId);assert.notEqual(a.storyId,c.storyId);
 const combined=await consolidate([a.storyId!,b.storyId!,c.storyId!]);assert.ok(combined.every(r=>!r.merge));
 const comparison=await groupArticle(await report('Unity 6000.3.2f1 与团结引擎 6000.3.2t1 对比','both'));
 assert.notEqual(comparison.storyId,a.storyId);assert.notEqual(comparison.storyId,b.storyId);
 const translation=await groupArticle(await report('Unity 6000.3.2f1 engine release','unity_global'));
 assert.equal(translation.factId,a.factId);
});
test('near-identical and native-reference hot signals cannot attach across products',async()=>{
 const title='Unity 2022.3.62f1 引擎版本发布 渲染功能与稳定性更新';
 const rootId=await report(title,'unity_global',false,{tweetId:'1234567890123456789'});
 const root=await groupArticle(rootId);
 const signal=await report(title,'tuanjie',true,{replyTo:'1234567890123456789'});
 const result=await groupArticle(signal,{signalOnly:true});
 assert.notEqual(result.storyId,root.storyId);
 assert.equal((await sql`SELECT 1 FROM story_signals WHERE article_id=${signal}`).length,0);
});

test('review: a material revision cannot keep automatic membership in its old product/version fact',async()=>{
 const id=await report('Unity 6000.4.1f1 release','unity_global');
 const original=await groupArticle(id);
 const peer=await groupArticle(await report('Unity 6000.4.1f1 release','unity_global'));
 assert.equal(peer.factId,original.factId);
 const [row]=await sql`SELECT source_id,url FROM articles WHERE id=${id}`;
 const title='团结引擎 1.10.4 release';
 await upsertMaterial({sourceId:row!.source_id,url:row!.url,title,bodyText:title,bodyStatus:'ok',via:'fetch',publishedAt:new Date()});
 await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,score,selected,output) VALUES(${id},2,'rule','pass','engine',${['引擎发布','engine:tuanjie']},${title},${title},90,true,${sql.json({scope:'single',fact:{title,subject:'Unity 中国',action:'发布',object:title}})})`;
 await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${id}`;await publishArticle(id);
 const revised=await groupArticle(id);assert.notEqual(revised.factId,original.factId);assert.notEqual(revised.storyId,original.storyId);
 assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${id} AND fact_id=${original.factId!}`).length,0);
});

test('review: superseded revisions are compared with the revision that established membership',async()=>{
 const id=await report('Unity 6000.5.1f1 release','unity_global');const original=await groupArticle(id);
 const [row]=await sql`SELECT source_id,url FROM articles WHERE id=${id}`;
 const title='团结引擎 1.10.4 release';
 for(const suffix of ['初稿','修正文案'])await upsertMaterial({sourceId:row!.source_id,url:row!.url,title,bodyText:title+suffix,bodyStatus:'ok',via:'fetch',publishedAt:new Date()});
 await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,score,selected,output) VALUES(${id},3,'rule','pass','engine',${['引擎发布','engine:tuanjie']},${title},${title},90,true,${sql.json({scope:'single',fact:{title,subject:'Unity 中国',action:'发布',object:title}})})`;
 await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${id}`;await publishArticle(id);
 const revised=await groupArticle(id);assert.notEqual(revised.factId,original.factId);assert.notEqual(revised.storyId,original.storyId);
});
