import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { CoreService } from '../../services/core.js';
import type { Identity } from '../../services/auth.js';
import { parse, uuid, loginSchema, propertyQuery } from '../../schemas/http.js';
import { DomainError } from '../../domain/errors.js';

export function apiRouter(service:CoreService):Router {
  const router=Router();
  const id=(req:Request,name:string)=>parse(uuid,req.params[name]);
  const identity=(res:Response)=>res.locals.identity as Identity|null;
  router.use(async(req,res,next)=>{
    res.locals.identity=req.method==='POST'&&req.path==='/auth/sessions'?null:await service.auth.identify(req.headers.authorization);
    next();
  });
  router.post('/auth/sessions',async(req,res)=>{
    const input=parse(loginSchema,req.body);
    const result=await service.auth.login(input,req.ip??'unknown');res.setHeader('Cache-Control','no-store');res.json({data:result});
  });
  router.get('/auth/session',async(_req,res)=>{
    const auth=identity(res);service.user(auth);
    res.setHeader('Cache-Control','no-store');res.json({data:{profile:await service.auth.profile(auth!.userId),expiresAt:auth!.expiresAt.toISOString()}});
  });
  router.delete('/auth/sessions/current',async(_req,res)=>{const auth=identity(res);service.user(auth);await service.auth.logout(auth!);res.json({data:null});});
  router.get('/me/profile',async(req,res)=>{parse(z.object({}).strict(),req.query);res.setHeader('Cache-Control','no-store');res.json({data:await service.auth.profile(service.user(identity(res)))});});
  router.get('/properties/count',async(req,res)=>{
    const query=parse(propertyQuery.omit({cursor:true,limit:true}),req.query);
    res.json(await service.properties.search({...query,limit:20},identity(res)?.userId??null,true));
  });
  router.get('/properties',async(req,res)=>res.json(await service.properties.search(parse(propertyQuery,req.query),identity(res)?.userId??null)));
  router.get('/catalog/locations',async(req,res)=>{
    const query=parse(z.object({provinceCode:z.string().min(1).max(64).optional()}).strict(),req.query);
    res.json({data:await service.catalog(identity(res),query.provinceCode)});
  });
  router.get('/properties/:propertyId',async(req,res)=>res.json({data:await service.read(identity(res),c=>service.properties.get(c,id(req,'propertyId')))}));
  router.put('/properties/:propertyId/saved',async(req,res)=>{parse(z.object({}).strict(),req.body??{});res.json({data:await service.savedProperty(identity(res),id(req,'propertyId'),true)});});
  router.delete('/properties/:propertyId/saved',async(req,res)=>res.json({data:await service.savedProperty(identity(res),id(req,'propertyId'),false)}));
  router.get('/properties/:propertyId/legal',async(req,res)=>res.json({data:await service.read(identity(res),c=>service.properties.legal(c,id(req,'propertyId')))}));
  router.post('/properties/:propertyId/documents/:documentId/download',async(req,res)=>{
    parse(z.object({}).strict(),req.body??{});
    const data=await service.read(identity(res),c=>service.properties.download(c,id(req,'propertyId'),id(req,'documentId'),identity(res)?.userId??null));res.json({data});
  });
  router.get('/properties/:propertyId/area',async(req,res)=>{
    const query=parse(z.object({category:z.enum(['utility','traffic','living']).optional()}).strict(),req.query);
    res.json({data:await service.read(identity(res),c=>service.properties.area(c,id(req,'propertyId'),query.category))});
  });
  router.get('/properties/:propertyId/share',async(req,res)=>res.json({data:await service.share(identity(res),'properties',id(req,'propertyId'))}));
  // Explicit policy gates exist before a provider/calculator implementation.
  router.post('/finance/estimates',()=>{throw new DomainError(409,'FEATURE_NOT_ENABLED','SPEC-001 chưa được khóa');});
  router.post('/me/finance-plans',(_req,res)=>{service.user(identity(res));throw new DomainError(409,'FEATURE_NOT_ENABLED','SPEC-001 chưa được khóa');});
  return router;
}
