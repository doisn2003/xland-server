import { Router } from 'express';
import { extendedAuthRouter } from '../../auth/router.js';
import type { ExtendedAuthService } from '../../auth/extended-auth.js';
import type { AreaMapProvider } from '../../maps/area_map_service.js';
import { areaMapApiRouter } from '../../maps/map_routes.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { CoreService } from '../../services/core.js';
import type { Identity } from '../../services/auth.js';
import { parse, uuid, loginSchema, propertyQuery,profileInput,settingsInput,pagination,supportInput,dates,bookingInput,changeInput,bookingStatuses,feedQuery,registrationInput,text,financeInput } from '../../schemas/http.js';
import { DomainError } from '../../domain/errors.js';
import { AccountService } from '../../services/account.js';
import { BookingService,depositPolicy } from '../../services/bookings.js';
import { SocialService } from '../../services/social.js';
import { CommunityService } from '../../services/community.js';
import { FinanceService } from '../../services/finance.js';
import type { AvatarStorage } from '../../services/avatar-storage.js';

export function apiRouter(service:CoreService,avatarOrigins:readonly string[]=[],extendedAuth?:ExtendedAuthService,areaMaps?:AreaMapProvider,avatars?:AvatarStorage):Router {
  const router=Router();
  if(extendedAuth)router.use(extendedAuthRouter(extendedAuth));
  const accounts=new AccountService(service,avatarOrigins,avatars);const bookings=new BookingService(service);
  const social=new SocialService(service);const community=new CommunityService(service);
  const finance=new FinanceService(service);
  const id=(req:Request,name:string)=>parse(uuid,req.params[name]);
  const identity=(res:Response)=>res.locals.identity as Identity|null;
  const key=(req:Request)=>parse(z.string().regex(/^[\x21-\x7e]{16,128}$/),req.headers['idempotency-key']);
  router.use(async(req,res,next)=>{
    res.locals.identity=req.method==='POST'&&(req.path==='/auth/sessions'||req.path==='/auth/register')?null:await service.auth.identify(req.headers.authorization);
    next();
  });
  router.use((req,_res,next)=>{
    if(req.method!=='GET')parse(z.object({}).strict(),req.query);
    if(req.method==='DELETE')parse(z.object({}).strict(),req.body??{});
    if(req.method==='GET'&&![/^\/(properties(\/count)?|feed|clubs|events)$/, /^\/me\/(saved-videos|following|event-registrations|saved-events|bookings|support-requests|finance-plans)$/, /^\/catalog\/locations$/, /^\/properties\/[^/]+\/(availability|area)$/, /^\/consultants\/[^/]+\/(videos|properties|reviews|availability)$/, /^\/authors\/[^/]+\/videos$/, /^\/videos\/[^/]+\/comments$/, /^\/bookings\/[^/]+\/payments$/].some(p=>p.test(req.path)))parse(z.object({}).strict(),req.query);
    next();
  });
  if(areaMaps)router.use(areaMapApiRouter(service,areaMaps));
  router.post('/auth/sessions',async(req,res)=>{
    const input=parse(loginSchema,req.body);
    const result=await service.auth.login(input,req.ip??'unknown');res.setHeader('Cache-Control','no-store');res.json({data:result});
  });
  router.post('/auth/register',async(req,res)=>{
    const input=parse(loginSchema,req.body);
    const result=await service.auth.register(input);res.setHeader('Cache-Control','no-store');res.status(201).json({data:result});
  });
  router.get('/auth/session',async(_req,res)=>{
    const auth=identity(res);service.user(auth);
    res.setHeader('Cache-Control','no-store');res.json({data:{profile:await service.auth.profile(auth!.userId),expiresAt:auth!.expiresAt.toISOString()}});
  });
  router.delete('/auth/sessions/current',async(_req,res)=>{const auth=identity(res);service.user(auth);await service.auth.logout(auth!);res.json({data:null});});
  router.get('/me/profile',async(req,res)=>{parse(z.object({}).strict(),req.query);res.setHeader('Cache-Control','no-store');res.json({data:await service.auth.profile(service.user(identity(res)))});});
  router.get('/feed',async(req,res)=>res.json(await social.feed(identity(res),parse(feedQuery,req.query))));
  router.get('/videos/:videoId',async(req,res)=>res.json({data:await service.read(identity(res),c=>social.get(c,id(req,'videoId')))}));
  router.get('/videos/:videoId/comments',async(req,res)=>res.json(await social.comments(identity(res),id(req,'videoId'),parse(pagination.strict(),req.query))));
  router.post('/videos/:videoId/comments',async(req,res)=>{service.user(identity(res));const input=parse(z.object({text:text(1000)}).strict(),req.body);res.status(201).json({data:await social.createComment(identity(res),id(req,'videoId'),input.text,key(req))});});
  router.delete('/videos/:videoId/comments/:commentId',async(req,res)=>{await social.deleteComment(identity(res),id(req,'videoId'),id(req,'commentId'));res.json({data:null});});
  for(const kind of ['like','saved'] as const){
    router.put(`/videos/:videoId/${kind}`,async(req,res)=>{parse(z.object({}).strict(),req.body??{});res.json({data:await social.state(identity(res),id(req,'videoId'),kind,true)});});
    router.delete(`/videos/:videoId/${kind}`,async(req,res)=>res.json({data:await social.state(identity(res),id(req,'videoId'),kind,false)}));
  }
  router.get('/authors/:authorId',async(req,res)=>res.json({data:await social.authorProfile(identity(res),id(req,'authorId'))}));
  router.get('/authors/:authorId/videos',async(req,res)=>res.json(await social.authorVideos(identity(res),id(req,'authorId'),parse(pagination.strict(),req.query))));
  router.put('/authors/:authorId/follow',async(req,res)=>{parse(z.object({}).strict(),req.body??{});res.json({data:await social.state(identity(res),id(req,'authorId'),'follow',true)});});
  router.delete('/authors/:authorId/follow',async(req,res)=>res.json({data:await social.state(identity(res),id(req,'authorId'),'follow',false)}));
  router.get('/me/saved-videos',async(req,res)=>res.json(await social.saved(identity(res),parse(pagination.strict(),req.query))));
  router.get('/me/following',async(req,res)=>res.json(await social.following(identity(res),parse(pagination.strict(),req.query))));
  router.get('/videos/:videoId/share',async(req,res)=>res.json({data:await service.share(identity(res),'videos',id(req,'videoId'))}));
  router.get('/consultants/:consultantId',async(req,res)=>res.json({data:await community.consultant(identity(res),id(req,'consultantId'))}));
  router.get('/consultants/:consultantId/videos',async(req,res)=>res.json(await social.consultantVideos(identity(res),id(req,'consultantId'),parse(pagination.strict(),req.query))));
  router.get('/consultants/:consultantId/properties',async(req,res)=>res.json(await community.consultantProperties(identity(res),id(req,'consultantId'),parse(pagination.strict(),req.query))));
  router.get('/consultants/:consultantId/reviews',async(req,res)=>res.json(await community.reviews(identity(res),id(req,'consultantId'),parse(pagination.strict(),req.query))));
  router.get('/events',async(req,res)=>res.json(await community.events(identity(res),parse(pagination.extend({status:z.enum(['open','sold_out','closed','cancelled']).optional()}).strict(),req.query))));
  router.get('/events/:eventId',async(req,res)=>res.json({data:await service.read(identity(res),c=>community.get(c,id(req,'eventId')))}));
  router.put('/events/:eventId/saved',async(req,res)=>{parse(z.object({}).strict(),req.body??{});res.json({data:await community.saved(identity(res),id(req,'eventId'),true)});});
  router.delete('/events/:eventId/saved',async(req,res)=>res.json({data:await community.saved(identity(res),id(req,'eventId'),false)}));
  router.post('/events/:eventId/registrations',async(req,res)=>{service.user(identity(res));res.status(201).json({data:await community.register(identity(res),id(req,'eventId'),parse(registrationInput,req.body),key(req))});});
  router.get('/me/event-registrations',async(req,res)=>res.json(await community.registrations(identity(res),parse(pagination.strict(),req.query))));
  router.get('/me/saved-events',async(req,res)=>res.json(await community.events(identity(res),parse(pagination.strict(),req.query),true)));
  router.get('/events/:eventId/share',async(req,res)=>res.json({data:await service.share(identity(res),'events',id(req,'eventId'))}));
  router.patch('/me/profile',async(req,res)=>{service.user(identity(res));res.json({data:await accounts.profile(identity(res),parse(profileInput,req.body))});});
  router.get('/me/settings',async(req,res)=>{parse(z.object({}).strict(),req.query);res.json({data:await accounts.settings(identity(res))});});
  router.patch('/me/settings',async(req,res)=>{service.user(identity(res));res.json({data:await accounts.settings(identity(res),parse(settingsInput,req.body))});});
  router.get('/clubs',async(req,res)=>res.json(await accounts.clubs(identity(res),parse(pagination.strict(),req.query))));
  router.get('/clubs/:clubId',async(req,res)=>res.json({data:await accounts.getClub(identity(res),id(req,'clubId'))}));
  router.post('/support-requests',async(req,res)=>{service.user(identity(res));res.status(201).json({data:await accounts.createSupport(identity(res),parse(supportInput,req.body),key(req))});});
  router.get('/me/support-requests',async(req,res)=>res.json(await accounts.supports(identity(res),parse(pagination.strict(),req.query))));
  router.get('/me/finance-plans',async(req,res)=>res.json(await accounts.plans(identity(res),parse(pagination.strict(),req.query))));
  router.delete('/me/finance-plans/:planId',async(req,res)=>{await accounts.deletePlan(identity(res),id(req,'planId'));res.json({data:null});});
  router.get('/properties/:propertyId/availability',async(req,res)=>res.json({data:await bookings.availability(identity(res),id(req,'propertyId'),parse(dates,req.query))}));
  router.get('/consultants/:consultantId/availability',async(req,res)=>res.json({data:await bookings.availability(identity(res),id(req,'consultantId'),parse(dates,req.query),true)}));
  router.get('/booking-deposit-policy',(_req,res)=>res.json({data:depositPolicy}));
  router.post('/bookings',async(req,res)=>{service.user(identity(res));res.status(201).json({data:await bookings.create(identity(res),parse(bookingInput,req.body),key(req))});});
  router.get('/me/bookings',async(req,res)=>res.json(await bookings.list(identity(res),parse(pagination.extend({status:z.enum(bookingStatuses).optional()}).strict(),req.query))));
  router.get('/bookings/:bookingId',async(req,res)=>{service.user(identity(res));res.json({data:await service.read(identity(res),c=>bookings.get(c,id(req,'bookingId')))});});
  for(const kind of ['cancellation','reschedule'])router.post(`/bookings/:bookingId/${kind}-requests`,async(req,res)=>{
    service.user(identity(res));key(req);const input=parse(changeInput,req.body);
    if((kind==='reschedule'&&!input.requestedSlotId)||(kind==='cancellation'&&input.requestedSlotId))throw new DomainError(400,'INVALID_INPUT','requestedSlotId không hợp lệ cho yêu cầu');
    await bookings.changeGate(identity(res),id(req,'bookingId'));
  });
  router.get('/bookings/:bookingId/payments',async(req,res)=>res.json(await bookings.payments(identity(res),id(req,'bookingId'),parse(pagination.strict(),req.query))));
  router.get('/payments/:paymentId',async(req,res)=>res.json({data:await bookings.getPayment(identity(res),id(req,'paymentId'))}));
  router.post('/payments/:paymentId/refresh',async(req,res)=>{service.user(identity(res));parse(z.object({}).strict(),req.body??{});res.json({data:await bookings.getPayment(identity(res),id(req,'paymentId'))});});
  router.post('/bookings/:bookingId/payment-intents',async(req,res)=>{service.user(identity(res));key(req);parse(z.object({}).strict(),req.body??{});await bookings.paymentGate(identity(res),id(req,'bookingId'));});
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
  router.post('/finance/estimates',async(req,res)=>res.json({data:await finance.estimate(identity(res),parse(financeInput,req.body))}));
  router.post('/me/finance-plans',async(req,res)=>{service.user(identity(res));const input=parse(z.object({label:text(100),input:financeInput}).strict(),req.body);res.status(201).json({data:await finance.save(identity(res),input.label,input.input,key(req))});});
  return router;
}
