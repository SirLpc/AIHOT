import './setup.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as identity from '@aihot/industry/engine-identity';
import { normalizeStructure } from '@aihot/backend/editorial/analyze';

const report = (title: string, tags: string[] = []) => ({ title, tags });
test('product identity requires evidence, never a Chinese language or .cn guess', () => {
  assert.equal(identity.engineProduct(report('中文技术教程 https://docs.unity.cn/cn/6000.0/')), 'unknown');
  assert.equal(identity.engineProduct(report('Unity 6.3 released')), 'unity_global');
  assert.equal(identity.engineProduct(report('团结引擎 1.10.4 发布')), 'tuanjie');
  assert.equal(identity.engineProduct(report('Unity 与团结引擎对比')), 'both');
});
test('release guards preserve product and exact full version identities', () => {
  const can = identity.engineReportsCompatible;
  assert.equal(can(report('Unity 2022.3.62f1'), report('团结引擎 2022.3.62t16')), false);
  assert.equal(can(report('Unity 6000.3.2f1'), report('Unity 6000.3.3f1')), false);
  assert.equal(can(report('Unity 6.3 发布'), report('团结引擎 1.10.4 发布')), false);
  assert.equal(can(report('Unity 与团结引擎对比'), report('Unity 6.3 发布')), false);
  assert.equal(can(report('Unity 6000.3.2f1 released'), report('Unity 6000.3.2f1 发布')), true);
  assert.equal(can(report('团结引擎 1.10.4 发布'), report('Tuanjie 1.10.4 released')), true);
  assert.equal(can(report('Unity 6000.3.2f1'), report('Unity 6000.3.2f1c1')), false);
});
test('Tuanjie underlying Unity version is context, not the product identity', () => {
  assert.equal(identity.engineProduct({ title: '团结引擎 1.10.4', summary: '基于 Unity 2022.3.62f1，内部版本 2022.3.62t16' }), 'tuanjie');
  assert.deepEqual(identity.engineVersions({ title: '团结引擎 1.10.4', summary: '基于 Unity 2022.3.62f1' }), ['1.10.4']);
});
test('structure overwrites unsupported model product claims and reserves a tag slot', () => {
  const a = { title: '中文教程', url: 'https://example.cn/a', bodyText: '实现一个组件。', excerpt: null, source: { tags: [] } } as never;
  const structure = { scope: 'single', category: 'tip', tags: ['教程/实践', 'engine:tuanjie'], subjects: [], fact: null } as never;
  assert.ok(normalizeStructure(structure, a).tags.includes('engine:unknown'));
  assert.ok(!normalizeStructure(structure, a).tags.includes('engine:tuanjie'));
});

test('group decision helpers reject an incompatible product despite model SAME_OCCURRENCE', async () => {
  const { sameOccurrence, storyForDevelopment, signalTarget } = await import('@aihot/backend/events/relate');
  const a={title:'Unity 6000.3.2f1',tags:['engine:unity_global']} as never;
  const candidates=[{factId:1,storyId:1,storyRoot:true,score:1,report:{title:'团结引擎 6000.3.2t1',tags:['engine:tuanjie']}}] as never;
  const verdicts=new Map([[1,{relation:'SAME_OCCURRENCE',confidence:1,note:''}]]) as never;
  assert.deepEqual((sameOccurrence as Function)(candidates,verdicts,a),[]);
  assert.equal((signalTarget as Function)(candidates,verdicts,0.8,a),null);
  assert.equal((storyForDevelopment as Function)(candidates,new Map([[1,{relation:'SAME_STORY',confidence:1}]]),a),null);
});

test('review: full v-prefixed versions and summary evidence cannot collapse or bridge', () => {
  assert.deepEqual(identity.engineVersions(report('Unity v6000.3.2f1')), ['6000.3.2f1']);
  assert.equal(identity.engineReportsCompatible(report('Unity v6000.3.2f1'), report('Unity v7000.3.2f1')), false);
  assert.equal(identity.engineReportsCompatible({title:'Unity patch release',summary:'Unity 6000.3.2f1 released'}, {title:'Unity patch release',summary:'Unity 6000.3.3f1 released'}), false);
  assert.equal(identity.engineReportsCompatible(report('Unity patch release'),report('Unity 6000.3.2f1 release')),false);
});
test('review: comparisons are checked across title/body/source, base and publisher mentions are not subjects', () => {
  assert.ok(identity.groundedEngineTags([], 'Unity 6.3 版本对比', '比较 Unity 6.3 与团结引擎 1.10.4 的功能。').includes('engine:both'));
  assert.ok(identity.groundedEngineTags([], '版本对比', '比较 Unity 6.3 与团结引擎 1.10.4 的功能。',['engine:unity_global']).includes('engine:both'));
  const t = {title:'团结引擎 1.10.4（基于 Unity 2022.3.62f1）'};
  assert.equal(identity.engineProduct(t),'tuanjie');assert.deepEqual(identity.engineVersions(t),['1.10.4']);
  assert.equal(identity.engineProduct(report('Unity Technologies 公司政策公告')),'unknown');
});

test('official Tuanjie Base field and support email are metadata, not a second product',()=>{
 const body='联系我们 supportchina@unity.cn。当前版本Base：Unity 2022.3.62f1';
 assert.ok(identity.groundedEngineTags([], '团结引擎 1.10.4', body, ['engine:tuanjie']).includes('engine:tuanjie'));
 assert.deepEqual(identity.engineVersions({title:'团结引擎 1.10.4',identityText:body}),['1.10.4']);
 assert.equal(identity.engineProduct(report('中文文档 docs.unity.cn')),'unknown');
});
