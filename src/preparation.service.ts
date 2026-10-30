import {Registry,requireRegistry} from './registry';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { AuditService } from './audit.service';
type Preparation={kind:'itn003-preparation';version:1;registry?:Registry;name?:string;file:string;raw:string;classifications?:Record<number,number>;fieldOverrides?:Record<number,Record<string,unknown>>;taxOverrides?:Record<number,{value:string;source:string}>;decisions:Record<number,'keep'|'exclude'>;reasons:Record<number,string>};
type Saved={id:string;revision:string;createdAt:string;updatedAt:string;preparation:Preparation};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class PreparationService {
 private directory=resolve(__dirname,'..','data','preparations');
 private writes:Promise<unknown>=Promise.resolve();
 constructor(@Inject(AuditService) private readonly audit:AuditService){}
 private path(id:unknown) {
  if(typeof id!=='string'||!uuid.test(id))throw new BadRequestException('Identificador da auditoria inválido.');
  return resolve(this.directory,id+'.json');
 }
 private validate(value:unknown):Preparation {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new BadRequestException('Preparação inválida.');
  const p=value as Record<string,any>;
  if(p.kind!=='itn003-preparation'||p.version!==1||typeof p.file!=='string'||!p.file.trim()||p.file.length>260||typeof p.raw!=='string')throw new BadRequestException('Formato de preparação inválido.');
  if(p.name!==undefined&&(typeof p.name!=='string'||p.name.length>160))throw new BadRequestException('O nome da auditoria deve ter até 160 caracteres.');
  if(Buffer.byteLength(p.raw,'utf8')>45*1024*1024)throw new BadRequestException('O JSON original deve ter até 45 MB.');
  const count=this.audit.parse(p.raw).data.imoveis.length;
  for(const name of ['decisions','reasons']){
   if(!p[name]||typeof p[name]!=='object'||Array.isArray(p[name]))throw new BadRequestException('Decisões ou anotações inválidas.');
   for(const [key,value] of Object.entries(p[name])){
    const index=Number(key);
    if(!/^\d+$/.test(key)||!Number.isSafeInteger(index)||String(index)!==key||index>=count)throw new BadRequestException('A preparação referencia um ato inexistente.');
    if(name==='decisions'&&value!=='keep'&&value!=='exclude')throw new BadRequestException('Decisão inválida.');
    if(name==='reasons'&&(typeof value!=='string'||value.length>10000))throw new BadRequestException('Anotações devem ter até 10 mil caracteres por ato.');
   }
  }
  const registry=p.registry===undefined?undefined:requireRegistry(p.registry);
  const classifications=this.audit.validateClassifications(p.raw,p.classifications);
  const fieldOverrides=this.audit.validateFieldOverrides(p.raw,p.fieldOverrides);
  const taxOverrides=this.audit.validateTaxOverrides(p.raw,p.taxOverrides);
  return {kind:'itn003-preparation',version:1,registry,name:p.name?.trim()||p.file,file:p.file,raw:p.raw,classifications,taxOverrides,fieldOverrides,decisions:p.decisions,reasons:p.reasons};
 }
 private metadata(saved:Saved) {
  const count=this.audit.parse(saved.preparation.raw).data.imoveis.length;
  const decisions=Object.values(saved.preparation.decisions);
  return {registry:saved.preparation.registry,id:saved.id,revision:saved.revision,name:saved.preparation.name||saved.preparation.file,file:saved.preparation.file,updatedAt:saved.updatedAt,createdAt:saved.createdAt,total:count,kept:decisions.filter(d=>d==='keep').length,excluded:decisions.filter(d=>d==='exclude').length,pending:count-decisions.length};
 }
 private async read(id:unknown):Promise<Saved> {
  const path=this.path(id);
  try{return JSON.parse(await readFile(path,'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new NotFoundException('Auditoria salva não encontrada.');throw error;}
 }
 async list() {
  await this.writes;
  await mkdir(this.directory,{recursive:true});
  const files=(await readdir(this.directory)).filter(name=>name.endsWith('.json')&&uuid.test(name.slice(0,-5)));
  const items=[];let unreadable=0;
  for(const file of files){try{const saved=await this.read(file.slice(0,-5));this.validate(saved.preparation);items.push(this.metadata(saved));}catch{unreadable++;}}
  return {items:items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),unreadable};
 }
 async load(id:unknown) {
  await this.writes;
  const saved=await this.read(id);
  return {...this.metadata(saved),preparation:this.validate(saved.preparation)};
 }
 save(value:unknown,id?:unknown,revision?:unknown) {
  const operation=this.writes.then(async()=>{
   const preparation=this.validate(value);
   const now=new Date().toISOString();
   let previous:Saved|undefined;
   if(id!==undefined){
    previous=await this.read(id);
    if(typeof revision!=='string'||previous.revision!==revision)throw new ConflictException('Esta auditoria foi atualizada em outra aba. Reabra a versão salva ou baixe sua preparação antes de continuar.');
    if(previous.preparation.registry!==undefined&&previous.preparation.registry!==preparation.registry)throw new ConflictException('O cartório desta auditoria não pode ser alterado. Importe o arquivo como uma nova auditoria.');
    if(previous.preparation.raw!==preparation.raw)throw new ConflictException('O arquivo original mudou. Importe-o como uma nova auditoria.');
   }
   const saved:Saved={id:previous?.id??randomUUID(),revision:randomUUID(),createdAt:previous?.createdAt??now,updatedAt:now,preparation};
   await mkdir(this.directory,{recursive:true});
   const destination=this.path(saved.id);
   const temp=resolve(this.directory,`${saved.id}.${randomUUID()}.tmp`);
   await writeFile(temp,JSON.stringify(saved),{encoding:'utf8',flag:'wx'});
   await rename(temp,destination);
   return this.metadata(saved);
  });
  this.writes=operation.catch(()=>{});
  return operation;
 }
}
