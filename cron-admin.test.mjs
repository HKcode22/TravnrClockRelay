import test from "node:test";
import assert from "node:assert/strict";
import {managedSpec,exactManaged,manage,createDisabledPair,renewExactLease,rekeyPilot,LANES} from "./cron-admin.mjs";
import {PILOT} from "./cron-audit.mjs";
const pin="a".repeat(40),now=Date.parse("2026-11-18T08:00:00Z"),until="2026-11-20T08:00:00.000Z",tok="github_pat_"+"t".repeat(40),newTok="github_pat_"+"n".repeat(40);
const ops={CREATE_DISABLED:"CREATE_EXACT_DISABLED_MANAGED_CRON_JOB",ENABLE_EXACT:"ENABLE_EXACT_MANAGED_CRON_JOB",DISABLE_EXACT:"DISABLE_EXACT_MANAGED_CRON_JOB"};
const cfg=(op="CREATE_DISABLED",lane="CLOCK_ONLY")=>({op,lane,until,token:tok,now,jobId:op==="CREATE_DISABLED"?null:42,confirm:ops[op],pin,env:{}});
function fixture(op="CREATE_DISABLED",lane="CLOCK_ONLY",fault=""){
 const spec=managedSpec({lane,until,token:tok,now}),calls=[],events=[];
 let job={jobId:42,...structuredClone(spec),enabled:op==="DISABLE_EXACT"};
 const request=async(method,path,body)=>{
  calls.push({method,path});
  if(method==="GET"&&path==="/jobs")return {someFailed:fault==="incomplete",jobs:op==="CREATE_DISABLED"&&fault!=="duplicate"?[]:[{jobId:42,title:spec.title,url:spec.url}]};
  if(method==="GET"&&path==="/jobs/42")return {jobDetails:fault==="drift"?{...job,url:"https://example.com"}:job};
  if(method==="PUT"){if(fault==="unknown")throw Error("timeout");job={jobId:42,...body.job};return {jobId:42};}
  if(method==="PATCH"){if(fault==="unknown")throw Error("timeout");job={...job,...body.job};return {};}
  throw Error("unexpected");
 };
 return {calls,events,request,main:async()=>pin,emit:x=>events.push(x),sleep:async()=>{}};
}
test("three lanes distinct titles/body schedules and one shared isolated target only",()=>{
 const xs=Object.keys(LANES).map(lane=>managedSpec({lane,until,token:tok,now}));
 assert.equal(new Set(xs.map(x=>x.title)).size,3);assert.equal(new Set(xs.map(x=>x.url)).size,1);
 assert(xs.every(x=>x.enabled===false&&x.saveResponses&&x.url.includes("TravnrClockRelay")&&!x.url.includes("ReplitTranvr")));
 assert.deepEqual(JSON.parse(xs[1].extendedData.body).inputs,{lane:"PRIMARY_BACKSTOP"});
 assert.deepEqual(JSON.parse(xs[2].extendedData.body).inputs,{lane:"ROLLING_ROOT"});
});
test("expiry and exact token restrictions",()=>{assert.throws(()=>managedSpec({lane:"ROLLING_ROOT",until:"2027-04-01T00:00:00.000Z",token:tok,now}),/EXPIRY_BOUND/);assert.throws(()=>managedSpec({lane:"CLOCK_ONLY",until,token:"no",now}),/SCOPE/)});
test("create one disabled only and verify exact config",async()=>{const f=fixture(),x=await manage(cfg(),f);assert.equal(x.status,"MANAGED_CRON_CREATED_DISABLED_VERIFIED");assert.equal(x.jobId,42);assert.equal(f.calls.filter(x=>x.method!=="GET").length,1);assert(!JSON.stringify(x).includes(tok))});
test("duplicate or unknown list no PUT",async()=>{for(const fault of ["duplicate","incomplete"]){const f=fixture("CREATE_DISABLED","CLOCK_ONLY",fault);await assert.rejects(manage(cfg(),f));assert.equal(f.calls.filter(x=>x.method!=="GET").length,0)}});
test("unknown PUT response never retries",async()=>{const f=fixture("CREATE_DISABLED","CLOCK_ONLY","unknown");await assert.rejects(manage(cfg(),f));assert.equal(f.calls.filter(x=>x.method==="PUT").length,1)});
test("clock-only explicit enable verified once, no target permission",async()=>{const f=fixture("ENABLE_EXACT"),x=await manage(cfg("ENABLE_EXACT"),f);assert.equal(x.status,"MANAGED_CRON_ENABLED_VERIFIED_NOT_EXECUTION_PROOF");assert.equal(f.calls.filter(x=>x.method==="PATCH").length,1);assert.equal(x.targetDispatches,0)});
test("production recovery lane enable requires independent lane flags",async()=>{const f=fixture("ENABLE_EXACT","ROLLING_ROOT");await assert.rejects(manage(cfg("ENABLE_EXACT","ROLLING_ROOT"),f),/SEPARATE_TARGET_LANE_APPROVAL/);assert.equal(f.calls.length,0)});
test("explicit lane approval affects only exact cron job and not execution",async()=>{const f=fixture("ENABLE_EXACT","PRIMARY_BACKSTOP");const c=cfg("ENABLE_EXACT","PRIMARY_BACKSTOP");c.env={TRAVNR_RELAY_MODE:"MULTI_LANE",TRAVNR_RELAY_PRIMARY_ENABLED:"1",TRAVNR_APPROVED_TARGET_MAIN_SHA:"f".repeat(40),TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED:"1"};const x=await manage(c,f);assert.equal(x.targetDispatches,0);assert.equal(f.calls.filter(x=>x.method==="PATCH").length,1)});
test("emergency exact disable works without a replacement PAT",async()=>{const f=fixture("DISABLE_EXACT","CLOCK_ONLY"),c=cfg("DISABLE_EXACT");delete c.token;const r=await manage(c,f);assert.equal(r.status,"MANAGED_CRON_DISABLED_VERIFIED");assert.equal(f.calls.filter(x=>x.method==="PATCH").length,1)});
test("main drift, mutated job or unknown PATCH refuses replay",async()=>{const f=fixture("ENABLE_EXACT","CLOCK_ONLY","unknown");await assert.rejects(manage(cfg("ENABLE_EXACT"),f));assert.equal(f.calls.filter(x=>x.method==="PATCH").length,1);const d=fixture("ENABLE_EXACT","CLOCK_ONLY","drift");await assert.rejects(manage(cfg("ENABLE_EXACT"),d),/JOB_READBACK/);assert.equal(d.calls.filter(x=>x.method==="PATCH").length,0);const x=fixture();await assert.rejects(manage(cfg(),{...x,main:async()=>"b".repeat(40)}),/MAIN_DRIFT/);assert.equal(x.calls.length,0)});
function pilotFixture(fault=""){
 const pilotNow=Date.parse("2026-11-18T06:25:00Z"),s=managedSpec({lane:"CLOCK_ONLY",until:PILOT.until,token:tok,now:pilotNow});
 let j={jobId:PILOT.jobId,...s,title:PILOT.title,enabled:fault!=="disabled"};
 const calls=[];
 return {pilotNow,calls,request:async(method,path,body)=>{calls.push(method);assert.equal(path,"/jobs/"+PILOT.jobId);
  if(method==="PATCH"){if(fault==="unknown")throw Error("timeout");assert.deepEqual(Object.keys(body.job),["extendedData"]);j={...j,...body.job};return {};}return {jobDetails:j};},main:async()=>PILOT.pin,emit:()=>{}};
}
test("pilot rotate changes only destination authorization, retains original expiration",async()=>{const f=pilotFixture(),r=await rekeyPilot({token:newTok,now:f.pilotNow},f);assert.equal(r.status,"PILOT_REKEY_VERIFIED_NOT_SLOT_PROOF");assert.equal(r.expiryUnchanged,PILOT.until);assert.deepEqual(f.calls,["GET","PATCH","GET"]);assert(!JSON.stringify(r).includes(newTok))});
test("already rekeyed no mutation and disabled pilot never auto-enabled",async()=>{const f=pilotFixture(),r=await rekeyPilot({token:tok,now:f.pilotNow},f);assert.equal(r.cronMutations,0);const d=pilotFixture("disabled");await assert.rejects(rekeyPilot({token:newTok,now:d.pilotNow},d),/DISABLED/);assert.deepEqual(d.calls,["GET"])});
test("unknown rekey PATCH not repeated",async()=>{const f=pilotFixture("unknown");await assert.rejects(rekeyPilot({token:newTok,now:f.pilotNow},f));assert.deepEqual(f.calls,["GET","PATCH"])});

test("prior rotation attempt permits only exact readback, not another PATCH",async()=>{const f=pilotFixture();await assert.rejects(rekeyPilot({token:newTok,now:f.pilotNow,allowWrite:false},f),/PREVIOUS_ATTEMPT/);assert.deepEqual(f.calls,["GET"]);const g=pilotFixture(),x=await rekeyPilot({token:tok,now:g.pilotNow,allowWrite:false},g);assert.equal(x.cronMutations,0);});

function pairFixture(fault=""){
 const store=new Map(),calls=[],events=[];
 const pair={until,token:tok,now,jobId:null,confirm:"CREATE_BOTH_RECOVERY_CRON_JOBS_DISABLED_NO_FORWARD",pin,env:{TRAVNR_RELAY_MODE:"CLOCK_ONLY"}};
 if(fault==="existingRolling")store.set(90,{jobId:90,...managedSpec({lane:"ROLLING_ROOT",until,token:tok,now})});
 let count=0;
 const request=async(method,path,body)=>{
  calls.push({method,path});
  if(method==="GET"&&path==="/jobs")return {someFailed:false,jobs:[...store.values()].map(x=>({jobId:x.jobId,title:x.title,url:x.url,schedule:x.schedule}))};
  if(method==="GET")return {jobDetails:store.get(Number(path.split("/").at(-1)))};
  if(method==="PUT"){
   count++;
   assert.equal(body.job.enabled,false);
   if(fault==="firstUnknown"&&count===1||fault==="secondUnknown"&&count===2)throw Error("timeout");
   const n=fault==="duplicateAck"?42:41+count;
   store.set(n,{jobId:n,...body.job});
   return {jobId:n};
  }
  throw Error("unexpected operation");
 };
 return {pair,store,calls,events,request,main:async()=>pin,emit:x=>events.push(x),sleep:async()=>{}};
}
test("pair provisions two disabled jobs with one exact approval, final readbacks and no forwarding",async()=>{
 const f=pairFixture(),a=await createDisabledPair(f.pair,f);
 assert.equal(a.status,"MANAGED_RECOVERY_PAIR_DISABLED_VERIFIED_NO_FORWARD");
 assert.deepEqual(a.jobs,[{lane:"PRIMARY_BACKSTOP",jobId:42},{lane:"ROLLING_ROOT",jobId:43}]);
 assert.equal(f.calls.filter(x=>x.method==="GET").length,8);
 assert.equal(f.calls.filter(x=>x.method==="PUT").length,2);
 assert([...f.store.values()].every(j=>j.enabled===false));
 assert.equal(a.targetDispatches,0);
 assert(!JSON.stringify([a,f.events]).includes(tok));
});
test("existing partial pair blocks all writes rather than recreate either member",async()=>{
 const f=pairFixture("existingRolling");await assert.rejects(createDisabledPair(f.pair,f),/ALREADY_EXISTS/);
 assert(f.calls.every(x=>x.method==="GET"));
});
test("uncertain first or second create never retries and retains prior verified receipt",async()=>{
 for(const fault of ["firstUnknown","secondUnknown"]){
  const f=pairFixture(fault);await assert.rejects(createDisabledPair(f.pair,f));
  assert.equal(f.calls.filter(x=>x.method==="PUT").length,fault==="firstUnknown"?1:2);
  assert.equal(f.events.filter(x=>x.status==="PAIR_MEMBER_DISABLED_VERIFIED").length,fault==="firstUnknown"?0:1);
 }
});
test("duplicate IDs and forwarding-on config reject pair completion",async()=>{
 const f=pairFixture("duplicateAck");await assert.rejects(createDisabledPair(f.pair,f),/PAIR_ACK_SCOPE/);
 const g=pairFixture();g.pair.env.TRAVNR_RELAY_ROLLING_ENABLED="1";
 await assert.rejects(createDisabledPair(g.pair,g),/PAIR_STOP_SCOPE/);assert.equal(g.calls.length,0);
});

function renewalFixture(fault=""){
 const lane="ROLLING_ROOT",priorUntil="2026-11-20T08:00:00.000Z",nextUntil="2026-11-29T08:00:00.000Z";
 const args={lane,priorUntil,until:nextUntil,token:tok,now,jobId:42,confirm:"RENEW_ACTIVE_MANAGED_CRON_LEASE_ONLY",pin};
 const old=managedSpec({lane,until:priorUntil,token:tok,now}),newer=managedSpec({lane,until:nextUntil,token:tok,now});
 let job={jobId:42,...(fault==="already"?newer:old),enabled:fault!=="disabled"};
 if(fault==="otherExpiry")job.schedule={...job.schedule,expiresAt:20261121080000};
 if(fault==="tokenDrift")job.extendedData={...job.extendedData,headers:{...job.extendedData.headers,Authorization:"Bearer "+newTok}};
 const calls=[],events=[];
 return {args,calls,events,main:async()=>pin,emit:x=>events.push(x),request:async(method,path,body)=>{
  calls.push(method);
  if(path==="/jobs")return {someFailed:false,jobs:[{jobId:42,title:job.title,url:job.url}]};
  assert.equal(path,"/jobs/42");
  if(method==="PATCH"){assert.deepEqual(body,{job:{schedule:newer.schedule}});if(fault==="unknown")throw Error("unknown timeout");job={...job,...body.job};return {};}
  return {jobDetails:job};
 }};
}
test("exact active lease renewal patches schedule only and verifies original job/token",async()=>{
 const f=renewalFixture(),r=await renewExactLease(f.args,f);assert.equal(r.status,"MANAGED_CRON_LEASE_RENEWED_VERIFIED_NOT_EXECUTION_PROOF");assert.deepEqual(f.calls,["GET","GET","PATCH","GET"]);assert.equal(r.cronMutations,1);assert(!JSON.stringify([r,f.events]).includes(tok));
});
test("already renewed exact lease is readback-only",async()=>{const f=renewalFixture("already"),r=await renewExactLease(f.args,f);assert.equal(r.cronMutations,0);assert.deepEqual(f.calls,["GET","GET"])});
test("disabled, different expiry or credential drift cannot renew",async()=>{for(const fault of ["disabled","otherExpiry","tokenDrift"]){const f=renewalFixture(fault);await assert.rejects(renewExactLease(f.args,f));assert.deepEqual(f.calls,["GET","GET"])}});
test("too early, expired, overlong or non-extending renewal is refused before network",async()=>{for(const patch of [{now:now-8*86400000},{now:Date.parse(until)},{until:"2026-12-05T08:00:00.000Z"},{until}]){const f=renewalFixture();await assert.rejects(renewExactLease({...f.args,...patch},f),/RENEW_BOUNDS/);assert.equal(f.calls.length,0)}});
test("uncertain renewal response does not repeat PATCH",async()=>{const f=renewalFixture("unknown");await assert.rejects(renewExactLease(f.args,f));assert.deepEqual(f.calls,["GET","GET","PATCH"])});
