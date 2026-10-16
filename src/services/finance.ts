import type{z}from'zod';
import type{PoolClient}from'pg';
import type{CoreService}from'./core.js';
import type{Identity}from'./auth.js';
import type{Wire}from'../repositories/properties.js';
import{financeInput,parse}from'../schemas/http.js';
import{DomainError,missing}from'../domain/errors.js';

export type FinanceInput=z.infer<typeof financeInput>;
export const formulaVersion='xland-loan-v1';
export const roundingRule='VND_HALF_UP_MONTHLY_LAST_ADJUST';
export interface Installment{month:number;principalVnd:string;interestVnd:string;paymentVnd:string;balanceVnd:string}
const maximum=99999999999999999999n;
const halfUp=(numerator:bigint,denominator:bigint):bigint=>(numerator*2n+denominator)/(denominator*2n);
function checked(value:bigint):string{
  if(value<0n||value>maximum)throw new DomainError(400,'INVALID_INPUT','Kết quả vượt giới hạn VND, hãy điều chỉnh khoản vay',[{field:'loanVnd',code:'FINANCE_RESULT_OUT_OF_RANGE'}]);
  return value.toString();
}
/** A-06 exact rational calculation. No oracle/data file is imported by application code. */
export function amortize(raw:FinanceInput):{result:Wire;schedule:Installment[]}{
  const input=parse(financeInput,raw);const principal=BigInt(input.loanVnd),n=input.termMonths;
  const [whole,fraction='']=input.annualRatePercent.split('.');const rateNumerator=BigInt(whole!+fraction),rateDenominator=1200n*10n**BigInt(fraction.length);
  let standard:bigint;
  if(input.method==='declining_balance'||rateNumerator===0n)standard=halfUp(principal,BigInt(n));
  else{
    const power=(rateDenominator+rateNumerator)**BigInt(n);const denominatorPower=rateDenominator**BigInt(n);
    standard=halfUp(principal*rateNumerator*power,rateDenominator*(power-denominatorPower));
  }
  let balance=principal,totalInterest=0n,totalPrincipal=0n,totalPayments=0n;const schedule:Installment[]=[];
  for(let month=1;month<=n;month++){
    const interest=halfUp(balance*rateNumerator,rateDenominator);
    let paidPrincipal:bigint;
    if(month===n)paidPrincipal=balance;
    else{const target=input.method==='declining_balance'?standard:standard>interest?standard-interest:0n;paidPrincipal=target<balance?target:balance;}
    const payment=paidPrincipal+interest;balance-=paidPrincipal;totalInterest+=interest;totalPrincipal+=paidPrincipal;totalPayments+=payment;
    schedule.push({month,principalVnd:checked(paidPrincipal),interestVnd:checked(interest),paymentVnd:checked(payment),balanceVnd:checked(balance)});
  }
  if(balance!==0n||totalPrincipal!==principal||totalPayments!==principal+totalInterest)throw new Error('Finance schedule invariant failed');
  const first=schedule[0]!;
  const result:Wire={input,monthlyPaymentVnd:first.paymentVnd,firstMonthPrincipalVnd:first.principalVnd,firstMonthInterestVnd:first.interestVnd,totalInterestVnd:checked(totalInterest),totalRepaymentVnd:checked(totalPayments),formulaVersion,roundingRule,estimateNotice:'Ước tính minh họa; không phải đề nghị cấp tín dụng; chưa gồm phí, thuế, bảo hiểm'};
  return{result,schedule};
}
export class FinanceService{
  constructor(readonly core:CoreService){}
  private async price(c:PoolClient,input:FinanceInput,lock:boolean):Promise<string>{
    const row=(await c.query(`SELECT id,price_total FROM xland.properties WHERE id=$1${lock?' FOR SHARE':''}`,[input.propertyId])).rows[0];if(!row)missing();
    if(BigInt(input.equityVnd)+BigInt(input.loanVnd)!==BigInt(row.price_total))throw new DomainError(400,'INVALID_INPUT','Giá hiện hành đã thay đổi hoặc vốn/vay không khớp; hãy tải lại giá',[{field:'equityVnd',code:'PRICE_MISMATCH'},{field:'loanVnd',code:'PRICE_MISMATCH'}]);
    return row.price_total as string;
  }
  async estimate(identity:Identity|null,input:FinanceInput):Promise<Wire>{return this.core.read(identity,async c=>{await this.price(c,input,false);return amortize(input).result;});}
  async save(identity:Identity|null,label:string,input:FinanceInput,key:string):Promise<Wire>{this.core.user(identity);return this.core.write(identity,c=>this.core.idempotent(c,identity!,'N02',key,{label,input},async()=>{
    const price=await this.price(c,input,true);const result=amortize(input).result;const id=this.core.newId();
    const row=(await c.query(`INSERT INTO xland.saved_finance_plans(id,user_id,property_id,label,input,price_snapshot,result,formula_version,rounding_rule)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING created_at`,[id,this.core.user(identity),input.propertyId,label,JSON.stringify(input),price,JSON.stringify(result),formulaVersion,roundingRule])).rows[0];
    return{id,data:{id,propertyId:input.propertyId,label,input,result,createdAt:row.created_at.toISOString()}};
  }));}
}
