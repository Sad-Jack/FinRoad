import test from 'node:test';
import assert from 'node:assert/strict';
import {demoState,demoStore} from '../public/demo.js';
import {forecast,addDays} from '../public/finance.js';

test('demo shows a shortfall before salary and a positive final balance across date boundaries',()=>{
  for(const now of ['2026-11-09','2026-12-25','2027-02-25','2028-02-28']){
    const state=demoState(now),plan=forecast(state,now,addDays(now,30));
    assert.equal(plan.events.length,8);
    assert.equal(plan.firstShortfall.date,addDays(now,2));
    assert.equal(plan.firstShortfall.balance,-700000);
    assert.equal(plan.minimum,-1300000);
    assert.equal(plan.balance,5000000);
    assert.equal(state.balanceDate,now);
  }
});

test('demo edits and imports stay in memory, and reopening restores the original example',()=>{
  const now='2026-11-09',store=demoStore(now),initial=store.load();
  initial.state.balance=9900000;
  assert.equal(store.read().state.balance,1800000);
  const saved=store.save(initial.state,initial.revision);
  assert.equal(saved.state.balance,9900000);
  assert.throws(()=>store.save(initial.state,initial.revision));
  assert.throws(()=>store.restore({...saved.state,balance:'broken'}));
  assert.equal(store.read().state.balance,9900000);
  const imported=store.restore({...saved.state,balance:100});
  assert.equal(imported.state.balance,100);
  assert.equal(demoStore(now).load().state.balance,1800000);
});
