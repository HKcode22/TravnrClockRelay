/** Runs the exact production wait and final hard-latest guard on a
 * real hosted runner. The clock is the local runner, NOT PostgreSQL.
 * No provider, DB, paid reservation, workflow dispatch, or secrets. */
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {waitForP5ScheduledPhysicalDispatch} from "./reviewed-production/server/lib/disruption/phase5V0080GitHubPrearm_v39.ts";
import {requireP5PaidGetBeforeHardLatest} from "./reviewed-production/server/lib/disruption/phase5SourceUpcomingDueQueueReadonly_v39.ts";
const M=60000,iso=n=>new Date(n).toISOString();
const PRE="REFUSED_P5_V0080_PREARM_",HARD="REFUSED_P5_SOURCE_DUE_QUEUE_MISSED_HARD_LATEST";
function noCredentials(){
 for(const k of ["DATABASE_URL","V39_P5_SOURCE_DATABASE_URL","V39_DATABASE_RUNTIME_URL","AERODATABOX_API_KEY","RAPIDAPI_KEY","AERODATABOX_WEBHOOK_SECRET","TRAVNR_TARGET_ACTIONS_TOKEN","TRAVNR_CRON_ACCOUNT_KEY","TRAVNR_CRON_RELAY_TOKEN","GH_TOKEN","GITHUB_TOKEN"])assert(!process.env[k]);
 assert.equal(process.env.GITHUB_REPOSITORY,"HKcode22/TravnrClockRelay");
 assert.equal(process.env.GITHUB_EVENT_NAME,"pull_request");
 assert.equal(process.env.GITHUB_RUN_ATTEMPT,"1");
}
async function virtual({lead=90*M,overshoot=0,backward=false,invalid=false,cutoffLead=15*M}={}){
 const planned=Date.parse("2030-01-01T12:00:00.000Z"),cutoff=planned+cutoffLead,hard=Math.min(planned+M,cutoff-180000-120000);
 let t=planned-lead,n=0,maxFar=0,maxNear=0;
 await waitForP5ScheduledPhysicalDispatch(iso(planned),iso(cutoff),180,async()=>{
  n++;
  if(invalid)return new Date(NaN);
  if(backward&&n===2)t-=120000;
  return new Date(t);
 },async d=>{
  assert(d>0&&d<=60000);
  if(planned-t<=120000){assert(d<=5000);maxNear=Math.max(maxNear,d);}
  else{assert(d<=planned-t-120000);maxFar=Math.max(maxFar,d);}
  t+=d;
  if(t===planned)t+=overshoot;
 });
 requireP5PaidGetBeforeHardLatest(new Date(t),iso(hard));
 assert(t>=planned&&t<hard);
 return {polls:n,maxFar,maxNear,latenessMs:t-planned};
}
async function fixtureTests(){
 const a=await virtual(),b=await virtual({lead:15*M,overshoot:1000});
 assert(a.polls<=115&&a.maxFar===60000&&a.maxNear===5000&&a.latenessMs===0);
 assert(b.latenessMs===1000);
 await assert.rejects(virtual({overshoot:60000}),new RegExp(HARD));
 await assert.rejects(virtual({overshoot:61000}),new RegExp(HARD));
 await assert.rejects(virtual({lead:121*M}),new RegExp(PRE+"GITHUB_JOB_STARTED_TOO_EARLY"));
 await assert.rejects(virtual({backward:true}),new RegExp(PRE+"DATABASE_CLOCK_MOVED_BACKWARD"));
 await assert.rejects(virtual({invalid:true}),new RegExp(PRE+"UNTRUSTED_DATABASE_CLOCK"));
 await assert.rejects(virtual({overshoot:16*M}),new RegExp(PRE+"MISSED_PROSPECTIVE_DISPATCH"));
 await assert.rejects(virtual({cutoffLead:2*M}),new RegExp(PRE+"MISSED_PROSPECTIVE_DISPATCH"));
 console.log(JSON.stringify({status:"EXACT_PREARM_HELPER_VIRTUAL_FAULT_CASES_PASS",cases:9,nominal90:a,lateWithinHard:b,providerCalls:0,databaseCalls:0,dispatches:0}));
}
async function actual(){
 const begin=Date.now(),mono=performance.now(),planned=begin+90*M,cutoff=planned+15*M,hard=planned+M;
 let polls=0,far=0,near=0,last=null,maxSleepOvershoot=0;
 console.log(JSON.stringify({status:"ACTUAL_90_MIN_PREARM_WAIT_STARTED_RUNNER_CLOCK_ONLY",runId:process.env.GITHUB_RUN_ID,beginUtc:iso(begin),plannedUtc:iso(planned),hardLatestUtc:iso(hard),providerCalls:0,databaseCalls:0}));
 await waitForP5ScheduledPhysicalDispatch(iso(planned),iso(cutoff),180,async()=>{
  polls++;last=Date.now();return new Date(last);
 },async d=>{
  const before=Date.now(),left=planned-last;
  if(left>120000){assert(d<=60000&&d<=left-120000);far++;}
  else{assert(d<=5000&&d<=left);near++;}
  await new Promise(r=>setTimeout(r,d));
  maxSleepOvershoot=Math.max(maxSleepOvershoot,Date.now()-before-d);
  if((far+near)%15===0)console.log(JSON.stringify({status:"ACTUAL_PREARM_WAIT_HEARTBEAT",polls,observedUtc:iso(Date.now()),remainingMs:Math.max(0,planned-Date.now())}));
 });
 const observed=Date.now();
 requireP5PaidGetBeforeHardLatest(new Date(observed),iso(hard));
 const late=observed-planned,elapsed=performance.now()-mono;
 assert(late>=0&&elapsed>=90*M-2000&&polls<=1501);
 console.log(JSON.stringify({status:"ACTUAL_90_MIN_PREARM_WAIT_RUNNER_CLOCK_VERIFIED_NOT_DATABASE_OR_COLLECTION_PROOF",runId:process.env.GITHUB_RUN_ID,beginUtc:iso(begin),plannedUtc:iso(planned),observedUtc:iso(observed),hardLatestUtc:iso(hard),elapsedMs:Math.round(elapsed),latenessMs:late,polls,farSleeps:far,nearSleeps:near,maxSleepOvershootMs:maxSleepOvershoot,diagnostic2sTimingTargetMet:late<=2000,providerCalls:0,databaseCalls:0,dispatches:0,paidAuthorityGranted:false}));
 if(late>2000)process.exitCode=2;
}
noCredentials();
await fixtureTests();
if(process.argv[2]==="--actual")await actual();
else assert.equal(process.argv[2],"--fixtures");
