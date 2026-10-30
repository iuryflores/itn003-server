import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {AuditService} from './audit.service';
import {PreparationService} from './preparation.service';
const raw='{"version":"1.3.0","cns":"123456","imoveis":[{"numero_matricula":"001","numero":9007199254740993},{"numero_matricula":"002"}]}';
const preparation={kind:'itn003-preparation',version:1,file:'teste.json',raw,decisions:{0:'exclude'},reasons:{0:'Revisar no legado'}};

test('registry survives reload and cannot be changed on an existing audit',async t=>{
 const {service,create}=await setup(t);
 const first=await service.save({...preparation,registry:'1RIGO'});
 const second=await service.save({...preparation,registry:'2RIGO'});
 assert.equal((await create().load(first.id)).preparation.registry,'1RIGO');
 assert.equal((await create().load(second.id)).preparation.registry,'2RIGO');
 await assert.rejects(service.save({...preparation,registry:'2RIGO'},first.id,first.revision),/cartório/);
 await assert.rejects(service.save({...preparation,registry:'3RIGO'}),/Selecione/);
 const old=await service.save(preparation);
 assert.equal((await create().load(old.id)).preparation.registry,undefined);
 await service.save({...preparation,registry:'2RIGO'},old.id,old.revision);
 assert.equal((await create().load(old.id)).preparation.registry,'2RIGO');
});
async function setup(t:any){
 const root=await mkdtemp(join(tmpdir(),'itn003-preparations-test-'));
 t.after(async()=>{if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('itn003-preparations-test-'))throw new Error('Unexpected test path');await rm(root,{recursive:true,force:true});});
 const create=()=>{const service=new PreparationService(new AuditService());(service as any).directory=root;return service;};
 return {root,create,service:create()};
}
test('saved progress survives a service restart and retains the exact original JSON',async t=>{
 const {service,create,root}=await setup(t);
 const saved=await service.save({...preparation,minute:'Must not persist'});
 assert.equal(saved.pending,1);assert.equal(saved.excluded,1);
 const reopened=await create().load(saved.id);
 assert.equal(reopened.preparation.raw,raw);assert.deepEqual(reopened.preparation.reasons,preparation.reasons);
 assert.equal((reopened.preparation as any).minute,undefined);
 const stored=await readFile(join(root,saved.id+'.json'),'utf8');assert.ok(!stored.includes('Must not persist'));
 const list=await create().list();assert.equal(list.items.length,1);assert.equal(list.items[0].id,saved.id);
 assert.equal((list.items[0] as any).raw,undefined);
});
test('updates save decisions without losing the original and reject stale revisions',async t=>{
 const {service}=await setup(t);const first=await service.save(preparation);
 const updated={...preparation,decisions:{0:'exclude',1:'keep'},reasons:{0:'Conferido'}};
 const second=await service.save(updated,first.id,first.revision);
 assert.equal(second.id,first.id);assert.equal(second.pending,0);assert.equal(second.kept,1);
 await assert.rejects(service.save(preparation,first.id,first.revision),/outra aba/);
 assert.equal((await service.load(first.id)).preparation.reasons[0],'Conferido');
 await assert.rejects(service.save({...updated,raw:raw+' '},second.id,second.revision),/original mudou/);
});
test('validates decisions and keeps file paths within the preparation directory',async t=>{
 const {service}=await setup(t);
 await assert.rejects(service.load('../.env'),/inválido/);
 await assert.rejects(service.save({...preparation,decisions:{3:'keep'}}),/inexistente/);
 await assert.rejects(service.save({...preparation,decisions:{0:'unknown'}}),/inválida/);
 await assert.rejects(service.save({...preparation,reasons:{0:22}}),/Anotações/);
 const list=await service.list();assert.equal(list.items.length,0);
});
test('multiple periods with the same filename keep independent files and progress',async t=>{
 const {service,create}=await setup(t);
 const march=await service.save({...preparation,name:'Março/2026'});
 const april=await service.save({...preparation,name:'Abril/2026',decisions:{1:'keep'},reasons:{1:'Conferido em abril'}});
 assert.notEqual(march.id,april.id);
 const restarted=create();const list=await restarted.list();
 assert.equal(list.items.length,2);
 assert.deepEqual(new Set(list.items.map(i=>i.name)),new Set(['Março/2026','Abril/2026']));
 await restarted.save({...preparation,name:'Março/2026',decisions:{0:'keep',1:'exclude'}},march.id,march.revision);
 const restoredApril=await restarted.load(april.id);
 assert.equal(restoredApril.preparation.name,'Abril/2026');
 assert.deepEqual(restoredApril.preparation.decisions,{1:'keep'});
 assert.equal(restoredApril.preparation.reasons[1],'Conferido em abril');
});
test('classification overrides persist separately from the immutable original',async t=>{
 const {service,create}=await setup(t);
 const saved=await service.save({...preparation,classifications:{0:5}});
 const reopened=await create().load(saved.id);
 assert.equal(reopened.preparation.raw,raw);
 assert.deepEqual(reopened.preparation.classifications,{0:5});
 await assert.rejects(service.save({...preparation,classifications:{0:7}}),/entre 1 e 6/);
});

test('manual tax choice survives save and reload without changing source JSON',async t=>{
 const {service,create}=await setup(t);
 const taxOverrides={0:{value:'12345.6700',source:'ato.dto.valorAvaliacao'}};
 const saved=await service.save({...preparation,taxOverrides});
 const restored=(await create().load(saved.id)).preparation;
 assert.deepEqual(restored.taxOverrides,taxOverrides);assert.equal(restored.raw,raw);
 await service.save({...preparation,taxOverrides:{}},saved.id,saved.revision);
 assert.deepEqual((await create().load(saved.id)).preparation.taxOverrides,{});
});
