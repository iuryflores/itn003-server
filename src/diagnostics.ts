import { ErrorObject } from 'ajv';
const discriminators = new Set(['decisao_jud','ato','motivo_envio','tipo_imovel','contexto_rural','contexto_urbano','tipo_matricula_transcricao','nao_CPF','estrangeiro','condicao_parte']);
/** Prioritizes the closest failing alternative for display only. Official Ajv validation remains authoritative. */
export function prioritizeErrors(errors: ErrorObject[]): ErrorObject[] {
  let remaining = [...errors];
  const groups = errors.filter(e => e.keyword === 'anyOf' || e.keyword === 'oneOf').sort((a,b)=>b.schemaPath.length-a.schemaPath.length);
  for (const group of groups) {
    if (!remaining.includes(group)) continue;
    const prefix=group.schemaPath+'/';
    const belongs=(e:ErrorObject)=>e.schemaPath.startsWith(prefix) && (e.instancePath===group.instancePath||e.instancePath.startsWith(group.instancePath+'/'));
    const branches = new Map<string, ErrorObject[]>();
    for (const e of remaining.filter(belongs)) {
      const branch=e.schemaPath.slice(prefix.length).split('/')[0];
      branches.set(branch,[...(branches.get(branch)??[]),e]);
    }
    if (!branches.size) continue;
    const cost=(list:ErrorObject[])=>list.reduce((total,e)=>total+(e.keyword==='const'||e.keyword==='not'?10000:e.keyword==='required'&&discriminators.has(e.params.missingProperty)?10000:e.keyword==='type'?100:e.keyword==='enum'?100:1),0);
    const best=Math.min(...[...branches.values()].map(cost));
    const selected=new Set([...branches.values()].filter(list=>cost(list)===best).flat());
    remaining=remaining.filter(e=>e!==group&&(!belongs(e)||selected.has(e)));
  }
  const seen=new Set<string>();
  return remaining.filter(e=>{const key=JSON.stringify([e.instancePath,e.keyword,e.params]);if(seen.has(key))return false;seen.add(key);return true;});
}
/** Illustrative format only; identifiers must come from the actual record. */
export function patternExample(pattern:string):string|undefined {
 const candidates=['15/10/2026','123456.1.1234567-12','GO-1234567-1234567890ABCDEF1234567890ABCDEF','12345-678','1234567-8',...Array.from({length:41},(_,i)=>'1234567890'.repeat(5).slice(0,i+1))];
 try{return candidates.find(value=>new RegExp(pattern).test(value));}catch{return undefined;}
}
export function issueExample(e:ErrorObject):string|undefined {
 const p=e.params;
 if(e.keyword==='pattern')return patternExample(p.pattern);
 if(e.keyword==='const')return JSON.stringify(p.allowedValue);
 if(e.keyword==='enum')return JSON.stringify(p.allowedValues[0]);
 if(e.keyword==='type')return ({string:'"Texto de exemplo"',number:'1234.56',integer:'1',boolean:'true',array:'[{ … }]',object:'{ … }',null:'null'} as Record<string,string>)[p.type];
 if(e.keyword==='minimum')return String(p.limit);
 if(e.keyword==='maximum')return String(p.limit);
 if(e.keyword==='minLength'||e.keyword==='maxLength')return '1'.repeat(Math.min(p.limit,80));
 return undefined;
}
export function describeError(e:ErrorObject) {
 const p=e.params;
 switch(e.keyword) {
  case 'required':return `Preencha o campo obrigatório “${p.missingProperty}”.`;
  case 'type':return `Informe ${p.type==='string'?'um texto':p.type==='number'?'um número':p.type==='integer'?'um número inteiro':p.type==='boolean'?'true ou false':p.type==='array'?'uma lista':p.type==='object'?'um objeto':p.type==='null'?'null':p.type}.`;
  case 'pattern':return `Valor fora do formato exigido. Padrão: ${p.pattern}`;
  case 'const':return `O valor exigido nesta alternativa é ${JSON.stringify(p.allowedValue)}.`;
  case 'enum':return `Use um dos valores permitidos: ${p.allowedValues.join(', ')}.`;
  case 'additionalProperties':return `O campo “${p.additionalProperty}” não é permitido nesta estrutura.`;
  case 'minItems':return `A lista deve conter pelo menos ${p.limit} item(ns).`;
  case 'maxItems':return `A lista permite no máximo ${p.limit} item(ns).`;
  case 'minLength':return `Informe pelo menos ${p.limit} caracteres.`;
  case 'maxLength':return `Use no máximo ${p.limit} caracteres.`;
  case 'minimum':return `Informe um valor maior ou igual a ${p.limit}.`;
  case 'maximum':return `Informe um valor menor ou igual a ${p.limit}.`;
  case 'contains':return 'A lista não contém um item que atende à condição exigida (confira as partes alienante e adquirente quando aplicável).';
  case 'not':return 'Esta combinação de campos não é aceita por esta alternativa da regra.';
  default:return `${e.message??'Valor inválido'} (${JSON.stringify(p)})`;
 }
}

export function explainRequirement(path:string, item:Record<string,any>):string {
 const field=path.split('/').pop();
 if(path.includes('/dados_pessoa/')) {
  const index=Number(path.split('/')[2]);const person=item.dados_pessoa?.[index]??{};
  if(field==='data_inicio_rel_juridica')return 'Anexo I, §4.2: exigido quando a relação jurídica está preenchida.';
  if(field==='regime_bens')return 'Anexo I, §4.2: exigido para pessoa casada ou em união estável.';
  if(field==='nacionalidade')return 'Anexo I, §4.2: exigido quando estrangeiro = true.';
  if(field==='cpf_cnpj')return 'Anexo I, §4.2: identificar a parte no novo ato; observar a exceção nao_CPF quando verdadeira.';
  if(field==='relacao_juridica'&&person.condicao_parte!==1)return 'Anexo I, §4.2: relação jurídica exigida para o novo ato; alienante tem regra específica.';
  return 'Anexo I, §4.2: conferir a identificação e as condições aplicáveis a esta pessoa.';
 }
 if((['area_terreno_total','data_ato','numero_ato','tipo_ato','ato'].includes(field??'') || item.tipo_imovel===2&&['cib','cod_sncr','car'].includes(field??'') || item.tipo_imovel===1&&field==='cif')&&item.motivo_envio===1)return 'Anexo I, §3: campo exigido para motivo_envio = 1 (novo ato), observadas as exceções de decisão judicial e abertura de ofício.';
 if(['numero_transcricao','data_transcricao'].includes(field??''))return 'Anexo I, §3: exigido quando tipo_matricula_transcricao = 2 (transcrição).';
 if(['numero_matricula','data_matricula','cnm','situacao'].includes(field??''))return 'Anexo I, §3: exigido quando tipo_matricula_transcricao = 1 (matrícula), observadas as exceções.';
 if(['alteracao_titularidade','valor_transacao','valor_imposto'].includes(field??''))return 'Anexo I, §3: exigido para ato = 4 (transmissão / aquisição originária de direitos reais).';
 if(field==='alteracao_imovel')return 'Anexo I, §3: exigido para ato = 5 (alteração do imóvel).';
 if(field==='codigo_incra')return 'Anexo I, §3: exigido quando certificacao_incra = true.';
 if(field==='nome_imovel')return 'Anexo I, §3: exigido quando imovel_possui_nome = true.';
 if(field==='ccir'&&item.tipo_imovel===2)return 'Anexo I rural, §3: CCIR é opcional. Quando informado, o Anexo II exige 11 dígitos; a ausência não gera pendência.';
 if(field==='cib'&&item.tipo_imovel===1)return 'Anexo I urbano, §3: CIB é opcional. Quando informado, deve atender ao formato do Anexo II.';
 if(['protocolo_prenotacao','data_protocolo_prenotacao'].includes(field??''))return 'Anexo I, §3: campo opcional; a ausência não gera pendência. Quando informado, deve atender ao schema.';
 if(field==='dados_pessoa'&&item.ato===4)return 'Anexo I, §3: em novo ato de transmissão, informar pelo menos um alienante (condicao_parte = 1) e um adquirente (2).';
 return 'Conferir o campo e a condição indicada pelo schema oficial do Anexo II.';
}

export function classifyIssue(issue:{path:string;rule:string}, item:Record<string,any>) {
 const topLevel=issue.path.split('/').filter(Boolean);
 const field=topLevel[0];
 // Somente campos marcados como “Não” nos manuais de ambos os tipos.
 const optional = new Set(['decisao_jud','sistema_coordenadas','fuso_zona','sistema_referencia','coordenadas','numero_poligono','categoria_poligono','protocolo_prenotacao','data_protocolo_prenotacao','livro_transcricao','folha_transcricao','dados_confrontantes']);
 if(item.tipo_imovel===2)optional.add('ccir');
 if(item.tipo_imovel===1)optional.add('cib');
 const missing=issue.rule==='required';
 const isOptional=topLevel.length===1&&optional.has(field);
 return {
  category: missing?'missing_required':'invalid_value',
  requirement: missing?'Obrigatório neste enquadramento':isOptional?'Opcional; validar quando informado':'Valor ou formato exigido pelo schema',
 };
}

export function documentationNotes(item:Record<string,any>) {
 const notes:{path:string;message:string;source:string}[]=[];
 if(item.tipo_imovel===2&&typeof item.cod_sncr==='string'&&/^\d{12}$/.test(item.cod_sncr))notes.push({path:'/cod_sncr',message:'O schema aceita SNCR com 12 ou 13 dígitos. A tabela do manual indica tamanho 13, mas a seção “Validação de caracteres” também admite 12 ou 13. Um SNCR de 12 dígitos não gera erro de tamanho.',source:'Anexo I rural · §3 e Validação de caracteres; Anexo II · cod_sncr'});
 return notes;
}
