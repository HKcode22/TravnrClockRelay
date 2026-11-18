import test from "node:test";
import assert from "node:assert/strict";
import {PILOT,REPO,WF,config,validateJob,planned,classify,ack,verifyReceipt,samples,audit} from "./cron-audit.mjs";
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
