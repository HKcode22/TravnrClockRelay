import test from "node:test";
import assert from "node:assert/strict";
import {rehearse,verifyObserveReceipt} from "./target-rehearsal.mjs";
import {RELAY,TARGET,PILOT} from "./relay.mjs";
const NOW=Date.parse("2026-11-18T09:00:00.000Z"),iso=t=>new Date(t).toISOString(),pin="a".repeat(40),target="45d04392e2eecfc1220230f252d2ada8cc6137e0",root="https://api.github.com/repos/";
const tok="github_pat_"+"x".repeat(40),own="ghs_"+"y".repeat(40);
const env={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:RELAY,GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:"10",GITHUB_SHA:pin,GITHUB_TOKEN:own,TRAVNR_TARGET_ACTIONS_TOKEN:tok,TRAVNR_REHEARSAL_RELAY_PIN:pin,TRAVNR_REHEARSAL_TARGET_PIN:target,TRAVNR_REHEARSAL_CONFIRM:"ONE_CROSS_REPO_OBSERVE_ONLY_NO_PROVIDER_NO_DB"};
const self={id:10,head_sha:pin,head_branch:"main",path:".github/workflows/recovery-delivery-rehearsal.yml",event:"workflow_dispatch",run_attempt:1,status:"in_progress"};
const row={id:22,head_sha:target,head_branch:"main",path:".github/workflows/"+PILOT,event:"workflow_dispatch",run_attempt:1,status:"completed",conclusion:"success",created_at:iso(NOW)};
const names=["six-slot-cron-observation-only","actual-readonly-preview-diagnostic","bounded-manual-github-handoff","rolling-no-provider-rehearsal","bounded-primary-retention-backstop"];
const jobs={total_count:5,jobs:names.map((name,i)=>({id:100+i,name,run_id:22,head_sha:target,run_attempt:1,status:"completed",conclusion:i===0?"success":"skipped",completed_at:iso(NOW+1000),steps:i===0?["Record scheduled dispatch drift; not authority to collect","Read GitHub's ACTUAL scheduled jobs, detect missing or late slots (no provider)"].map(name=>({name,status:"completed",conclusion:"success"})):[]}))};
const marker="PHASE5_SIX_SLOT_GITHUB_CLOCK_NO_PROVIDER_NO_DB_NO_PAID",log=iso(NOW)+" "+marker;
const wrap=(x,status=200)=>({status,ok:status>=200&&status<300,json:async()=>x});
function fixture(fault=""){
 const calls=[],events=[];let clock=NOW,posts=0,reads=0;
 const fetcher=async(url,init)=>{
  calls.push({url,method:init.method});assert.equal(init.headers.Authorization,"Bearer "+(url.startsWith(root+RELAY)?own:tok));
  if(init.method==="POST"){
   posts++;assert.equal(url,root+TARGET+"/actions/workflows/"+PILOT+"/dispatches");
   assert.deepEqual(JSON.parse(init.body),{ref:"main",return_run_details:true,inputs:{mode:"OBSERVE"}});
   if(fault==="ambiguous")return wrap({},503);
   return wrap({workflow_run_id:22,run_url:root+TARGET+"/actions/runs/22",html_url:"https://github.com/"+TARGET+"/actions/runs/22"});
  }
  if(url===root+RELAY+"/actions/runs/10")return wrap(self);
  if(url.startsWith(root+RELAY+"/actions/workflows/"))return wrap({total_count:fault==="prior"?2:1,workflow_runs:fault==="prior"?[self,{...self,id:9}]:[self]});
  if(url===root+RELAY+"/git/ref/heads/main")return wrap({object:{sha:pin}});
  if(url===root+TARGET+"/git/ref/heads/main")return wrap({object:{sha:fault==="drift"?"c".repeat(40):target}});
  if(url.startsWith(root+TARGET+"/contents/"))return wrap({sha:fault==="blob"?"b".repeat(40):"c1356a0aa278745708b5bb9d20e1cdc0bc2bdf2a"});
  if(url.includes("/runs?branch=main&status="))return wrap({total_count:fault==="active"?1:0,workflow_runs:fault==="active"?[row]:[]});
  if(url===root+TARGET+"/actions/runs/22"){reads++;return wrap(fault==="failed"?{...row,conclusion:"failure"}:reads===1?{...row,status:"in_progress",conclusion:null}:row);}
  if(url.includes("/actions/runs/22/jobs"))return wrap(fault==="otherJob"?{...jobs,jobs:jobs.jobs.map((j,i)=>i===1?{...j,conclusion:"success"}:j)}:jobs);
  throw Error("fixture unexpected");
 };
 return {calls,events,postCount:()=>posts,opts:{fetcher,now:()=>clock,sleep:async ms=>{clock+=ms},readLog:async()=>fault==="missingLog"?"":log,emit:x=>events.push(x)}};
}
test("real path shape dispatches only OBSERVE once and verifies all other jobs skipped",async()=>{
 const f=fixture(),x=await rehearse(env,f.opts);assert.equal(x.targetRunId,22);assert.equal(x.targetJobId,100);assert.equal(x.allNonObserveJobsSkipped,true);assert.equal(x.paidAuthorityGranted,false);assert.equal(f.postCount(),1);assert(!JSON.stringify(x).includes(tok));
});
test("prior attempt, main drift, workflow drift and concurrent target all stop before POST",async()=>{
 for(const fault of ["prior","drift","blob","active"]){const f=fixture(fault);await assert.rejects(rehearse(env,f.opts));assert.equal(f.postCount(),0);}
});
test("unknown ACK, terminal failure or other executed job never replays",async()=>{
 for(const fault of ["ambiguous","failed","otherJob","missingLog"]){const f=fixture(fault);await assert.rejects(rehearse(env,f.opts),/NO_BLIND_REPLAY/);assert.equal(f.postCount(),1);}
});
test("prohibit provider or Cron credentials, wrong target pin and repeated workflow attempts",async()=>{
 for(const patch of [{DATABASE_URL:"x"},{TRAVNR_CRON_ACCOUNT_KEY:"x"},{TRAVNR_REHEARSAL_TARGET_PIN:pin},{GITHUB_RUN_ATTEMPT:"2"}]){const f=fixture();await assert.rejects(rehearse({...env,...patch},f.opts),/SCOPE/);assert.equal(f.calls.length,0);}
});
test("actual echo only, exact unique job names and completed step",()=>{
 assert.equal(verifyObserveReceipt(row,jobs,log,22).targetJobId,100);
 assert.throws(()=>verifyObserveReceipt(row,jobs,"echo '"+marker+"'",22),/OBSERVE_MARKER/);
 assert.throws(()=>verifyObserveReceipt(row,jobs,log+"\n"+log,22),/OBSERVE_MARKER/);
 assert.throws(()=>verifyObserveReceipt(row,{...jobs,total_count:4,jobs:jobs.jobs.slice(0,4)},log,22),/TARGET_TERMINAL_IDENTITY/);
});
