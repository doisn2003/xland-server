import { Router } from 'express';
import { z } from 'zod';
import type { ExtendedAuthService } from './extended-auth.js';
import { DomainError } from '../domain/errors.js';
import { parse } from '../schemas/http.js';

/** Mount before legacy identity middleware: auth proof must not use a stale bearer. */
export function extendedAuthRouter(service:ExtendedAuthService):Router {
  const router=Router();
  const noQuery=z.object({}).strict();
  router.get('/auth/capabilities',(req,res)=>{
    parse(noQuery,req.query);res.setHeader('Cache-Control','no-store');res.json({data:service.capabilities()});
  });
  router.post('/auth/google/sessions',async(req,res)=>{
    parse(noQuery,req.query);
    const input=parse(z.object({idToken:z.string().min(1).max(8192)}).strict(),req.body);
    res.json({data:await service.googleSession(input.idToken,req.ip??'unknown')});
  });
  router.post('/auth/phone/challenges',async(req,res)=>{
    parse(noQuery,req.query);
    const input=parse(z.object({phone:z.string().min(1).max(40)}).strict(),req.body);
    const key=parse(z.string().regex(/^[\x21-\x7e]{16,128}$/),req.headers['idempotency-key']);
    if(!service.phone)throw new DomainError(503,'FEATURE_NOT_ENABLED','Đăng nhập số điện thoại chưa sẵn sàng.');
    res.json({data:await service.phone.request(input.phone,req.ip??'unknown',key)});
  });
  router.post('/auth/phone/sessions',async(req,res)=>{
    parse(noQuery,req.query);
    const input=parse(z.object({challengeId:z.uuid(),code:z.string().regex(/^\d{6}$/)}).strict(),req.body);
    if(!service.phone)throw new DomainError(503,'FEATURE_NOT_ENABLED','Đăng nhập số điện thoại chưa sẵn sàng.');
    res.json({data:await service.phone.verify(input.challengeId,input.code,req.ip??'unknown')});
  });
  return router;
}
