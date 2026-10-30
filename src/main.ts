import 'reflect-metadata';
import { Body, Controller, Get, Inject, Module, Param, Post, Query, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuditService } from './audit.service';
import { LegacyService } from './legacy.service';
import { PreparationService } from './preparation.service';
@Controller('api')
class AuditController {
  constructor(@Inject(AuditService) private readonly service: AuditService) {}
  @Get('field-guide') fieldGuide(){return this.service.fieldGuide();}
  @Post('audit') audit(@Body() body: {raw?: unknown;classifications?:unknown;taxOverrides?:unknown}) { return this.service.audit(body.raw,body.classifications,body.taxOverrides); }
  @Post('export') export(@Body() body: {raw?: unknown; excluded?: unknown;classifications?:unknown;taxOverrides?:unknown}, @Res() response: any) {
    const result = this.service.export(body.raw, body.excluded,body.classifications,body.taxOverrides);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="itn003-auditado.json"');
    response.send(result);
  }
}
@Controller('api/legacy')
class LegacyController {
  constructor(@Inject(LegacyService) private readonly service:LegacyService, @Inject(AuditService) private readonly auditService:AuditService) {}
  @Get('status') status(@Query('registry') registry?:string){return this.service.status(registry);}
  @Get('acts/:id/minute') async minute(@Param('id') id:string,@Query('registry') registry:string,@Res({passthrough:true}) response:any){response.setHeader('Cache-Control','no-store');return this.service.minute(id,registry);}
  @Get('structure') structure(@Query('registry') registry?:string){return this.service.structure(registry);}
  @Post('context') context(@Body() body:{raw?:unknown;registry?:unknown}){return this.service.context(this.auditService.parse(body.raw).data.imoveis,body.registry);}
}
@Controller('api/preparations')
class PreparationController {
 constructor(@Inject(PreparationService) private readonly service:PreparationService){}
 @Get() list(@Res({passthrough:true}) response:any){response.setHeader('Cache-Control','no-store');return this.service.list();}
 @Get(':id') load(@Param('id') id:string,@Res({passthrough:true}) response:any){response.setHeader('Cache-Control','no-store');return this.service.load(id);}
 @Post() save(@Body() body:{preparation?:unknown;id?:unknown;revision?:unknown}){return this.service.save(body.preparation,body.id,body.revision);}
}
@Module({controllers:[AuditController,LegacyController,PreparationController], providers:[AuditService,LegacyService,PreparationService]})
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {bodyParser:false});
  const {json} = await import('express');
  app.use(json({limit:'50mb'}));
  await app.listen(3000, '127.0.0.1');
}
bootstrap();

