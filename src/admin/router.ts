import {Router} from 'express';
import {z} from 'zod';
import type {Database} from '../repositories/database.js';
import type {AuthService,Identity} from '../services/auth.js';
import {parse,uuid} from '../schemas/http.js';
import {AdminAuth} from './auth.js';
import {AdminService} from './service.js';
import {AdminStorage} from './storage.js';
import {authorizeUpload,finalizeUpload} from './uploads.js';

export async function adminRouter(db:Database,auth:AuthService,env:NodeJS.ProcessEnv){
  const router=Router(),access=new AdminAuth(db,auth),service=new AdminService(db),storage=new AdminStorage(env);
  await access.initialize();
  router.post('/session',async(req,res)=>{
    const data=parse(z.object({username:z.string().min(1).max(64),password:z.string().min(1).max(128)}).strict(),req.body);
    res.json({data:await access.login(data.username,data.password,req.ip??'unknown')});
  });
  router.use(async(req,res,next)=>{res.locals.admin=await access.require(await auth.identify(req.headers.authorization));next();});
  const identity=(res:{locals:Record<string,unknown>})=>res.locals.admin as Identity;
  router.get('/session',async(_req,res)=>res.json({data:{profile:await auth.profile(identity(res).userId),role:'admin'}}));
  router.delete('/session',async(_req,res)=>{await auth.logout(identity(res));res.json({data:null});});
  router.get('/schema',async(_req,res)=>res.json({data:await service.schema(identity(res))}));
  router.get('/overview',async(_req,res)=>res.json({data:await service.overview(identity(res))}));
  router.get('/locations',async(_req,res)=>res.json({data:await service.locations(identity(res))}));
  router.get('/lookups/:entity',async(req,res)=>{
    const q=parse(z.object({q:z.string().max(150).default(''),id:uuid.optional()}).strict(),req.query);
    res.json({data:await service.lookup(identity(res),String(req.params.entity),q.q,q.id)});
  });
  router.post('/uploads',async(req,res)=>{
    const q=parse(z.object({mimeType:z.string().max(100),size:z.number().int().positive(),privateDocument:z.boolean().default(false)}).strict(),req.body);
    const data=await service.transaction(identity(res),async c=>{
      const result=await authorizeUpload(c,identity(res),storage,q.mimeType,q.size,q.privateDocument);
      await service.audit(c,identity(res),'upload-authorized','storage',result.uploadId,[q.mimeType]);return result;
    });
    res.json({data});
  });
  router.post('/uploads/finalize',async(req,res)=>{
    const q=parse(z.object({uploadId:uuid}).strict(),req.body);
    const data=await service.transaction(identity(res),async c=>{
      const result=await finalizeUpload(c,identity(res),storage,q.uploadId);
      await service.audit(c,identity(res),'upload-verified','storage',q.uploadId,[]);return result;
    });
    res.json({data});
  });
  router.get('/:entity',async(req,res)=>{
    const q=parse(z.object({q:z.string().max(150).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(50).default(25),filter:z.string().max(50).optional(),value:z.string().max(150).optional()}).strict(),req.query);
    res.json({data:await service.list(identity(res),String(req.params.entity),q)});
  });
  router.get('/:entity/:id',async(req,res)=>res.json({data:await service.get(identity(res),String(req.params.entity),parse(uuid,req.params.id))}));
  router.post('/:entity',async(req,res)=>res.status(201).json({data:await service.save(identity(res),String(req.params.entity),parse(z.record(z.string(),z.unknown()),req.body))}));
  router.patch('/:entity/:id',async(req,res)=>res.json({data:await service.save(identity(res),String(req.params.entity),parse(z.record(z.string(),z.unknown()),req.body),parse(uuid,req.params.id))}));
  return router;
}
