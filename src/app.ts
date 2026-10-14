import { randomUUID } from 'node:crypto';
import express from 'express';
import type { ErrorRequestHandler } from 'express';

export interface AppDependencies {
  checkReadiness: () => Promise<boolean>;
}

export function createApp(deps: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId as string);
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/health/live', (_req, res) => res.json({ data: { status: 'live' } }));
  app.get('/health/ready', async (_req, res) => {
    const ready = await deps.checkReadiness().catch(() => false);
    res.status(ready ? 200 : 503).json({ data: { status: ready ? 'ready' : 'not_ready' } });
  });
  app.use((_req, res) => res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Resource not found' },
    requestId: res.locals.requestId,
  }));
  const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    void _next; // Express identifies an error handler by its four arguments.
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
