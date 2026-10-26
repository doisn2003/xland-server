import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { sharingConfig } from './sharing/config.js';
import { sharingRouter } from './sharing/routes.js';
import { configuredExtendedAuth } from './auth/config.js';
import { geoapifyConfig } from './maps/geoapify_config.js';
import { GeoapifyAreaMapService, geoapifyTileRouter } from './maps/geoapify_maps.js';
import { PostgresMapStore } from './maps/geoapify_store.js';
import { planningConfig, PlanningMapService, PlanningAreaMapProvider, planningTileRouter } from './maps/planning_maps.js';
import { createApp } from './app.js';
import { Database } from './repositories/database.js';
import { AuthService } from './services/auth.js';
import { CoreService } from './services/core.js';
import { CursorCodec } from './services/cursor.js';
import { apiRouter } from './routes/v1/api.js';
import { databaseTarget } from './config/database-target.js';
import { trustedProxyHops } from './config/environment.js';
import { adminRouter } from './admin/router.js';

export async function runtime(env:NodeJS.ProcessEnv) {
  if(env.XLAND_API_MODE==='bootstrap')return {app:createApp({checkReadiness:async()=>false}),close:async()=>{}};
  const target=databaseTarget(env,env.NODE_ENV==='test');
  if(!env.CURSOR_SECRET||Buffer.byteLength(env.CURSOR_SECRET)<32)throw new Error('Persistent CURSOR_SECRET of at least 32 bytes is required');
  const sharing=sharingConfig(env);
  const db=new Database(target.connectionString);
  const auth=new AuthService(db);await auth.initialize();
  const service=new CoreService(db,auth,new CursorCodec(env.CURSOR_SECRET?Buffer.from(env.CURSOR_SECRET):randomBytes(32)),()=>new Date(),sharing.publicBaseUrl);
  const maps=new GeoapifyAreaMapService(geoapifyConfig(env),new PostgresMapStore(db));
  const planning=new PlanningMapService(planningConfig(env));
  const publicPages=Router().use(sharingRouter(service,sharing)).use(geoapifyTileRouter(maps)).use(planningTileRouter(planning));
  const api=Router().use('/admin',await adminRouter(db,auth,env)).use(apiRouter(service,(env.AVATAR_ORIGINS??'').split(',').filter(Boolean),configuredExtendedAuth(db,auth,env),new PlanningAreaMapProvider(maps,planning)));
  return {app:createApp({checkReadiness:()=>db.ready(),api,publicPages,allowedOrigins:(env.CORS_ORIGINS??'').split(',').filter(Boolean),trustProxyHops:trustedProxyHops(env)}),close:()=>db.close()};
}
