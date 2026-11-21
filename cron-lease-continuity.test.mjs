import test from "node:test";
import assert from "node:assert/strict";
import {renewPair,renewalMode,classifyPriorRun,OLD,EXTENDED,RENEW_FROM,RENEW_LAST} from "./cron-lease-continuity.mjs";
import {managedSpec,ACTUAL_PAIR} from "./cron-admin.mjs";
const now=Date.parse("2026-12-12T09:00:00.000Z"),pin="a".repeat(40),token="github_pat_"+"x".repeat(40);
const env={GITHUB_SHA:pin,TRAVNR_LEASE_CONTINUITY_ARMED:"1",TRAVNR_RELAY_MODE:"CLOCK_ONLY",TRAVNR_CRON_RELAY_TOKEN:token};
function fixture(fault=""){
 const store=new Map(ACTUAL_PAIR.map(x=>[x.jobId,{jobId:x.jobId,...managedSpec({lane:x.lane,until:fault==="extended"?EXTENDED:OLD,token,now}),enabled:true}]));
 if(fault==="partial")store.get(8890475).schedule.expiresAt=20261230080000;
 if(fault==="disabled")store.get(8890476).enabled=false;
 if(fault==="cadence")store.get(8890476).schedule.minutes=[8,28,48];
 if(fault==="auth")store.get(8890476).extendedData.headers.Authorization="Bearer github_pat_"+"y".repeat(40);
 const calls=[],events=[];
 const request=async(method,p,body)=>{
  calls.push({method,p});
  if(p==="/jobs")return {someFailed:false,jobs:[...store.values()]};
  const n=Number(p.split("/").at(-1)),j=store.get(n);
  if(method==="GET")return {jobDetails:structuredClone(j)};
  assert.equal(method,"PATCH");assert.deepEqual(Object.keys(body.job),["schedule"]);
  if(fault==="unknown"&&n===8890476)throw Error("unknown PATCH");
  store.set(n,{...j,...body.job});return {};
 };
 return {store,calls,events,request,main:async()=>fault==="drift"?"b".repeat(40):pin,emit:x=>events.push(x),probe:async t=>t===token&&fault!=="invalidToken"};
}
const arg={env,now,priorRisk:[]};
test("actual two IDs, schedule-only fixed extension, no forwarding or credentials in receipt",async()=>{
 const f=fixture(),a=await renewPair(arg,f);
 assert.equal(a.status,"EXACT_PAIR_FIXED_LEASE_EXTENDED_VERIFIED");assert.equal(a.cronMutations,2);
 assert.deepEqual(a.rows.map(x=>x.jobId),[8890475,8890476]);assert.equal(a.targetDispatches,0);assert.equal(a.paidAuthorityGranted,false);
 assert.deepEqual(f.calls.map(x=>x.method),["GET","GET","GET","GET","PATCH","GET","GET","PATCH","GET"]);
 assert(!JSON.stringify([a,f.events]).includes(token));
 for(const j of f.store.values())assert.equal(j.schedule.expiresAt,20261230080000);
});
test("both renewed already: independently read back, no further writes even after prior attempt",async()=>{
 const f=fixture("extended"),a=await renewPair({...arg,priorRisk:[123]},f);
 assert.equal(a.status,"EXACT_PAIR_ALREADY_EXTENDED_INDEPENDENT_READBACK_NO_WRITE");assert(f.calls.every(x=>x.method==="GET"));
});
test("uncertain prior or partial pair never blindly patches",async()=>{
 for(const fault of ["partial","disabled","auth","cadence","drift","invalidToken"]){const f=fixture(fault);await assert.rejects(renewPair(arg,f));assert(f.calls.every(x=>x.method==="GET"))}
 const f=fixture();await assert.rejects(renewPair({...arg,priorRisk:[12]},f),/NO_REPLAY/);assert(f.calls.every(x=>x.method==="GET"));
});
test("ambiguous second mutation stops, no rollback or repeat",async()=>{
 const f=fixture("unknown");await assert.rejects(renewPair(arg,f));assert.equal(f.calls.filter(x=>x.method==="PATCH").length,2);
 assert.equal(f.events.filter(x=>x.status==="FIXED_LEASE_EXTENSION_READBACK").length,1);
});
test("no writes outside fixed window or with uncommissioned/mixed mode",async()=>{
 for(const n of [Date.parse(RENEW_FROM)-1,Date.parse(RENEW_LAST)+1]){const f=fixture(),a=await renewPair({...arg,now:n},f);assert.equal(a.cronMutations,0);assert.equal(f.calls.length,0)}
 for(const patch of [{TRAVNR_LEASE_CONTINUITY_ARMED:"0"},{TRAVNR_RELAY_PRIMARY_ENABLED:"1"},{TRAVNR_RELAY_MODE:"MULTI_LANE"}]){const f=fixture();await assert.rejects(renewPair({...arg,env:{...env,...patch}},f));assert.equal(f.calls.length,0)}
 const released={...env,TRAVNR_RELAY_MODE:"MULTI_LANE",TRAVNR_RELAY_PRIMARY_ENABLED:"1",TRAVNR_RELAY_ROLLING_ENABLED:"1",TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED:"1",TRAVNR_APPROVED_TARGET_MAIN_SHA:pin,TRAVNR_ROLLING_POLICY_UNTIL_UTC:"2026-12-25T00:00:00.000Z"};
 assert.equal(renewalMode(released),"RELEASED");
 assert.equal(renewalMode({...released,TRAVNR_ROLLING_POLICY_UNTIL_UTC:"2026-12-29T04:00:00.000Z"}),"RELEASED");
 assert.throws(()=>renewalMode({...released,TRAVNR_ROLLING_POLICY_UNTIL_UTC:"2026-12-30T08:00:01.000Z"}),/MODE_OR_POLICY/);
});
test("only exact skipped mutation-capable step excludes prior run risk",()=>{
 const r={id:1,head_sha:pin,head_branch:"main",event:"schedule",path:".github/workflows/cron-lease-continuity.yml",status:"completed",run_attempt:1};
 const common={run_id:1,head_sha:pin,status:"completed",run_attempt:1};
 const j={total_count:2,jobs:[{...common,id:2,name:"offline",conclusion:"skipped",steps:[]},{...common,id:3,name:"extend-exact-existing-pair",conclusion:"failure",steps:[{name:"Extend exact existing pair only, no replay",status:"completed",conclusion:"skipped"}]}]};
 assert.equal(classifyPriorRun(r,j,pin),false);
 j.jobs[1].steps[0].conclusion="failure";assert.equal(classifyPriorRun(r,j,pin),true);
 assert.equal(classifyPriorRun({...r,head_sha:"b".repeat(40)},j,pin),true);
});

 test("fixed lease covers the Monday POST tail and one full 24h final FIDS window, within existing renewal bounds",()=>{
 const tail=Date.parse("2026-12-29T04:00:00.000Z"),end=Date.parse(EXTENDED);
 assert.equal(end-tail,28*3600000);
 assert.ok(end-Date.parse(OLD)<=14*86400000);
 assert.ok(end-Date.parse(RENEW_FROM)<=32*86400000);
 });
