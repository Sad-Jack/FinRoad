const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
test('iPhone fixture covers financial record types without user data', t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finroad-fixture-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const out=path.join(dir,'example.json');
 execFileSync(process.execPath,[path.join(__dirname,'../ios/tests/fixtures/generate.cjs'),out]);
 const s=JSON.parse(fs.readFileSync(out,'utf8'));
 assert.deepEqual(new Set(s.debts.map(d=>d.kind)),new Set(['loan','mortgage','personal','card']));
 assert(s.transactions.some(t=>t.repeat==='monthly'));
 assert(s.transactions.some(t=>t.repeat==='once'&&!t.draft));
 assert(s.transactions.some(t=>t.draft));
 assert(s.incomeSources.some(i=>i.incomeType==='salary'&&i.salaryShare<10000));
 assert(s.incomeSources.some(i=>i.incomeType==='other'&&i.repeat==='once'));
 assert(Object.keys(s.completed).length>0);
});
