/** Actual one-shot cross-repo delivery verification, no provider/DB authority.
 * Fixed existing no-paid OBSERVE canary; never request the collection controller.
 * This tests cross-repo transport, not paid worker recovery or data completeness. */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {readPrimaryVerifyLog,RELAY,TARGET,PILOT} from "./relay.mjs";
const ROOT="https://api.github.com/repos/",WF="recovery-delivery-rehearsal.yml";
const TARGET_SHA="45d04392e2eecfc1220230f252d2ada8cc6137e0";
const TARGET_WF_BLOB="c1356a0aa278745708b5bb9d20e1cdc0bc2bdf2a";
const HOLD=s=>{throw Error("HOLD_CROSS_REPO_REHEARSAL_"+s)};
const id=x=>Number.isSafeInteger(x)&&x>0,sha=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x);
const iso=n=>new Date(n).toISOString();
const active=["queued","in_progress","waiting","requested","pending"];
const skipped=["actual-readonly-preview-diagnostic","bounded-manual-github-handoff","rolling-no-provider-rehearsal","bounded-primary-retention-backstop"];
const observeJob="six-slot-cron-observation-only";
const marker="PHASE5_SIX_SLOT_GITHUB_CLOCK_NO_PROVIDER_NO_DB_NO_PAID";
function identity(r,wf,pin,n){
 return r?.id===n&&r.head_sha===pin&&r.head_branch==="main"&&r.path===".github/workflows/"+wf&&r.event==="workflow_dispatch"&&r.run_attempt===1;
}
export function verifyObserveReceipt(r,jobs,log,n){
 if(!identity(r,PILOT,TARGET_SHA,n)||r.status!=="completed"||r.conclusion!=="success"||!Array.isArray(jobs?.jobs)||
    jobs.total_count!==5||jobs.jobs.length!==5||new Set(jobs.jobs.map(j=>j.name)).size!==5||new Set(jobs.jobs.map(j=>j.id)).size!==5||
    !jobs.jobs.every(j=>id(j.id)&&j.run_id===n&&j.head_sha===TARGET_SHA&&j.run_attempt===1&&j.status==="completed"))
  HOLD("TARGET_TERMINAL_IDENTITY");
 const map=new Map(jobs.jobs.map(j=>[j.name,j]));
 if(!skipped.every(k=>{const j=map.get(k);return j?.conclusion==="skipped"&&(j.steps==null||Array.isArray(j.steps)&&j.steps.length===0)}))HOLD("NON_OBSERVE_JOB");
 const j=map.get(observeJob);
 const step="Record scheduled dispatch drift; not authority to collect";
 if(j?.conclusion!=="success"||j.steps?.filter(s=>s.name===step&&s.status==="completed"&&s.conclusion==="success").length!==1||
    j.steps?.filter(s=>s.name==="Read GitHub's ACTUAL scheduled jobs, detect missing or late slots (no provider)"&&s.status==="completed"&&s.conclusion==="success").length!==1)HOLD("OBSERVE_STEP");
 // Match the actual echo, not the ANSI-wrapped shell command in setup logs.
 const hits=String(log).split(/\r?\n/).filter(l=>/^\s*(?:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\s+)?PHASE5_SIX_SLOT_GITHUB_CLOCK_NO_PROVIDER_NO_DB_NO_PAID\s*$/.test(l));
 if(hits.length!==1)HOLD("OBSERVE_MARKER");
 return {targetRunId:n,targetJobId:j.id,targetPin:TARGET_SHA,targetWorkflow:PILOT,observationMarker:marker,allNonObserveJobsSkipped:true};
}
export async function rehearse(env,{fetcher=fetch,readLog=(f,t,j)=>readPrimaryVerifyLog(f,t,j),now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),emit=()=>{}}={}){
 const pin=env.GITHUB_SHA,n=Number(env.GITHUB_RUN_ID),token=env.TRAVNR_TARGET_ACTIONS_TOKEN,own=env.GITHUB_TOKEN;
 if(env.GITHUB_ACTIONS!=="true"||env.GITHUB_REPOSITORY!==RELAY||env.GITHUB_REF!=="refs/heads/main"||
    env.GITHUB_EVENT_NAME!=="workflow_dispatch"||env.GITHUB_RUN_ATTEMPT!=="1"||!id(n)||!sha(pin)||
    env.TRAVNR_REHEARSAL_RELAY_PIN!==pin||env.TRAVNR_REHEARSAL_TARGET_PIN!==TARGET_SHA||
    env.TRAVNR_REHEARSAL_CONFIRM!=="ONE_CROSS_REPO_OBSERVE_ONLY_NO_PROVIDER_NO_DB"||
    !/^github_pat_[A-Za-z0-9_]{25,}$/.test(token??"")||typeof own!=="string"||own.length<16||
    env.DATABASE_URL||env.RAPIDAPI_KEY||env.AERODATABOX_API_KEY||env.TRAVNR_CRON_RELAY_TOKEN||env.TRAVNR_CRON_ACCOUNT_KEY||
    env.NODE_TLS_REJECT_UNAUTHORIZED==="0")HOLD("SCOPE");
 let reads=0,attempted=false;const began=now();
 const headers=t=>({Authorization:"Bearer "+t,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"});
 const get=async(repo,path)=>{
  if(++reads>45||now()-began>210000)HOLD("READ_BOUND");
  const r=await fetcher(ROOT+repo+path,{method:"GET",headers:headers(repo===RELAY?own:token),redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!r.ok)HOLD("READ_HTTP_"+r.status);return r.json();
 };
 const stable=async()=>{
  if((await get(RELAY,"/git/ref/heads/main")).object?.sha!==pin||
     (await get(TARGET,"/git/ref/heads/main")).object?.sha!==TARGET_SHA)HOLD("MAIN_DRIFT");
 };
 try{
  const self=await get(RELAY,"/actions/runs/"+n);
  if(!identity(self,WF,pin,n)||self.status!=="in_progress")HOLD("SELF_IDENTITY");
  const ownHistory=await get(RELAY,"/actions/workflows/"+WF+"/runs?event=workflow_dispatch&branch=main&per_page=100");
  if(ownHistory.total_count!==1||ownHistory.workflow_runs?.length!==1||!identity(ownHistory.workflow_runs[0],WF,pin,n))HOLD("ONE_SHOT_HISTORY_REVIEW");
  await stable();
  if((await get(TARGET,"/contents/.github/workflows/"+PILOT+"?ref="+TARGET_SHA)).sha!==TARGET_WF_BLOB)HOLD("TARGET_WORKFLOW_BLOB");
  for(const q of active){
   const a=await get(TARGET,"/actions/workflows/"+PILOT+"/runs?branch=main&status="+q+"&per_page=100");
   if(a.total_count!==0||!Array.isArray(a.workflow_runs)||a.workflow_runs.length!==0)HOLD("TARGET_ACTIVE_OR_HISTORY_UNKNOWN");
  }
  await stable();
  const sent=now();emit({status:"CROSS_REPO_OBSERVE_ATTEMPT_NO_REPLAY",relayRunId:n,targetPin:TARGET_SHA,sentUtc:iso(sent)});
  attempted=true;
  const post=await fetcher(ROOT+TARGET+"/actions/workflows/"+PILOT+"/dispatches",{method:"POST",headers:{...headers(token),"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(10000),body:JSON.stringify({ref:"main",return_run_details:true,inputs:{mode:"OBSERVE"}})});
  if(post.status!==200)HOLD("ACK_HTTP_"+post.status);
  const a=await post.json(),tid=a?.workflow_run_id;
  if(!id(tid)||a.run_url!==ROOT+TARGET+"/actions/runs/"+tid||a.html_url!=="https://github.com/"+TARGET+"/actions/runs/"+tid)HOLD("UNKNOWN_ACK");
  emit({status:"CROSS_REPO_OBSERVE_ACK_NOT_EXECUTION_PROOF",relayRunId:n,targetRunId:tid});
  let row;
  for(let i=0;i<26;i++){
   row=await get(TARGET,"/actions/runs/"+tid);
   if(!identity(row,PILOT,TARGET_SHA,tid)||Date.parse(row.created_at)<sent-5000)HOLD("TARGET_RUN_IDENTITY");
   if(row.status==="completed")break;
   await sleep(5000);
  }
  if(row?.status!=="completed"||row.conclusion!=="success")HOLD("TARGET_NOT_SUCCESS");
  const jobs=await get(TARGET,"/actions/runs/"+tid+"/jobs?filter=latest&per_page=100"),j=jobs.jobs?.find(x=>x.name===observeJob);
  if(!id(j?.id))HOLD("OBSERVE_JOB");
  const log=await readLog(fetcher,token,j.id);
  const proof=verifyObserveReceipt(row,jobs,log,tid);
  const done=Date.parse(j.completed_at),created=Date.parse(row.created_at),observed=now();
  if(![done,created,observed].every(Number.isFinite)||created<sent-5000||done<created||done<sent||done>observed+5000)HOLD("TARGET_COMPLETION_CLOCK");
  await stable();
  return {status:"ACTUAL_CROSS_REPO_OBSERVE_DELIVERY_VERIFIED_NOT_COLLECTION_PROOF",relayRunId:n,relayPin:pin,...proof,requestToTargetCompletionMs:done-sent,providerCallsByRelay:0,databaseReadsByRelay:0,databaseWritesByRelay:0,paidAuthorityGranted:false,dispatches:1};
 }catch(e){
  const m=/^HOLD_(CROSS_REPO_REHEARSAL|EXTERNAL_CLOCK)_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_CROSS_REPO_REHEARSAL_REDACTED";
  throw Error(attempted?m+"_NO_BLIND_REPLAY":m);
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await rehearse(process.env,{emit:x=>console.log(JSON.stringify(x))})))}
 catch(e){console.error(/^HOLD_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_CROSS_REPO_REHEARSAL_REDACTED");process.exitCode=2;}
}
