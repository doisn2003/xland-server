import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{setTimeout as delay}from'node:timers/promises';
import{testApi}from'../helpers/api.js';
import{assertWire}from'../helpers/wire.js';
import type{Wire}from'../../src/repositories/properties.js';

test('C-4 finance/profile PostgreSQL: exact estimate, immutable owner snapshots, atomic current price and clear semantics',async t=>{
  const api=await testApi();const property='00000000-0000-4000-8000-000000000005';
  const input={propertyId:property,equityVnd:'1200000000',loanVnd:'1200000000',termMonths:240,annualRatePercent:'9',method:'equal_installment'};
  const waitForLock=async(pattern:string)=>{for(let i=0;i<200;i++){const r=await api.db.pool.query("SELECT count(*)::int total FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",[pattern]);if(r.rows[0].total)return;await delay(10);}throw new Error('Expected controlled concurrency lock was not observed');};
  try{
    const a=await api.login();const b=await api.login(api.context.second);
    await t.test('guest estimate exact equal/declining/zero loan and invalid price/property/range/overflow',async()=>{
      const equal=await api.request('/finance/estimates','POST',input);assert.equal(equal.status,200);assertWire(equal.body.data,'FinanceResult');const result=equal.body.data as Wire;assert.equal(result.monthlyPaymentVnd,'10796711');assert.equal(result.totalInterestVnd,'1391210961');
      const declining=await api.request('/finance/estimates','POST',{...input,method:'declining_balance'});assert.equal(declining.status,200);assert.equal((declining.body.data as Wire).monthlyPaymentVnd,'14000000');assert.equal((declining.body.data as Wire).totalInterestVnd,'1084500000');
      const zero=await api.request('/finance/estimates','POST',{...input,equityVnd:'2400000000',loanVnd:'0',annualRatePercent:'0'});assert.equal(zero.status,200);assert.equal((zero.body.data as Wire).totalRepaymentVnd,'0');
      assert.equal((await api.request('/finance/estimates','POST',{...input,propertyId:randomUUID()})).status,404);
      const mismatch=await api.request('/finance/estimates','POST',{...input,equityVnd:'0'});assert.equal(mismatch.status,400);assert.deepEqual(((mismatch.body.error as Wire).details as Wire[]).map(d=>d.field),['equityVnd','loanVnd']);
      for(const patch of [{loanVnd:'-1'},{loanVnd:1200000000},{termMonths:61},{annualRatePercent:'101'},{annualRatePercent:'0.0000001'},{result:{monthlyPaymentVnd:'1'}}])assert.equal((await api.request('/finance/estimates','POST',{...input,...patch})).status,400);
      await api.db.pool.query('UPDATE xland.properties SET price_total=$1 WHERE id=$2',['99999999999999999999',property]);
      const overflow=await api.request('/finance/estimates','POST',{...input,equityVnd:'0',loanVnd:'99999999999999999999',termMonths:360,annualRatePercent:'100'});assert.equal(overflow.status,400);assert.equal((((overflow.body.error as Wire).details as Wire[])[0]!).code,'FINANCE_RESULT_OUT_OF_RANGE');
      await api.db.pool.query('UPDATE xland.properties SET price_total=$1 WHERE id=$2',['2400000000',property]);
    });
    let plan:Wire={};
    await t.test('server recompute persisted once under concurrent retry; cross-user invisible; client result forbidden',async()=>{
      const body={label:'Phương án A-06',input};
      assert.equal((await api.request('/me/finance-plans','POST',body)).status,401);
      assert.equal((await api.request('/me/finance-plans','POST',{...body,result:{}},a,randomUUID())).status,400);
      const results=await Promise.all([api.request('/me/finance-plans','POST',body,a,'finance-snapshot-key01'),api.request('/me/finance-plans','POST',body,a,'finance-snapshot-key01')]);for(const r of results)assert.equal(r.status,201);assert.deepEqual(results[0]!.body,results[1]!.body);plan=results[0]!.body.data as Wire;assertWire(plan,'SavedFinancePlan');
      const persisted=(await api.db.pool.query('SELECT price_snapshot,input,result,formula_version,rounding_rule FROM xland.saved_finance_plans WHERE id=$1',[plan.id])).rows[0];assert.equal(persisted.price_snapshot,'2400000000');assert.equal(persisted.formula_version,'xland-loan-v1');assert.equal(persisted.rounding_rule,'VND_HALF_UP_MONTHLY_LAST_ADJUST');assert.deepEqual(persisted.result,plan.result);
      assert.equal(((await api.request('/me/finance-plans','GET',undefined,b)).body.data as Wire[]).length,0);
      assert.equal((await api.request('/me/finance-plans','POST',{...body,label:'Thay label'},a,'finance-snapshot-key01')).status,409);
      await assert.rejects(api.db.transaction('xland_api',api.context.second.id,c=>c.query('INSERT INTO xland.saved_finance_plans(id,user_id,property_id,label,input,price_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),api.context.first.id,property,'forged','{}','1'])));
    });
    await t.test('price change does not rewrite original retry/history or legacy null plan',async()=>{
      await api.db.pool.query('UPDATE xland.properties SET price_total=$1 WHERE id=$2',['2400000001',property]);
      const replay=await api.request('/me/finance-plans','POST',{label:'Phương án A-06',input},a,'finance-snapshot-key01');assert.equal(replay.status,201);assert.deepEqual(replay.body.data,plan);
      assert.equal((await api.request('/me/finance-plans','POST',{label:'New key mismatch',input},a,randomUUID())).status,400);
      const legacy=randomUUID();await api.db.pool.query('INSERT INTO xland.saved_finance_plans(id,user_id,property_id,label,input,price_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[legacy,api.context.first.id,property,'Legacy result:null',JSON.stringify(input),'2400000000']);
      const history=(await api.request('/me/finance-plans','GET',undefined,a)).body.data as Wire[];assert.equal(history.find(p=>p.id===legacy)!.result,null);assert.deepEqual(history.find(p=>p.id===plan.id)!.result,plan.result);
      assert.equal((await api.request('/me/finance-plans/'+plan.id,'DELETE',undefined,b)).status,404);
      assert.equal((await api.request('/me/finance-plans/'+plan.id,'DELETE',undefined,a)).status,200);
      await api.db.pool.query('UPDATE xland.properties SET price_total=$1 WHERE id=$2',['2400000000',property]);
    });
    await t.test('price update committed before save lock is revalidated, not stale-price accepted',async()=>{
      const updater=await api.db.pool.connect();try{
        await updater.query('BEGIN');await updater.query('UPDATE xland.properties SET price_total=$1 WHERE id=$2',['2400000001',property]);
        const pending=api.request('/me/finance-plans','POST',{label:'Must reject stale price',input},a,randomUUID());
        await waitForLock('SELECT id,price_total%');await updater.query('COMMIT');assert.equal((await pending).status,400);
      }finally{await updater.query('ROLLBACK');updater.release();}
      await api.db.pool.query('UPDATE xland.properties SET price_total=$1 WHERE id=$2',['2400000000',property]);
    });
    await t.test('price stays locked through snapshot insert and concurrent mutation commits afterwards',async()=>{
      await api.db.pool.query(`CREATE FUNCTION xland_meta.pause_finance_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.label='Finance lock probe' THEN PERFORM pg_advisory_xact_lock(719310); END IF; RETURN NEW; END $$;
        CREATE TRIGGER pause_finance_test BEFORE INSERT ON xland.saved_finance_plans FOR EACH ROW EXECUTE FUNCTION xland_meta.pause_finance_test();`);
      const blocker=await api.db.pool.connect();const updater=await api.db.pool.connect();try{
        await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(719310)');
        const pending=api.request('/me/finance-plans','POST',{label:'Finance lock probe',input},a,randomUUID());await waitForLock('INSERT INTO xland.saved_finance_plans%');
        const update=updater.query('UPDATE xland.properties SET price_total=$1 WHERE id=$2',['2400000001',property]);await waitForLock('UPDATE xland.properties%');
        await blocker.query('COMMIT');const response=await pending;assert.equal(response.status,201);await update;
        const id=(response.body.data as Wire).id;const snapshot=(await api.db.pool.query('SELECT price_snapshot FROM xland.saved_finance_plans WHERE id=$1',[id])).rows[0];assert.equal(snapshot.price_snapshot,'2400000000');
      }finally{await blocker.query('ROLLBACK');blocker.release();updater.release();}
      await api.db.pool.query('UPDATE xland.properties SET price_total=$1 WHERE id=$2',['2400000000',property]);
    });
    await t.test('failed final idempotency insert rolls back finance plan and retry record',async()=>{
      await api.db.pool.query(`CREATE FUNCTION xland_meta.finance_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='finance-late-failure01' THEN RAISE EXCEPTION 'isolated finance fault'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER finance_late_failure BEFORE INSERT ON xland.idempotency_records FOR EACH ROW EXECUTE FUNCTION xland_meta.finance_late_failure();`);
      const r=await api.request('/me/finance-plans','POST',{label:'Rollback probe',input},a,'finance-late-failure01');assert.equal(r.status,500);assert.ok(!JSON.stringify(r.body).includes('isolated finance fault'));
      assert.equal(Number((await api.db.pool.query("SELECT count(*) count FROM xland.saved_finance_plans WHERE label='Rollback probe'")).rows[0].count),0);
    });
    await t.test('profile explicit null clears, omission keeps, set resets verification; flags never accepted on wire',async()=>{
      const set=await api.request('/me/profile','PATCH',{avatarUrl:'https://media.xland.test/avatar.png',contactPhone:'0912345678'},a);assert.equal(set.status,200);assert.equal((set.body.data as Wire).contactVerified,false);
      const keep=await api.request('/me/profile','PATCH',{displayName:'Giữ thông tin'},a);assert.equal((keep.body.data as Wire).avatarUrl,'https://media.xland.test/avatar.png');assert.equal((keep.body.data as Wire).contactPhone,'+84912345678');
      const clear=await api.request('/me/profile','PATCH',{avatarUrl:null,contactPhone:null},a);assert.equal(clear.status,200);assert.equal((clear.body.data as Wire).avatarUrl,null);assert.equal((clear.body.data as Wire).contactPhone,null);
      assert.equal((await api.request('/me/profile','PATCH',{clearAvatar:true},a)).status,400);assert.equal((await api.request('/me/profile','PATCH',{clearContactPhone:true},a)).status,400);
      assert.notEqual(((await api.request('/me/profile','GET',undefined,b)).body.data as Wire).displayName,'Giữ thông tin');
    });
  }finally{await api.close();}
});
