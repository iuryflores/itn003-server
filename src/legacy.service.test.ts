import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionError, normalizeConnectionString, readOnlyTransaction } from './legacy.service';
test('normalizes SQLAlchemy URLs without changing encoded credentials',()=>{
 assert.equal(normalizeConnectionString('postgresql+psycopg2://reader:p%40ss@localhost:5432/legacy'),'postgresql://reader:p%40ss@localhost:5432/legacy');
 assert.equal(normalizeConnectionString('postgres://reader:test@localhost/legacy'),'postgres://reader:test@localhost/legacy');
 assert.throws(()=>normalizeConnectionString('https://localhost/legacy'));
 assert.throws(()=>normalizeConnectionString('postgresql://localhost/'));
});
test('all reads execute in read-only transactions and release the client',async()=>{
 const statements:string[]=[];let released=false;
 const client={query:async(sql:string)=>{statements.push(sql);return{rows:[]};},release:()=>{released=true;}};
 await readOnlyTransaction(client as any,async c=>{await c.query('SELECT 1');});
 assert.equal(statements[0],'BEGIN READ ONLY');assert.equal(statements.at(-1),'ROLLBACK');
 assert.ok(statements.includes("SET LOCAL statement_timeout = '10s'"));assert.equal(released,true);
});
test('failed reads roll back and discard connections if rollback also fails',async()=>{
 let discard=false;const statements:string[]=[];
 const client={query:async(sql:string)=>{statements.push(sql);if(sql==='ROLLBACK')throw new Error('gone');return{rows:[]};},release:(value:boolean)=>{discard=value;}};
 await assert.rejects(readOnlyTransaction(client as any,async()=>{throw new Error('query failed');}),/query failed/);
 assert.equal(statements.at(-1),'ROLLBACK');assert.equal(discard,true);
});
test('public errors do not include driver messages or credentials',()=>{
 assert.ok(connectionError('28P01').includes('autenticação'));
 assert.ok(connectionError('ENOTFOUND').includes('localizar'));
 assert.ok(connectionError('UNKNOWN').includes('Não foi possível'));
});
test('encodes a literal at-sign in the password without changing its value',()=>{
 const normalized=normalizeConnectionString('postgresql://reader:example@password@localhost:5432/legacy');
 assert.ok(normalized.includes('example%40password@'));
 assert.equal(decodeURIComponent(new URL(normalized).password),'example@password');
 const encoded=normalizeConnectionString('postgresql://reader:example%40password@localhost:5432/legacy');
 assert.equal(encoded,normalized);
 assert.ok(!encoded.includes('%2540'));
});
import { LegacyService } from './legacy.service';

test('all legacy endpoints reject missing or unknown registry before network access',async()=>{
 const service=new LegacyService();
 (service as any).read=()=>{throw new Error('Network access forbidden in this test');};
 for(const registry of [undefined,'','3RIGO','1rigo',{},'1RIGO_POSTGRES_CONNECTION_STRING']){
  await assert.rejects(service.status(registry),/Selecione o cartório/);
  await assert.rejects(service.context([],registry),/Selecione o cartório/);
  await assert.rejects(service.minute('12345678-1234-1234-1234-123456789abc',registry),/Selecione o cartório/);
  await assert.rejects(service.structure(registry),/Selecione o cartório/);
 }
});

test('each registry owns its pool; no pool connects during configuration',async()=>{
 const service=new LegacyService();(service as any).queriesApproved=()=>true;
 (service as any).configured=(registry:string)=>`postgresql://reader:fake@localhost/${registry}`;
 try{
  const first=await (service as any).getPool('1RIGO');
  const second=await (service as any).getPool('2RIGO');
  assert.notEqual(first,second);
  assert.equal(await (service as any).getPool('1RIGO'),first);
  assert.equal(await (service as any).getPool('2RIGO'),second);
  assert.equal(first.totalCount,0);assert.equal(second.totalCount,0);
 }finally{await service.onModuleDestroy();}
});

test('context and minute route to the selected registry even for identical act identifiers',async()=>{
 const service=new LegacyService();(service as any).queriesApproved=()=>true;
 const routed:string[]=[];
 (service as any).read=async(work:any,registry:string)=>{
  routed.push(registry);
  return work({query:async()=>({rows:[{id:'12345678-1234-1234-1234-123456789abc',text:registry}]})});
 };
 for(const registry of ['1RIGO','2RIGO']){
  const minute=await service.minute('12345678-1234-1234-1234-123456789abc',registry);
  assert.equal(minute.text,registry);assert.equal(minute.registry,registry);
  const context=await service.context([{tipo_matricula_transcricao:1,numero_matricula:'123',numero_ato:'1',tipo_ato:1}],registry);
  assert.equal(context.registry,registry);
 }
 assert.deepEqual(routed,['1RIGO','1RIGO','2RIGO','2RIGO']);
});
test('manual validation mode prevents network access in all legacy endpoints',async()=>{
 const service=new LegacyService();
 (service as any).queriesApproved=()=>false;
 (service as any).configured=()=>{throw new Error('Credentials must not be read in manual mode');};
 const status=await service.status('1RIGO');
 assert.equal(status.connected,false);assert.equal((status as any).enabled,false);
 await assert.rejects(service.context([],'1RIGO'),/desabilitadas/);
 await assert.rejects(service.structure('1RIGO'),/desabilitadas/);
});
test('minute validates UUID before any connection and returns only the requested act',async()=>{
 const service=new LegacyService();(service as any).queriesApproved=()=>true;
 let calls=0;
 (service as any).read=async(work:any)=>work({query:async(sql:string,values:string[])=>{
  calls++;assert.ok(sql.includes('a.id=$1::uuid'));assert.deepEqual(values,['12345678-1234-1234-1234-123456789abc']);
  return {rows:[{id:values[0],title:'Exemplo fictício',text:'Texto de teste',tooLarge:false}]};
 }});
 await assert.rejects(service.minute('not-a-uuid','1RIGO'),/inválido/);assert.equal(calls,0);
 const result=await service.minute('12345678-1234-1234-1234-123456789abc','1RIGO');
 assert.equal(calls,1);assert.equal(result.text,'Texto de teste');assert.equal(result.source,'public.ato.texto');
});
test('minute is blocked when database queries are disabled and handles a missing act',async()=>{
 const service=new LegacyService();(service as any).queriesApproved=()=>false;
 await assert.rejects(service.minute('12345678-1234-1234-1234-123456789abc','1RIGO'),/desabilitadas/);
 (service as any).queriesApproved=()=>true;
 (service as any).read=async(work:any)=>work({query:async()=>({rows:[]})});
 await assert.rejects(service.minute('12345678-1234-1234-1234-123456789abc','1RIGO'),/não encontrado/);
});
