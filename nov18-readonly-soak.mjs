/** Detached, read-only hosted observation. It does not schedule or dispatch any work. */
import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
export const RELAY="HKcode22/TravnrClockRelay",TARGET="HKcode22/ReplitTranvr",RELAY_SHA="b3a775b4ec7213af796bb8c727b69c3d0feb8bb7",TARGET_SHA="ea89308f468494d848f549539200f73f848a4fa7";
export const FROM=Date.parse("2026-11-18T16:17:17.321Z"),UNTIL=Date.parse("2026-11-18T18:17:17.321Z"),MIN=60000;
const WF="external-clock.yml",BRANCH="phase5/nov18-readonly-scheduler-soak",API="https://api.github.com/repos/";
const periods={PRIMARY_BACKSTOP:15,ROLLING_ROOT:10},offsets={PRIMARY_BACKSTOP:4,ROLLING_ROOT:8};
const ZERO={providerCalls:0,databaseReads:0,databaseWrites:0,dispatches:0,paidAuthorityGranted:false};
const iso=n=>new Date(n).toISOString(),id=n=>Number.isSafeInteger(n)&&n>0;
const hold=s=>{throw Error("HOLD_SOAK_"+s)};
export function slotFor(lane,t){
 if(!Object.hasOwn(periods,lane)||!Number.isFinite(t))hold("SLOT_SCOPE");
 const size=periods[lane]*MIN,off=offsets[lane]*MIN;
 return Math.floor((t-off)/size)*size+off;
}
export function expectedSlots(clock){
 const a=[];
 for(const lane of Object.keys(periods)){
  for(let t=slotFor(lane,FROM)+periods[lane]*MIN;t<=clock-2*MIN;t+=periods[lane]*MIN)
   a.push({lane,slotUtc:iso(t)});
 }
 return a.sort((x,y)=>x.slotUtc.localeCompare(y.slotUtc));
}
export function classifyList(runs,clock){
 if(!Array.isArray(runs)||runs.length>100||new Set(runs.map(x=>x.id)).size!==runs.length)hold("LIST_SCOPE");
 const valid=[],unexpected=[];
 for(const r of runs){
  const t=Date.parse(r.created_at),lane=Object.keys(periods).find(l=>r.display_title==="TRAVNR EXTERNAL CLOCK "+l);
  if(r.display_title==="TRAVNR EXTERNAL CLOCK CLOCK_ONLY")continue;
  if(!id(r.id)||r.head_sha!==RELAY_SHA||r.head_branch!=="main"||r.event!=="workflow_dispatch"||
   r.run_attempt!==1||r.path!==".github/workflows/"+WF||!lane||!Number.isFinite(t)||t<FROM||t>clock+5000){
    unexpected.push({runId:id(r.id)?r.id:null,reason:"IDENTITY_OR_SCOPE"});continue;
  }
  const slot=slotFor(lane,t);
  if(slot<FROM){unexpected.push({runId:r.id,reason:"BEFORE_FIRST_REVIEWED_SLOT"});continue;}
  valid.push({lane,slotUtc:iso(slot),runId:r.id,createdUtc:r.created_at,run:r});
 }
 const slots=expectedSlots(clock).map(q=>{
  const found=valid.filter(r=>r.lane===q.lane&&r.slotUtc===q.slotUtc);
  return {...q,count:found.length,runIds:found.map(x=>x.runId)};
 });
 return {valid,unexpected,slots};
}
export function receiptFor(run,lane,records){
 const terminal=records.filter(x=>x.relayRunId===run.id&&x.providerCallsByRelay===0&&x.databaseReadsByRelay===0&&x.databaseWritesByRelay===0&&x.paidAuthorityGranted===false);
 if(terminal.length!==1)hold("RELAY_RECEIPT_COUNT");
 const q=terminal[0],seen=Date.parse(q.runnerObservedUtc),created=Date.parse(run.created_at);
 if(q.mode!==lane||q.actualCreatedUtc!==run.created_at||!Number.isFinite(seen)||seen<created||
   !Number.isSafeInteger(q.creationToObservedMs)||Math.abs(seen-created-q.creationToObservedMs)>1000)
  hold("RELAY_CLOCK_RECEIPT");
 const attempts=records.filter(x=>x.relayRunId===run.id&&x.status==="EXTERNAL_WAKE_TARGET_ATTEMPT_NO_REPLAY");
 const acks=records.filter(x=>x.relayRunId===run.id&&x.status==="EXTERNAL_WAKE_TARGET_ACK_NOT_EXECUTION_PROOF");
 const status=q.status;
 if(status==="TARGET_ACK_AND_RUN_IDENTITY_VERIFIED_NOT_COLLECTION_PROOF"){
  if(q.relayDispatches!==1||!id(q.targetRunId)||attempts.length!==1||acks.length!==1||acks[0].runId!==q.targetRunId||attempts[0].workflow!==q.targetWorkflow)hold("ACK_PAIR");
  const wanted=lane==="ROLLING_ROOT"?"phase6-direct-recovery-tick.yml":"phase5-primary-fids-expiry-no-provider.yml";
  if(q.targetWorkflow!==wanted||lane==="ROLLING_ROOT"&&seen>=UNTIL)hold("DISPATCH_SCOPE");
  return {disposition:"ACK",targetId:q.targetRunId,targetWorkflow:q.targetWorkflow,seenUtc:q.runnerObservedUtc};
 }
 if(attempts.length||acks.length||!(q.relayDispatches===undefined||q.relayDispatches===0))hold("NON_ACK_DISPOSITION_WITH_ATTEMPT");
 const allowed=lane==="PRIMARY_BACKSTOP"?["DEFER_RECENT_PRIMARY_STEP_NOT_DELETION_PROOF","DEFER_TARGET_ALREADY_ACTIVE"]:["DEFER_RECENT_DIRECT_TICK_NOT_COLLECTION_PROOF","DEFER_TARGET_ALREADY_ACTIVE","DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW"];
 if(!allowed.includes(status))return {disposition:"REVIEW",reason:status,seenUtc:q.runnerObservedUtc};
 if(status==="DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW"&&seen<UNTIL-5*MIN)hold("PREMATURE_EXPIRY");
 if(lane==="ROLLING_ROOT"&&seen>=UNTIL&&status!=="DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW")return {disposition:"REVIEW",reason:"POST_EXPIRY_NONWINDOW_DEFER",seenUtc:q.runnerObservedUtc};
 return {disposition:status,seenUtc:q.runnerObservedUtc};
}
function parseReceipts(raw){const out=[];for(const row of raw.split(/\r?\n/)){const n=row.indexOf('{"status":');if(n<0)continue;try{out.push(JSON.parse(row.slice(n)));}catch{}}return out;}
function completeJobs(data,run){
 if(!Number.isSafeInteger(data?.total_count)||data.total_count<1||data.total_count>100||!Array.isArray(data.jobs)||data.jobs.length!==data.total_count||
  new Set(data.jobs.map(x=>x.id)).size!==data.jobs.length||!data.jobs.every(j=>id(j.id)&&j.run_id===run.id&&j.head_sha===run.head_sha&&j.run_attempt===1))hold("JOB_IDENTITY");
 return data.jobs;
}
const skipped=j=>j?.status==="completed"&&j.conclusion==="skipped"&&(j.steps==null||Array.isArray(j.steps)&&j.steps.length===0);
const successStep=(j,n)=>j?.status==="completed"&&j.conclusion==="success"&&j.steps?.filter(s=>s.name===n&&s.status==="completed"&&s.conclusion==="success").length===1;
const safe=e=>/^HOLD_SOAK_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_SOAK_READ_UNAVAILABLE";
export async function runSoak(env){
 if(env.GITHUB_ACTIONS!=="true"||env.GITHUB_REPOSITORY!==RELAY||env.GITHUB_EVENT_NAME!=="pull_request"||
 env.GITHUB_HEAD_REF!==BRANCH||env.GITHUB_RUN_ATTEMPT!=="1"||typeof env.GITHUB_TOKEN!=="string"||env.GITHUB_TOKEN.length<16||
 [env.TRAVNR_TARGET_ACTIONS_TOKEN,env.TRAVNR_CRON_ACCOUNT_KEY,env.TRAVNR_CRON_RELAY_TOKEN,env.DATABASE_URL,env.AERODATABOX_API_KEY,env.RAPIDAPI_KEY].some(Boolean))hold("READONLY_SCOPE");
 const began=Date.now(),end=began+320*MIN;
 if(began<FROM||began-FROM>90*MIN||end-FROM>8*60*MIN)hold("OBSERVATION_CLOCK");
 const path=env.RUNNER_TEMP+"/travnr-readonly-soak.json",cache=new Map(),targetCache=new Map(),samples=[],errors=[];
 let reads=0,publicFallbacks=0,pinDrift=false;
 async function get(repo,p){
  if(![RELAY,TARGET].includes(repo)||!p.startsWith("/")||++reads>1000||Date.now()>end+2*MIN)hold("READ_BOUND");
  const url=API+repo+p;
  const headers={Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
  let r=await fetch(url,{method:"GET",headers:{...headers,Authorization:"Bearer "+env.GITHUB_TOKEN},redirect:"error",signal:AbortSignal.timeout(12000)});
  if(repo===TARGET&&[403,404].includes(r.status)){
   if(++publicFallbacks>300)hold("PUBLIC_FALLBACK_BOUND");
   r=await fetch(url,{method:"GET",headers,redirect:"error",signal:AbortSignal.timeout(12000)});
  }
  if(!r.ok)hold("HTTP_"+r.status);
  return r.json();
 }
 const main=async repo=>(await get(repo,"/git/ref/heads/main")).object?.sha;
 const ownLog=(run,j)=>execFileSync("gh",["run","view",String(run.id),"-R",RELAY,"--job",String(j.id),"--log"],{
  env:{PATH:process.env.PATH,HOME:process.env.HOME,GH_TOKEN:env.GITHUB_TOKEN,GH_PROMPT_DISABLED:"1"},encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024,stdio:["ignore","pipe","ignore"]});
 async function verifyTarget(x,lane){
  if(targetCache.has(x.targetId))return targetCache.get(x.targetId);
  const r=await get(TARGET,"/actions/runs/"+x.targetId);
  if(r.id!==x.targetId||r.head_sha!==TARGET_SHA||r.head_branch!=="main"||r.event!=="workflow_dispatch"||r.run_attempt!==1||
    r.path!==".github/workflows/"+x.targetWorkflow||r.display_title!==(lane==="ROLLING_ROOT"?"P6 DIRECT RECOVERY VERIFY":"P5 PRIMARY BACKSTOP CHILD"))hold("TARGET_IDENTITY");
  if(r.status!=="completed")return {targetState:"PENDING"};
  if(r.conclusion!=="success")hold("TARGET_FAILURE");
  const j=completeJobs(await get(TARGET,"/actions/runs/"+r.id+"/jobs?filter=latest&per_page=100"),r);
  let targetState;
  if(lane==="ROLLING_ROOT"){
   const v=j.find(x=>x.name==="direct-readonly-verify");
   if(j.length!==3||!["offline-direct-recovery","direct-protected-recovery-tick"].every(n=>skipped(j.find(x=>x.name===n)))||
    !successStep(v,"Verify exact direct wake and existing workflow metadata NO POST"))hold("TARGET_DIRECT_STEP");
   targetState="EXACT_READONLY_STEP_METADATA_SUCCESS";
  }else{
   if(j.length!==1||j[0].name!=="primary-fids-expiry"||j[0].status!=="completed"||j[0].conclusion!=="success")hold("TARGET_PRIMARY_JOB");
   targetState="EXACT_PRIMARY_JOB_METADATA_SUCCESS_NOT_DELETION_PROOF";
  }
  const out={targetState,targetCompletedUtc:r.updated_at};targetCache.set(x.targetId,out);return out;
 }
 async function verifyPulse(x){
  const r=x.run;
  if(r.status!=="completed")return {disposition:"RUN_PENDING"};
  if(r.conclusion!=="success")return {disposition:"REVIEW",reason:"RELAY_"+String(r.conclusion)};
  let v=cache.get(r.id);
  if(!v){
   const j=completeJobs(await get(RELAY,"/actions/runs/"+r.id+"/jobs?filter=latest&per_page=100"),r);
   const f=j.find(x=>x.name==="target-forward");
   if(j.length!==3||!["offline-tests","independent-pulse"].every(n=>skipped(j.find(x=>x.name===n))))hold("RELAY_JOB_SET");
   if(skipped(f))return {disposition:"REVIEW",reason:"TARGET_FORWARD_SKIPPED"};
   if(!successStep(f,"Run node cli.mjs"))hold("RELAY_EXECUTION_STEP");
   v=receiptFor(r,x.lane,parseReceipts(ownLog(r,f)));
   cache.set(r.id,v);
  }
  if(v.disposition==="ACK")return {...v,...await verifyTarget(v,x.lane)};
  return v;
 }
 let latest={valid:[],slots:[],unexpected:[]};
 function emit(status){
  const r={status,beganUtc:iso(began),plannedEndUtc:iso(end),observedUtc:iso(Date.now()),relayMain:RELAY_SHA,targetMain:TARGET_SHA,
   observationScope:"HOSTED_READONLY_NO_PRODUCTION_RELEASE",reads,publicFallbacks,pinDrift,samples,errors,latest,...ZERO};
  writeFileSync(path,JSON.stringify(r,null,2),{mode:0o600});
  const s=samples.at(-1);console.log(JSON.stringify({status,reads,pinDrift,...(s??{}),...ZERO}));
 }
 for(let n=0;n<=32;n++){
  const scheduled=began+n*10*MIN;
  if(n)await new Promise(r=>setTimeout(r,Math.max(0,scheduled-Date.now())));
  if(Date.now()>end+MIN)break;
  try{
   if(await main(RELAY)!==RELAY_SHA||await main(TARGET)!==TARGET_SHA){pinDrift=true;hold("MAIN_PIN_DRIFT");}
   const list=await get(RELAY,"/actions/workflows/"+WF+"/runs?branch=main&event=workflow_dispatch&per_page=100&created="+encodeURIComponent(">="+iso(FROM)));
   if(!Number.isSafeInteger(list.total_count)||list.total_count>100||list.workflow_runs?.length!==list.total_count)hold("HISTORY_INCOMPLETE");
   const q=classifyList(list.workflow_runs,Date.now()),rows=[];
   for(const x of q.valid){
    let out;
    try{out=await verifyPulse(x);}catch(e){out={disposition:"REVIEW",reason:safe(e)};}
    rows.push({lane:x.lane,slotUtc:x.slotUtc,runId:x.runId,createdUtc:x.createdUtc,...out,
     plannedToRunnerMs:out.seenUtc?Date.parse(out.seenUtc)-Date.parse(x.slotUtc):null});
   }
   latest={slots:q.slots,unexpected:q.unexpected,rows};
   const required=new Set(q.slots.map(s=>s.lane+"@"+s.slotUtc)),mature=rows.filter(x=>required.has(x.lane+"@"+x.slotUtc));
   const counts={expected:q.slots.length,missing:q.slots.filter(s=>s.count===0).length,duplicates:q.slots.filter(s=>s.count>1).length,unexpected:q.unexpected.length,
     pending:mature.filter(x=>x.disposition==="RUN_PENDING"||x.targetState==="PENDING").length,
     reviews:mature.filter(x=>x.disposition==="REVIEW").length,
     late:mature.filter(x=>x.plannedToRunnerMs!==null&&x.plannedToRunnerMs>120000).length,
     exactTargetMetadata:mature.filter(x=>x.targetState?.startsWith("EXACT_")).length,
     expectedExpiryDeferrals:mature.filter(x=>x.disposition==="DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW").length};
   // Separate actual native expiry cadence; never equate green status to deletion.
   let native=null;
   if(n%3===0||n===32){
    const z=await get(TARGET,"/actions/workflows/phase5-primary-fids-expiry-no-provider.yml/runs?branch=main&event=schedule&per_page=100&created="+encodeURIComponent(">="+iso(FROM)));
    if(!Number.isSafeInteger(z.total_count)||z.total_count>100||z.workflow_runs?.length!==z.total_count)hold("NATIVE_LIST_INCOMPLETE");
    const nativeRuns=z.workflow_runs.map(v=>({id:v.id,at:v.created_at,conclusion:v.conclusion,shaMatch:v.head_sha===TARGET_SHA})).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
    native={count:nativeRuns.length,maxCreationGapMs:Math.max(0,...nativeRuns.slice(1).map((v,i)=>Date.parse(v.at)-Date.parse(nativeRuns[i].at))),runs:nativeRuns};
   }
   samples.push({n,scheduledUtc:iso(scheduled),clockUtc:iso(Date.now()),...counts,native});
   emit("ACTUAL_HOSTED_SOAK_OBSERVATION_NO_GO");
  }catch(e){errors.push({n,observedUtc:iso(Date.now()),reason:safe(e)});emit("ACTUAL_HOSTED_SOAK_PARTIAL_READ_HOLD");if(pinDrift)break;}
 }
 const last=samples.at(-1),full=last?.n===32&&!pinDrift&&last.missing===0&&last.duplicates===0&&last.unexpected===0&&last.pending===0&&last.reviews===0&&last.late===0;
 emit(full?"ACTUAL_HOSTED_READONLY_SOAK_COMPLETE_NO_COLLECTION_PROOF":"HOLD_ACTUAL_HOSTED_READONLY_SOAK_INCOMPLETE_OR_INCIDENT");
 if(!full)process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await runSoak(process.env);}catch(e){console.error(safe(e));process.exitCode=2;}
}
