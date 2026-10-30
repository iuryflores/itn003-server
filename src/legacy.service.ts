import {Registry,requireRegistry} from './registry';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Pool, PoolClient } from 'pg';
import { lookupKeys, matchResults, CONTEXT_SQL } from './legacy.lookup';

export function normalizeConnectionString(value:string) {
  const normalized=value.trim().replace(/^postgres(?:ql)?\+[^:]+:\/\//i,'postgresql://');
  try {
    const parsed=new URL(normalized);
    if(!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.hostname||!parsed.pathname||parsed.pathname==='/')throw new Error();
    // Serializa credenciais reservadas (como @) sem codificar novamente os escapes já existentes.
    return parsed.toString();
  }catch {throw new BadRequestException('A conexão do cartório deve ser uma URL PostgreSQL válida.');}
}
export function connectionError(code?:string) {
  if(code==='28P01'||code==='28000'||code==='08P01')return 'O banco recusou a autenticação ou o protocolo de conexão. Confira a conexão do cartório selecionado em server/.env.';
  if(code==='ENOTFOUND'||code==='EAI_AGAIN')return 'Não foi possível localizar o servidor PostgreSQL.';
  if(code==='ECONNREFUSED')return 'A conexão PostgreSQL foi recusada. Confira o endereço, a porta e o acesso à rede.';
  if(code==='42501')return 'O usuário do banco não tem permissão para realizar esta consulta de leitura.';
  if(code==='57014')return 'A consulta ao legado excedeu o tempo permitido.';
  return 'Não foi possível consultar o PostgreSQL. Confira a conexão e a disponibilidade do banco.';
}
export async function readOnlyTransaction<T>(client:Pick<PoolClient,'query'|'release'>,work:(client:Pick<PoolClient,'query'|'release'>)=>Promise<T>):Promise<T> {
  let discard=false;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    return await work(client);
  }finally{
    try{await client.query('ROLLBACK');}catch{discard=true;}
    client.release(discard);
  }
}
@Injectable()
export class LegacyService implements OnModuleDestroy {
  private pools=new Map<Registry,{pool:Pool;url:string}>();
  private configured(registry:Registry) {
    const envPath=resolve(__dirname,'..','.env');
    const file=existsSync(envPath)?parseEnv(readFileSync(envPath,'utf8')):{};
    const key=`${registry}_POSTGRES_CONNECTION_STRING`;
    return process.env[key] || file[key];
  }
  private queriesApproved() {
    const envPath=resolve(__dirname,'..','.env');
    const file=existsSync(envPath)?parseEnv(readFileSync(envPath,'utf8')):{};
    return (process.env.LEGACY_QUERIES_APPROVED??file.LEGACY_QUERIES_APPROVED)==='true';
  }
  private requireApproval() {
    if(!this.queriesApproved())throw new ForbiddenException('Consultas ao legado desabilitadas na configuração do servidor.');
  }
  private async getPool(registry:Registry) {
    this.requireApproval();
    const value=this.configured(registry);
    if(!value)throw new ServiceUnavailableException(`Configure ${registry}_POSTGRES_CONNECTION_STRING em server/.env.`);
    const normalized=normalizeConnectionString(value);
    let current=this.pools.get(registry);
    if(current?.url!==normalized){
      const previous=current?.pool;
      const pool=new Pool({connectionString:normalized,max:2,connectionTimeoutMillis:8000,idleTimeoutMillis:10000,allowExitOnIdle:true});
      pool.on('error',()=>{});
      current={pool,url:normalized};this.pools.set(registry,current);
      await previous?.end();
    }
    return current!.pool;
  }
  private async read<T>(work:(client:Pick<PoolClient,'query'|'release'>)=>Promise<T>,registry:Registry) {
    try {
      const pool=await this.getPool(registry);
      return await readOnlyTransaction(await pool.connect(),work);
    }catch(error){
      if(error instanceof HttpException)throw error;
      throw new ServiceUnavailableException(connectionError((error as {code?:string})?.code));
    }
  }
  async status(value?:unknown) {
    const registry=requireRegistry(value);
    if(!this.queriesApproved())return {enabled:false,connected:false,readOnly:true,mappingReady:false,message:'Consultas pela aplicação desabilitadas na configuração do servidor.'};
    if(!this.configured(registry))return {configured:false,connected:false,readOnly:true,mappingReady:false,message:`Configure ${registry}_POSTGRES_CONNECTION_STRING em server/.env.`};
    return this.read(async client=>{
      await client.query('SELECT 1');
      return {configured:true,connected:true,readOnly:true,mappingReady:true,message:'Conexão verificada. Consulte os atos do JSON para complementar a auditoria com títulos, serviços e datas do legado.'};
    },registry);
  }
  async context(items:unknown[],value?:unknown) {
    const registry=requireRegistry(value);
    this.requireApproval();
    const keys=lookupKeys(items);
    const rows=keys.length?await this.read(async client=>{
      const result=await client.query(CONTEXT_SQL,[JSON.stringify(keys)]);
      return result.rows;
    },registry):[];
    return {registry,fetchedAt:new Date().toISOString(),source:'PostgreSQL legado · ato, indicador_real e tipo_servico',matches:matchResults(items.length,keys,rows)};
  }
  async minute(id:string,value?:unknown) {
    const registry=requireRegistry(value);
    this.requireApproval();
    if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new BadRequestException('Identificador do ato inválido.');
    return this.read(async client=>{
      const result=await client.query(`SELECT a.id::text AS id,a.titulo AS title,
        CASE WHEN octet_length(a.texto)<=2097152 THEN a.texto ELSE NULL END AS text,
        (COALESCE(octet_length(a.texto),0)>2097152) AS "tooLarge"
        FROM public.ato a WHERE a.id=$1::uuid LIMIT 1`,[id]);
      if(!result.rows.length)throw new NotFoundException('Ato não encontrado no legado.');
      const row=result.rows[0];
      return {...row,registry,source:'public.ato.texto',fetchedAt:new Date().toISOString()};
    },registry);
  }
  async structure(value?:unknown) {
    const registry=requireRegistry(value);
    return this.read(async client=>{
      const result=await client.query(`SELECT table_schema AS schema, table_name AS table, column_name AS column, data_type AS type
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY table_schema,table_name,ordinal_position LIMIT 1801`);
      return {columns:result.rows.slice(0,1800),truncated:result.rows.length>1800,mappingReady:true};
    },registry);
  }
  async onModuleDestroy(){await Promise.all([...this.pools.values()].map(entry=>entry.pool.end()));}
}
