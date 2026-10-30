import {patternExample} from './diagnostics';
type Schema=Record<string,any>;
type Requirement='required'|'conditional'|'optional';
export type GuideField={path:string;example?:string;requirement:Requirement;rule:string;types:string[];sources:string[]};
const optional=new Set(['decisao_jud','sistema_coordenadas','fuso_zona','sistema_referencia','coordenadas','numero_poligono','categoria_poligono','protocolo_prenotacao','data_protocolo_prenotacao','livro_transcricao','folha_transcricao','dados_confrontantes','onerosa_nao_onerosa','rip','fracao','nome_representante_legal','cpf_representante_legal','data_averbacao']);
const notes:Record<string,string>={
 version:'Versão exigida pelo schema: 1.3.0.',cns:'Identificação da serventia na raiz do arquivo.',imoveis:'Lista com pelo menos um imóvel.',
 tipo_imovel:'1 = urbano; 2 = rural.',contexto_rural:'1 = padrão; 2 = União; 3 = estrangeiros.',contexto_urbano:'1 = padrão; 2 = União.',motivo_envio:'1 = novo ato; 2 = acervo.',
 decisao_jud:'Indicador opcional. Quando true, aplica a alternativa de decisão judicial do schema, com exigências reduzidas.',
 tipo_matricula_transcricao:'1 = matrícula; 2 = transcrição.',
 numero_matricula:'Exigido para matrícula (tipo_matricula_transcricao = 1).',
 numero_transcricao:'Exigido para transcrição (tipo_matricula_transcricao = 2).',
 data_matricula:'Para matrícula, observadas as exceções de decisão judicial e abertura de ofício.',
 cnm:'Para matrícula, observadas as exceções de decisão judicial e abertura de ofício.',
 situacao:'Para matrícula, observadas as exceções de decisão judicial e abertura de ofício.',
 data_transcricao:'Para transcrição, observada a exceção de decisão judicial.',
 tipo_ato:'Para novo ato (motivo_envio = 1), observadas as exceções do schema. 1 = registro; 2 = averbação.',
 numero_ato:'Número sequencial do ato no registro; para novo ato, observadas as exceções do schema.',
 ato:'Classificação ITN003 para novo ato. A abertura de ofício (2) possui alternativa própria com exigências reduzidas.',
 data_ato:'Data do ato; para novo ato, observadas as exceções do schema.',
 alteracao_titularidade:'Para transmissão/aquisição originária de direitos reais (ato = 4).',
 valor_imposto:'ITBI/ITCMD; para transmissão (ato = 4). Não equivale automaticamente ao valor de avaliação.',
 valor_transacao:'Valor da operação; para transmissão (ato = 4).',
 alteracao_imovel:'Para alteração do imóvel (ato = 5).',
 codigo_incra:'Exigido quando certificacao_incra = true, observadas as exceções do schema.',
 nome_imovel:'Exigido quando imovel_possui_nome = true, nos contextos que admitem o campo.',
 regime_utilizacao:'Aplicável a imóvel da União (contexto = 2).',cat:'No contexto da União, quando regime_utilizacao = 1 (aforamento) ou 2 (ocupação).',
 base_calculo_itbi:'No contexto da União, quando valor_imposto é preenchido.',
 area_terreno_total:'Área do imóvel. Ver regras de novo ato e contexto; o objeto informado exige valor e unidade.',
 area_terreno_uniao:'Área da União, conforme contexto e motivo do envio; o objeto informado exige valor e unidade.',
 dados_imovel:'Endereços do imóvel. Os campos internos são avaliados em cada endereço informado.',
 dados_pessoa:'Partes. Em novo ato de transmissão, o schema exige ao menos um alienante e um adquirente.',
 autorizacao_incra:'Aplicável ao contexto rural de estrangeiros (contexto_rural = 3).',
 faixa_fronteira:'Aplicável ao contexto rural de estrangeiros (contexto_rural = 3).',
 area_sn:'Aplicável ao contexto rural de estrangeiros (contexto_rural = 3).',
};
const personNotes:Record<string,string>={
 condicao_parte:'Em novo ato de transmissão: 1 = alienante; 2 = adquirente. Deve existir pelo menos uma parte de cada condição.',
 nome_completo:'Para novo ato (motivo_envio = 1).',cpf_cnpj:'Para novo ato; dispensado na alternativa nao_CPF = true.',
 nao_CPF:'Indicador opcional; true dispensa o CPF na alternativa prevista pelo schema.',
 estrangeiro:'Indicador de estrangeiro para novo ato.',nacionalidade:'Exigido quando estrangeiro = true.',
 estado_civil:'Conferir a alternativa da pessoa e do motivo do envio no schema.',regime_bens:'Exigido para estado_civil = 2 (casado) ou 6 (união estável).',
 relacao_juridica:'Para novo ato; o alienante (condicao_parte = 1) tem dispensa específica.',
 data_inicio_rel_juridica:'Exigido quando relacao_juridica está preenchida.',percentual:'Percentual do direito para novo ato.',
 filhos_brasileiros:'No contexto rural de estrangeiros, para novo ato.',
};
// Positive required clauses only: a required inside "not" is a prohibition, not an obligation.
function requirements(schema:Schema):{must:Set<string>;may:Set<string>} {
 const must=new Set<string>(schema.required??[]),may=new Set(must);
 for(const branch of schema.allOf??[]){const r=requirements(branch);r.must.forEach(f=>must.add(f));r.may.forEach(f=>may.add(f));}
 for(const op of ['anyOf','oneOf'])if(schema[op]?.length){
  const alternatives=schema[op].map(requirements);
  alternatives.forEach((r:{may:Set<string>})=>r.may.forEach(f=>may.add(f)));
  alternatives[0].must.forEach((f:string)=>{if(alternatives.every((r:{must:Set<string>})=>r.must.has(f)))must.add(f);});
 }
 return {must,may};
}
export function buildFieldGuide(schema:Schema,kind:'rurais'|'urbanos'):GuideField[]{
 const scopes=new Map<string,{schema:Schema;source:string}[]>();
 function visit(node:any,path:string,source:string){
  if(!node||typeof node!=='object'||Array.isArray(node))return;
  if(node.properties||node.required){const entries=scopes.get(path)??[];entries.push({schema:node,source});scopes.set(path,entries);}
  for(const [field,child] of Object.entries(node.properties??{}))visit(child,path?`${path}.${field}`:field,`${source}/properties/${field}`);
  if(node.items)visit(node.items,`${path}[]`,`${source}/items`);
  if(node.contains)visit(node.contains,`${path}[]`,`${source}/contains`);
  for(const op of ['allOf','anyOf','oneOf'])for(const [i,child] of (node[op]??[]).entries())visit(child,path,`${source}/${op}/${i}`);
 }
 // Include composite scopes to account for alternative branches in the guaranteed set.
 function register(node:any,path:string,source:string){
  if(!node||typeof node!=='object')return;
  if(node.items){const entries=scopes.get(`${path}[]`)??[];entries.unshift({schema:node.items,source:`${source}/items`});scopes.set(`${path}[]`,entries);}
  for(const [key,child] of Object.entries(node.properties??{}))register(child,path?`${path}.${key}`:key,`${source}/properties/${key}`);
 }
 visit(schema,'','#');register(schema,'','#');
 const fields:GuideField[]=[];
 for(const [scope,entries] of scopes){
  const keys=new Set(entries.flatMap(e=>Object.keys(e.schema.properties??{})));
  const global=requirements(scope===''?schema:entries[0].schema);
  for(const key of keys){
   const definitions=entries.filter(e=>e.schema.properties?.[key]);
   const possible=entries.some(e=>requirements(e.schema).may.has(key));
   const nested=scope.includes('dados_pessoa[]');
   const guaranteed=scope===''||scope==='imoveis[]'?global.must.has(key):entries.every(e=>requirements(e.schema).must.has(key));
   let requirement:Requirement=guaranteed?'required':possible?'conditional':'optional';
   if(scope==='imoveis[]'&&(optional.has(key)||(kind==='rurais'&&key==='ccir')||(kind==='urbanos'&&key==='cib')))requirement='optional';
   if(nested&&key==='nao_CPF')requirement='optional';
   let rule=(nested?personNotes[key]:undefined)??notes[key]??(requirement==='optional'?'Pode ficar ausente. Quando preenchido, deve atender ao formato e ao contexto do schema.':requirement==='required'?'Exigido nesta estrutura.':'Exigido em uma ou mais alternativas do schema; depende do contexto e dos demais campos.');
   if(key==='cib')rule=kind==='rurais'?'Para novo ato rural (motivo_envio = 1), observadas as exceções.':'Opcional no urbano; quando preenchido, deve atender ao formato do schema.';
   if(key==='cod_sncr')rule='Para novo ato rural. O schema admite 12 ou 13 dígitos; ver observação da auditoria.';
   if(key==='car'||key==='cif')rule='Para novo ato, observadas as exceções do schema.';
   if(scope.includes('[]')&&scope!=='imoveis[]')rule+=' A exigência é relativa a cada elemento da estrutura informada; não torna a estrutura pai obrigatória por si só.';
   const example=definitions.map(e=>e.schema.properties[key].pattern).filter(Boolean).map(patternExample).find(Boolean);
   fields.push({example,path:scope?`${scope}.${key}`:key,requirement,rule,types:[...new Set(definitions.flatMap(e=>{const t=e.schema.properties[key].type;return t?[t].flat():[];}))] as string[],sources:definitions.slice(0,3).map(e=>`Anexo II · imoveis-${kind}-onr.schema.json ${e.source}/properties/${key}`)});
  }
 }
 return fields.sort((a,b)=>a.path.localeCompare(b.path));
}
