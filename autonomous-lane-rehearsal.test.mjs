import test from "node:test";
import assert from "node:assert/strict";
import {verifyShadowAudit,verifyRollingReceipt,rehearse} from "./autonomous-lane-rehearsal.mjs";
import {RELAY,TARGET,PRIMARY,PILOT} from "./relay.mjs";
const OLD="ed35a5467dda0afc75eda386ad43ee4f401b23c4",PIN="45d04392e2eecfc1220230f252d2ada8cc6137e0",SELF="a".repeat(40),NOW=Date.parse("2026-11-18T12:00:00Z"),iso=n=>new Date(n).toISOString(),ROOT="https://api.github.com/repos/";
const ar={id:44281886719,head_sha:OLD,head_branch:"main",path:".github/workflows/cron-admin.yml",event:"workflow_dispatch",run_attempt:1,status:"completed",conclusion:"success"};
const aj={total_count:3,jobs:[{id:134724802849,name:"audit-actual-shadow-pair",run_id:ar.id,head_sha:OLD,run_attempt:1,status:"completed",conclusion:"success",steps:[{name:"Observe one hour and verify every eligible external tick, no forwarding",status:"completed",conclusion:"success"}]},{id:1,name:"exact-manual-management",run_id:ar.id,head_sha:OLD,run_attempt:1,status:"completed",conclusion:"success"},{id:2,name:"offline-tests",run_id:ar.id,head_sha:OLD,run_attempt:1,status:"completed",conclusion:"skipped",steps:[]}]};
const shadow=["PRIMARY_BACKSTOP","ROLLING_ROOT"].map((lane,i)=>({status:"READONLY_CRON_AND_RELAY_AUDIT_NOT_COLLECTION_PROOF",mode:"SHADOW",lane,jobId:8890475+i,relayPin:OLD,shadowFullyProven:true,expected:i?6:4,proven:i?6:4,ackOnly:0,unresolved:0,unexpectedRows:0,over120Seconds:0,disabledEarly:false,relayTargetAcks:0,targetDispatches:0,cronWrites:0,providerCalls:0,databaseReads:0,databaseWrites:0,paidAuthorityGranted:false,rows:Array.from({length:i?6:4},(_,k)=>({status:"SHADOW_LANE_PROVEN_NO_FORWARD",runId:10+i*10+k,jobId:100+i*10+k}))}));
const sl=()=>shadow.map(x=>JSON.stringify(x)).join("\n");
test("actual audit identity, both lanes and no forwarding mandatory",()=>{
 assert.equal(verifyShadowAudit(ar,aj,sl()).length,2);
 assert.throws(()=>verifyShadowAudit({...ar,conclusion:"failure"},aj,sl()),/AUDIT_IDENTITY/);
 assert.throws(()=>verifyShadowAudit(ar,aj,JSON.stringify(shadow[0])),/AUDIT_RECEIPTS/);
 assert.throws(()=>verifyShadowAudit(ar,aj,[{...shadow[0],relayTargetAcks:1},shadow[1]].map(x=>JSON.stringify(x)).join("\n")),/AUDIT_SCOPE/);
});
const chain="a".repeat(32),deadline=iso(NOW+29*60000);
function rolling(hop=0,parent=0,id=90+hop,c=chain,d=deadline){
 const r={id,head_sha:PIN,head_branch:"main",path:".github/workflows/"+PILOT,event:"workflow_dispatch",run_attempt:1,status:"completed",conclusion:"success",created_at:iso(NOW),display_title:"P5 ROLLING "+c+" "+hop+" "+parent};
 const names=["rolling-no-provider-rehearsal","six-slot-cron-observation-only","actual-readonly-preview-diagnostic","bounded-manual-github-handoff","bounded-primary-retention-backstop"];
 const jobs={total_count:5,jobs:names.map((name,i)=>({id:1000+id*10+i,name,run_id:id,head_sha:PIN,run_attempt:1,status:"completed",conclusion:i?"skipped":"success",steps:i?[]:["Observe two real read-only rolling waves and admit at most one rehearsal successor","Publish exact non-sensitive rehearsal successor receipt"].map(name=>({name,status:"completed",conclusion:"success"}))}))};
 const x={schema:"v39.phase5.rolling-continuation-rehearsal.v1",status:hop===2?"TERMINAL_REHEARSAL_NO_MORE_DISPATCH":"ONE_REHEARSAL_SUCCESSOR_ACKNOWLEDGED",chainId:c,hop,runId:String(id),parentRunId:String(parent),reviewedMainSha:PIN,deadlineUtc:d,providerCalls:0,databaseReads:0,databaseWrites:0,collectionDispatches:0,phase6PaidGo:false,waves:[{wave:1,lanes:8},{wave:2,lanes:8}],rehearsalDispatches:hop===2?0:1,nextRunId:hop===2?null:String(id+1),...(hop===2?{}:{nextDispatchAtUtc:iso(NOW+1000)})};
 return {r,jobs,x,log:JSON.stringify(x)};
}
test("rolling terminal receipt binds exact chain and all other jobs skipped",()=>{
 const a=rolling();assert.equal(verifyRollingReceipt(a.r,a.jobs,a.log,chain,0,0,deadline).nextRunId,91);
 const z=rolling(2,91,92);assert.equal(verifyRollingReceipt(z.r,z.jobs,z.log,chain,2,91,deadline).nextRunId,null);
 assert.throws(()=>verifyRollingReceipt(a.r,a.jobs,JSON.stringify({...a.x,collectionDispatches:1}),chain,0,0,deadline),/ROLLING_RECEIPT/);
 const bad=structuredClone(a.jobs);bad.jobs[1].conclusion="success";assert.throws(()=>verifyRollingReceipt(a.r,bad,a.log,chain,0,0,deadline),/ROLLING_STEPS/);
});
const env={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:RELAY,GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"push",GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:"100",GITHUB_SHA:SELF,GITHUB_TOKEN:"ghs_"+"x".repeat(40),TRAVNR_TARGET_ACTIONS_TOKEN:"github_pat_"+"y".repeat(40),TRAVNR_TARGET_FORWARD_ENV_READY:"1",TRAVNR_REHEARSAL_PREVIOUS_SHA:OLD,TRAVNR_RELAY_MODE:"CLOCK_ONLY",TRAVNR_EXERCISE_LANE:"ROLLING_ROOT"};
function fixture(fault=""){
 let sent,posts=0,params;const calls=[];
 const self={id:100,head_sha:SELF,head_branch:"main",path:".github/workflows/autonomous-lane-rehearsal.yml",event:"push",run_attempt:1,status:"in_progress"};
 const w=(x,status=200)=>({status,ok:status>=200&&status<300,json:async()=>x});
 const fetcher=async(url,init)=>{
  calls.push({url,method:init.method});
  if(init.method==="POST"){
   posts++;params=JSON.parse(init.body).inputs;sent=NOW;assert.equal(params.mode,"ROLLING_REHEARSAL");
   assert.equal(url,ROOT+TARGET+"/actions/workflows/"+PILOT+"/dispatches");
   if(fault==="ambiguous")return w({},503);
   return w({workflow_run_id:90,run_url:ROOT+TARGET+"/actions/runs/90",html_url:"https://github.com/"+TARGET+"/actions/runs/90"});
  }
  if(url===ROOT+RELAY+"/git/ref/heads/main")return w({object:{sha:SELF}});
  if(url===ROOT+TARGET+"/git/ref/heads/main")return w({object:{sha:fault==="drift"?SELF:PIN}});
  if(url===ROOT+RELAY+"/actions/runs/100")return w(self);
  if(url.startsWith(ROOT+RELAY+"/actions/workflows/"))return w({total_count:fault==="prior"?2:1,workflow_runs:[self]});
  if(url===ROOT+RELAY+"/actions/runs/"+ar.id)return w(fault==="audit"?{...ar,conclusion:"failure"}:ar);
  if(url.startsWith(ROOT+RELAY+"/actions/runs/"+ar.id+"/jobs"))return w(aj);
  if(url.startsWith(ROOT+TARGET+"/contents/"))return w({sha:"c1356a0aa278745708b5bb9d20e1cdc0bc2bdf2a"});
  if(url.includes("&status="))return w({total_count:fault==="active"?1:0,workflow_runs:fault==="active"?[{}]:[]});
  const m=url.match(/\/actions\/runs\/(90|91|92)(\/jobs.*)?$/);if(m&&params){const id=Number(m[1]),h=id-90,a=rolling(h,h?id-1:0,id,params.chain_id,params.deadline_utc);return w(m[2]?a.jobs:a.r);}
  throw Error("unexpected GET");
 };
 const targetLog=async(t,j)=>{const id=(j-1000)/10,h=id-90,a=rolling(h,h?id-1:0,id,params.chain_id,params.deadline_utc);return fault==="badReceipt"?"":a.log};
 return {calls,posts:()=>posts,opts:{fetcher,ownLog:async()=>sl(),targetLog,now:()=>NOW+2000,sleep:async()=>{}}};
}
test("autonomous root makes exactly one POST; bot's two actual successor receipts are separately verified",async()=>{
 const f=fixture(),a=await rehearse(env,f.opts);assert.equal(a.rootDispatches,1);assert.equal(a.proof.botSuccessorDispatches,2);assert.deepEqual(a.proof.rows.map(x=>x.runId),[90,91,92]);assert.equal(f.posts(),1);
});
test("prior run, incomplete audit, active target or SHA drift never submit",async()=>{
 for(const fault of ["prior","audit","active","drift"]){const f=fixture(fault);await assert.rejects(rehearse(env,f.opts));assert.equal(f.posts(),0);}
});
test("unknown response or incorrect terminal receipt never replays",async()=>{
 for(const fault of ["ambiguous","badReceipt"]){const f=fixture(fault);await assert.rejects(rehearse(env,f.opts),/NO_BLIND_REPLAY/);assert.equal(f.posts(),1);}
});
test("wrong release flags or provider/management secret cannot enter routine exercise",async()=>{
 for(const patch of [{TRAVNR_RELAY_MODE:"MULTI_LANE"},{TRAVNR_RELAY_ROLLING_ENABLED:"1"},{TRAVNR_CRON_ACCOUNT_KEY:"x"},{DATABASE_URL:"x"},{GITHUB_RUN_ATTEMPT:"2"}]){const f=fixture();await assert.rejects(rehearse({...env,...patch},f.opts),/SCOPE/);assert.equal(f.calls.length,0);}
});

test("primary rehearsal uses real VERIFY_ONLY workflow, never APPLY",async()=>{
 const p=fixture(),self=p.opts.fetcher;let posts=0;
 const run={id:81,head_sha:PIN,head_branch:"main",path:".github/workflows/"+PRIMARY,event:"workflow_dispatch",run_attempt:1,status:"completed",conclusion:"success",created_at:iso(NOW)};
 const j={id:82,name:"primary-fids-expiry",run_id:81,head_sha:PIN,run_attempt:1,status:"completed",conclusion:"success",completed_at:iso(NOW+1500),steps:[{name:"Verify exact main and execute only bounded primary FIDS expiry",status:"completed",conclusion:"success"}]};
 const counters=Object.fromEntries(["liveOriginals","eligibleOriginals","hardDueOriginals","eligibleNextHour","hardDueNextHour","unboundLiveOriginals","markedExpiredPayloadPresent","unlinkedUnexpiredPopulation","unexpiredPopulationWithoutLiveOriginal"].map(k=>[k,0]));
 const receipt={status:"PRIMARY_FIDS_VERIFY_ONLY_NO_WRITES",reviewedMainSha:PIN,distinctDbActorsVerified:true,privateCommissionState:"GRANTED",providerCalls:0,databaseWrites:0,objectDeletions:0,phase6PaidGo:false,backupOrPitrVerified:false,completeRetentionDeploymentVerified:false,before:{schema:"v39.phase5.primary-fids-expiry-status.v1",observedAtUtc:iso(NOW+1000),...counters,deletionStopUnresolved:false,providerCalls:0,databaseWrites:0,phase6PaidGo:false,backupOrPitrVerified:false,completeRetentionDeploymentVerified:false}};
 const w=x=>({status:200,ok:true,json:async()=>x});
 p.opts.fetcher=async(url,init)=>{
  if(init.method==="POST"){
   posts++;assert.equal(url,ROOT+TARGET+"/actions/workflows/"+PRIMARY+"/dispatches");assert.deepEqual(JSON.parse(init.body).inputs,{confirm:"VERIFY_PRIMARY_FIDS_ONLY_NO_WRITES",approved_main_sha:PIN});
   return w({workflow_run_id:81,run_url:ROOT+TARGET+"/actions/runs/81",html_url:"https://github.com/"+TARGET+"/actions/runs/81"});
  }
  if(url.startsWith(ROOT+TARGET+"/contents/"))return w({sha:"fe6768a52899f05b208baa316a0686011abf46a7"});
  if(url===ROOT+TARGET+"/actions/runs/81")return w(run);
  if(url.includes("/actions/runs/81/jobs"))return w({total_count:1,jobs:[j]});
  return self(url,init);
 };
 p.opts.targetLog=async()=>JSON.stringify(receipt);
 const a=await rehearse({...env,TRAVNR_EXERCISE_LANE:"PRIMARY_BACKSTOP"},p.opts);
 assert.equal(a.proof.verifiedRunId,81);assert.equal(posts,1);
});
