import{test}from'node:test';
import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{amortize,type FinanceInput}from'../../src/services/finance.js';
import{DomainError}from'../../src/domain/errors.js';
test('A-06 all14 independent oracle vectors: exact amounts, last installment and totals invariants',async t=>{
  const bytes=await readFile('../brain/logs/agent-a/RV-P2-001/finance-v1-vectors.json');assert.equal(createHash('sha256').update(bytes).digest('hex'),'ff21d3080be904c630e9fefd2b4975c9bbdbcd95d673f9e4ee698fa64d7dc330');
  const oracle=JSON.parse(bytes.toString()) as {vectors:Array<FinanceInput&{expected:Record<string,string>;lastPaymentVnd?:string;lastPrincipalVnd?:string;lastInterestVnd?:string;expectedError?:string}>};assert.equal(oracle.vectors.length,14);
  for(const [index,v]of oracle.vectors.entries())await t.test(`${index+1} ${v.method} P=${v.loanVnd} rate=${v.annualRatePercent}`,()=>{
    const input:FinanceInput={propertyId:'00000000-0000-4000-8000-000000000005',equityVnd:'0',loanVnd:v.loanVnd,termMonths:v.termMonths,annualRatePercent:v.annualRatePercent,method:v.method};
    if(v.expected.error){assert.throws(()=>amortize(input),e=>e instanceof DomainError&&e.details?.[0]?.code==='FINANCE_RESULT_OUT_OF_RANGE');return;}
    const {result,schedule}=amortize(input);for(const [key,value]of Object.entries(v.expected))assert.equal(result[key],value,key);
    const last=schedule.at(-1)!;assert.equal(last.paymentVnd,v.lastPaymentVnd);assert.equal(last.principalVnd,v.lastPrincipalVnd);assert.equal(last.interestVnd,v.lastInterestVnd);
    assert.equal(schedule.length,v.termMonths);assert.equal(last.balanceVnd,'0');
    assert.equal(schedule.reduce((sum,row)=>sum+BigInt(row.principalVnd),0n),BigInt(v.loanVnd));
    assert.equal(schedule.reduce((sum,row)=>sum+BigInt(row.paymentVnd),0n).toString(),result.totalRepaymentVnd);
    assert.equal(schedule.reduce((sum,row)=>sum+BigInt(row.interestVnd),0n).toString(),result.totalInterestVnd);
    assert.equal(BigInt(result.firstMonthPrincipalVnd as string)+BigInt(result.firstMonthInterestVnd as string),BigInt(result.monthlyPaymentVnd as string));
  });
});
test('finance rejects malformed/negative/range input without Number money conversion',()=>{
  const base:FinanceInput={propertyId:'00000000-0000-4000-8000-000000000005',equityVnd:'0',loanVnd:'1200000000',termMonths:240,annualRatePercent:'9',method:'equal_installment'};
  for(const patch of [{loanVnd:'-1'},{loanVnd:'1e9'},{loanVnd:'100000000000000000000'},{loanVnd:1},{annualRatePercent:'100.000001'},{annualRatePercent:'0.0000001'},{annualRatePercent:'-1'},{termMonths:61},{termMonths:0},{termMonths:372},{method:'unknown'}])assert.throws(()=>amortize({...base,...patch} as FinanceInput),e=>e instanceof DomainError&&e.code==='INVALID_INPUT');
});
