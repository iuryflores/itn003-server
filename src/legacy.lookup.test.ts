import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupKeys, matchResults, CONTEXT_SQL } from './legacy.lookup';
const item={tipo_matricula_transcricao:1,numero_matricula:'4781',numero_ato:'14',tipo_ato:2,ato:6};
const row={index:0,id:'fake-id',title:'Dados do imóvel',service:'Dados do imóvel',actKind:'AVERBACAO',registeredAt:'31/03/2026',sealedAt:'31/03/2026',classification:'OUTRO',georeferencing:false,polygon:null,cancelled:false,matchKind:'exact'};
test('lookup uses registry type, act number and act type rather than classification',()=>{
 const keys=lookupKeys([item,{...item,tipo_matricula_transcricao:2,numero_transcricao:'3',livro_transcricao:'8',numero_ato:'115'}]);
 assert.equal(keys[0].actNumber,'14');assert.equal(keys[0].actKind,'AVERBACAO');
 assert.equal(keys[0].registryKind,'MATRICULA');assert.equal(keys[1].registryKind,'TRANSCRICAO');assert.equal(keys[1].book,'8');
 assert.equal(matchResults(1,keys,[row])[0].record?.title,'Dados do imóvel');
});
test('ambiguous lookup never picks a candidate automatically',()=>{
 const match=matchResults(1,lookupKeys([item]),[row,{...row,id:'other'}])[0];
 assert.equal(match.status,'ambiguous');assert.equal(match.record,undefined);
});
test('missing keys and not found records are distinct; SQL input is parameterized',()=>{
 const keys=lookupKeys([{},item,{...item,numero_ato:"14';DROP TABLE ato;--"}]);
 const result=matchResults(3,keys,[]);
 assert.deepEqual(result.map(r=>r.status),['invalid_key','not_found','invalid_key']);
 assert.ok(CONTEXT_SQL.includes('jsonb_to_recordset($1::jsonb)'));assert.ok(CONTEXT_SQL.includes('LIMIT 3'));
 assert.throws(()=>lookupKeys(Array.from({length:1001},()=>item)));
});
test('opening acts with number zero are explicit review cases',()=>{
 const opening={...item,ato:1,numero_ato:'0'};
 assert.equal(lookupKeys([opening])[0].opening,true);
 const match=matchResults(1,lookupKeys([opening]),[{...row,actKind:'ABERTURA',matchKind:'opening'}])[0];
 assert.equal(match.status,'matched');assert.ok(match.message.includes('difere'));
});
test('lookup exposes assessment sources separately and never aliases them as tax',()=>{
 assert.ok(CONTEXT_SQL.includes("a.valores->>'valorAvaliacao'"));
 assert.ok(CONTEXT_SQL.includes("a.dto->>'valorAvaliacao'"));
 assert.ok(CONTEXT_SQL.includes('a.doi_valor_avaliacao::text'));
 assert.ok(!/AS\s+"?valor_imposto/i.test(CONTEXT_SQL));
});
