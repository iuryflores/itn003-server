import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AuditService} from './audit.service';
import {buildFieldGuide} from './field-guide';

test('guide distinguishes mandatory, conditional and documented optional fields by property type',()=>{
 const guide=new AuditService().fieldGuide();
 assert.equal(guide.version,'1.3.0');
 for(const kind of ['rurais','urbanos']){
  const fields=guide.guides[kind];const field=(path:string)=>fields.find(f=>f.path===path)!;
  assert.ok(fields.length>70);assert.equal(new Set(fields.map(f=>f.path)).size,fields.length);
  for(const path of ['version','cns','imoveis','imoveis[].tipo_imovel','imoveis[].motivo_envio'])assert.equal(field(path).requirement,'required',path);
  for(const path of ['imoveis[].numero_matricula','imoveis[].numero_transcricao','imoveis[].valor_imposto'])assert.equal(field(path).requirement,'conditional',path);
  for(const path of ['imoveis[].decisao_jud','imoveis[].protocolo_prenotacao','imoveis[].coordenadas','imoveis[].dados_pessoa[].nao_CPF'])assert.equal(field(path).requirement,'optional',path);
  assert.match(field('imoveis[].valor_imposto').rule,/ato = 4/);
  assert.ok(fields.every(f=>f.sources.length>0));
 }
 const rural=guide.guides.rurais,urban=guide.guides.urbanos;
 assert.equal(rural.find(f=>f.path==='imoveis[].ccir')?.requirement,'optional');
 assert.equal(rural.find(f=>f.path==='imoveis[].cib')?.requirement,'conditional');
 assert.equal(urban.find(f=>f.path==='imoveis[].cib')?.requirement,'optional');
 assert.ok(!urban.some(f=>f.path==='imoveis[].ccir'));
 assert.match(rural.find(f=>f.path==='imoveis[].dados_imovel[].uf')!.rule,/cada elemento/);
});

test('negative required clauses never create an obligation; arrays retain their nested scope',()=>{
 const fields=buildFieldGuide({type:'object',properties:{flag:{type:'boolean'},rows:{type:'array',items:{type:'object',properties:{name:{type:'string'},note:{type:'string'}},required:['name']}}},required:['rows'],not:{required:['flag']}},'rurais');
 assert.equal(fields.find(f=>f.path==='flag')?.requirement,'optional');
 assert.equal(fields.find(f=>f.path==='rows')?.requirement,'required');
 assert.equal(fields.find(f=>f.path==='rows[].name')?.requirement,'required');
 assert.equal(fields.find(f=>f.path==='rows[].note')?.requirement,'optional');
});
