import {BadRequestException} from '@nestjs/common';
export type Registry='1RIGO'|'2RIGO';
export function requireRegistry(value:unknown):Registry{
 if(value!=='1RIGO'&&value!=='2RIGO')throw new BadRequestException('Selecione o cartório: 1RIGO ou 2RIGO.');
 return value;
}
