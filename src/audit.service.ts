import { BadRequestException, Injectable } from '@nestjs/common';
import { prioritizeErrors, describeError, explainRequirement, classifyIssue, documentationNotes } from './diagnostics';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { modify, applyEdits, parseTree, findNodeAtLocation, Node as JsonNode } from 'jsonc-parser';

function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
@Injectable()
export class AuditService {
  private validators = new Map<number, ValidateFunction>();
  private roots = new Map<number, ValidateFunction>();
  constructor() {
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    const directory = 'schemas';
    const root = [resolve(__dirname, '..'), process.cwd()].find(p => existsSync(resolve(p, directory)));
    if (!root) throw new Error('Pasta dos schemas oficiais não encontrada.');
    for (const [type, name] of [[1, 'urbanos'], [2, 'rurais']] as const) {
      const schema = JSON.parse(readFileSync(resolve(root, directory, `imoveis-${name}-onr.schema.json`), 'utf8'));
      this.validators.set(type, ajv.compile(schema.properties.imoveis.items));
      this.roots.set(type, ajv.compile({...schema, $id: undefined, properties: {...schema.properties, imoveis: {type: 'array', minItems: 1}}}));
    }
  }
  parse(raw: unknown) {
    if (typeof raw === 'string') raw = raw.replace(/^\uFEFF/, '');
    if (typeof raw !== 'string') throw new BadRequestException('Envie o conteúdo do arquivo JSON.');
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new BadRequestException('JSON inválido. Verifique a sintaxe do arquivo.'); }
    if (!object(data) || !Array.isArray(data.imoveis)) throw new BadRequestException('Esperado um objeto com a lista "imoveis". Envie uma amostra se seu arquivo usa outro formato.');
    const tree = parseTree(raw)!;
    function duplicates(node: JsonNode) {
      if (node.type === 'object') {
        const keys = node.children?.map(p => p.children![0].value) ?? [];
        if (new Set(keys).size !== keys.length) throw new BadRequestException('O JSON contém chaves duplicadas. Corrija antes de auditar.');
      }
      node.children?.forEach(duplicates);
    }
    duplicates(tree);
    return {data, tree, raw};
  }
  validateClassifications(raw:unknown,changes:unknown={}) {
    const {data}=this.parse(raw);
    if(changes===undefined)changes={};
    if(!changes||typeof changes!=='object'||Array.isArray(changes))throw new BadRequestException('Alterações de classificação inválidas.');
    const result:Record<number,number>={};
    for(const [key,value] of Object.entries(changes)){
      const index=Number(key);
      if(!/^\d+$/.test(key)||!Number.isSafeInteger(index)||String(index)!==key||index>=data.imoveis.length||!object(data.imoveis[index]))throw new BadRequestException('A classificação referencia um ato inexistente ou inválido.');
      if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>6)throw new BadRequestException('A classificação do ato deve ser um código entre 1 e 6.');
      result[index]=value;
    }
    return result;
  }
  private classifiedRaw(raw:unknown,changes:unknown={}) {
    const source=this.parse(raw);
    const classifications=this.validateClassifications(raw,changes);
    let output=source.raw;
    for(const [index,code] of Object.entries(classifications)){
      output=applyEdits(output,modify(output,['imoveis',Number(index),'ato'],code,{}));
    }
    return output;
  }
  private issues(errors: ErrorObject[] | null | undefined) {
    return (errors ?? []).map(e => ({path: (e.instancePath + (e.keyword === 'required' ? '/' + e.params.missingProperty : e.keyword === 'additionalProperties' ? '/' + e.params.additionalProperty : '')) || '/', rule: e.keyword, message: describeError(e), source: `Anexo II · ${e.schemaPath}`}));
  }
  audit(raw: unknown, classifications:unknown={}) {
    const original=this.parse(raw);
    const {data} = this.parse(this.classifiedRaw(raw,classifications));
    const root = this.roots.get(1)!;
    root(data);
    const rootIssues = this.issues(root.errors);
    const items = data.imoveis.map((item: unknown, index: number) => {
      const value = object(item) ? item : {};
      const validator = this.validators.get(value.tipo_imovel);
      const valid = validator ? !!validator(item) : false;
      const rawErrors = validator?.errors ? [...validator.errors] : [];
      const issues = validator ? this.issues(prioritizeErrors(rawErrors)) : [{path: '/tipo_imovel', rule: 'type', message: 'Informe tipo_imovel 1 (urbano) ou 2 (rural).', source: 'Anexo I · Regras gerais'}];
      const legacy = value.motivo_envio === 2;
      const acts: Record<number,string> = {1:'Abertura de matrícula',2:'Abertura de ofício / decisão judicial',3:'Alteração da relação jurídica',4:'Transmissão / aquisição de direitos reais',5:'Alteração do imóvel',6:'Outro'};
      return {index, originalAct: original.data.imoveis[index]?.ato ?? null, act: acts[value.ato] ?? 'Ato não informado', actNumber: String(value.numero_ato ?? ''), actDate: String(value.data_ato ?? ''), actType: value.tipo_ato === 1 ? 'Registro' : value.tipo_ato === 2 ? 'Averbação' : 'Não informado', rawIssues: this.issues(rawErrors), recordType: value.tipo_matricula_transcricao === 1 ? 'Matrícula' : value.tipo_matricula_transcricao === 2 ? 'Transcrição' : 'Tipo de registro não informado', label: String((value.tipo_matricula_transcricao === 1 ? value.numero_matricula : value.tipo_matricula_transcricao === 2 ? value.numero_transcricao : undefined) ?? 'Número não informado'), type: value.tipo_imovel === 1 ? 'Urbano' : value.tipo_imovel === 2 ? 'Rural' : 'Desconhecido', reason: legacy ? 'Acervo' : value.motivo_envio === 1 ? 'Novo ato' : 'Não informado', status: valid ? 'valid' : legacy ? 'review' : 'invalid', documentationNotes: documentationNotes(value), issues: issues.map(issue => ({...issue, ...classifyIssue(issue, value), explanation: explainRequirement(issue.path, value)})), guidance: legacy ? 'Acervo: revisar o enquadramento e a flexibilização do art. 3º-A, §3º. Divergências no schema não determinam exclusão automática.' : 'Conferir o enquadramento do ato no Anexo I. A validade estrutural não determina a obrigação de comunicar.', data: item};
    });
    return {rootIssues, items, schemaVersion: '1.3.0'};
  }
  export(raw: unknown, excluded: unknown, classifications:unknown={}) {
    const parsed = this.parse(this.classifiedRaw(raw,classifications));
    if (!Array.isArray(excluded) || excluded.some(i => !Number.isInteger(i) || i < 0 || i >= parsed.data.imoveis.length)) throw new BadRequestException('Índices de exclusão inválidos.');
    const remove = new Set(excluded);
    const array = findNodeAtLocation(parsed.tree, ['imoveis'])!;
    const kept = (array.children ?? []).filter((_, i) => !remove.has(i));
    if (!kept.length) throw new BadRequestException('Selecione pelo menos um imóvel. A ausência de atos é comunicada pelo módulo do Mapa, não por JSON vazio.');
    if (!remove.size) return parsed.raw;
    return parsed.raw.slice(0, array.offset) + '[\n' + kept.map(n => parsed.raw.slice(n.offset, n.offset + n.length)).join(',\n') + '\n]' + parsed.raw.slice(array.offset + array.length);
  }
}
