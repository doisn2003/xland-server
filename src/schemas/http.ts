import { z } from 'zod';
import { invalid } from '../domain/errors.js';
export const uuid=z.string().uuid();
export const money=z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
export const decimal=z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/);
export const text=(max:number)=>z.string().trim().min(1).max(max).refine(v=>!/[<>\u0000]/.test(v));
export const phone=z.string().regex(/^(\+[1-9][0-9]{8,14}|0[0-9]{9})$/).transform(v=>v.startsWith('0')?'+84'+v.slice(1):v);
export const loginSchema=z.object({username:z.string().min(1).max(256),password:z.string().min(1).max(512)}).strict();
export function parse<T>(schema:z.ZodType<T>,input:unknown):T {
  const result=schema.safeParse(input);
  if(!result.success)invalid(result.error.issues[0]?.path.join('.')||'request');
  return result.data;
}
export const pagination=z.object({cursor:z.string().max(4096).optional(),limit:z.coerce.number().int().min(1).max(50).default(20)});
const csv=(values:readonly string[])=>z.string().transform(s=>s.split(',')).refine(a=>a.length>0&&new Set(a).size===a.length&&a.every(s=>values.includes(s)));
export const propertyQuery=pagination.extend({query:text(100).optional(),regions:csv(['north','central','south']).optional(),category:z.enum(['residential','industrial','agricultural','other']).optional(),provinceCode:text(64).optional(),districtCode:text(64).optional(),communeCode:text(64).optional(),minPriceVnd:money.optional(),maxPriceVnd:money.optional(),areaBands:csv(['below_100','from_100_to_200','above_200']).optional(),landTypes:csv(['residential','industrial','agricultural','other']).optional(),minRoadWidthM:decimal.optional(),hasDocuments:z.enum(['true','false']).optional(),savedOnly:z.enum(['true','false']).default('false'),sort:z.enum(['relevant','newest','price_asc','price_desc','area_asc']).default('relevant')}).strict();
export type PropertyQuery=z.infer<typeof propertyQuery>;
export const feedQuery=pagination.extend({feedScope:z.enum(['recommended','following']).default('recommended'),region:z.enum(['north','central','south']).optional(),category:z.enum(['residential','industrial','agricultural','other']).optional()}).strict();
export const bookingInput=z.object({propertyId:uuid,slotId:uuid,sourceVideoId:uuid.nullable().optional(),attendeeCount:z.number().int().min(1).max(100),transportMode:z.enum(['self_arranged','needs_assistance']),requestDocuments:z.boolean(),requestLoanAdvice:z.boolean(),contactName:text(100),contactPhone:phone,note:text(2000).nullable().optional()}).strict();
export const supportInput=z.object({kind:z.enum(['chat','legal_review','loan_advice','consultant_appointment','location_inquiry']),propertyId:uuid.nullable().optional(),consultantId:uuid.nullable().optional(),message:text(2000),contactName:text(100),contactPhone:phone,consentToShareContact:z.literal(true)}).strict();
const optionalProfileText=(max:number)=>z.string().trim().max(max).refine(v=>!/[<>\u0000]/.test(v));
export const profileInput=z.object({
  displayName:optionalProfileText(100).optional(),
  avatarUrl:z.url().nullable().optional(),
  avatar:z.object({mimeType:z.enum(['image/jpeg','image/png','image/webp']),bytesBase64:z.string().min(1).max(6990508)}).strict().optional(),
  contactPhone:z.union([phone,z.literal('').transform(()=>null)]).nullable().optional(),
  address:optionalProfileText(500).nullable().optional(),
}).strict().refine(v=>!(v.avatar!==undefined&&v.avatarUrl!==undefined),{path:['avatar'],message:'Không thể vừa tải vừa đặt hoặc xóa ảnh đại diện'});
export const settingsInput=z.object({notificationConsent:z.boolean().optional(),feedAutoplay:z.boolean().optional(),feedMutedByDefault:z.boolean().optional()}).strict().refine(v=>Object.keys(v).length>0);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;});
export const dates=z.object({fromDate:date,toDate:date}).strict().refine(v=>{const delta=Date.parse(v.toDate)-Date.parse(v.fromDate);return delta>=0&&delta<31*86400000;});
export const registrationInput=z.object({contactName:text(100),contactPhone:phone,attendeeCount:z.number().int().min(1).max(100)}).strict();
export const changeInput=z.object({reason:text(2000),requestedSlotId:uuid.optional()}).strict();
export const bookingStatuses=['draft','awaiting_deposit','pending_confirmation','confirmed','completed','expired','cancel_requested','cancelled','reschedule_requested','rejected','no_show'] as const;
export const financeInput=z.object({propertyId:uuid,equityVnd:money,loanVnd:money,termMonths:z.number().int().min(60).max(360).refine(v=>v%12===0),annualRatePercent:decimal.refine(v=>Number(v)<=100),method:z.enum(['equal_installment','declining_balance'])}).strict();
