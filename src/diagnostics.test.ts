import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patternExample,issueExample} from './diagnostics';

test('every official pattern has a practical example that matches the regex',()=>{
 const patterns=new Set<string>();
 function visit(value:any){
  if(!value||typeof value!=='object')return;
  if(typeof value.pattern==='string')patterns.add(value.pattern);
  Object.values(value).forEach(visit);
 }
 for(const kind of ['rurais','urbanos'])visit(JSON.parse(readFileSync(`schemas/imoveis-${kind}-onr.schema.json`,'utf8')));
 assert.ok(patterns.size>5);
 for(const pattern of patterns){
  const example=patternExample(pattern);
  assert.ok(example,`Missing example: ${pattern}`);
  assert.match(example,new RegExp(pattern));
 }
});

test('examples keep dates readable and respect enum and type constraints',()=>{
 assert.equal(patternExample('^\\d{2}\\/\\d{2}\\/\\d{4}$'),'15/10/2026');
 assert.equal(issueExample({keyword:'enum',params:{allowedValues:[2,3]}} as any),'2');
 assert.equal(issueExample({keyword:'type',params:{type:'number'}} as any),'1234.56');
});
