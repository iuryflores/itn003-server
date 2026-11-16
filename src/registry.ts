import {BadRequestException} from '@nestjs/common';
export type Registry='1RIGO'|'2RIGO'|'SENADOR_CANEDO';
export function requireRegistry(value:unknown):Registry{
 if(value!=='1RIGO'&&value!=='2RIGO'&&value!=='SENADOR_CANEDO')throw new BadRequestException('Selecione o cartório na lista.');
 return value;
}
