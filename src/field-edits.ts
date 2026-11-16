import {BadRequestException} from '@nestjs/common';
import {applyEdits,findNodeAtLocation,modify,parseTree} from 'jsonc-parser';

export type FieldEdit={index?:number;path:string;value:string|null};

export function applyFieldEdits(raw:string,edits:unknown=[]):{raw:string;edits:FieldEdit[]} {
 if(!Array.isArray(edits))throw new BadRequestException('Correções de campos inválidas.');
 const validated:FieldEdit[]=[];
 for(const edit of edits){
  if(!edit||typeof edit.path!=='string'||!edit.path.startsWith('/')||
   (edit.index!==undefined&&(!Number.isSafeInteger(edit.index)||edit.index<0))||
   (edit.value!==null&&typeof edit.value!=='string')){
   throw new BadRequestException('Correção de campo inválida.');
  }
  const parts:string[]=edit.path==='/'?[]:edit.path.slice(1).split('/').map((part:string)=>part.replaceAll('~1','/').replaceAll('~0','~'));
  if((edit.index===undefined&&(!parts.length||parts[0]==='imoveis'))||
   parts.some(part=>!part||['__proto__','constructor','prototype'].includes(part))||
   (!parts.length&&edit.value===null)){
   throw new BadRequestException('Este campo não pode ser alterado por esta correção.');
  }
  const tree=parseTree(raw)!;
  const path:(string|number)[]=edit.index===undefined?[]:['imoveis',edit.index];
  let node=findNodeAtLocation(tree,path);
  if(!node)throw new BadRequestException('A correção referencia um ato inexistente.');
  for(const part of parts){
   if(node?.type==='array'&&/^(0|[1-9]\d*)$/.test(part)&&Number(part)<=(node.children?.length??0)){
    path.push(Number(part));
   }else if(node?.type==='object'){
    path.push(part);
   }else{
    throw new BadRequestException('Corrija primeiro a estrutura que contém este campo.');
   }
   node=findNodeAtLocation(tree,path);
  }
  if(edit.value===null){
   if(node)raw=applyEdits(raw,modify(raw,path,undefined,{}));
  }else{
   try{JSON.parse(edit.value);}catch{throw new BadRequestException('O valor informado tem formato inválido.');}
   if(!node){
    raw=applyEdits(raw,modify(raw,path,false,{}));
    node=findNodeAtLocation(parseTree(raw)!,path);
   }
   if(!node)throw new BadRequestException('Campo inexistente.');
   raw=raw.slice(0,node.offset)+edit.value.trim()+raw.slice(node.offset+node.length);
  }
  validated.push({index:edit.index,path:edit.path,value:edit.value});
 }
 return {raw,edits:validated};
}
