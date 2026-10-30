import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from './audit.service';
const service = new AuditService();
test('export removes only selected positions and preserves exact numeric tokens and metadata',()=>{
 const raw='{"version":"1.3.0","cns":"123456","extra":9007199254740993,"imoveis":[{"tipo_imovel":1,"x":9007199254740993},{"tipo_imovel":2,"x":"001"}]}';
 const output=service.export(raw,[1]);
 assert.ok(output.includes('"extra":9007199254740993'));
 assert.ok(output.includes('"x":9007199254740993'));
 assert.equal(JSON.parse(output).imoveis.length,1);
 assert.equal(service.export(raw,[]),raw);
 assert.equal(JSON.parse(raw).imoveis.length,2);
});
test('keeps duplicates as independent records and original order',()=>{
 const raw=JSON.stringify({imoveis:[{id:'a'},{id:'a'},{id:'b'}]});
 assert.deepEqual(JSON.parse(service.export(raw,[0])).imoveis,[{id:'a'},{id:'b'}]);
});
test('rejects malformed inputs, duplicate keys, empty exports and invalid indices',()=>{
 for(const raw of ['{','[]','{}','{"imoveis":[],"imoveis":[]}']) assert.throws(()=>service.audit(raw));
 const raw='{"imoveis":[{}]}';
 for(const indices of [[0],[-1],[1],[0.5],null]) assert.throws(()=>service.export(raw,indices));
});
test('distinguishes legacy review from structural error and exposes root errors',()=>{
 const result=service.audit(JSON.stringify({version:'wrong',cns:'bad',imoveis:[{tipo_imovel:1,motivo_envio:2},{tipo_imovel:2,motivo_envio:1},null]}));
 assert.ok(result.rootIssues.length>=2);
 assert.deepEqual(result.items.map((i: any)=>i.status),['review','invalid','invalid']);
 assert.ok(result.items.every((i: any)=>i.issues.length>0));
});
test('official judicial exception validates for both schemas',()=>{
 const items=[{tipo_imovel:1,contexto_urbano:1},{tipo_imovel:2,contexto_rural:1}].map(i=>({...i,decisao_jud:true,motivo_envio:1,tipo_matricula_transcricao:1,numero_matricula:'123'}));
 const result=service.audit(JSON.stringify({version:'1.3.0',cns:'123456',imoveis:items}));
 assert.deepEqual(result.items.map((i: any)=>i.status),['valid','valid']);
});
import { prioritizeErrors } from './diagnostics';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
test('prioritizes applicable conditional branches without changing official validity',()=>{
 const result=service.audit(JSON.stringify({version:'1.3.0',cns:'123456',imoveis:[{tipo_imovel:2,contexto_rural:1,motivo_envio:1,ato:6,tipo_matricula_transcricao:2,numero_transcricao:'10',georreferenciamento:false,certificacao_incra:false,imovel_possui_nome:false,dados_imovel:[],dados_pessoa:[]}]}));
 const issuePaths=result.items[0].issues.map((e: any)=>e.path);
 assert.ok(issuePaths.includes('/data_transcricao'));
 assert.ok(issuePaths.includes('/cod_sncr'));
 assert.ok(!issuePaths.includes('/numero_matricula'));
 assert.ok(!issuePaths.includes('/decisao_jud'));
 assert.equal(result.items[0].status,'invalid');
 assert.ok(result.items[0].rawIssues.length>result.items[0].issues.length);
 assert.deepEqual(prioritizeErrors([]),[]);
});
const realFile=resolve(process.cwd(),'../itn003-rurais.json');
test('provided real file: audit all 60 acts and preserve retained records', {skip:!existsSync(realFile)},()=>{
 const raw=readFileSync(realFile,'utf8');const result=service.audit(raw);
 assert.equal(result.items.length,60);
 assert.equal(result.rootIssues.length,0);
 assert.equal(result.items.filter((i:any)=>i.status==='valid').length,5);
 assert.equal(result.items.filter((i:any)=>i.status==='invalid').length,55);
 assert.ok(result.items[0].issues.some((e:any)=>e.path==='/data_transcricao'));
 assert.ok(result.items[1].issues.some((e:any)=>e.path==='/cod_sncr'));
 assert.ok(result.items[1].issues.some((e:any)=>e.path==='/car'));
 assert.ok(!result.items[1].issues.some((e:any)=>e.path==='/decisao_jud'));
 const exported=JSON.parse(service.export(raw,[0,2,59]));
 const original=JSON.parse(raw.replace(/^\uFEFF/,''));
 assert.deepEqual(exported,{...original,imoveis:original.imoveis.filter((_:unknown,i:number)=>![0,2,59].includes(i))});
});
import { classifyIssue, documentationNotes } from './diagnostics';
test('documented optional fields are not charged as missing',()=>{
 const result=service.audit(JSON.stringify({version:'1.3.0',cns:'123456',imoveis:[{tipo_imovel:2,contexto_rural:1,motivo_envio:1,ato:6,tipo_matricula_transcricao:1,numero_matricula:'10'}]}));
 assert.ok(!result.items[0].issues.some((i:any)=>['/ccir','/protocolo_prenotacao','/data_protocolo_prenotacao'].includes(i.path)));
 assert.equal(classifyIssue({path:'/ccir',rule:'pattern'},{tipo_imovel:2}).requirement,'Opcional; validar quando informado');
 assert.equal(classifyIssue({path:'/cib',rule:'pattern'},{tipo_imovel:1}).requirement,'Opcional; validar quando informado');
 assert.equal(classifyIssue({path:'/cod_sncr',rule:'required'},{tipo_imovel:2}).category,'missing_required');
});
test('SNCR with 12 digits is a documentation note and not an invented length failure',()=>{
 assert.equal(documentationNotes({tipo_imovel:2,cod_sncr:'123456789012'}).length,1);
 assert.equal(documentationNotes({tipo_imovel:2,cod_sncr:'1234567890123'}).length,0);
 if(existsSync(realFile)) {
  const r=service.audit(readFileSync(realFile,'utf8'));
  const valid=r.items.find((i:any)=>i.label==='167254'&&i.actNumber==='5')!;
  assert.equal(valid.status,'valid');
  assert.equal(valid.documentationNotes.length,1);
 }
});
test('conditional tax is charged for transmission and not for unrelated acts',()=>{
 const base={tipo_imovel:2,contexto_rural:1,motivo_envio:1,tipo_matricula_transcricao:1,numero_matricula:'123'};
 const r=service.audit(JSON.stringify({version:'1.3.0',cns:'123456',imoveis:[{...base,ato:4},{...base,ato:6}]}));
 assert.ok(r.items[0].issues.some((i:any)=>i.path==='/valor_imposto'));
 assert.ok(!r.items[1].issues.some((i:any)=>i.path==='/valor_imposto'));
});
test('classification edits revalidate conditional fields while preserving the original classification',()=>{
 const raw=JSON.stringify({version:'1.3.0',cns:'123456',imoveis:[{tipo_imovel:2,contexto_rural:1,motivo_envio:1,ato:6,tipo_ato:2,numero_ato:'14',tipo_matricula_transcricao:1,numero_matricula:'123',georreferenciamento:false,certificacao_incra:false,imovel_possui_nome:false,dados_imovel:[],dados_pessoa:[]}]});
 const result=service.audit(raw,{0:5});
 assert.equal(result.items[0].originalAct,6);assert.equal(result.items[0].data.ato,5);
 assert.equal(result.items[0].data.numero_ato,'14');assert.equal(result.items[0].data.tipo_ato,2);
 assert.ok(result.items[0].issues.some((issue:any)=>issue.path==='/alteracao_imovel'));
 assert.equal(JSON.parse(raw).imoveis[0].ato,6);
 const restored=service.audit(raw,{});assert.equal(restored.items[0].data.ato,6);
 assert.ok(!restored.items[0].issues.some((issue:any)=>issue.path==='/alteracao_imovel'));
});
test('export applies only classification edits and exclusions, preserving other numeric tokens',()=>{
 const raw='{"version":"1.3.0","cns":"123456","imoveis":[{"ato":6,"numero_ato":"14","n":9007199254740993,"valor":1.2300},{"ato":6,"id":"remove"}]}';
 const output=service.export(raw,[1],{0:3});
 assert.ok(output.includes('"n":9007199254740993'));assert.ok(output.includes('"valor":1.2300'));
 assert.equal(JSON.parse(output).imoveis[0].ato,3);assert.equal(JSON.parse(output).imoveis.length,1);
 assert.equal(service.export(raw,[],{}),raw);
 for(const invalid of [{0:7},{0:'5'},{2:5},{'-1':3},{'00':5},[]])assert.throws(()=>service.audit(raw,invalid));
});


test('manual assessment override revalidates tax and exports exact decimal tokens',()=>{
 const raw='{"version":"1.3.0","cns":"123456","imoveis":[{"tipo_imovel":2,"contexto_rural":1,"motivo_envio":1,"tipo_matricula_transcricao":1,"numero_matricula":"123","ato":4},{"ato":6,"valor_imposto":50.00}]}';
 const source='ato.valores.valorAvaliacao';
 assert.ok(service.audit(raw).items[0].issues.some((i:any)=>i.path==='/valor_imposto'));
 const override={0:{value:'12345.67',source}};
 const audit=service.audit(raw,{},override);
 assert.equal(audit.items[0].data.valor_imposto,12345.67);
 assert.ok(!audit.items[0].issues.some((i:any)=>i.path==='/valor_imposto'));
 const lexicalRaw=raw.replace('\"ato\":4','\"ato\":4,\"n\":9007199254740993,\"other\":1.2300');
 const output=service.export(lexicalRaw,[1],{0:4},{0:{value:'9007199254740993.1200',source}});
 assert.ok(output.includes('"valor_imposto": 9007199254740993.1200')||output.includes('"valor_imposto":9007199254740993.1200'));
 assert.ok(output.includes('"n":9007199254740993'));assert.ok(output.includes('"other":1.2300'));
 assert.equal(JSON.parse(output).imoveis.length,1);
 assert.equal(service.export(raw,[],{},{}),raw);
 assert.equal(service.audit(raw,{},{}).items[1].data.valor_imposto,50);
 assert.equal(service.audit(raw,{}, {1:{value:'0',source}}).items[1].data.valor_imposto,0);
});
test('rejects invalid tax overrides before audit and export',()=>{
 const raw='{"imoveis":[{}]}';const source='ato.doi_valor_avaliacao';
 for(const invalid of [[],{1:{value:'1',source}},{'00':{value:'1',source}},{0:{value:'1,00',source}},{0:{value:'-1',source}},{0:{value:'NaN',source}},{0:{value:1,source}},{0:{value:'1',source:'arbitrary'}}]){
  assert.throws(()=>service.audit(raw,{},invalid));assert.throws(()=>service.export(raw,[],{},invalid));
 }
});

test('manual pending fields revalidate, export and restore without changing original tokens',()=>{
 const raw='{"imoveis":[{"tipo_imovel":2,"contexto_rural":1,"motivo_envio":1,"ato":4,"extra":9007199254740993},{"tipo_imovel":2}]}';
 const changes={0:{cod_sncr:'0012345678901'}};
 const audit=service.audit(raw,{}, {},changes);
 assert.equal(audit.items[0].data.cod_sncr,'0012345678901');
 assert.ok(!audit.items[0].rawIssues.some((issue:any)=>issue.path==='/cod_sncr'));
 const output=service.export(raw,[1],{}, {},changes);
 assert.equal(JSON.parse(output).imoveis[0].cod_sncr,'0012345678901');
 assert.ok(output.includes('9007199254740993'));
 assert.equal(service.export(raw,[],{}, {},{}),raw);
 assert.ok(service.audit(raw,{}, {},{0:{cod_sncr:'bad'}}).items[0].rawIssues.some((issue:any)=>issue.path==='/cod_sncr'));
 for(const change of [{2:{cod_sncr:'123'}},{0:{unknown:'x'}},{0:{ato:4}},{0:{valor_imposto:3}},JSON.parse('{"0":{"__proto__":{}}}')])assert.throws(()=>service.audit(raw,{}, {},change));
});
