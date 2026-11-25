import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
export const REPO="HKcode22/TravnrClockRelay",WF="external-clock.yml";
const GH="https://api.github.com/repos/"+REPO,CRON="https://api.cron-job.org",TARGET_PUBLIC="https://api.github.com/repos/HKcode22/ReplitTranvr";
const URL=GH+"/actions/workflows/"+WF+"/dispatches";
const HOLD=s=>{throw Error("HOLD_CRON_MANAGER_"+s)};
const id=x=>Number.isSafeInteger(x)&&x>0,sha=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x),iso=x=>new Date(x).toISOString();
const time=x=>{const t=Date.parse(x);if(typeof x!=="string"||!Number.isFinite(t))HOLD("UTC");return t};
export const MANAGED_LANES=Object.freeze({
 CLOCK_ONLY:{title:"Travnr isolated clock-only monitored backup",minutes:[2,12,22,32,42,52]},
 PRIMARY_BACKSTOP:{title:"Travnr isolated primary expiry recovery",minutes:[4,19,34,49]},
 ROLLING_ROOT:{title:"Travnr isolated rolling root recovery",minutes:[8,18,28,38,48,58]}
});
const laneOf=c=>c.lane??"CLOCK_ONLY",meta=c=>MANAGED_LANES[laneOf(c)],bodyOf=c=>JSON.stringify({ref:"main",return_run_details:true,...(laneOf(c)==="CLOCK_ONLY"?{}:{inputs:{lane:laneOf(c)}})});
const utcNumber=x=>Number(iso(x).slice(0,19).replace(/[-:T]/g,""));
export const PILOT=Object.freeze({jobId:8889486,title:"Travnr isolated 90-minute external clock pilot",pin:"9cca29330405774520e0c7929f4916e24d9934e4",from:"2026-11-18T06:23:10.805Z",enabledReadback:"2026-11-18T06:23:11.184Z",until:"2026-11-18T07:53:06.000Z"});
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function config(env,mode,lane="CLOCK_ONLY"){
 if(mode==="PILOT")return {...PILOT};
 if(mode!=="RECENT"||!Object.hasOwn(MANAGED_LANES,lane))HOLD("MODE");
 const pre=lane==="CLOCK_ONLY"?"TRAVNR_CRON_":lane==="PRIMARY_BACKSTOP"?"TRAVNR_CRON_PRIMARY_":"TRAVNR_CRON_ROLLING_";
 const c={lane,jobId:Number(env[pre+"JOB_ID"]),title:MANAGED_LANES[lane].title,pin:env.TRAVNR_CRON_RELAY_SHA,from:env[pre+"START_UTC"],enabledReadback:env[pre+"ENABLED_UTC"],until:env[pre+"UNTIL_UTC"]};
 if(!/^[1-9]\d{0,14}$/.test(env[pre+"JOB_ID"]??"")||!sha(c.pin)||!id(c.jobId))HOLD("CONFIG");
 const a=time(c.from),b=time(c.enabledReadback),z=time(c.until);
 if(b<a||b-a>60000||z<=b||z-a>60*86400000)HOLD("CONFIG_WINDOW");
 return c;
}
export function validateJob(c,j){
 const s=j?.schedule,h=j?.extendedData?.headers??{},headers=Object.fromEntries(Object.entries(h).map(([k,v])=>[k.toLowerCase(),v]));
 if(!j||j.jobId!==c.jobId||j.title!==c.title||j.url!==URL||j.requestMethod!==1||j.type!==0||
    j.saveResponses!==true||j.redirectSuccess!==false||j.requestTimeout!==30||j.auth?.enable!==false||
    typeof j.enabled!=="boolean"||s?.timezone!=="UTC"||s?.expiresAt!==utcNumber(time(c.until))||
    !["hours","mdays","months","wdays"].every(k=>eq(s[k],[-1]))||!eq(s.minutes,meta(c).minutes)||
    j.extendedData?.body!==bodyOf(c)||
    Object.keys(headers).length!==4||headers.accept!=="application/vnd.github+json"||
    headers["content-type"]!=="application/json"||headers["x-github-api-version"]!=="2022-11-28"||
    !/^Bearer github_pat_[A-Za-z0-9_]{25,}$/.test(headers.authorization??"")||
    j.notification?.onFailure!==true||j.notification?.onFailureCount!==1||j.notification?.onDisable!==true)HOLD("EXACT_JOB_CONFIG");
 return {enabled:j.enabled,expiresAt:c.until};
}
export function planned(c,mode,now){
 const start=time(c.from),end=time(c.until);
 if(!Number.isSafeInteger(now)||end<=start)HOLD("CLOCK");
 const lower=mode==="PILOT"||mode==="SHADOW"?start:Math.max(start,now-180*60000-120000);
 const upper=Math.min(end,now-120000); // two minute observation grace, not collection permission
 const out=[];
 for(let t=Math.floor(lower/60000)*60000+60000;t<end&&t<=upper;t+=60000)if(meta(c).minutes.includes(new Date(t).getUTCMinutes()))out.push(t/1000);
 if(out.length>(mode==="PILOT"?9:19))HOLD("PLAN_BOUND");
 return out;
}
export function classify(c,slots,history){
 if(!Array.isArray(history)||history.length>100)HOLD("HISTORY_BOUND");
 const groups=new Map(),unexpected=[];
 for(const x of history){
  if(x.jobId!==c.jobId||!Number.isSafeInteger(x.datePlanned)||!Number.isSafeInteger(x.date)||!Number.isSafeInteger(x.jitter)||
     typeof x.identifier!=="string"||!/^[A-Za-z0-9-]{1,100}$/.test(x.identifier)||x.url!==URL||
     Math.abs((x.date-x.datePlanned)*1000-x.jitter)>2000)HOLD("HISTORY_IDENTITY");
  if(x.datePlanned*1000<time(c.originalFrom??c.from)||x.datePlanned*1000>=time(c.until)||!meta(c).minutes.includes(new Date(x.datePlanned*1000).getUTCMinutes()))unexpected.push(x.datePlanned);
  if(!groups.has(x.datePlanned))groups.set(x.datePlanned,[]);
  groups.get(x.datePlanned).push(x);
 }
 const rows=slots.map(p=>{
  const list=groups.get(p)??[];
  if(list.length===0)return {planned:p,status:p*1000<=time(c.enabledReadback)?"ENABLE_BOUNDARY_UNCERTAIN":"UNOBSERVED_CRON_TICK"};
  if(list.length!==1)return {planned:p,status:"DUPLICATE_CRON_TICK"};
  const r=list[0];if(r.status!==1||r.httpStatus!==200)return {planned:p,status:"CRON_HTTP_FAILURE",httpStatus:r.httpStatus};
  return {planned:p,status:"CRON_HTTP_ACK_ONLY",row:r};
 });
 return {rows,unexpected:unexpected.length};
}
export function ack(c,r,d){
 const x=d?.jobHistoryDetails;
 if(!x||x.jobId!==c.jobId||x.identifier!==r.identifier||x.date!==r.date||x.datePlanned!==r.datePlanned||x.url!==URL||
    x.status!==1||x.httpStatus!==200||typeof x.body!=="string"||x.body.length>10000)HOLD("DETAIL_IDENTITY");
 let a;try{a=JSON.parse(x.body)}catch{HOLD("ACK_JSON")}
 if(!id(a.workflow_run_id)||a.run_url!==GH+"/actions/runs/"+a.workflow_run_id||a.html_url!=="https://github.com/"+REPO+"/actions/runs/"+a.workflow_run_id)HOLD("ACK_IDENTITY");
 return a.workflow_run_id;
}
const receiptJob=c=>laneOf(c)==="CLOCK_ONLY"||c.shadow?"independent-pulse":c.independentWake?"independent-wake":"target-forward";
export function verifyReceipt(c,r,n,run,jobs,log){
 if(c.shadowRecent){
  if(![c.pin,c.activationPin].includes(run?.head_sha))HOLD("RUN_IDENTITY");
  c={...c,pin:run.head_sha};
 }
 if(run?.id!==n||run.head_sha!==c.pin||run.head_branch!=="main"||run.path!==".github/workflows/"+WF||
    run.event!=="workflow_dispatch"||run.run_attempt!==1||laneOf(c)!=="CLOCK_ONLY"&&run.display_title!=="TRAVNR EXTERNAL CLOCK "+laneOf(c))HOLD("RUN_IDENTITY");
 if(run.status!=="completed")return {status:"RELAY_PENDING",runId:n};
 if(run.conclusion!=="success")return {status:"RELAY_FAILED",runId:n};
 if(!Array.isArray(jobs?.jobs)||jobs.total_count!==jobs.jobs.length||jobs.jobs.length>100)HOLD("JOBS");
 if(c.shadow){
  const named=new Map(jobs.jobs.map(j=>[j.name,j]));
  if(jobs.total_count!==3||named.size!==3||new Set(jobs.jobs.map(j=>j.id)).size!==3||!["offline-tests","independent-pulse","target-forward"].every(k=>named.has(k))||
     !jobs.jobs.every(j=>id(j.id)&&j.run_id===n&&j.head_sha===c.pin&&j.run_attempt===1&&j.status==="completed")||
     named.get("offline-tests").conclusion!=="skipped"||!(named.get("offline-tests").steps==null||Array.isArray(named.get("offline-tests").steps)&&named.get("offline-tests").steps.length===0))HOLD("SHADOW_JOB_SCOPE");
  const forward=jobs.jobs.filter(j=>j.name==="target-forward");
  if(forward.length!==1||!id(forward[0].id)||forward[0].run_id!==n||forward[0].head_sha!==c.pin||forward[0].run_attempt!==1||
     forward[0].status!=="completed"||forward[0].conclusion!=="skipped"||!(forward[0].steps==null||Array.isArray(forward[0].steps)&&forward[0].steps.length===0))HOLD("SHADOW_FORWARD_NOT_SKIPPED");
 }
 const matches=jobs.jobs.filter(j=>j.name===receiptJob(c));
 if(matches.length!==1)HOLD("PULSE_JOB");
 const j=matches[0];
 if(c.independentWake)return verifyIndependentWakeReceipt(c,r,n,run,j,jobs,log);
 if(laneOf(c)!=="CLOCK_ONLY"&&id(j.id)&&j.status==="completed"&&j.conclusion==="skipped"&&j.run_id===n&&j.head_sha===c.pin&&j.run_attempt===1&&(j.steps==null||j.steps.length===0))return {status:"RELAY_FORWARD_SKIPPED",runId:n};
 if(!id(j.id)||j.head_sha!==c.pin||j.run_id!==n||j.run_attempt!==1||j.status!=="completed"||j.conclusion!=="success"||
    j.steps?.filter(s=>s.name==="Run node cli.mjs"&&s.status==="completed"&&s.conclusion==="success").length!==1)HOLD("PULSE_STEP");
 if(laneOf(c)!=="CLOCK_ONLY"&&!c.shadow)return verifyRecoveryOutput(c,r,n,run,j,log);
 const status=c.shadow?"EXTERNAL_RECOVERY_LANE_SHADOW_OBSERVED_NO_TARGET_DISPATCH":"EXTERNAL_CLOCK_OBSERVED_NO_TARGET_DISPATCH";
 const hits=String(log).split(/\r?\n/).filter(l=>l.includes('{"status":"'+status+'"'));
 if(hits.length!==1)HOLD("RECEIPT_COUNT");
 let x;try{x=JSON.parse(hits[0].slice(hits[0].indexOf('{"status":')).trim())}catch{HOLD("RECEIPT_JSON")}
 const created=time(run.created_at),observed=time(x.runnerObservedUtc);
 if(x.relayRunId!==n||x.mode!==laneOf(c)||c.shadow&&x.relayDispatches!==0||time(x.actualCreatedUtc)!==created||x.providerCallsByRelay!==0||
    x.databaseReadsByRelay!==0||x.databaseWritesByRelay!==0||x.paidAuthorityGranted!==false||
    !Number.isSafeInteger(x.creationToObservedMs)||x.creationToObservedMs<0||Math.abs(observed-created-x.creationToObservedMs)>1000||
    created<r.date*1000-5000||observed<created||observed<time(j.started_at)-5000||observed>time(j.completed_at)+1000)HOLD("RECEIPT_SCOPE");
 return {status:c.shadow?"SHADOW_LANE_PROVEN_NO_FORWARD":"CLOCK_ONLY_PROVEN",runId:n,jobId:j.id,plannedToRunnerMs:observed-r.datePlanned*1000,creationToRunnerMs:observed-created};
}
function verifyIndependentWakeReceipt(c,r,n,run,j,jobs,log){
 const names=["offline-tests","independent-pulse","target-forward","independent-wake"];
 if(laneOf(c)!=="ROLLING_ROOT"||jobs.total_count!==4||
    new Set(jobs.jobs.map(x=>x.name)).size!==4||new Set(jobs.jobs.map(x=>x.id)).size!==4||
    !jobs.jobs.every(x=>names.includes(x.name)&&id(x.id)&&x.run_id===n&&x.head_sha===c.pin&&x.run_attempt===1&&x.status==="completed")||
    jobs.jobs.some(x=>x!==j&&(x.conclusion!=="skipped"||x.steps?.length))||
    j.conclusion!=="success"||j.steps?.filter(x=>x.name==="Wake each independent reviewed worker route once"&&x.status==="completed"&&x.conclusion==="success").length!==1)HOLD("INDEPENDENT_WAKE_JOB_SCOPE");
 const hits=String(log).split(/\r?\n/).filter(l=>l.includes('{"status":"INDEPENDENT_WAKE_COMPLETE_NOT_COLLECTION_PROOF"'));
 if(hits.length!==1)HOLD("INDEPENDENT_WAKE_RECEIPT_COUNT");
 let x;try{x=JSON.parse(hits[0].slice(hits[0].indexOf('{"status":')).trim())}catch{HOLD("INDEPENDENT_WAKE_JSON")}
 const required=["SOURCE_POST","PRE_ENROLLMENT","T24","LATER_PRE","DAILY_PREPARE","PRE_RECOVERY"];
 const namesAllowed=[...required,"EARLY_DRAW"];
 if(x.relayRunId!==n||x.targetSha!==c.targetPin||x.providerCalls!==0||x.databaseWrites!==0||x.paidAuthorityGranted!==false||
    !Array.isArray(x.lanes)||![6,7].includes(x.lanes.length)||new Set(x.lanes.map(y=>y.lane)).size!==x.lanes.length||
    !required.every(k=>x.lanes.some(y=>y.lane===k))||x.lanes.some(y=>!namesAllowed.includes(y.lane)))HOLD("INDEPENDENT_WAKE_RECEIPT_SCOPE");
 const statuses=["ACK_NOT_COLLECTION_PROOF","ACTIVE_DEFERRED","ACTIVE_READ_UNAVAILABLE_DEFERRED","DEFERRED_DEADLINE","ACK_UNKNOWN_OR_REFUSED"];
 if(x.lanes.some(y=>!statuses.includes(y.status)||(y.status==="ACK_NOT_COLLECTION_PROOF"? !id(y.runId):y.runId!==undefined)))HOLD("INDEPENDENT_WAKE_LANE_STATUS");
 const acks=x.lanes.filter(y=>y.status==="ACK_NOT_COLLECTION_PROOF");
 if(new Set(acks.map(y=>y.runId)).size!==acks.length)HOLD("INDEPENDENT_WAKE_DUPLICATE_ACK");
 const created=time(run.created_at),started=time(j.started_at),ended=time(j.completed_at);
 if(created<r.date*1000-5000||started<created||ended<started)HOLD("INDEPENDENT_WAKE_CLOCK");
 const review=x.lanes.some(y=>!["ACK_NOT_COLLECTION_PROOF","ACTIVE_DEFERRED"].includes(y.status));
 return {status:review?"RELAY_INDEPENDENT_WAKE_REVIEW_REQUIRED":"RELAY_INDEPENDENT_WAKE_ACKS_OBSERVED_NOT_COLLECTION_PROOF",
   runId:n,jobId:j.id,plannedToRunnerMs:started-r.datePlanned*1000,creationToRunnerMs:started-created,
   timingBasis:"GITHUB_JOB_STARTED_AT",independentAcknowledgedLanes:acks.length,
   independentActiveDeferredLanes:x.lanes.filter(y=>y.status==="ACTIVE_DEFERRED").length,
   independentReviewLanes:x.lanes.filter(y=>!["ACK_NOT_COLLECTION_PROOF","ACTIVE_DEFERRED"].includes(y.status)).map(y=>y.lane),
   independentTargetRunIds:acks.map(y=>y.runId),targetCollectionVerified:false};
}
function verifyRecoveryOutput(c,r,n,run,j,log){
 const rows=[];
 for(const l of String(log).split(/\r?\n/)){
  const p=l.indexOf('{"status":');if(p<0)continue;
  let a;try{a=JSON.parse(l.slice(p).trim())}catch{HOLD("RECOVERY_LOG_JSON")}
  if(a&&typeof a==="object"&&Object.hasOwn(a,"providerCallsByRelay"))rows.push(a);
 }
 if(rows.length!==1)HOLD("RECOVERY_RECEIPT_COUNT");
 const x=rows[0],base={runId:n,jobId:j.id,disposition:x.status};
 if(x.relayRunId!==n||x.mode!==laneOf(c)||x.providerCallsByRelay!==0||x.databaseReadsByRelay!==0||
    x.databaseWritesByRelay!==0||x.paidAuthorityGranted!==false)HOLD("RECOVERY_RECEIPT_SCOPE");
 if(x.status==="EXTERNAL_WAKE_PREFLIGHT_DEFERRED_NO_POST"){
  if(x.relayDispatches!==0)HOLD("RECOVERY_PREFLIGHT_SCOPE");
  return {status:"RELAY_PREFLIGHT_DEFERRED",...base};
 }
 const created=time(run.created_at),observed=time(x.runnerObservedUtc);
 if(time(x.actualCreatedUtc)!==created||!Number.isSafeInteger(x.creationToObservedMs)||x.creationToObservedMs<0||
    Math.abs(observed-created-x.creationToObservedMs)>1000||created<r.date*1000-5000||
    observed<created||observed<time(j.started_at)-5000||observed>time(j.completed_at)+1000)HOLD("RECOVERY_CLOCK");
 const result={...base,plannedToRunnerMs:observed-r.datePlanned*1000,creationToRunnerMs:observed-created};
 if(x.status==="TARGET_ACK_AND_RUN_IDENTITY_VERIFIED_NOT_COLLECTION_PROOF"){

  const wf=laneOf(c)==="PRIMARY_BACKSTOP"?"phase5-primary-fids-expiry-no-provider.yml":(c.directTick===true||c.directVerify===true)?"phase6-direct-recovery-tick.yml":"phase6-rolling-controller-bounded-session.yml";
  if(!id(x.targetRunId)||x.targetWorkflow!==wf||x.relayDispatches!==1)HOLD("RECOVERY_TARGET_ACK");
  return {status:"RELAY_TARGET_ACK_ONLY",...result,targetRunId:x.targetRunId};
 }
 const benign=["DEFER_TARGET_ALREADY_ACTIVE","DEFER_RECENT_PRIMARY_STEP_NOT_DELETION_PROOF","DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW",...(laneOf(c)==="ROLLING_ROOT"&&(c.directTick===true||c.directVerify===true)?["DEFER_RECENT_DIRECT_TICK_NOT_COLLECTION_PROOF"]:[])];
 const review=["DEFER_SEPARATE_LANE_OFF","QUARANTINED_PRIOR_RELAY_RUN_REVIEW","DEFER_NO_CURRENT_MAIN_APPLY_BASELINE_REVIEW","DEFER_NO_CURRENT_MAIN_FULL_RETENTION_APPLY_BASELINE_REVIEW","DEFER_CURRENT_WINDOW_CUSTODY_REVIEW_NO_REPLAY",...(laneOf(c)==="ROLLING_ROOT"&&(c.directTick===true||c.directVerify===true)?["DEFER_DIRECT_PRIOR_ATTEMPT_REVIEW_NO_REPLAY"]:[])];
 if(benign.includes(x.status))return {status:"RELAY_OBSERVED_DEFER_NO_WORK_PROOF",...result};
 if(review.includes(x.status))return {status:"RELAY_REVIEW_REQUIRED",...result};
 HOLD("RECOVERY_UNKNOWN_DISPOSITION");
}
/** Target public metadata only: ACK is not terminal success, and even
 * a verified protected step does not establish provider or collection proof. */
export async function observeTargetStep(c,targetRunId,targetGh){
 const lane=laneOf(c),primary=lane==="PRIMARY_BACKSTOP",verify=lane==="ROLLING_ROOT"&&c.directVerify===true,direct=lane==="ROLLING_ROOT"&&(c.directTick===true||verify);
 if(!["PRIMARY_BACKSTOP","ROLLING_ROOT"].includes(lane)||!id(targetRunId)||!sha(c.targetPin)||typeof targetGh!=="function")HOLD("TARGET_OBSERVATION_SCOPE");

 const workflow=primary?"phase5-primary-fids-expiry-no-provider.yml":direct?"phase6-direct-recovery-tick.yml":"phase6-rolling-controller-bounded-session.yml";
 const expectedJob=primary?"primary-fids-expiry":direct?(verify?"direct-readonly-verify":"direct-protected-recovery-tick"):"one-protected-bounded-session";
 const expectedStep=primary?"Verify exact main and execute only bounded primary FIDS expiry":direct?(verify?"Verify exact direct wake and existing workflow metadata NO POST":"Execute one direct recovery wave and reconcile exact parent ACKs"):"Execute one protected rolling session and reconcile accepted workers before terminal";
 const r=await targetGh("/actions/runs/"+targetRunId);
 if(r?.id!==targetRunId||r.head_sha!==c.targetPin||r.head_branch!=="main"||r.event!=="workflow_dispatch"||
    r.path!==".github/workflows/"+workflow||r.run_attempt!==1||direct&&r.display_title!==(verify?"P6 DIRECT RECOVERY VERIFY":"P6 DIRECT RECOVERY TICK"))HOLD("TARGET_RUN_IDENTITY");
 const full=primary&&r.display_title==="P5 FULL RETENTION BACKSTOP CHILD";
 if(primary&&!full&&r.display_title!=="P5 PRIMARY BACKSTOP CHILD")HOLD("TARGET_PRIMARY_TITLE");
 if(!["completed","queued","in_progress","waiting","requested","pending"].includes(r.status))HOLD("TARGET_STATUS");
 if(r.status!=="completed")return {status:"RELAY_TARGET_PENDING_EXECUTION",targetRunId,targetStatus:r.status};
 if(r.conclusion!=="success")return {status:"RELAY_TARGET_TERMINAL_FAILURE",targetRunId,targetConclusion:r.conclusion};
 const jobs=await targetGh("/actions/runs/"+targetRunId+"/jobs?filter=latest&per_page=100");
 if(!Array.isArray(jobs?.jobs)||jobs.total_count!==jobs.jobs.length||(primary?(full?jobs.total_count!==2:![1,2].includes(jobs.total_count)):jobs.total_count!==(direct?3:2))||
    new Set(jobs.jobs.map(j=>j.id)).size!==jobs.jobs.length||
    !jobs.jobs.every(j=>id(j.id)&&j.run_id===targetRunId&&j.head_sha===c.targetPin&&j.run_attempt===1&&j.status==="completed"))HOLD("TARGET_JOBS");
 const matches=jobs.jobs.filter(j=>j.name===expectedJob);
 if(matches.length!==1)HOLD("TARGET_PROTECTED_JOB");
 const j=matches[0];
 
 if(primary){
  const siblings=jobs.jobs.filter(x=>x!==j);
  if(full){
   const research=siblings[0];
   if(siblings.length!==1||research.name!=="phase7-expiry"||
      research.conclusion!=="success"||research.steps?.filter(s=>s.name==="Bounded derived research and temporary link due-only expiry"&&s.conclusion==="success"&&s.status==="completed").length!==1)
    HOLD("TARGET_FULL_RETENTION_RESEARCH_STEP");
  }else if(siblings.length>0&&(siblings.length!==1||siblings[0].name!=="phase7-expiry"||
    siblings[0].conclusion!=="skipped"||!(siblings[0].steps==null||Array.isArray(siblings[0].steps)&&siblings[0].steps.length===0)))
   HOLD("TARGET_PRIMARY_UNEXPECTED_SIBLING");
 }
 if(!primary){
  const expectedSkipped=direct?["offline-direct-recovery",verify?"direct-protected-recovery-tick":"direct-readonly-verify"]:["offline-bounded-session-reconciliation"];
  if(!expectedSkipped.every(name=>jobs.jobs.filter(x=>x.name===name&&x.conclusion==="skipped"&&(x.steps==null||Array.isArray(x.steps)&&x.steps.length===0)).length===1))HOLD("TARGET_UNEXPECTED_JOB");
 }
 if(j.conclusion==="skipped"&&(j.steps==null||Array.isArray(j.steps)&&j.steps.length===0))return {status:"RELAY_TARGET_PROTECTED_JOB_SKIPPED",targetRunId,targetJobId:j.id};
 if(j.conclusion!=="success"||j.steps?.filter(s=>s.name===expectedStep&&s.conclusion==="success"&&s.status==="completed").length!==1)HOLD("TARGET_PROTECTED_STEP");


 if(verify)return {status:"RELAY_TARGET_READONLY_DIRECT_VERIFY_EXECUTED_NO_COLLECTION_PROOF",targetRunId,targetJobId:j.id,targetPin:c.targetPin};
 if(!primary&&j.steps?.filter(s=>s.name===(direct?"Preserve direct terminal operational receipt":"Preserve terminal operational receipt for independently reviewed continuation")&&s.conclusion==="success"&&s.status==="completed").length!==1)HOLD("TARGET_TERMINAL_RECEIPT_STEP");
 if(direct){
  const markers=["Direct outcome TERMINAL_PARENT_ACKS_RECONCILED","Direct outcome PREFLIGHT_HOLD_NO_POST","Direct outcome KNOWN_ACTIVE_PARENT_ACKS_CARRIED"].map(name=>j.steps?.filter(s=>s.name===name)??[]);
  if(markers.some(x=>x.length!==1||x[0].status!=="completed"||!["success","skipped"].includes(x[0].conclusion))||
     markers.filter(x=>x[0].conclusion==="success").length!==1)HOLD("DIRECT_TARGET_DISPOSITION");
  if(markers[1][0].conclusion==="success")return {status:"RELAY_TARGET_DIRECT_PREFLIGHT_HOLD_NO_POST",targetRunId,targetJobId:j.id,targetPin:c.targetPin};
  if(markers[2][0].conclusion==="success")return {status:"RELAY_TARGET_DIRECT_KNOWN_ACTIVE_CUSTODY_NOT_TERMINAL_PROOF",targetRunId,targetJobId:j.id,targetPin:c.targetPin};
 }
 return {status:"RELAY_TARGET_STEP_EXECUTION_VERIFIED_NOT_COLLECTION_PROOF",targetRunId,targetJobId:j.id,targetPin:c.targetPin,...(primary?{retentionScope:full?"FULL_BACKSTOP_BOTH_STEPS_METADATA_ONLY":"PRIMARY_ONLY_STEP_METADATA_ONLY",...(full?{researchJobId:jobs.jobs.find(x=>x.name==="phase7-expiry").id}:{})}:{})};
}
export function samples(rows,mode,limit=3){
 const good=rows.filter(x=>x.status==="CRON_HTTP_ACK_ONLY");
 if(mode==="PILOT"||mode==="SHADOW")return good;
 if(limit===1)return good.length?[good.at(-1)]:[];
 if(limit!==3)HOLD("SAMPLE_LIMIT");
 // At most three detail calls per two-hour audit (60 account requests/day worst case).
 const max=[...good].sort((a,b)=>b.row.jitter-a.row.jitter||a.planned-b.planned)[0];
 return [...new Map([good[0],good.at(-1),max].filter(Boolean).map(x=>[x.planned,x])).values()];
}
/** Read-only expiry warning; never extends an authorization. */
export function leaseHealth(c,mode,now){
 if(mode==="PILOT")return null;
 const end=time(c.until);
 if(!Number.isSafeInteger(now))HOLD("CLOCK");
 const remaining=end-now;
 return {remainingMs:Math.max(0,remaining),state:remaining<=0?"EXPIRED":remaining<=48*3600000?"RENEWAL_CRITICAL":remaining<=7*86400000?"RENEWAL_DUE_REVIEW":"LEASE_CURRENT"};
}
/** Fixed study-end lease readback tolerance, not extension authority.
 * Only the exact pair may advance to the predetermined later expiry.
 * Partial renewal must still surface as a pair-level incident. */
export function continuityConfig(c,job,mode,now){
 const old="2026-12-19T08:00:00.000Z",end="2026-12-30T08:00:00.000Z";
 const exactPair=[["PRIMARY_BACKSTOP",8890475],["ROLLING_ROOT",8890476]].some(([l,n])=>laneOf(c)===l&&c.jobId===n);
 if(c.leaseContinuity===true&&exactPair&&["RECENT","SHADOW_RECENT"].includes(mode)&&
    c.until===old&&now>=Date.parse("2026-12-12T08:00:00.000Z")&&job?.schedule?.expiresAt===utcNumber(time(end)))
  return {...c,until:end};
 return c;
}
export async function audit({c,mode,now,cron,gh,logs,targetGh,sampleLimit=3}){
 const job=(await cron("/jobs/"+c.jobId)).jobDetails;
 c=continuityConfig(c,job,mode,now);
 const detail=validateJob(c,job);
 const slots=planned(c,mode,now),h=await cron("/jobs/"+c.jobId+"/history"),{rows,unexpected}=classify(c,slots,h.history);
 const selected=samples(rows,mode,sampleLimit),used=new Set();
 for(const x of selected){
  try{
   const r=x.row,n=ack(c,r,await cron("/jobs/"+c.jobId+"/history/"+encodeURIComponent(r.identifier)));
   if(used.has(n))HOLD("DUPLICATE_RUN_ACK");used.add(n);
   const run=await gh("/actions/runs/"+n);
   let jobs,log;
   if(run.status==="completed"&&run.conclusion==="success"){
    jobs=await gh("/actions/runs/"+n+"/jobs?filter=latest&per_page=100");
    const j=jobs.jobs?.find(v=>v.name===receiptJob(c));
    if(!id(j?.id))HOLD("PULSE_JOB");
    if(j.conclusion!=="skipped")log=await logs(n,j.id);
   }
   Object.assign(x,verifyReceipt(c,r,n,run,jobs,log));
   if(x.status==="RELAY_TARGET_ACK_ONLY"&&targetGh)Object.assign(x,await observeTargetStep(c,x.targetRunId,targetGh));
  }catch(e){x.status="EVIDENCE_HOLD";x.reason=/^HOLD_CRON_MANAGER_[A-Z0-9_]+$/.test(e?.message||"")?e.message:"HOLD_CRON_MANAGER_UNKNOWN";}
 }
 const safe=rows.map(({row,...x})=>({...x,plannedUtc:iso(x.planned*1000)}));
 const proven=safe.filter(x=>x.status===(c.shadow?"SHADOW_LANE_PROVEN_NO_FORWARD":"CLOCK_ONLY_PROVEN")),timed=safe.filter(x=>Number.isFinite(x.plannedToRunnerMs)),late=timed.filter(x=>x.plannedToRunnerMs>120000),ackOnly=safe.filter(x=>x.status==="CRON_HTTP_ACK_ONLY");
 const relayTargetAcks=safe.filter(x=>id(x.targetRunId)).length,relayTargetExecutions=safe.filter(x=>x.status==="RELAY_TARGET_STEP_EXECUTION_VERIFIED_NOT_COLLECTION_PROOF"||x.status==="RELAY_TARGET_READONLY_DIRECT_VERIFY_EXECUTED_NO_COLLECTION_PROOF").length,relayDefers=safe.filter(x=>x.status==="RELAY_OBSERVED_DEFER_NO_WORK_PROOF").length,
  directKnownActiveCustody=safe.filter(x=>x.status==="RELAY_TARGET_DIRECT_KNOWN_ACTIVE_CUSTODY_NOT_TERMINAL_PROOF").length;
 const bad=safe.filter(x=>!["CLOCK_ONLY_PROVEN","SHADOW_LANE_PROVEN_NO_FORWARD","CRON_HTTP_ACK_ONLY","RELAY_TARGET_STEP_EXECUTION_VERIFIED_NOT_COLLECTION_PROOF","RELAY_TARGET_READONLY_DIRECT_VERIFY_EXECUTED_NO_COLLECTION_PROOF","RELAY_TARGET_DIRECT_KNOWN_ACTIVE_CUSTODY_NOT_TERMINAL_PROOF","RELAY_OBSERVED_DEFER_NO_WORK_PROOF","RELAY_INDEPENDENT_WAKE_ACKS_OBSERVED_NOT_COLLECTION_PROOF"].includes(x.status));
 const expired=now>=time(c.until)+120000,disabledEarly=now<time(c.until)&&!detail.enabled;
 return {status:"READONLY_CRON_AND_RELAY_AUDIT_NOT_COLLECTION_PROOF",mode,lane:laneOf(c),jobId:c.jobId,relayPin:c.pin,observedUtc:iso(now),auditFirstPlannedUtc:slots.length?iso(slots[0]*1000):null,auditLastPlannedUtc:slots.length?iso(slots.at(-1)*1000):null,expected:slots.length,proven:proven.length,ackOnly:ackOnly.length,relayTargetAcks,relayTargetExecutions,relayDefers,directKnownActiveCustody,unresolved:bad.length,unexpectedRows:unexpected,over120Seconds:late.length,expired,disabledEarly,
  leaseHealth:leaseHealth(c,mode,now),leaseUntilUtc:detail.expiresAt,
  shadowFullyProven:mode==="SHADOW"&&c.shadow===true&&slots.length>=(laneOf(c)==="PRIMARY_BACKSTOP"?3:5)&&proven.length===slots.length&&unexpected===0&&late.length===0&&!disabledEarly,
  fullyProven:expired&&mode==="PILOT"&&slots.length>0&&proven.length===slots.length&&unexpected===0,
  timingTargetMet:expired&&mode==="PILOT"&&slots.length>0&&proven.length===slots.length&&unexpected===0&&late.length===0,
  maxPlannedToRunnerMs:timed.length?Math.max(...timed.map(x=>x.plannedToRunnerMs)):null,rows:safe,
  cronWrites:0,targetDispatches:0,providerCalls:0,databaseReads:0,databaseWrites:0,paidAuthorityGranted:false};
}
/** Exact same-run activation receipt constructed by owner-approved manager.
 * Fixed job IDs, pinned code, max one-hour observation, no target token. */
export function shadowConfigs(raw,pin){
 let x;try{x=JSON.parse(raw)}catch{HOLD("SHADOW_RECEIPT_JSON");}
 if(typeof raw!=="string"||raw.length>4000||!sha(pin)||x?.relayPin!==pin||
    x.status!=="EXACT_EXISTING_PAIR_SHADOW_ENABLED_NO_FORWARD"||x.until!=="2026-12-19T08:00:00.000Z"||
    x.cronMutations!==2||x.providerCalls!==0||x.databaseWrites!==0||x.targetDispatches!==0||x.paidAuthorityGranted!==false||
    !Array.isArray(x.jobs)||x.jobs.length!==2)HOLD("SHADOW_RECEIPT_SCOPE");
 return [["PRIMARY_BACKSTOP",8890475],["ROLLING_ROOT",8890476]].map(([lane,jobId],i)=>{
  const j=x.jobs[i],a=time(j?.attemptUtc),z=time(j?.readbackUtc);
  if(j.lane!==lane||j.jobId!==jobId||z<a||z-a>60000)HOLD("SHADOW_BOUNDARY");
  return {lane,jobId,pin,title:MANAGED_LANES[lane].title,from:j.attemptUtc,enabledReadback:j.readbackUtc,until:x.until,shadow:true};
 });
}
/** The original failed sample remains immutable. New proof starts only
 * after each actual credential PATCH and exact readback. */
export function repairedShadowConfigs(raw,pin){
 let x;try{x=JSON.parse(raw)}catch{HOLD("REPAIR_RECEIPT_JSON")}
 if(typeof raw!=="string"||raw.length>4000||!sha(pin)||x?.relayPin!==pin||x.status!=="EXACT_EXISTING_PAIR_AUTH_REPAIRED_NO_FORWARD"||
    x.until!=="2026-12-19T08:00:00.000Z"||!id(x.probeRunId)||!id(x.probeJobId)||x.cronMutations!==2||
    x.providerCalls!==0||x.databaseWrites!==0||x.targetDispatches!==0||x.paidAuthorityGranted!==false||
    !Array.isArray(x.jobs)||x.jobs.length!==2)HOLD("REPAIR_RECEIPT_SCOPE");
 return [["PRIMARY_BACKSTOP",8890475,"2026-11-18T10:05:06.006Z"],["ROLLING_ROOT",8890476,"2026-11-18T10:05:07.058Z"]].map(([lane,jobId,originalFrom],i)=>{
  const j=x.jobs[i],a=time(j?.attemptUtc),z=time(j?.readbackUtc);
  if(j.lane!==lane||j.jobId!==jobId||a<Date.parse("2026-11-18T11:07:38.180Z")||z<a||z-a>60000||z>=time(x.until))HOLD("REPAIR_BOUNDARY");
  // Do not count a tick racing with the replacement PATCH as new proof.
  return {lane,jobId,pin,title:MANAGED_LANES[lane].title,originalFrom,from:j.readbackUtc,enabledReadback:j.readbackUtc,until:x.until,shadow:true};
 });
}
/** Exact actual credential repair receipt; prior failed history retained. */
export const SHADOW_ACTIVATION_PIN="b53c43de45c56d439525e72d0233e71770176f24";
const SHADOW_REPAIR=Object.freeze({
 status:"EXACT_EXISTING_PAIR_AUTH_REPAIRED_NO_FORWARD",relayPin:SHADOW_ACTIVATION_PIN,until:"2026-12-19T08:00:00.000Z",
 jobs:[{lane:"PRIMARY_BACKSTOP",jobId:8890475,attemptUtc:"2026-11-18T12:06:51.136Z",readbackUtc:"2026-11-18T12:06:52.030Z"},
 {lane:"ROLLING_ROOT",jobId:8890476,attemptUtc:"2026-11-18T12:06:52.471Z",readbackUtc:"2026-11-18T12:06:53.372Z"}],
 probeRunId:44300784533,probeJobId:134789651297,cronMutations:2,providerCalls:0,databaseWrites:0,targetDispatches:0,paidAuthorityGranted:false
});
export function shadowRecentConfigs(e){
 if(e.GITHUB_EVENT_NAME!=="schedule"||!sha(e.GITHUB_SHA)||e.TRAVNR_RELAY_MODE!=="CLOCK_ONLY"||
    [e.TRAVNR_RELAY_PRIMARY_ENABLED,e.TRAVNR_RELAY_ROLLING_ENABLED,e.TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED].some(v=>v==="1"))HOLD("SHADOW_RECENT_STOP_SCOPE");
 return repairedShadowConfigs(JSON.stringify(SHADOW_REPAIR),SHADOW_ACTIVATION_PIN).map(c=>({...c,activationPin:c.pin,pin:e.GITHUB_SHA,shadowRecent:true}));
}
export function auditLanes(layout){
 if(layout==="PRIMARY_ONLY")return ["PRIMARY_BACKSTOP"];
 if(layout==="RECOVERY_PAIR")return ["PRIMARY_BACKSTOP","ROLLING_ROOT"];
 if(layout==="CLOCK_ONLY")return ["CLOCK_ONLY"];
 HOLD("AUDIT_LAYOUT");
}
async function main(){
 const e=process.env,local=process.argv[2]==="--owner-audit-pilot",repaired=process.argv[2]==="--shadow-rekey",shadow=process.argv[2]==="--shadow-pair"||repaired,mode=local?"PILOT":shadow?"SHADOW":e.TRAVNR_CRON_AUDIT_MODE,shadowRecent=mode==="SHADOW_RECENT";
 if(local?e.GITHUB_ACTIONS==="true":e.GITHUB_ACTIONS!=="true"||e.GITHUB_REPOSITORY!==REPO||e.GITHUB_REF!=="refs/heads/main"||
    !(shadow?["workflow_dispatch"]:["schedule","workflow_dispatch","push"]).includes(e.GITHUB_EVENT_NAME)||e.GITHUB_RUN_ATTEMPT!=="1"||
    (!shadow&&(["schedule","workflow_dispatch"].includes(e.GITHUB_EVENT_NAME)?!["RECENT","SHADOW_RECENT"].includes(mode):mode!=="PILOT"||e.TRAVNR_CRON_PREVIOUS_RELAY_SHA!==PILOT.pin||Date.now()<time(PILOT.until)+120000))||
    typeof e.GITHUB_TOKEN!=="string"||e.GITHUB_TOKEN.length<16)HOLD("RUNTIME_SCOPE");
 if(e.DATABASE_URL||e.RAPIDAPI_KEY||e.AERODATABOX_API_KEY||e.TRAVNR_TARGET_ACTIONS_TOKEN||e.NODE_TLS_REJECT_UNAUTHORIZED==="0"||
    typeof e.TRAVNR_CRON_ACCOUNT_KEY!=="string"||e.TRAVNR_CRON_ACCOUNT_KEY.length<16)HOLD("SECRET_SCOPE");
 const layout=shadow||shadowRecent?"SHADOW_PAIR":mode==="PILOT"?"CLOCK_ONLY":e.TRAVNR_CRON_AUDIT_LAYOUT||"CLOCK_ONLY";
 if(!["CLOCK_ONLY","PRIMARY_ONLY","RECOVERY_PAIR","SHADOW_PAIR"].includes(layout))HOLD("AUDIT_LAYOUT");
 const recoveryLayout=layout==="PRIMARY_ONLY"||layout==="RECOVERY_PAIR";
 
 const route=e.TRAVNR_RELAY_ROLLING_ROUTE||"DURABLE_ROOT";
 if(!["DURABLE_ROOT","DIRECT_TICK","DIRECT_VERIFY","INDEPENDENT_WAKE"].includes(route))HOLD("AUDIT_ROLLING_ROUTE");
 if(route==="INDEPENDENT_WAKE"&&(!recoveryLayout||!sha(e.P6_RELAY_APPROVED_EXECUTABLE_SHA)||e.P6_RELAY_APPROVED_EXECUTABLE_SHA!==e.GITHUB_SHA))HOLD("AUDIT_INDEPENDENT_EXECUTABLE_PIN");
 const configs=(shadowRecent?shadowRecentConfigs(e):repaired?repairedShadowConfigs(e.TRAVNR_SHADOW_RECEIPT,e.GITHUB_SHA):shadow?shadowConfigs(e.TRAVNR_SHADOW_RECEIPT,e.GITHUB_SHA):auditLanes(layout).map(l=>({...config(e,mode,l),...(recoveryLayout?{targetPin:e.TRAVNR_APPROVED_TARGET_MAIN_SHA,...(route==="INDEPENDENT_WAKE"?{pin:e.P6_RELAY_APPROVED_EXECUTABLE_SHA,...(l==="ROLLING_ROOT"?{independentWake:true}:{})}:{}),...(l==="ROLLING_ROOT"&&route==="DIRECT_TICK"?{directTick:true}:l==="ROLLING_ROOT"&&route==="DIRECT_VERIFY"?{directVerify:true}:{})}:{})}))).map(c=>({...c,leaseContinuity:e.TRAVNR_LEASE_CONTINUITY_ARMED==="1"&&e.TRAVNR_LEASE_ENV_READY==="1"}));
 if(recoveryLayout&&!configs.every(c=>sha(c.targetPin)))HOLD("TARGET_AUDIT_PIN_REQUIRED");
 if(new Set(configs.map(x=>x.jobId)).size!==configs.length)HOLD("DUPLICATE_AUDIT_JOB");
 const allowed=new Set(configs.map(x=>String(x.jobId))),max=mode==="PILOT"||shadow?15:["RECOVERY_PAIR","SHADOW_PAIR"].includes(layout)?6:5;
 let calls=0;
 const cron=async p=>{
  const m=p.match(/^\/jobs\/([1-9][0-9]{0,14})(?:\/history(?:\/[A-Za-z0-9-]{1,100})?)?$/);
  if(++calls>max||!m||!allowed.has(m[1]))HOLD("CRON_READ_BOUND");
  const a=await fetch(CRON+p,{method:"GET",headers:{Authorization:"Bearer "+e.TRAVNR_CRON_ACCOUNT_KEY},redirect:"error",signal:AbortSignal.timeout(12000)});
  if(!a.ok)HOLD("CRON_HTTP_"+a.status);
  const data=await a.json();await new Promise(r=>setTimeout(r,250));return data;
 };
 const ghEnv={PATH:e.PATH,HOME:e.HOME,GH_PROMPT_DISABLED:"1",GH_HOST:"github.com",
   ...(e.GH_CONFIG_DIR?{GH_CONFIG_DIR:e.GH_CONFIG_DIR}:{}),...(e.XDG_CONFIG_HOME?{XDG_CONFIG_HOME:e.XDG_CONFIG_HOME}:{}),
   ...(local?(e.GH_TOKEN?{GH_TOKEN:e.GH_TOKEN}:e.GITHUB_TOKEN?{GITHUB_TOKEN:e.GITHUB_TOKEN}:{}):{GH_TOKEN:e.GITHUB_TOKEN})};
 const cli=(args,maxBuffer)=>execFileSync("gh",args,{env:ghEnv,encoding:"utf8",timeout:30000,maxBuffer,stdio:["ignore","pipe","ignore"]});
 const gh=async p=>{
  if(!/^\/actions\/runs\/[1-9][0-9]{0,14}(?:\/jobs\?filter=latest&per_page=100)?$/.test(p))HOLD("GH_READ_SCOPE");
  if(local)return JSON.parse(cli(["api","--hostname","github.com","--method","GET","repos/"+REPO+p],2*1024*1024));
  const a=await fetch(GH+p,{method:"GET",headers:{Authorization:"Bearer "+e.GITHUB_TOKEN,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!a.ok)HOLD("GH_HTTP_"+a.status);return a.json();
 };
 let targetReads=0;
 const targetGh=async p=>{
  if(!recoveryLayout||++targetReads>4||!/^\/actions\/runs\/[1-9][0-9]{0,14}(?:\/jobs\?filter=latest&per_page=100)?$/.test(p))HOLD("PUBLIC_TARGET_READ_SCOPE");
  const a=await fetch(TARGET_PUBLIC+p,{method:"GET",headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!a.ok)HOLD("PUBLIC_TARGET_HTTP_"+a.status);return a.json();
 };
 if(repaired){
  let r;try{r=JSON.parse(e.TRAVNR_SHADOW_RECEIPT)}catch{HOLD("REPAIR_RECEIPT_JSON")}
  const p=await gh("/actions/runs/"+r.probeRunId),j=await gh("/actions/runs/"+r.probeRunId+"/jobs?filter=latest&per_page=100");
  const v=j.jobs?.find(x=>x.id===r.probeJobId);
  if(p.id!==r.probeRunId||p.head_sha!==e.GITHUB_SHA||p.head_branch!=="main"||p.event!=="workflow_dispatch"||
    p.run_attempt!==1||p.path!==".github/workflows/"+WF||p.display_title!=="TRAVNR EXTERNAL CLOCK CLOCK_ONLY"||p.status!=="completed"||p.conclusion!=="success"||
    j.total_count!==3||j.jobs?.length!==3||!j.jobs.every(x=>x.run_id===p.id&&x.head_sha===e.GITHUB_SHA&&x.run_attempt===1&&x.status==="completed")||
    v?.name!=="independent-pulse"||v.conclusion!=="success"||v.steps?.filter(s=>s.name==="Run node cli.mjs"&&s.status==="completed"&&s.conclusion==="success").length!==1||
    !["offline-tests","target-forward"].every(k=>j.jobs.some(x=>x.name===k&&x.conclusion==="skipped"&&(x.steps==null||x.steps.length===0))))HOLD("REPAIR_PROBE_EXECUTION");
 }
 if(shadow){
  const end=Math.max(...configs.map(c=>time(c.enabledReadback)))+60*60000;
  const left=end-Date.now();if(left>60*60000||left< -5*60000)HOLD("SHADOW_AUDIT_CLOCK");
  console.log(JSON.stringify({status:"SHADOW_PAIR_AUDIT_WAIT_STARTED",auditAtUtc:iso(end)}));
  if(left>0)await new Promise(r=>setTimeout(r,left));
  const head=await fetch(GH+"/git/ref/heads/main",{method:"GET",headers:{Authorization:"Bearer "+e.GITHUB_TOKEN,Accept:"application/vnd.github+json"},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!head.ok||(await head.json()).object?.sha!==e.GITHUB_SHA)HOLD("SHADOW_MAIN_DRIFT");
 }
 const logs=(n,j)=>cli(["run","view",String(n),"-R",REPO,"--job",String(j),"--log"],2*1024*1024);
 const leaseReadbacks=[];
 for(const c of configs){
  const before=calls;
  try{
   const out=await audit({c,mode,now:Date.now(),cron,gh,logs,targetGh:recoveryLayout?targetGh:undefined,sampleLimit:recoveryLayout||shadowRecent?1:3});
   leaseReadbacks.push({lane:out.lane,until:out.leaseUntilUtc});
   console.log(JSON.stringify({...out,cronApiReads:calls-before}));
   if(shadow&&!out.shadowFullyProven||shadowRecent&&out.expected>0&&out.proven!==1||out.unresolved||out.unexpectedRows||out.disabledEarly||out.over120Seconds||out.leaseHealth?.state==="RENEWAL_CRITICAL"||out.leaseHealth?.state==="EXPIRED"||(out.expired&&(mode==="RECENT"||!out.fullyProven)))process.exitCode=2;
  }catch(err){console.error(JSON.stringify({status:"AUDIT_LANE_UNVERIFIED",lane:laneOf(c),jobId:c.jobId,reason:/^HOLD_CRON_MANAGER_[A-Z0-9_]+$/.test(err?.message??"")?err.message:"HOLD_CRON_MANAGER_REDACTED",cronApiReads:calls-before}));process.exitCode=2;}
 }
 if(configs.length===2&&configs.every(c=>c.leaseContinuity)&&
   (leaseReadbacks.length!==2||new Set(leaseReadbacks.map(x=>x.until)).size!==1)){
  console.error(JSON.stringify({status:"HOLD_PAIR_LEASE_CONTINUITY_READBACK_MISMATCH",readbacks:leaseReadbacks,cronWrites:0,targetDispatches:0}));
  process.exitCode=2;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^HOLD_CRON_MANAGER_[A-Z0-9_]+$/.test(e?.message||"")?e.message:"HOLD_CRON_MANAGER_REDACTED");process.exitCode=2});
