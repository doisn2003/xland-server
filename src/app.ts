import { randomUUID } from 'node:crypto';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import type { Router } from 'express';
import { DomainError } from './domain/errors.js';

export interface AppDependencies {
  checkReadiness: () => Promise<boolean>;
  api?: Router;
  publicPages?: Router;
  allowedOrigins?: readonly string[];
  trustProxyHops?: 0 | 1;
}

export function createApp(deps: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxyHops ?? 0);
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId as string);
    next();
  });
  // A 5 MiB avatar uses up to 6.67 MiB as base64. Other endpoints keep 64 KiB.
  app.use('/api/v1/me/profile',express.json({limit:'7mb'}));
  app.use(express.json({ limit: '64kb' }));
  app.use((req,res,next)=>{
    const origin=req.headers.origin;
    if(origin&&(deps.allowedOrigins??[]).includes(origin)){
      res.setHeader('Access-Control-Allow-Origin',origin);res.vary('Origin');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,Idempotency-Key');
      res.setHeader('Access-Control-Expose-Headers','X-Request-Id,Retry-After');
    }
    if(req.method==='OPTIONS'){
      if(!origin||!(deps.allowedOrigins??[]).includes(origin)){res.status(403).json({error:{code:'FORBIDDEN',message:'Origin is not configured'},requestId:res.locals.requestId});return;}
      res.sendStatus(204);return;
    }
    next();
  });
  app.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  app.get('/health/live', (_req, res) => res.json({ data: { status: 'live' } }));
  app.get('/health/ready', async (_req, res) => {
    const ready = await deps.checkReadiness().catch(() => false);
    res.status(ready ? 200 : 503).json({ data: { status: ready ? 'ready' : 'not_ready' } });
  });
  if(deps.publicPages)app.use(deps.publicPages);
  if(deps.api)app.use('/api/v1',deps.api);
  app.use((_req, res) => res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Resource not found' },
    requestId: res.locals.requestId,
  }));
  const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    void _next; // Express identifies an error handler by its four arguments.
    if(err instanceof DomainError){
      if(err.status===429)res.setHeader('Retry-After','60');
      res.status(err.status).json({error:{code:err.code,message:err.message,...(err.details?{details:err.details}:{})},requestId:res.locals.requestId});return;
    }
    const status = typeof err === 'object' && err !== null && 'status' in err ? err.status : undefined;
    const inputError = status === 400 || status === 413;
    res.status(inputError ? status : 500).json({
      error: {
        code: status === 413 ? 'PAYLOAD_TOO_LARGE' : inputError ? 'INVALID_INPUT' : 'INTERNAL_ERROR',
        message: inputError ? 'Invalid request body' : 'Internal server error',
      },
      requestId: res.locals.requestId,
    });
  };
  app.use(errorHandler);
  return app;
}
