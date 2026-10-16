import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { Database } from './repositories/database.js';
import { AuthService } from './services/auth.js';
import { CoreService } from './services/core.js';
import { CursorCodec } from './services/cursor.js';
import { apiRouter } from './routes/v1/api.js';
import { databaseTarget } from './config/database-target.js';

export async function runtime(env:NodeJS.ProcessEnv) {
  if(env.XLAND_API_MODE==='bootstrap')return {app:createApp({checkReadiness:async()=>false}),close:async()=>{}};
  const target=databaseTarget(env,env.NODE_ENV==='test');
  if(env.NODE_ENV==='production'&&!env.CURSOR_SECRET)throw new Error('CURSOR_SECRET is required');
  if(env.PUBLIC_BASE_URL&&!env.PUBLIC_BASE_URL.startsWith('https://'))throw new Error('PUBLIC_BASE_URL requires HTTPS');
  const db=new Database(target.connectionString);
  const auth=new AuthService(db);await auth.initialize();
  const service=new CoreService(db,auth,new CursorCodec(env.CURSOR_SECRET?Buffer.from(env.CURSOR_SECRET):randomBytes(32)),()=>new Date(),env.PUBLIC_BASE_URL);
  return {app:createApp({checkReadiness:()=>db.ready(),api:apiRouter(service),allowedOrigins:(env.CORS_ORIGINS??'').split(',').filter(Boolean)}),close:()=>db.close()};
}
