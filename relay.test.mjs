import test from "node:test";
import assert from "node:assert/strict";
import {runPulse,rootInputs,cronJobSpec,readPrimaryVerifyLog,verifyPrimaryBootstrapReceipt,verifyNativeFullRetentionPrivateReceipt,provesNoTargetStep,directTargetDisposition,RELAY,TARGET,PILOT,PRIMARY,ROLLING,DIRECT,DIRECT_TITLE,DIRECT_CONFIRM,DIRECT_VERIFY_TITLE,DIRECT_VERIFY_CONFIRM,FULL_RETENTION_CONFIRM,FULL_RETENTION_TITLE} from "./relay.mjs";
const NOW=Date.parse("2026-11-18T06:00:00.000Z"),SHA="a".repeat(40),LOCAL="b".repeat(40);
const tok="github_pat_"+ "x".repeat(30),root="https://api.github.com/repos/";
const wrap=(data,status=200)=>({status,ok:status===200,json:async()=>data});
const row=(id,wf,head=SHA,status="completed")=>({id,path:".github/workflows/"+wf,head_sha:head,head_branch:"main",event:"workflow_dispatch",run_attempt:1,status,conclusion:status==="completed"?"success":null,created_at:new Date(NOW-60000).toISOString()});
const bootRow={...row(202,PRIMARY),created_at:new Date(NOW-20*60000).toISOString()};
const bootJob={id:1202,name:"primary-fids-expiry",run_id:202,head_sha:SHA,run_attempt:1,status:"completed",conclusion:"success",completed_at:new Date(NOW-18*60000).toISOString(),steps:[{name:"Verify exact main and execute only bounded primary FIDS expiry",status:"completed",conclusion:"success"}]};
const bootStatus={status:"PRIMARY_FIDS_VERIFY_ONLY_NO_WRITES",reviewedMainSha:SHA,distinctDbActorsVerified:true,privateCommissionState:"GRANTED",providerCalls:0,databaseWrites:0,objectDeletions:0,phase6PaidGo:false,backupOrPitrVerified:false,completeRetentionDeploymentVerified:false,before:{schema:"v39.phase5.primary-fids-expiry-status.v1",observedAtUtc:new Date(NOW-19*60000).toISOString(),liveOriginals:0,eligibleOriginals:0,hardDueOriginals:0,eligibleNextHour:0,hardDueNextHour:0,unboundLiveOriginals:0,markedExpiredPayloadPresent:0,unlinkedUnexpiredPopulation:0,unexpiredPopulationWithoutLiveOriginal:0,deletionStopUnresolved:false,providerCalls:0,databaseWrites:0,phase6PaidGo:false,backupOrPitrVerified:false,completeRetentionDeploymentVerified:false}};
function f(mode,fault=""){
 let posts=0,body;const events=[],env={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:RELAY,GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:"100",GITHUB_SHA:LOCAL,GITHUB_TOKEN:tok,TRAVNR_RELAY_MODE:mode,TRAVNR_TARGET_ACTIONS_TOKEN:tok,TRAVNR_APPROVED_TARGET_MAIN_SHA:SHA,TRAVNR_RELAY_MODE_SINCE_UTC:new Date(NOW-3600000).toISOString(),TRAVNR_ROLLING_POLICY_FROM_UTC:new Date(NOW-600000).toISOString(),TRAVNR_ROLLING_POLICY_UNTIL_UTC:new Date(NOW+6*3600000).toISOString(),TRAVNR_ROLLING_FOUR_APPROVED:"1"};
 const wf=mode==="PILOT"?PILOT:mode==="PRIMARY_BACKSTOP"?PRIMARY:fault.startsWith("direct")?DIRECT:ROLLING;
 const fetcher=async(url,init)=>{
  if(init.method==="POST"){
   posts++;body=JSON.parse(init.body);
   assert.equal(url,root+TARGET+"/actions/workflows/"+wf+"/dispatches");
   if(fault==="ack"||fault==="directAck")return wrap({},503);
   return wrap({workflow_run_id:201,run_url:root+TARGET+"/actions/runs/201",html_url:"https://github.com/"+TARGET+"/actions/runs/201"});
  }
  assert.equal(init.method,"GET");
  if(url===root+RELAY+"/actions/runs/100")return wrap({...row(100,"external-clock.yml",LOCAL,"in_progress"),display_title:"TRAVNR EXTERNAL CLOCK "+(env.TRAVNR_RELAY_LANE||"CLOCK_ONLY")});
  if(url===root+RELAY+"/actions/runs/712/jobs?filter=latest&per_page=100")return wrap({total_count:3,jobs:["offline-tests","independent-pulse","target-forward"].map((name,i)=>({id:900+i,name,run_id:712,head_sha:LOCAL,run_attempt:1,status:"completed",conclusion:i===2?"failure":"skipped",steps:i===2?[{name:"Run node cli.mjs",status:"completed",conclusion:fault==="skippedForward"?"skipped":"failure"}]:[]}))});
  if(url.includes(root+RELAY+"/actions/workflows/")){
   if(env.TRAVNR_RELAY_MODE==="MULTI_LANE"&&["otherLane","sameLane","unknownLane","skippedForward","oldCodeFailure"].includes(fault)&&url.includes("status=failure")){
    const title=fault==="unknownLane"?"unknown":["sameLane","skippedForward","oldCodeFailure"].includes(fault)?"TRAVNR EXTERNAL CLOCK "+env.TRAVNR_RELAY_LANE:"TRAVNR EXTERNAL CLOCK "+(env.TRAVNR_RELAY_LANE==="PRIMARY_BACKSTOP"?"ROLLING_ROOT":"PRIMARY_BACKSTOP");
    return wrap({total_count:1,workflow_runs:[{...row(712,"external-clock.yml",fault==="oldCodeFailure"?SHA:LOCAL),display_title:title,conclusion:"failure"}]});
   }
   return wrap({total_count:fault==="prior"?1:0,workflow_runs:fault==="prior"?[{}]:[]});
  }
  if(url===root+TARGET+"/git/ref/heads/main")return wrap({object:{sha:fault==="drift"?LOCAL:SHA}});
  if(url===root+TARGET+"/actions/runs/202")return wrap(bootRow);
  if(url===root+TARGET+"/actions/runs/202/jobs?filter=latest&per_page=100"){
   if(["twoJobVerify","executedSibling","unknownSibling"].includes(fault)){
    const sibling={...bootJob,id:1203,name:fault==="unknownSibling"?"other-job":"phase7-expiry",conclusion:fault==="executedSibling"?"success":"skipped",steps:fault==="executedSibling"?bootJob.steps:[]};
    return wrap({total_count:2,jobs:[sibling,bootJob]});
   }
   return wrap({total_count:1,jobs:[bootJob]});
  }
  if(url===root+TARGET+"/actions/jobs/1202/logs"){
   assert.equal(init.redirect,"manual");assert(init.headers.Authorization.startsWith("Bearer "));
   return new Response("",{status:302,headers:{Location:fault==="evilHost"?"https://untrusted.example/log":"https://logs.blob.core.windows.net/log?sig=fixture"}});
  }
  if(url.startsWith("https://logs.blob.core.windows.net/")){
   assert.equal(init.redirect,"error");assert.equal(init.headers,undefined);
   return new Response("timestamp "+JSON.stringify(fault==="notZero"?{...bootStatus,before:{...bootStatus.before,hardDueOriginals:1}}:bootStatus),{status:200});
  }
  if(url===root+TARGET+"/actions/runs/201")return wrap(fault==="targetFailed"?{...row(201,wf),conclusion:"failure"}:{...row(201,wf,SHA,"queued"),...(wf===DIRECT?{display_title:env.TRAVNR_RELAY_ROLLING_ROUTE==="DIRECT_VERIFY"?DIRECT_VERIFY_TITLE:DIRECT_TITLE}:{})});
  if(wf===DIRECT&&url.includes("/actions/workflows/"+ROLLING+"/runs?"))
   return wrap({total_count:fault==="directOldActive"&&url.includes("status=queued")?1:0,workflow_runs:fault==="directOldActive"&&url.includes("status=queued")?[row(301,ROLLING,SHA,"queued")]:[]});
  if(wf===DIRECT&&url.includes("/actions/workflows/"+DIRECT+"/runs?")&&url.includes("&created=")){
   const q=new URL(url),status=q.searchParams.get("status");
   if(fault==="directPriorFailure"&&status==="failure")return wrap({total_count:1,workflow_runs:[{...row(113,DIRECT),conclusion:"failure",display_title:DIRECT_TITLE}]});
   if(["directRecent","directOld","directMissingMarker","directSafeHold","directCarried"].includes(fault)&&status==="success"){
    const created=fault==="directRecent"?NOW-3*60000:NOW-15*60000;
    return wrap({total_count:1,workflow_runs:[{...row(113,DIRECT),created_at:new Date(created).toISOString(),display_title:env.TRAVNR_RELAY_ROLLING_ROUTE==="DIRECT_VERIFY"?DIRECT_VERIFY_TITLE:DIRECT_TITLE}]});
   }
   return wrap({total_count:0,workflow_runs:[]});
  }
  if(wf===DIRECT&&url.includes("/actions/runs/113/jobs")){
   const mk=(name,conclusion="success")=>({name,status:"completed",conclusion});
   const j={id:511,name:"direct-protected-recovery-tick",run_id:113,head_sha:SHA,run_attempt:1,status:"completed",conclusion:"success",
    steps:[mk("Execute one direct recovery wave and reconcile exact parent ACKs"),mk("Preserve direct terminal operational receipt"),
     mk("Direct outcome TERMINAL_PARENT_ACKS_RECONCILED",["directSafeHold","directCarried"].includes(fault)?"skipped":"success"),mk("Direct outcome PREFLIGHT_HOLD_NO_POST",fault==="directSafeHold"?"success":"skipped"),mk("Direct outcome KNOWN_ACTIVE_PARENT_ACKS_CARRIED",fault==="directCarried"?"success":"skipped")]};
   if(fault==="directMissingMarker")j.steps.pop();
   
   if(env.TRAVNR_RELAY_ROLLING_ROUTE==="DIRECT_VERIFY"){j.name="direct-readonly-verify";j.steps=[mk("Verify exact direct wake and existing workflow metadata NO POST")];}
   return wrap({total_count:3,jobs:[j,{...j,id:512,name:"offline-direct-recovery",conclusion:"skipped",steps:[]},
    {...j,id:513,name:env.TRAVNR_RELAY_ROLLING_ROUTE==="DIRECT_VERIFY"?"direct-protected-recovery-tick":"direct-readonly-verify",conclusion:"skipped",steps:[]}]});
  }
  if(url.includes("/actions/runs/112/jobs"))return wrap({total_count:2,jobs:[{id:501,name:"one-protected-bounded-session",run_id:112,head_sha:SHA,run_attempt:1,status:"completed",conclusion:fault==="skip"?"skipped":"success",steps:fault==="skip"?[]:[{name:"Execute one protected rolling session"}]},{id:502,name:"offline-bounded-session-reconciliation",run_id:112,head_sha:SHA,run_attempt:1,status:"completed",conclusion:"skipped",steps:[]}]});
  if(url.includes("/actions/runs/111/jobs"))return wrap({total_count:1,jobs:[{id:1111,name:"primary-fids-expiry",run_id:111,head_sha:SHA,run_attempt:1,status:"completed",conclusion:"success",completed_at:new Date(NOW-(fault==="recent"?5:40)*60000).toISOString(),steps:[{name:"Verify exact main and execute only bounded primary FIDS expiry",status:"completed",conclusion:"success"}]}]});
  if(url.includes("&status="))return wrap({total_count:fault==="active"?1:0,workflow_runs:fault==="active"?[row(301,wf,SHA,"queued")]:[]});
  if(url.includes("per_page=20"))return wrap({total_count:1,workflow_runs:[{...row(111,wf),event:["verifyOnly","coldStart","evilHost","notZero","twoJobVerify","executedSibling","unknownSibling"].includes(fault)?"workflow_dispatch":"schedule"}]});
  if(url.includes("&created="))return wrap({total_count:["window","skip","partial","failedRoot"].includes(fault)?1:0,workflow_runs:["window","skip","partial","failedRoot"].includes(fault)?[{...row(112,wf),conclusion:fault==="failedRoot"?"failure":"success"}]:[]});
  throw Error("unexpected request");
 };
 return {env,opts:{now:()=>NOW,fetcher,emit:x=>events.push(x),sleep:async()=>{}},posts:()=>posts,body:()=>body,events};
}
test("clock only requires no target credential and dispatches nothing",async()=>{const x=f("CLOCK_ONLY");delete x.env.TRAVNR_TARGET_ACTIONS_TOKEN;assert.equal((await runPulse(x.env,x.opts)).status,"EXTERNAL_CLOCK_OBSERVED_NO_TARGET_DISPATCH");assert.equal(x.posts(),0);});
test("pilot forwards exactly one existing nonpaid OBSERVE",async()=>{const x=f("PILOT");assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);assert.deepEqual(x.body().inputs,{mode:"OBSERVE"});assert.equal(x.posts(),1);});
test("stale primary selects existing primary-only backstop confirmation",async()=>{const x=f("PRIMARY_BACKSTOP");assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);assert.equal(x.body().inputs.confirm,"APPLY_REVIEWED_PRIMARY_FIDS_BACKSTOP_NO_PRIVATE_MUTATION");assert.equal(x.posts(),1);});
test("recent actual primary job prevents redundant dispatch",async()=>{const x=f("PRIMARY_BACKSTOP","recent");assert.match((await runPulse(x.env,x.opts)).status,/DEFER_RECENT/);assert.equal(x.posts(),0);});
test("rolling root uses existing dynamic manual contract before cutoff",async()=>{const x=f("ROLLING_ROOT");assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);assert.equal(x.body().inputs.confirm,"RUN_UP_TO_FOUR_PROTECTED_ROLLING_SESSIONS_AFTER_SEPARATE_PHASE6_GO");assert.equal(x.body().inputs.scheduled_root_run_id,"");assert.equal(x.posts(),1);});
for(const [mode,fault] of [["PILOT","prior"],["PILOT","active"],["PILOT","drift"],["ROLLING_ROOT","window"]])test("no POST "+fault,async()=>{const x=f(mode,fault);await runPulse(x.env,x.opts);assert.equal(x.posts(),0);});
test("unknown ACK never retries",async()=>{const x=f("PILOT","ack");await assert.rejects(runPulse(x.env,x.opts),/NO_BLIND_REPLAY/);assert.equal(x.posts(),1);});
test("scope rejects provider keys and foreign repository",async()=>{for(const a of [{AERODATABOX_API_KEY:"x"},{GITHUB_REPOSITORY:TARGET}]){const x=f("PILOT");await assert.rejects(runPulse({...x.env,...a},x.opts),/SCOPE/);assert.equal(x.posts(),0);}});
test("dynamic scope declines late window and never invents approval",()=>{const a=new Date(NOW-110*60000).toISOString(),b=new Date(NOW+10*60000).toISOString();assert.equal(rootInputs(NOW,a,b,SHA,true),null);});
test("cron job targets isolated relay only, disabled by default, expiring, no target token",()=>{const j=cronJobSpec(tok,NOW);assert.equal(j.enabled,false);assert.equal(j.requestMethod,1);assert.equal(j.schedule.expiresAt,20261118073000);assert.match(j.url,/TravnrClockRelay/);assert(!j.url.includes("ReplitTranvr"));});

test("already-terminal target failure quarantines the attempted wake",async()=>{const x=f("PILOT","targetFailed");await assert.rejects(runPulse(x.env,x.opts),/ACK_TARGET_TERMINAL_FAILURE_REVIEW_NO_BLIND_REPLAY/);assert.equal(x.posts(),1);});

test("VERIFY-only success is not expiry APPLY freshness or initial baseline",async()=>{const x=f("PRIMARY_BACKSTOP","verifyOnly");assert.match((await runPulse(x.env,x.opts)).status,/NO_CURRENT_MAIN_APPLY_BASELINE/);assert.equal(x.posts(),0);});
test("all exact skipped jobs permit only guarded target root wake",async()=>{const x=f("ROLLING_ROOT","skip");assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);assert.equal(x.posts(),1);assert(x.events.some(e=>e.status==="EXTERNAL_WAKE_ONLY_SKIPPED_CONTROLLER_HISTORY_NO_DB_AUTHORITY"));});
test("actual or partially executed protected root never replays",async()=>{const x=f("ROLLING_ROOT","partial");assert.match((await runPulse(x.env,x.opts)).status,/CUSTODY_REVIEW/);assert.equal(x.posts(),0);});
test("failed protected root requires custody reconciliation, never replays",async()=>{const x=f("ROLLING_ROOT","failedRoot");assert.match((await runPulse(x.env,x.opts)).status,/CUSTODY_REVIEW/);assert.equal(x.posts(),0);});

function multi(mode,fault=""){
 const x=f(mode,fault);
 Object.assign(x.env,{TRAVNR_RELAY_MODE:"MULTI_LANE",TRAVNR_TARGET_FORWARD_ENV_READY:"1",TRAVNR_RELAY_LANE:mode,TRAVNR_RELAY_PRIMARY_ENABLED:"1",TRAVNR_RELAY_ROLLING_ENABLED:"1",TRAVNR_RELAY_PRIMARY_SINCE_UTC:new Date(NOW-3600000).toISOString(),TRAVNR_RELAY_ROLLING_SINCE_UTC:new Date(NOW-3600000).toISOString()});
 return x;
}
test("multi-lane rolling independent of known terminal primary failure",async()=>{const x=multi("ROLLING_ROOT","otherLane");assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);assert.equal(x.posts(),1);});
test("multi-lane primary independent of known terminal rolling failure",async()=>{const x=multi("PRIMARY_BACKSTOP","otherLane");assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);assert.equal(x.posts(),1);});
test("same lane and unidentified prior failures quarantine",async()=>{for(const fault of ["sameLane","unknownLane"]){const x=multi("ROLLING_ROOT",fault);assert.match((await runPulse(x.env,x.opts)).status,/QUARANTINED/);assert.equal(x.posts(),0);}});
test("disabled lane is independent and never requires target credentials",async()=>{const x=multi("PRIMARY_BACKSTOP");delete x.env.TRAVNR_TARGET_ACTIONS_TOKEN;x.env.TRAVNR_RELAY_PRIMARY_ENABLED="0";assert.match((await runPulse(x.env,x.opts)).status,/LANE_OFF/);assert.equal(x.posts(),0);});
test("multi-lane clock-only never receives target authority",async()=>{const x=multi("CLOCK_ONLY");delete x.env.TRAVNR_TARGET_ACTIONS_TOKEN;assert.equal((await runPulse(x.env,x.opts)).status,"EXTERNAL_CLOCK_OBSERVED_NO_TARGET_DISPATCH");assert.equal(x.posts(),0);});
test("single-lane mode rejects spoofed workflow input",async()=>{const x=f("CLOCK_ONLY");x.env.TRAVNR_RELAY_LANE="ROLLING_ROOT";await assert.rejects(runPulse(x.env,x.opts),/SCOPE/);assert.equal(x.posts(),0);});

test("first primary wake from exact selected VERIFY receipt is guarded and never counts as APPLY freshness",async()=>{
 const x=f("PRIMARY_BACKSTOP","coldStart");x.env.TRAVNR_RELAY_PRIMARY_VERIFY_RUN_ID="202";
 assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);assert.equal(x.posts(),1);
 assert(x.events.some(e=>e.status==="EXTERNAL_FIRST_PRIMARY_WAKE_FROM_EXACT_VERIFY_NOT_APPLY_FRESHNESS"));
});
test("initial wake refuses nonzero due counter or untrusted signed log host",async()=>{
 for(const fault of ["notZero","evilHost"]){const x=f("PRIMARY_BACKSTOP",fault);x.env.TRAVNR_RELAY_PRIMARY_VERIFY_RUN_ID="202";assert.match((await runPulse(x.env,x.opts)).status,/PREFLIGHT_DEFERRED/);assert.equal(x.posts(),0);}
});
test("VERIFY receipt must be exact, zero, unique and fresh",()=>{
 const log=JSON.stringify(bootStatus),jobs={total_count:1,jobs:[bootJob]};
 assert.equal(verifyPrimaryBootstrapReceipt(bootRow,jobs,log,SHA,202,NOW).verifiedJobId,1202);
 for(const x of [()=>verifyPrimaryBootstrapReceipt(bootRow,jobs,log,SHA,202,NOW+7*3600000),()=>verifyPrimaryBootstrapReceipt(bootRow,jobs,log+"\n"+log,SHA,202,NOW),()=>verifyPrimaryBootstrapReceipt(bootRow,jobs,log,"b".repeat(40),202,NOW)])assert.throws(x,/PRIMARY_BOOTSTRAP_VERIFY/);
});
test("signed job-log retrieval never forwards target bearer or accepts arbitrary host",async()=>{
 let seen=0;const log=await readPrimaryVerifyLog(async(url,init)=>{seen++;if(seen===1){assert.equal(init.redirect,"manual");return new Response("",{status:302,headers:{Location:"https://logs.blob.core.windows.net/path?sig=fixture"}});}assert.equal(init.headers,undefined);assert.equal(init.redirect,"error");return new Response("sanitized fixture");},tok,1202);
 assert.equal(log,"sanitized fixture");assert.equal(seen,2);
});

test("exact skipped target-capable step recovers the same lane without considering uncertain POST safe",async()=>{
 const x=multi("ROLLING_ROOT","skippedForward");assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);
 assert.equal(x.posts(),1);assert(x.events.some(e=>e.status==="PRIOR_RELAY_FAILURE_EXACT_TARGET_STEP_SKIPPED_NO_POST"));
 const y=multi("ROLLING_ROOT","oldCodeFailure");assert.match((await runPulse(y.env,y.opts)).status,/QUARANTINED/);assert.equal(y.posts(),0);
});
test("missing target job or started target step never proves safe recovery",()=>{
 const r={id:712,head_sha:LOCAL,run_attempt:1,status:"completed"};
 const js=["offline-tests","independent-pulse","target-forward"].map((name,i)=>({id:900+i,name,run_id:r.id,head_sha:LOCAL,run_attempt:1,status:"completed",conclusion:i===2?"failure":"skipped",steps:i===2?[{name:"Run node cli.mjs",status:"completed",conclusion:"skipped"}]:[]}));
 assert.equal(provesNoTargetStep(r,js),true);assert.equal(provesNoTargetStep(r,js.slice(0,2)),false);
 assert.equal(provesNoTargetStep(r,[...js.slice(0,2),{...js[2],steps:[]}]),false);
 assert.equal(provesNoTargetStep(r,[...js.slice(0,2),{...js[2],steps:[{name:"Run node cli.mjs",status:"completed",conclusion:"failure"}]}]),false);
});

test("multi-lane recovery cannot forward from an uncommissioned target environment",async()=>{const x=multi("ROLLING_ROOT");delete x.env.TRAVNR_TARGET_FORWARD_ENV_READY;const r=await runPulse(x.env,x.opts);assert.equal(r.status,"EXTERNAL_WAKE_PREFLIGHT_DEFERRED_NO_POST");assert.equal(r.reason,"HOLD_EXTERNAL_CLOCK_TARGET_FORWARD_ENV_NOT_COMMISSIONED");assert.equal(x.posts(),0)});

test("each shadow recovery clock is secret-free and touches only its own run metadata",async()=>{
 for(const lane of ["PRIMARY_BACKSTOP","ROLLING_ROOT"]){
  const x=f(lane);Object.assign(x.env,{TRAVNR_RELAY_MODE:"SHADOW_PAIR",TRAVNR_RELAY_LANE:lane,TRAVNR_TARGET_ACTIONS_TOKEN:""});
  const fetcher=x.opts.fetcher;let reads=0;
  x.opts.fetcher=async(url,init)=>{assert.equal(url,root+RELAY+"/actions/runs/100");assert.equal(init.method,"GET");reads++;return fetcher(url,init);};
  const a=await runPulse(x.env,x.opts);assert.equal(a.status,"EXTERNAL_RECOVERY_LANE_SHADOW_OBSERVED_NO_TARGET_DISPATCH");assert.equal(a.mode,lane);assert.equal(a.relayDispatches,0);assert.equal(reads,1);
  await assert.rejects(runPulse({...x.env,TRAVNR_TARGET_ACTIONS_TOKEN:tok},x.opts),/SCOPE/);
 }
});

test("transient preflight GET failures recover without retrying a target POST",async()=>{
 for(const fault of [502,503,504,"transport","timeout",429]){
  const x=multi("PRIMARY_BACKSTOP");let failed=0;const get=x.opts.fetcher;
  x.opts.fetcher=async(url,init)=>{
   if(init.method==="GET"&&url===root+TARGET+"/git/ref/heads/main"&&failed<2){
    failed++;
    if(fault==="transport")throw new TypeError("synthetic transport failure");
    if(fault==="timeout")throw new DOMException("synthetic timeout","TimeoutError");
    return {...wrap({},fault),headers:new Headers(fault===429?{"retry-after":"1"}:{})};
   }
   return get(url,init);
  };
  assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);
  assert.equal(failed,2);assert.equal(x.posts(),1);
  assert.equal(x.events.filter(e=>e.status==="EXTERNAL_WAKE_PREFLIGHT_GET_RETRY_NO_POST").length,2);
 }
});
test("exhausted transient GET never dispatches and has a bounded attempt count",async()=>{
 const x=multi("PRIMARY_BACKSTOP");let n=0;const get=x.opts.fetcher;
 x.opts.fetcher=async(url,init)=>init.method==="GET"&&url===root+TARGET+"/git/ref/heads/main"?(n++,wrap({},503)):get(url,init);
 const r=await runPulse(x.env,x.opts);
 assert.equal(r.reason,"HOLD_EXTERNAL_CLOCK_GET_HTTP_503");assert.equal(n,3);assert.equal(x.posts(),0);
});
test("hard authorization and long or unspecified rate limits do not retry",async()=>{
 for(const [status,retry] of [[401,null],[403,null],[404,null],[429,null],[429,"60"],[503,"60"]]){
  const x=multi("PRIMARY_BACKSTOP");let n=0;const get=x.opts.fetcher;
  x.opts.fetcher=async(url,init)=>init.method==="GET"&&url===root+TARGET+"/git/ref/heads/main"?(n++,{...wrap({},status),headers:new Headers(retry==null?{}:{"retry-after":retry})}):get(url,init);
  const r=await runPulse(x.env,x.opts);
  assert.equal(r.reason,"HOLD_EXTERNAL_CLOCK_GET_HTTP_"+status);assert.equal(n,1);assert.equal(x.posts(),0);
 }
});
test("readback after a single acknowledged POST retains original four GET limit",async()=>{
 const x=multi("PRIMARY_BACKSTOP");let n=0;const get=x.opts.fetcher;
 x.opts.fetcher=async(url,init)=>init.method==="GET"&&url===root+TARGET+"/actions/runs/201"?(n++,wrap({},503)):get(url,init);
 await assert.rejects(runPulse(x.env,x.opts),/NO_BLIND_REPLAY/);
 assert.equal(n,4);assert.equal(x.posts(),1);
 assert.equal(x.events.filter(e=>e.status==="EXTERNAL_WAKE_PREFLIGHT_GET_RETRY_NO_POST").length,0);
});
test("retry delay cannot move preflight beyond the existing two-minute admission bound",async()=>{
 const x=multi("PRIMARY_BACKSTOP");let clock=NOW,n=0;const get=x.opts.fetcher;
 x.opts.now=()=>clock;
 x.opts.fetcher=async(url,init)=>{
  if(init.method==="GET"&&url===root+TARGET+"/git/ref/heads/main"){
   n++;clock=NOW+119000;return wrap({},503);
  }
  return get(url,init);
 };
 const r=await runPulse(x.env,x.opts);assert.equal(r.reason,"HOLD_EXTERNAL_CLOCK_GET_HTTP_503");assert.equal(n,1);assert.equal(x.posts(),0);
});

function directFixture(fault="directFresh"){
 const x=multi("ROLLING_ROOT",fault);
 Object.assign(x.env,{TRAVNR_RELAY_ROLLING_ROUTE:"DIRECT_TICK",TRAVNR_RELAY_DIRECT_TICK_APPROVED:"1",TRAVNR_RELAY_ROLLING_SINCE_UTC:new Date(NOW-20*60000).toISOString(),
  TRAVNR_ROLLING_POLICY_FROM_UTC:new Date(NOW-60*60000).toISOString()});
 return x;
}
test("direct route is one fixed target POST, independent of V0102 or root scope",async()=>{
 for(const fault of ["directFresh","directOld","directSafeHold","directCarried"]){
  const x=directFixture(fault);const r=await runPulse(x.env,x.opts);
  assert.equal(r.targetWorkflow,DIRECT);assert.equal(r.targetRunId,201);assert.equal(x.posts(),1);
  assert.deepEqual(x.body().inputs,{confirm:DIRECT_CONFIRM,approved_main_sha:SHA});
 }
});
test("direct route refuses absent approval, prior root failure, recent or malformed prior tick and old active controller",async()=>{
 for(const fault of ["directRecent","directMissingMarker","directOldActive","directPriorFailure"]){
  const x=directFixture(fault);const r=await runPulse(x.env,x.opts);assert.equal(x.posts(),0);assert(r.status!== "TARGET_ACK_AND_RUN_IDENTITY_VERIFIED_NOT_COLLECTION_PROOF");
 }
 const x=directFixture();delete x.env.TRAVNR_RELAY_DIRECT_TICK_APPROVED;
 assert.match((await runPulse(x.env,x.opts)).reason,/DIRECT_TICK_NOT_SEPARATELY_APPROVED/);assert.equal(x.posts(),0);
 const y=directFixture();y.env.TRAVNR_ROLLING_POLICY_UNTIL_UTC=new Date(NOW+24*60000).toISOString();
 assert.equal((await runPulse(y.env,y.opts)).status,"DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW");assert.equal(y.posts(),0);
});
test("direct route unknown ACK never falls back to rolling root or repeats",async()=>{
 const x=directFixture("directAck");await assert.rejects(runPulse(x.env,x.opts),/NO_BLIND_REPLAY/);assert.equal(x.posts(),1);
});

test("bounded direct VERIFY reuses one wake without paid policy and cannot set tick approval",async()=>{
 for(const fault of ["directFresh","directOld"]){
  const x=directFixture(fault);Object.assign(x.env,{TRAVNR_RELAY_ROLLING_ROUTE:"DIRECT_VERIFY",TRAVNR_RELAY_DIRECT_TICK_APPROVED:"0"});
  delete x.env.TRAVNR_ROLLING_POLICY_FROM_UTC;delete x.env.TRAVNR_ROLLING_POLICY_UNTIL_UTC;
  const out=await runPulse(x.env,x.opts);assert.equal(out.targetWorkflow,DIRECT);assert.equal(x.posts(),1);
  assert.deepEqual(x.body().inputs,{confirm:DIRECT_VERIFY_CONFIRM,approved_main_sha:SHA});
 }
 const y=directFixture();y.env.TRAVNR_RELAY_ROLLING_ROUTE="DIRECT_VERIFY";
 assert.match((await runPulse(y.env,y.opts)).reason,/DIRECT_TICK_NOT_SEPARATELY_APPROVED/);assert.equal(y.posts(),0);
 const z=directFixture();Object.assign(z.env,{TRAVNR_RELAY_ROLLING_ROUTE:"DIRECT_VERIFY",TRAVNR_RELAY_DIRECT_TICK_APPROVED:"0",TRAVNR_RELAY_ROLLING_SINCE_UTC:new Date(NOW-116*60000).toISOString()});
 assert.equal((await runPulse(z.env,z.opts)).status,"DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW");assert.equal(z.posts(),0);
});

// GitHub can expose the newly created workflow run before evaluating run-name.
// The live Nov18 verify dispatch returned an ACK, then failed readback, while
// its independently read target later succeeded on the expected title/commit.
test("direct acknowledged active run permits delayed title evaluation using only same-ID GET",async()=>{
 for(const route of ["DIRECT_VERIFY","DIRECT_TICK"]){
  const x=directFixture();if(route==="DIRECT_VERIFY")Object.assign(x.env,{TRAVNR_RELAY_ROLLING_ROUTE:route,TRAVNR_RELAY_DIRECT_TICK_APPROVED:"0"});
  const get=x.opts.fetcher;let n=0;
  x.opts.fetcher=async(url,init)=>{if(init.method==="GET"&&url===root+TARGET+"/actions/runs/201"){
   if(++n<=2)return wrap({...row(201,DIRECT,SHA,"queued"),display_title:"Phase6 direct existing-worker recovery (STOP default)"});
  }return get(url,init);};
  assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);assert.equal(n,3);assert.equal(x.posts(),1);
  assert.equal(x.events.filter(e=>e.status==="EXTERNAL_WAKE_ACK_ACTIVE_TITLE_PENDING_GET_ONLY").length,2);
 }
});
test("direct wrong active title exhaustion, terminal wrong title and immutable drift never replay or pass",async()=>{
 for(const [fault,expected,reads] of [["active","ACK_READBACK_TITLE_DRIFT",4],["terminal","ACK_READBACK_TITLE_DRIFT",1],["sha","ACK_READBACK_IMMUTABLE_DRIFT",1],["id","ACK_READBACK_IMMUTABLE_DRIFT",1],["event","ACK_READBACK_IMMUTABLE_DRIFT",1]]){
  const x=directFixture();let n=0;const get=x.opts.fetcher;
  x.opts.fetcher=async(url,init)=>{if(init.method==="GET"&&url===root+TARGET+"/actions/runs/201"){
   n++;return wrap({...row(fault==="id"?999:201,DIRECT,fault==="sha"?LOCAL:SHA,fault==="terminal"?"completed":"queued"),event:fault==="event"?"schedule":"workflow_dispatch",display_title:fault==="sha"||fault==="id"||fault==="event"?DIRECT_TITLE:"wrong"});
  }return get(url,init);};
  await assert.rejects(runPulse(x.env,x.opts),new RegExp(expected+"_NO_BLIND_REPLAY"));assert.equal(n,reads);assert.equal(x.posts(),1);
 }
});
test("a pending direct title followed by terminal target failure remains quarantined",async()=>{
 const x=directFixture();const get=x.opts.fetcher;let n=0;
 x.opts.fetcher=async(url,init)=>{if(init.method==="GET"&&url===root+TARGET+"/actions/runs/201"){
  n++;return wrap(n===1?{...row(201,DIRECT,SHA,"queued"),display_title:"pending"}:{...row(201,DIRECT),display_title:DIRECT_TITLE,conclusion:"failure"});
 }return get(url,init);};
 await assert.rejects(runPulse(x.env,x.opts),/ACK_TARGET_TERMINAL_FAILURE_REVIEW_NO_BLIND_REPLAY/);assert.equal(x.posts(),1);assert.equal(n,2);
});

test("two-job primary VERIFY selects named primary log regardless of job order",async()=>{
 const x=f("PRIMARY_BACKSTOP","twoJobVerify");x.env.TRAVNR_RELAY_PRIMARY_VERIFY_RUN_ID="202";
 assert.equal((await runPulse(x.env,x.opts)).targetRunId,201);assert.equal(x.posts(),1);
 assert(x.events.some(e=>e.status==="EXTERNAL_FIRST_PRIMARY_WAKE_FROM_EXACT_VERIFY_NOT_APPLY_FRESHNESS"));
});
test("executed or unknown research sibling cannot bootstrap primary dispatch",async()=>{
 for(const fault of ["executedSibling","unknownSibling"]){
  const x=f("PRIMARY_BACKSTOP",fault);x.env.TRAVNR_RELAY_PRIMARY_VERIFY_RUN_ID="202";
  assert.match((await runPulse(x.env,x.opts)).status,/PREFLIGHT_DEFERRED/);assert.equal(x.posts(),0);
 }
});
test("two-job primary receipt rejects incomplete, duplicate, drifted, or partially executed sibling",()=>{
 const sibling={...bootJob,id:1203,name:"phase7-expiry",conclusion:"skipped",steps:[]};
 const log=JSON.stringify(bootStatus);
 assert.equal(verifyPrimaryBootstrapReceipt(bootRow,{total_count:2,jobs:[sibling,bootJob]},log,SHA,202,NOW).verifiedJobId,1202);
 for(const rows of [[bootJob,{...sibling,head_sha:LOCAL}],[bootJob,{...sibling,id:bootJob.id}],[bootJob,{...sibling,run_attempt:2}],[bootJob,{...sibling,steps:[{name:"unexpected",conclusion:"skipped"}]}],[bootJob,sibling,{...sibling,id:1204}]]){
  assert.throws(()=>verifyPrimaryBootstrapReceipt(bootRow,{total_count:rows.length,jobs:rows},log,SHA,202,NOW),/PRIMARY_BOOTSTRAP_VERIFY/);
 }
 assert.throws(()=>verifyPrimaryBootstrapReceipt(bootRow,{total_count:2,jobs:[bootJob]},log,SHA,202,NOW),/PRIMARY_BOOTSTRAP_VERIFY/);
});

test("separate full retention scope defaults OFF; no legacy single-lane broadening",async()=>{
 const x=f("PRIMARY_BACKSTOP");x.env.TRAVNR_RELAY_FULL_RETENTION_APPROVED="1";
 assert.match((await runPulse(x.env,x.opts)).status,/PREFLIGHT_DEFERRED/);
 assert.equal(x.posts(),0);
});
test("full retention cannot treat prior primary-only success as full cleanup",async()=>{
 const x=multi("PRIMARY_BACKSTOP");x.env.TRAVNR_RELAY_FULL_RETENTION_APPROVED="1";
 const get=x.opts.fetcher;
 x.opts.fetcher=async(url,init)=>{const z=await get(url,init);
  if(url.includes("/actions/workflows/"+PRIMARY+"/runs?branch=main&per_page=20")&&init?.method!=="POST"){
   const raw=await z.json();return {ok:true,status:200,json:async()=>({...raw,workflow_runs:raw.workflow_runs.map(r=>({...r,event:"workflow_dispatch",display_title:"P5 PRIMARY BACKSTOP CHILD"}))})};
  }return z;
 };
 const q=await runPulse(x.env,x.opts);assert.match(q.status,/NO_CURRENT_MAIN_FULL_RETENTION_APPLY_BASELINE/);assert.equal(x.posts(),0);
});

test("full retention accepts a stale successful explicit full-scope dual-job baseline and makes exactly one scoped wake",async()=>{
 const x=multi("PRIMARY_BACKSTOP");x.env.TRAVNR_RELAY_FULL_RETENTION_APPROVED="1";
 const get=x.opts.fetcher;
 x.opts.fetcher=async(url,init)=>{
  if(url.includes("/actions/runs/111/jobs")){
   const z=await get(url,init),v=await z.json();
   return wrap({total_count:2,jobs:[...v.jobs,{...v.jobs[0],id:v.jobs[0].id+100,name:"phase7-expiry",steps:[{name:"Bounded derived research and temporary link due-only expiry",status:"completed",conclusion:"success"}]}]});
  }
  if(url.includes("/actions/workflows/"+PRIMARY+"/runs?branch=main&per_page=20"))return wrap({total_count:1,workflow_runs:[{...row(111,PRIMARY),created_at:new Date(NOW-50*60000).toISOString(),display_title:FULL_RETENTION_TITLE}]});
  if(url===root+TARGET+"/actions/runs/201")return wrap({...row(201,PRIMARY,SHA,"queued"),display_title:FULL_RETENTION_TITLE});
  return get(url,init);
 };
 const q=await runPulse(x.env,x.opts);
 assert.equal(q.targetRunId,201);assert.equal(x.body().inputs.confirm,FULL_RETENTION_CONFIRM);assert.equal(x.posts(),1);
});
test("full retention refuses a scheduled baseline without successful research sibling",async()=>{
 const x=multi("PRIMARY_BACKSTOP");x.env.TRAVNR_RELAY_FULL_RETENTION_APPROVED="1";
 const q=await runPulse(x.env,x.opts);
 assert.match(q.reason,/FULL_RETENTION_JOB_SET|FULL_RETENTION_RESEARCH_STEP/);assert.equal(x.posts(),0);
});

test("full retention never bootstraps from the selected primary-only read-only receipt",async()=>{
 const x=multi("PRIMARY_BACKSTOP","coldStart");
 x.env.TRAVNR_RELAY_FULL_RETENTION_APPROVED="1";
 x.env.TRAVNR_RELAY_PRIMARY_VERIFY_RUN_ID="202";
 const q=await runPulse(x.env,x.opts);
 assert.match(q.status,/NO_CURRENT_MAIN_FULL_RETENTION_APPLY_BASELINE/);
 assert.equal(x.posts(),0);
});
// Match actual projected production receipt (44929165704, job 136921785419),
// including PostgreSQL offset timestamps and no nested SQL-only flags.
const privateExpiryStatus={observedAtUtc:new Date(NOW-41*60000).toISOString().replace("Z","+00:00"),duePackets:0,dueIndexes:0,expiredHeads:0,foreignDuePackets:0,foreignDueIndexes:0,claims:0,deletionStopUnresolved:false};
const privateExpiryApply={before:privateExpiryStatus,after:privateExpiryStatus,deadlineDueObservedAtInitialRead:false,providerCalls:0,backupOrPitrVerified:false,completeRetentionDeploymentVerified:false,phase6PaidGo:false,receipts:[],databaseWritesPossible:false,status:"PRIVATE_EXPIRY_DUE_AT_READBACK_CLEARED",reviewedMainSha:SHA};
const nativeExpiryRun={...row(111,PRIMARY),created_at:new Date(NOW-50*60000).toISOString(),event:"schedule"};
const nativeExpiryJob={completed_at:new Date(NOW-40*60000).toISOString()};
test("native full retention requires a single exact private APPLY receipt, not VERIFY or a shifted clock",()=>{
 const log=x=>"timestamp "+JSON.stringify(x);
 assert.deepEqual(verifyNativeFullRetentionPrivateReceipt(log(privateExpiryApply),nativeExpiryRun,nativeExpiryJob),{privateApplyReceiptVerified:true});
 for(const bad of [{...privateExpiryApply,status:"PRIVATE_EXPIRY_VERIFY_ONLY_NO_WRITES"},{...privateExpiryApply,reviewedMainSha:LOCAL},{...privateExpiryApply,deadlineDueObservedAtInitialRead:true},{...privateExpiryApply,databaseWritesPossible:true},{...privateExpiryApply,receipts:[{}]},{...privateExpiryApply,after:{...privateExpiryStatus,claims:32}},{...privateExpiryApply,after:{...privateExpiryStatus,claims:1}},{...privateExpiryApply,after:{...privateExpiryStatus,foreignDuePackets:1}},{...privateExpiryApply,after:{...privateExpiryStatus,observedAtUtc:new Date(NOW).toISOString()}}])
  assert.throws(()=>verifyNativeFullRetentionPrivateReceipt(log(bad),nativeExpiryRun,nativeExpiryJob),/FULL_RETENTION_NATIVE_PRIVATE_APPLY/);
 assert.throws(()=>verifyNativeFullRetentionPrivateReceipt(log(privateExpiryApply)+"\n"+log(privateExpiryApply),nativeExpiryRun,nativeExpiryJob),/FULL_RETENTION_NATIVE_PRIVATE_APPLY/);
});
test("native dual-job success is not enough if private APPLY was not executed",async()=>{
 for(const apply of [true,false]){
  const x=multi("PRIMARY_BACKSTOP");x.env.TRAVNR_RELAY_FULL_RETENTION_APPROVED="1";
  const get=x.opts.fetcher;
  x.opts.fetcher=async(url,init)=>{
   if(url.includes("/actions/workflows/"+PRIMARY+"/runs?branch=main&per_page=20"))return wrap({total_count:1,workflow_runs:[nativeExpiryRun]});
   if(url.includes("/actions/runs/111/jobs")){
    const z=await get(url,init),v=await z.json();
    return wrap({total_count:2,jobs:[...v.jobs,{...v.jobs[0],id:1112,name:"phase7-expiry",steps:[{name:"Bounded derived research and temporary link due-only expiry",status:"completed",conclusion:"success"}]}]});
   }
   if(url===root+TARGET+"/actions/jobs/1111/logs")return new Response("",{status:302,headers:{Location:"https://logs.blob.core.windows.net/private-fixture"}});
   if(url==="https://logs.blob.core.windows.net/private-fixture"){assert.equal(init.headers,undefined);return new Response("timestamp "+JSON.stringify(apply?privateExpiryApply:{...privateExpiryApply,status:"PRIVATE_EXPIRY_VERIFY_ONLY_NO_WRITES"}));}
   if(url===root+TARGET+"/actions/runs/201")return wrap({...row(201,PRIMARY,SHA,"queued"),display_title:FULL_RETENTION_TITLE});
   return get(url,init);
  };
  const q=await runPulse(x.env,x.opts);
  if(apply){assert.equal(q.targetRunId,201);assert.equal(x.posts(),1);}
  else{assert.match(q.reason,/FULL_RETENTION_NATIVE_PRIVATE_APPLY_RECEIPT/);assert.equal(x.posts(),0);}
 }
});
