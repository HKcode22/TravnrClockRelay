import test from "node:test";
import assert from "node:assert/strict";
import {PILOT,REPO,WF,config,validateJob,planned,classify,ack,verifyReceipt,samples,audit,observeTargetStep,leaseHealth,shadowConfigs,repairedShadowConfigs} from "./cron-audit.mjs";
const c=PILOT,base="https://api.github.com/repos/"+REPO,url=base+"/actions/workflows/"+WF+"/dispatches";
const now=Date.parse("2026-11-18T07:56:00Z"),slots=planned(c,"PILOT",now),p=slots[0];
const row=(s=p,n=1)=>({jobId:c.jobId,datePlanned:s,date:s+1,jitter:1200,identifier:"history-"+n,url,status:1,httpStatus:200});
const job={jobId:c.jobId,title:c.title,url,enabled:true,requestMethod:1,type:0,saveResponses:true,redirectSuccess:false,requestTimeout:30,auth:{enable:false},
 schedule:{timezone:"UTC",expiresAt:20261118075306,hours:[-1],mdays:[-1],months:[-1],wdays:[-1],minutes:[2,12,22,32,42,52]},
 extendedData:{headers:{Authorization:"Bearer github_pat_"+"x".repeat(40),Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28"},body:JSON.stringify({ref:"main",return_run_details:true})},
 notification:{onFailure:true,onFailureCount:1,onDisable:true}};
const i=x=>new Date(x).toISOString(),mk=(s=p,n=101)=>{
 const r=row(s,n),created=i((s+2)*1000),observed=i((s+20)*1000);
 const run={id:n,head_sha:c.pin,head_branch:"main",path:".github/workflows/"+WF,event:"workflow_dispatch",run_attempt:1,status:"completed",conclusion:"success",created_at:created};
 const j={id:n+1000,name:"independent-pulse",head_sha:c.pin,run_id:n,run_attempt:1,status:"completed",conclusion:"success",started_at:i((s+10)*1000),completed_at:i((s+25)*1000),steps:[{name:"Run node cli.mjs",status:"completed",conclusion:"success"}]};
 const receipt={status:"EXTERNAL_CLOCK_OBSERVED_NO_TARGET_DISPATCH",relayRunId:n,mode:"CLOCK_ONLY",actualCreatedUtc:created,runnerObservedUtc:observed,creationToObservedMs:18000,providerCallsByRelay:0,databaseReadsByRelay:0,databaseWritesByRelay:0,paidAuthorityGranted:false};
 const detail={jobHistoryDetails:{...r,body:JSON.stringify({workflow_run_id:n,run_url:base+"/actions/runs/"+n,html_url:"https://github.com/"+REPO+"/actions/runs/"+n})}};
 return {r,run,jobs:{total_count:1,jobs:[j]},receipt,log:JSON.stringify(receipt),detail};
};
test("owner setup timestamps bind exactly nine UTC pilot slots",()=>{assert.equal(slots.length,9);assert.equal(i(slots[0]*1000),"2026-11-18T06:32:00.000Z");assert.equal(i(slots.at(-1)*1000),"2026-11-18T07:52:00.000Z");assert.deepEqual(config({},"PILOT"),c)});
test("not due until grace elapsed",()=>assert.equal(planned(c,"PILOT",p*1000+1000).length,0));
test("job exact configuration passes and never returns header",()=>{assert.deepEqual(validateJob(c,job),{enabled:true,expiresAt:c.until});for(const m of [{jobId:1},{url:"https://example.com"},{redirectSuccess:true},{auth:{enable:true}},{schedule:{...job.schedule,minutes:[0]}},{extendedData:{...job.extendedData,body:"{}"}}])assert.throws(()=>validateJob(c,{...job,...m}),/EXACT_JOB_CONFIG/)});
test("missing, duplicate and unsuccessful slots explicitly classified",()=>{const a=classify(c,slots,[row(slots[0],1),row(slots[0],2),{...row(slots[1],3),httpStatus:401,status:4}]);assert.equal(a.rows[0].status,"DUPLICATE_CRON_TICK");assert.equal(a.rows[1].status,"CRON_HTTP_FAILURE");assert.equal(a.rows[2].status,"UNOBSERVED_CRON_TICK")});
test("out of scope history is visible",()=>assert.equal(classify(c,slots,[row(p-60,1)]).unexpected,1));
test("history identity and jitter drift refused",()=>assert.throws(()=>classify(c,slots,[{...row(),jitter:100000}]),/HISTORY_IDENTITY/));
test("only exact known relay receives ack",()=>{const a=mk();assert.equal(ack(c,a.r,a.detail),101);assert.throws(()=>ack(c,a.r,{jobHistoryDetails:{...a.detail.jobHistoryDetails,body:'{"workflow_run_id":101}'}}),/ACK_IDENTITY/)});
test("pending or failed GitHub run not mistaken for proof",()=>{const a=mk();assert.equal(verifyReceipt(c,a.r,101,{...a.run,status:"queued"},null,null).status,"RELAY_PENDING");assert.equal(verifyReceipt(c,a.r,101,{...a.run,conclusion:"failure"},null,null).status,"RELAY_FAILED")});
test("real receipt scope checks code, time, target and provider authority",()=>{const a=mk();assert.equal(verifyReceipt(c,a.r,101,a.run,a.jobs,a.log).plannedToRunnerMs,20000);assert.throws(()=>verifyReceipt(c,a.r,101,{...a.run,head_sha:"a".repeat(40)},a.jobs,a.log),/RUN_IDENTITY/);for(const patch of [{mode:"PILOT"},{providerCallsByRelay:1},{paidAuthorityGranted:true},{runnerObservedUtc:i((p+60)*1000)}])assert.throws(()=>verifyReceipt(c,a.r,101,a.run,a.jobs,JSON.stringify({...a.receipt,...patch})),/RECEIPT_SCOPE/)});
test("bounded routine sample includes first last and highest jitter, not all",()=>{const rs=classify(c,slots,slots.map((x,i)=>row(x,i+1))).rows;assert.equal(samples(rs,"PILOT").length,9);assert.equal(samples(rs,"RECENT").length,2);rs[2].row.jitter+=100;assert.equal(samples(rs,"RECENT").length,3)});
function fixture(fault=""){
 const a=slots.map((s,k)=>mk(s,101+k)),cronCalls=[];
 const cron=async path=>{cronCalls.push(path);if(path.endsWith("/history"))return {history:a.filter((x,k)=>!(fault==="missing"&&k===2)).map(x=>x.r)};if(path.endsWith(String(c.jobId)))return {jobDetails:{...job,enabled:fault!=="disabled"}};const x=a.find(x=>path.endsWith(x.r.identifier));if(!x)throw Error("unknown");return x.detail};
 const gh=async path=>{const x=a.find(x=>path.includes("/"+x.run.id));return path.includes("/jobs")?x.jobs:x.run};
 const logs=async(n)=>a.find(x=>x.run.id===n).log;
 return {cron,gh,logs,cronCalls};
}
test("complete expired pilot proves all nine with 11 API reads",async()=>{const f=fixture(),a=await audit({c,mode:"PILOT",now,...f});assert.equal(a.proven,9);assert.equal(a.fullyProven,true);assert.equal(a.timingTargetMet,true);assert.equal(f.cronCalls.length,11);assert.equal(a.cronWrites,0);assert(!JSON.stringify(a).includes("github_pat_"))});
test("missing row cannot report full proof",async()=>{const a=await audit({c,mode:"PILOT",now,...fixture("missing")});assert.equal(a.proven,8);assert.equal(a.unresolved,1);assert.equal(a.fullyProven,false)});
test("early disabled job is actionable and can never prove full pilot before expiry",async()=>{const a=await audit({c,mode:"PILOT",now:p*1000+180000,...fixture("disabled")});assert.equal(a.disabledEarly,true);assert.equal(a.fullyProven,false)});
test("recent routine sample cannot be mistaken for full coverage",async()=>{const a=await audit({c,mode:"RECENT",now,...fixture()});assert.equal(a.proven,2);assert.equal(a.ackOnly,7);assert.equal(a.fullyProven,false)});

test("recovery lane config and schedule are independent",()=>{
 const e={TRAVNR_CRON_PRIMARY_JOB_ID:"234",TRAVNR_CRON_RELAY_SHA:c.pin,TRAVNR_CRON_PRIMARY_START_UTC:c.from,TRAVNR_CRON_PRIMARY_ENABLED_UTC:c.enabledReadback,TRAVNR_CRON_PRIMARY_UNTIL_UTC:c.until};
 const q=config(e,"RECENT","PRIMARY_BACKSTOP");assert.equal(q.jobId,234);assert.equal(q.lane,"PRIMARY_BACKSTOP");assert.equal(q.title,"Travnr isolated primary expiry recovery");
 assert(planned(q,"RECENT",now).every(t=>[4,19,34,49].includes(new Date(t*1000).getUTCMinutes())));
 assert.throws(()=>config(e,"RECENT","ROLLING_ROOT"),/CONFIG/);
});
test("recovery acknowledgement cannot certify target collection and skipped is unresolved",()=>{
 const a=mk(),q={...c,lane:"PRIMARY_BACKSTOP"},run={...a.run,display_title:"TRAVNR EXTERNAL CLOCK PRIMARY_BACKSTOP"},j={...a.jobs.jobs[0],name:"target-forward"},jobs={total_count:1,jobs:[j]};
 const receipt={...a.receipt,mode:q.lane,status:"TARGET_ACK_AND_RUN_IDENTITY_VERIFIED_NOT_COLLECTION_PROOF",targetRunId:555,targetWorkflow:"phase5-primary-fids-expiry-no-provider.yml",relayDispatches:1};
 assert.equal(verifyReceipt(q,a.r,101,run,jobs,JSON.stringify(receipt)).status,"RELAY_TARGET_ACK_ONLY");
 assert.throws(()=>verifyReceipt(q,a.r,101,run,jobs,JSON.stringify({...receipt,targetWorkflow:"other.yml"})),/RECOVERY_TARGET_ACK/);
 assert.throws(()=>verifyReceipt(q,a.r,101,{...run,display_title:"other"},jobs,JSON.stringify(receipt)),/RUN_IDENTITY/);
 assert.equal(verifyReceipt(q,a.r,101,run,{total_count:1,jobs:[{...j,conclusion:"skipped",steps:[]}]},null).status,"RELAY_FORWARD_SKIPPED");
 assert.equal(verifyReceipt(q,a.r,101,run,jobs,JSON.stringify({...receipt,status:"QUARANTINED_PRIOR_RELAY_RUN_REVIEW"})).status,"RELAY_REVIEW_REQUIRED");
});
test("pair mode samples at most one detail per lane and never reports full pilot proof",async()=>{
 const f=fixture(),a=await audit({c,mode:"RECENT",now,sampleLimit:1,...f});assert.equal(a.proven,1);assert.equal(a.ackOnly,8);assert.equal(f.cronCalls.length,3);assert.equal(a.fullyProven,false);
});

test("target ACK is not execution proof; distinguish pending, skipped, failed and exact completed step",async()=>{
 const pin="b".repeat(40),c={lane:"PRIMARY_BACKSTOP",targetPin:pin},n=777;
 const row={id:n,head_sha:pin,head_branch:"main",event:"workflow_dispatch",path:".github/workflows/phase5-primary-fids-expiry-no-provider.yml",run_attempt:1,status:"completed",conclusion:"success"};
 const j={id:888,name:"primary-fids-expiry",run_id:n,head_sha:pin,run_attempt:1,status:"completed",conclusion:"success",steps:[{name:"Verify exact main and execute only bounded primary FIDS expiry",conclusion:"success",status:"completed"}]};
 const get=(r=row,job=j)=>async path=>path.includes("/jobs")?{total_count:1,jobs:[job]}:r;
 assert.equal((await observeTargetStep(c,n,get())).status,"RELAY_TARGET_STEP_EXECUTION_VERIFIED_NOT_COLLECTION_PROOF");
 assert.equal((await observeTargetStep(c,n,get({...row,status:"queued",conclusion:null}))).status,"RELAY_TARGET_PENDING_EXECUTION");
 assert.equal((await observeTargetStep(c,n,get({...row,conclusion:"failure"}))).status,"RELAY_TARGET_TERMINAL_FAILURE");
 assert.equal((await observeTargetStep(c,n,get(row,{...j,conclusion:"skipped",steps:[]}))).status,"RELAY_TARGET_PROTECTED_JOB_SKIPPED");
 await assert.rejects(observeTargetStep(c,n,get({...row,head_sha:"a".repeat(40)})),/TARGET_RUN_IDENTITY/);
 await assert.rejects(observeTargetStep(c,n,get(row,{...j,steps:[]})),/TARGET_PROTECTED_STEP/);
});
test("rolling execution requires terminal receipt upload as well as actual protected step",async()=>{
 const pin="b".repeat(40),c={lane:"ROLLING_ROOT",targetPin:pin},n=777;
 const row={id:n,head_sha:pin,head_branch:"main",event:"workflow_dispatch",path:".github/workflows/phase6-rolling-controller-bounded-session.yml",run_attempt:1,status:"completed",conclusion:"success"};
 const j={id:888,name:"one-protected-bounded-session",run_id:n,head_sha:pin,run_attempt:1,status:"completed",conclusion:"success",steps:[{name:"Execute one protected rolling session and reconcile accepted workers before terminal",conclusion:"success",status:"completed"}]};
 const skip={...j,id:889,name:"offline-bounded-session-reconciliation",conclusion:"skipped",steps:[]};
 const get=job=>async path=>path.includes("/jobs")?{total_count:2,jobs:[job,skip]}:row;
 await assert.rejects(observeTargetStep(c,n,get(j)),/TARGET_TERMINAL_RECEIPT_STEP/);
 const good={...j,steps:[...j.steps,{name:"Preserve terminal operational receipt for independently reviewed continuation",conclusion:"success",status:"completed"}]};
 assert.equal((await observeTargetStep(c,n,get(good))).status,"RELAY_TARGET_STEP_EXECUTION_VERIFIED_NOT_COLLECTION_PROOF");
});

test("managed lease audit flags seven-day and 48h renewal thresholds, never authorizes extension",()=>{
 const end=Date.parse(c.until),d=86400000;
 assert.equal(leaseHealth(c,"PILOT",end),null);
 assert.equal(leaseHealth(c,"RECENT",end-8*d).state,"LEASE_CURRENT");
 assert.equal(leaseHealth(c,"RECENT",end-7*d).state,"RENEWAL_DUE_REVIEW");
 assert.equal(leaseHealth(c,"RECENT",end-2*d).state,"RENEWAL_CRITICAL");
 assert.deepEqual(leaseHealth(c,"RECENT",end),{remainingMs:0,state:"EXPIRED"});
});
test("reviewed renewal preserves original enable boundary in bounded study audit",()=>{
 const e={TRAVNR_CRON_PRIMARY_JOB_ID:"234",TRAVNR_CRON_RELAY_SHA:c.pin,TRAVNR_CRON_PRIMARY_START_UTC:c.from,TRAVNR_CRON_PRIMARY_ENABLED_UTC:c.enabledReadback,TRAVNR_CRON_PRIMARY_UNTIL_UTC:"2026-12-28T08:00:00.000Z"};
 const q=config(e,"RECENT","PRIMARY_BACKSTOP");
 assert.equal(q.from,c.from);assert.equal(q.enabledReadback,c.enabledReadback);
 assert.throws(()=>config({...e,TRAVNR_CRON_PRIMARY_UNTIL_UTC:"2027-02-01T00:00:00.000Z"},"RECENT","PRIMARY_BACKSTOP"),/CONFIG_WINDOW/);
});

test("shadow scope exact pair activation receipt verified; wrong ID/forward authority refused",()=>{
 const a={status:"EXACT_EXISTING_PAIR_SHADOW_ENABLED_NO_FORWARD",relayPin:c.pin,until:"2026-12-19T08:00:00.000Z",cronMutations:2,providerCalls:0,databaseWrites:0,targetDispatches:0,paidAuthorityGranted:false,jobs:[{lane:"PRIMARY_BACKSTOP",jobId:8890475,attemptUtc:c.from,readbackUtc:c.enabledReadback},{lane:"ROLLING_ROOT",jobId:8890476,attemptUtc:c.from,readbackUtc:c.enabledReadback}]};
 assert.deepEqual(shadowConfigs(JSON.stringify(a),c.pin).map(x=>x.jobId),[8890475,8890476]);
 assert.throws(()=>shadowConfigs(JSON.stringify({...a,paidAuthorityGranted:true}),c.pin),/SHADOW_RECEIPT_SCOPE/);
 assert.throws(()=>shadowConfigs(JSON.stringify({...a,jobs:[{...a.jobs[0],jobId:1},a.jobs[1]]}),c.pin),/SHADOW_BOUNDARY/);
});
test("shadow clock requires actual shadow receipt AND skipped target-forward job",()=>{
 const a=mk(),q={...c,lane:"PRIMARY_BACKSTOP",shadow:true},run={...a.run,display_title:"TRAVNR EXTERNAL CLOCK PRIMARY_BACKSTOP"};
 const forward={...a.jobs.jobs[0],id:222,name:"target-forward",conclusion:"skipped",steps:[]};
 const offline={...forward,id:223,name:"offline-tests"};
 const jobs={total_count:3,jobs:[a.jobs.jobs[0],forward,offline]};
 const log=JSON.stringify({...a.receipt,status:"EXTERNAL_RECOVERY_LANE_SHADOW_OBSERVED_NO_TARGET_DISPATCH",mode:"PRIMARY_BACKSTOP",relayDispatches:0});
 assert.equal(verifyReceipt(q,a.r,101,run,jobs,log).status,"SHADOW_LANE_PROVEN_NO_FORWARD");
 assert.throws(()=>verifyReceipt(q,a.r,101,run,{total_count:3,jobs:[jobs.jobs[0],{...forward,conclusion:"success"},offline]},log),/SHADOW_FORWARD_NOT_SKIPPED/);
 assert.throws(()=>verifyReceipt(q,a.r,101,run,jobs,a.log),/RECEIPT_COUNT/);
});

test("repaired pair retains original failed history but only evaluates future post-readback slots",()=>{
 const pin="a".repeat(40),a={status:"EXACT_EXISTING_PAIR_AUTH_REPAIRED_NO_FORWARD",relayPin:pin,until:"2026-12-19T08:00:00.000Z",probeRunId:81,probeJobId:82,cronMutations:2,providerCalls:0,databaseWrites:0,targetDispatches:0,paidAuthorityGranted:false,jobs:[{lane:"PRIMARY_BACKSTOP",jobId:8890475,attemptUtc:"2026-11-18T11:10:00.000Z",readbackUtc:"2026-11-18T11:10:01.000Z"},{lane:"ROLLING_ROOT",jobId:8890476,attemptUtc:"2026-11-18T11:10:02.000Z",readbackUtc:"2026-11-18T11:10:03.000Z"}]};
 const [c]=repairedShadowConfigs(JSON.stringify(a),pin);
 assert.equal(c.originalFrom,"2026-11-18T10:05:06.006Z");assert.equal(c.from,a.jobs[0].readbackUtc);
 const slots=planned(c,"SHADOW",Date.parse("2026-11-18T12:10:03Z"));assert(slots.every(t=>t*1000>Date.parse(c.from)));
 const old=Date.parse("2026-11-18T10:19:00Z")/1000,history=[{jobId:c.jobId,datePlanned:old,date:old,jitter:0,identifier:"old",url:"https://api.github.com/repos/HKcode22/TravnrClockRelay/actions/workflows/external-clock.yml/dispatches",status:4,httpStatus:401}];
 const out=classify(c,slots,history);assert.equal(out.unexpected,0);assert(out.rows.every(x=>x.status==="UNOBSERVED_CRON_TICK"));
 assert.throws(()=>repairedShadowConfigs(JSON.stringify({...a,probeRunId:0}),pin),/REPAIR_RECEIPT_SCOPE/);
 assert.throws(()=>repairedShadowConfigs(JSON.stringify({...a,jobs:[{...a.jobs[0],attemptUtc:"2026-11-18T10:05:06.006Z"},a.jobs[1]]}),pin),/REPAIR_BOUNDARY/);
});
