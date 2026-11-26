/** Phase5B independent wake. A clock is not a transaction coordinator.
 * No historical success/ACK chain, no recovery epoch reset, no provider or DB.
 * Each existing target workflow has its own concurrency and admission. The
 * same grouped SOURCE/POST parent is used once, never competing dispatches
 * against its shared workflow singleton. One POST per lane per wake; a lost
 * ACK is reported UNKNOWN, never retransmitted within the wake. Later pulses
 * are new scheduler intents, not reruns; target durable admission owns dedup.
 */
const TARGET="HKcode22/ReplitTranvr", RELAY="HKcode22/TravnrClockRelay";
const root="https://api.github.com/repos/"+TARGET;
const sha=x=>/^[a-f0-9]{40}$/.test(x??"");
const hold=x=>{throw Error("HOLD_INDEPENDENT_WAKE_"+x);};
export const routes=Object.freeze([
 ["SOURCE_POST","phase5-source-upcoming-queue-main-scheduled-readonly.yml",{confirm:"RUN_CURRENT_SIGNED_SOURCE_POST_CYCLE"}],
 ["PRE_ENROLLMENT","phase6-private-later-enrollment.yml",{confirm:"ENROLL_DUE_CURRENT_SIGNED_PRE_CYCLE_NO_PROVIDER",run_days:""}],
 ["T24","phase5-cd-github-one-queued-t24-witness-main-manual.yml",{confirm:"RUN_CURRENT_SIGNED_T24_WITH_WITNESS_NO_PROVIDER",frozen_roster:""}],
 ["LATER_PRE","phase5-cd-github-bounded-pre-tick.yml",{private_transport:"PRIVATE_CURRENT_SCHEDULE",current_dispatch_confirm:"RUN_CURRENT_SIGNED_PRE_TICK_NO_PROVIDER"}],
 ["DAILY_PREPARE","phase6-nonpaid-source-day-prepare-publish.yml",{confirm:"PREPARE_PUBLISH_NEXT_DUE_SIGNED_SOURCE_DAY_NO_PROVIDER",run_day_index:""}],
 ["PRE_RECOVERY","phase5-cd-github-existing-queue-lease-watchdog.yml",{confirm:"REAP_EXISTING_CD_LEASES_ONLY_NO_REPLAY_NO_PROVIDER"}],
 ["EARLY_DRAW","phase5-six-slot-approved-early-four-airport-draw.yml",{confirm:"ONE_FUTURE_EARLY_DRAW_AFTER_SEPARATE_PHASE6_GO"}]
].map(([lane,workflow,inputs])=>Object.freeze({lane,workflow,inputs:Object.freeze(inputs)})));
const id=x=>Number.isSafeInteger(x)&&x>0;
export function admitIndependentWake(e,clock){
 const from=Date.parse(e.TRAVNR_ROLLING_POLICY_FROM_UTC),until=Date.parse(e.TRAVNR_ROLLING_POLICY_UNTIL_UTC);
 if(e.GITHUB_ACTIONS!=="true"||e.GITHUB_REPOSITORY!==RELAY||e.GITHUB_REF!=="refs/heads/main"||
  e.GITHUB_EVENT_NAME!=="workflow_dispatch"||e.GITHUB_RUN_ATTEMPT!=="1"||!id(Number(e.GITHUB_RUN_ID))||
  !sha(e.GITHUB_SHA)||e.P6_RELAY_APPROVED_EXECUTABLE_SHA!==e.GITHUB_SHA||
  e.TRAVNR_RELAY_MODE!=="MULTI_LANE"||e.TRAVNR_RELAY_LANE!=="ROLLING_ROOT"||
  e.TRAVNR_RELAY_ROLLING_ROUTE!=="INDEPENDENT_WAKE"||e.TRAVNR_RELAY_ROLLING_ENABLED!=="1"||
  e.TRAVNR_TARGET_FORWARD_ENV_READY!=="1"||
  !sha(e.TRAVNR_APPROVED_TARGET_MAIN_SHA)||e.TRAVNR_APPROVED_TARGET_MAIN_SHA===e.GITHUB_SHA||
  !Number.isFinite(from)||!Number.isFinite(until)||new Date(from).toISOString()!==e.TRAVNR_ROLLING_POLICY_FROM_UTC||
  new Date(until).toISOString()!==e.TRAVNR_ROLLING_POLICY_UNTIL_UTC||clock<from||clock>=until||until-from>60*86400000||
  typeof e.TRAVNR_TARGET_ACTIONS_TOKEN!=="string"||e.TRAVNR_TARGET_ACTIONS_TOKEN.length<16||
  ["DATABASE_URL","AERODATABOX_API_KEY","AERODATABOX_WEBHOOK_SECRET","RAPIDAPI_KEY","V39_P5_SOURCE_DATABASE_URL","P5_V39_PRE_DATABASE_URL"].some(k=>e[k])||
  e.NODE_TLS_REJECT_UNAUTHORIZED==="0")hold("SCOPE");
 return {targetSha:e.TRAVNR_APPROVED_TARGET_MAIN_SHA,until};
}
export async function independentWake(e,{fetcher=fetch,now=Date.now,emit=()=>{}}={}){
 const start=now(),a=admitIndependentWake(e,start),deadline=Math.min(start+120000,a.until);
 const headers={Authorization:"Bearer "+e.TRAVNR_TARGET_ACTIONS_TOKEN,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
 const request=(path,method="GET",body)=>fetcher(root+path,{method,headers:{...headers,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:"error",signal:AbortSignal.timeout(10000)});
 // Only immutable main identity is global. No run counts, history sweeps,
 // predecessor artifacts, or other route's conclusion can block a wake.
 const pin=await request("/git/ref/heads/main");
 if(!pin.ok||(await pin.json()).object?.sha!==a.targetSha)hold("TARGET_MAIN_DRIFT");
 const utc=new Date(start);
 const out=[];
 // Active-only observation, not historical completeness. Do not compare a
 // changing list count to its page length, inspect failed predecessors, or
 // create another queued run when a live one is visible. A read outage is
 // local to this lane and automatically clears on the next external pulse.
 const activeStates=["queued","in_progress","waiting","requested","pending"];
 async function busy(r){
  const reads=await Promise.allSettled(activeStates.map(async status=>{
   const x=await request("/actions/workflows/"+r.workflow+"/runs?branch=main&status="+status+"&per_page=1");
   if(!x.ok)throw Error("ACTIVE_READ");
   const j=await x.json();
   if(!Number.isSafeInteger(j.total_count)||j.total_count<0||!Array.isArray(j.workflow_runs))throw Error("ACTIVE_SHAPE");
   return j.total_count>0||j.workflow_runs.length>0;
  }));
  if(reads.some(x=>x.status==="fulfilled"&&x.value))return "ACTIVE_DEFERRED";
  return reads.some(x=>x.status==="rejected")?"ACTIVE_READ_UNAVAILABLE_DEFERRED":null;
 }
 const selected=routes.filter(r=>r.lane!=="EARLY_DRAW"||(utc.getUTCHours()%4===0&&utc.getUTCMinutes()>=10&&utc.getUTCMinutes()<40));
 // Bound concurrent route groups to two. Each route still performs its own
 // active check immediately before its single POST; shared SOURCE/POST is one lane.
 // The slowest lane no longer serializes all seven distinct workflows.
 async function wakeRoute(r){
  if(now()>=deadline-11000)return {lane:r.lane,status:"DEFERRED_DEADLINE"};
  try{
   const blocked=await busy(r);
   if(blocked)return {lane:r.lane,status:blocked};
   if(now()>=deadline-11000)return {lane:r.lane,status:"DEFERRED_DEADLINE"};
   const res=await request("/actions/workflows/"+r.workflow+"/dispatches","POST",{ref:"main",return_run_details:true,inputs:r.inputs});
   if(res.status!==200)return {lane:r.lane,status:"ACK_UNKNOWN_OR_REFUSED",httpStatus:res.status};
   const j=await res.json(),n=j.workflow_run_id;
   if(!id(n)||j.run_url!==root+"/actions/runs/"+n||j.html_url!=="https://github.com/"+TARGET+"/actions/runs/"+n)return {lane:r.lane,status:"ACK_UNKNOWN_OR_REFUSED"};
   return {lane:r.lane,status:"ACK_NOT_COLLECTION_PROOF",runId:n};
  }catch{return {lane:r.lane,status:"ACK_UNKNOWN_OR_REFUSED"};}
 }
 for(let i=0;i<selected.length;i+=2)out.push(...await Promise.all(selected.slice(i,i+2).map(wakeRoute)));
 const result={status:"INDEPENDENT_WAKE_COMPLETE_NOT_COLLECTION_PROOF",relayRunId:Number(e.GITHUB_RUN_ID),targetSha:a.targetSha,lanes:out,providerCalls:0,databaseWrites:0,paidAuthorityGranted:false};
 emit(result);return result;
}
if(process.env.P6_INDEPENDENT_WAKE_ENTRYPOINT==="1")independentWake(process.env,{emit:x=>console.log(JSON.stringify(x))}).catch(e=>{console.error(/^HOLD_INDEPENDENT_WAKE_[A-Z_]+$/.test(e?.message??"")?e.message:"HOLD_INDEPENDENT_WAKE_REDACTED");process.exitCode=2;});
