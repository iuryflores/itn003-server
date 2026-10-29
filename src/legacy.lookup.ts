import { BadRequestException } from '@nestjs/common';
export type LookupKey={index:number;registryNumber:string;registryKind:string;book:string;actNumber:string;actKind:string;opening:boolean};
export type LegacyAct={id:string;title:string|null;service:string|null;actKind:string;registeredAt:string|null;sealedAt:string|null;classification:string|null;georeferencing:boolean|null;polygon:string|null;cancelled:boolean;matchKind:string};
export type LegacyMatch={index:number;status:'matched'|'ambiguous'|'not_found'|'invalid_key';message:string;record?:LegacyAct};
export function lookupKeys(items:unknown[]):LookupKey[] {
 if(items.length>1000)throw new BadRequestException('O cruzamento com o legado suporta até 1000 atos por consulta nesta versão.');
 return items.flatMap((item,index)=>{
  if(!item||typeof item!=='object'||Array.isArray(item))return [];
  const v=item as Record<string,unknown>;
  const registryNumber=v.tipo_matricula_transcricao===1?v.numero_matricula:v.tipo_matricula_transcricao===2?v.numero_transcricao:undefined;
  if(typeof registryNumber!=='string'||!/^\d{1,10}$/.test(registryNumber)||typeof v.numero_ato!=='string'||!/^\d{1,10}$/.test(v.numero_ato)||![1,2].includes(v.tipo_ato as number))return [];
  return [{index,registryNumber,registryKind:v.tipo_matricula_transcricao===1?'MATRICULA':'TRANSCRICAO',book:typeof v.livro_transcricao==='string'?v.livro_transcricao:'',actNumber:v.numero_ato,actKind:v.tipo_ato===1?'REGISTRO':'AVERBACAO',opening:(v.ato===1||v.ato===2)&&Number(v.numero_ato)===0}];
 });
}
export function matchResults(count:number,keys:LookupKey[],rows:({index:number}&LegacyAct)[]):LegacyMatch[] {
 const valid=new Set(keys.map(k=>k.index));
 const grouped=new Map<number,LegacyAct[]>();
 for(const {index,...record} of rows)grouped.set(index,[...(grouped.get(index)??[]),record]);
 return Array.from({length:count},(_,index)=>{
  if(!valid.has(index))return {index,status:'invalid_key',message:'Informe tipo e número da matrícula/transcrição, tipo do ato e numero_ato para cruzar com segurança.'};
  const records=grouped.get(index)??[];
  if(!records.length)return {index,status:'not_found',message:'Nenhum ato encontrado com esta identificação. Confira número, tipo do ato e livro da transcrição.'};
  if(records.length>1)return {index,status:'ambiguous',message:'Há mais de um ato com esta identificação. Nenhuma descrição foi associada automaticamente.'};
  const record=records[0];
  return {index,status:'matched',message:record.matchKind==='opening'?'Abertura localizada pelo número zero. O tipo informado no JSON difere de ABERTURA no legado; revise o enquadramento.':'Ato localizado por matrícula/transcrição, livro quando informado, número e tipo do ato.',record};
 });
}
export const CONTEXT_SQL=`SELECT k.index, m.* FROM jsonb_to_recordset($1::jsonb) AS k(index int,"registryNumber" text,"registryKind" text,book text,"actNumber" text,"actKind" text,opening boolean)
JOIN LATERAL (
 SELECT a.id::text AS id,a.titulo AS title,ts.nome AS service,a.tipo AS "actKind",
 to_char(a.registro,'DD/MM/YYYY') AS "registeredAt",to_char(a.selado,'DD/MM/YYYY') AS "sealedAt",
 a.classificacao_ato_itn003 AS classification,ir.possui_georreferenciamento AS georeferencing,
 ir.numero_poligono AS polygon,(a.cancelamento IS NOT NULL) AS cancelled,
 CASE WHEN a.tipo=k."actKind" THEN 'exact' ELSE 'opening' END AS "matchKind"
 FROM public.indicador_real ir JOIN public.ato a ON a.indicador_real_id=ir.id
 LEFT JOIN public.tipo_servico ts ON ts.id=a.tipo_servico_id
 WHERE ir.codigo=k."registryNumber"::bigint AND ir.livro=k."registryKind"
 AND (k."registryKind"<>'TRANSCRICAO' OR k.book='' OR ir.livro_numero=k.book OR ir.livro_transcricao=k.book)
 AND a.codigo=k."actNumber"::bigint
 AND (a.tipo=k."actKind" OR (k.opening AND a.tipo='ABERTURA'))
 ORDER BY a.id LIMIT 3
) m ON true`;
