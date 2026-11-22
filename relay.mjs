/** Isolated external clock: no provider keys, DB URLs or data. Only fixed existing
 * target workflows and exact owner-reviewed mode. CLOCK_ONLY is the default pilot.
 * Do not treat accepted GitHub run as successful execution or collection. */
export const RELAY="HKcode22/TravnrClockRelay",TARGET="HKcode22/ReplitTranvr";
export const PILOT="phase5-autonomous-clock-canary-no-provider.yml";
export const PRIMARY="phase5-primary-fids-expiry-no-provider.yml";
export const ROLLING="phase6-rolling-controller-bounded-session.yml";
export const DIRECT="phase6-direct-recovery-tick.yml";
export const DIRECT_TITLE="P6 DIRECT RECOVERY TICK";
export const DIRECT_VERIFY_TITLE="P6 DIRECT RECOVERY VERIFY";
export const FULL_RETENTION_CONFIRM="APPLY_REVIEWED_FULL_RETENTION_BACKSTOP_NO_PROVIDER";
export const FULL_RETENTION_TITLE="P5 FULL RETENTION BACKSTOP CHILD";
export const DIRECT_VERIFY_CONFIRM="VERIFY_DIRECT_RECOVERY_CLOCK_NO_PROVIDER_NO_DB_NO_DISPATCH";
export const DIRECT_CONFIRM="RUN_ONE_REVIEWED_DIRECT_RECOVERY_TICK_AFTER_SEPARATE_PHASE6_GO";
const ROOT="https://api.github.com/repos/",SELF="external-clock.yml",MIN=60000;
const HOLD=s=>{throw Error("HOLD_EXTERNAL_CLOCK_"+s);}, id=x=>Number.isSafeInteger(x)&&x>0;
const sha=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x);
const stamp=s=>{let n=Date.parse(s);if(!Number.isFinite(n)||new Date(n).toISOString()!==s)HOLD("UTC");return n;};
const iso=n=>new Date(n).toISOString();
const active=["queued","in_progress","waiting","requested","pending"];
const MULTI_LANES=["CLOCK_ONLY","PRIMARY_BACKSTOP","ROLLING_ROOT"];
const laneTitle=lane=>"TRAVNR EXTERNAL CLOCK "+lane;
const result=(status,fields={})=>({status,...fields,providerCallsByRelay:0,databaseReadsByRelay:0,databaseWritesByRelay:0,paidAuthorityGranted:false});
export function rootInputs(now,from,until,main,four){
 // This is only a prospective scheduling hint. The target's existing V0102
 // claim/actual DB clock, signed policy, SHA, STOP and all release gates remain.
 const a=stamp(from),z=stamp(until),epoch=Math.floor(now/1000)*1000;
 if(a%1000||z%1000||z<=a||z-a>60*24*3600000||!sha(main)||!Number.isSafeInteger(now))HOLD("POLICY_SCOPE");
 if(now<a||now>=z)return null;
 const start=a+Math.floor((now-a)/(120*MIN))*120*MIN,end=Math.min(start+120*MIN,z);
 if(end-now<20*MIN)return null;
 const multi=four===true&&end-epoch>=95*MIN;
 return {windowStart:iso(start),windowEnd:iso(end),inputs:{
  confirm:multi?"RUN_UP_TO_FOUR_PROTECTED_ROLLING_SESSIONS_AFTER_SEPARATE_PHASE6_GO":"RUN_ONE_PROTECTED_ROLLING_SESSION_AFTER_SEPARATE_PHASE6_GO",
  approved_main_sha:main,chain_hop:"0",parent_run_id:"0",sent_at_utc:"",
  window_epoch_utc:iso(epoch),window_deadline_utc:iso(multi?end:Math.min(end,epoch+30*MIN)),scheduled_root_run_id:""}};
}
export function cronJobSpec(relayToken,now=Date.now()){
 if(typeof relayToken!=="string"||!relayToken.startsWith("github_pat_")||relayToken.length<30||!Number.isSafeInteger(now))HOLD("RELAY_TOKEN_REQUIRED");
 const expiry=Number(iso(now+90*MIN).slice(0,19).replace(/[-:T]/g,""));
 return {title:"Travnr isolated 90-minute external clock pilot",url:ROOT+RELAY+"/actions/workflows/"+SELF+"/dispatches",
  enabled:false,saveResponses:true,requestMethod:1,requestTimeout:30,redirectSuccess:false,
  schedule:{timezone:"UTC",expiresAt:expiry,hours:[-1],mdays:[-1],minutes:[2,12,22,32,42,52],months:[-1],wdays:[-1]},
  notification:{onFailure:true,onFailureCount:1,onDisable:true,onSuccess:true},
  extendedData:{headers:{Authorization:"Bearer "+relayToken,Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28"},
   body:JSON.stringify({ref:"main",return_run_details:true})}};
}
const PRIMARY_STEP="Verify exact main and execute only bounded primary FIDS expiry";
const PRIMARY_COUNTERS=["liveOriginals","eligibleOriginals","hardDueOriginals","eligibleNextHour","hardDueNextHour","unboundLiveOriginals","markedExpiredPayloadPresent","unlinkedUnexpiredPopulation","unexpiredPopulationWithoutLiveOriginal"];
const gitAuth=token=>({Accept:"application/vnd.github+json",Authorization:"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28"});
/** GitHub returns a short-lived signed job-log URL. Never forward bearer
 * auth to storage. Bounded read, no raw log/content printed. */
export async function readPrimaryVerifyLog(fetcher,token,jobId){
 if(!id(jobId)||typeof token!=="string"||token.length<16)HOLD("PRIMARY_VERIFY_LOG_SCOPE");
 const a=await fetcher(ROOT+TARGET+"/actions/jobs/"+jobId+"/logs",{method:"GET",headers:gitAuth(token),redirect:"manual",signal:AbortSignal.timeout(10000)});
 if(a.status!==302)HOLD("PRIMARY_VERIFY_LOG_REDIRECT_HTTP_"+a.status);
 let u;try{u=new URL(a.headers.get("location"));}catch{HOLD("PRIMARY_VERIFY_LOG_LOCATION");}
 if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||
    !(/^[a-z0-9.-]+\.blob\.core\.windows\.net$/.test(u.hostname)||/^[a-z0-9.-]+\.githubusercontent\.com$/.test(u.hostname)))
  HOLD("PRIMARY_VERIFY_LOG_HOST");
 const z=await fetcher(u.href,{method:"GET",redirect:"error",signal:AbortSignal.timeout(15000)});
 if(!z.ok||!z.body||typeof z.body.getReader!=="function")HOLD("PRIMARY_VERIFY_LOG_READ_HTTP_"+z.status);
 const reader=z.body.getReader(),decoder=new TextDecoder(),limit=2*1024*1024;let bytes=0,log="";
 try{while(true){const q=await reader.read();if(q.done)break;bytes+=q.value.byteLength;if(bytes>limit)HOLD("PRIMARY_VERIFY_LOG_SIZE");log+=decoder.decode(q.value,{stream:true});}log+=decoder.decode();}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return log;
}
/** A primary VERIFY may have one legacy job or one additional, demonstrably
 * skipped research-expiry job. No other job or executed sibling is admissible.
 * This selects a log only; receipt validation remains mandatory. */
function primaryVerifyJob(run,jobs){
 const rows=jobs?.jobs;
 if(!Array.isArray(rows)||jobs.total_count!==rows.length||![1,2].includes(rows.length)||
    new Set(rows.map(j=>j.id)).size!==rows.length||
    !rows.every(j=>id(j.id)&&j.run_id===run.id&&j.head_sha===run.head_sha&&j.run_attempt===1&&j.status==="completed"))
  HOLD("PRIMARY_BOOTSTRAP_VERIFY_JOB_SET");
 const primary=rows.filter(j=>j.name==="primary-fids-expiry");
 if(primary.length!==1||primary[0].conclusion!=="success"||
    !Array.isArray(primary[0].steps)||primary[0].steps.filter(s=>s.name===PRIMARY_STEP&&s.status==="completed"&&s.conclusion==="success").length!==1)
  HOLD("PRIMARY_BOOTSTRAP_VERIFY_JOB");
 if(rows.length===2){
  const sibling=rows.find(j=>j!==primary[0]);
  if(sibling.name!=="phase7-expiry"||sibling.conclusion!=="skipped"||
     !(sibling.steps==null||Array.isArray(sibling.steps)&&sibling.steps.length===0))
   HOLD("PRIMARY_BOOTSTRAP_VERIFY_SIBLING");
 }
 return primary[0];
}
/** Reuse the existing owner's exact VERIFY-only receipt semantics for the
 * first backstop wake after a reviewed main transition. Not APPLY cadence. */
export function verifyPrimaryBootstrapReceipt(run,jobs,log,expectedSha,runId,clock){
 if(run?.id!==runId||run.head_sha!==expectedSha||run.path!==".github/workflows/"+PRIMARY||run.head_branch!=="main"||
    run.event!=="workflow_dispatch"||run.run_attempt!==1||run.status!=="completed"||run.conclusion!=="success")HOLD("PRIMARY_BOOTSTRAP_VERIFY_IDENTITY");
 const j=primaryVerifyJob(run,jobs);
 const hits=String(log).split(/\r?\n/).filter(l=>l.includes('{"status":"PRIMARY_FIDS_VERIFY_ONLY_NO_WRITES"'));
 if(hits.length!==1)HOLD("PRIMARY_BOOTSTRAP_VERIFY_RECEIPT_COUNT");
 let r;try{r=JSON.parse(hits[0].slice(hits[0].indexOf('{"status":"PRIMARY_FIDS_VERIFY_ONLY_NO_WRITES"')).trim());}
 catch{HOLD("PRIMARY_BOOTSTRAP_VERIFY_JSON");}
 const b=r.before,seen=Date.parse(b?.observedAtUtc),created=Date.parse(run.created_at),finished=Date.parse(j.completed_at);
 if(r.reviewedMainSha!==expectedSha||r.distinctDbActorsVerified!==true||r.privateCommissionState!=="GRANTED"||
    r.providerCalls!==0||r.databaseWrites!==0||r.objectDeletions!==0||r.phase6PaidGo!==false||
    r.backupOrPitrVerified!==false||r.completeRetentionDeploymentVerified!==false||
    !b||b.schema!=="v39.phase5.primary-fids-expiry-status.v1"||PRIMARY_COUNTERS.some(k=>b[k]!==0)||
    b.deletionStopUnresolved!==false||b.providerCalls!==0||b.databaseWrites!==0||b.phase6PaidGo!==false||
    b.backupOrPitrVerified!==false||b.completeRetentionDeploymentVerified!==false||
    ![seen,created,finished,clock].every(Number.isFinite)||seen<created||seen>finished+1000||finished>clock||clock-seen>6*3600000)
  HOLD("PRIMARY_BOOTSTRAP_VERIFY_RECEIPT_REVIEW");
 return {verifiedRunId:runId,verifiedJobId:j.id,observedAtUtc:iso(seen)};
}
/** A native schedule may be green while its private extension is only in
 * commission/VERIFY mode. Only a unique actual APPLY receipt qualifies it
 * as full-retention cadence. No log text or source data leaves this check. */
export function verifyNativeFullRetentionPrivateReceipt(log,run,job){
 const hits=String(log).split(/\r?\n/).flatMap(line=>{
  const i=line.indexOf("{");if(i<0)return [];
  try{const x=JSON.parse(line.slice(i).trim());return x?.status==="PRIVATE_EXPIRY_DUE_AT_READBACK_CLEARED"?[x]:[];}catch{return [];}
 });
 if(hits.length!==1)HOLD("FULL_RETENTION_NATIVE_PRIVATE_APPLY_RECEIPT");
 const r=hits[0],a=r.after,b=r.before,counts=["duePackets","dueIndexes","expiredHeads","foreignDuePackets","foreignDueIndexes"];
 // The production wrapper authenticates the SQL schema, then projects away
 // its schema/provider/write flags. Use the actual sanitized job-log shape
 // (observed in run 44929165704), not the pre-projection SQL response.
 const statusKeys=["observedAtUtc",...counts,"claims","deletionStopUnresolved"];
 const observed=Date.parse(a?.observedAtUtc),created=Date.parse(run.created_at),done=Date.parse(job.completed_at);
 if(r.reviewedMainSha!==run.head_sha||r.providerCalls!==0||r.phase6PaidGo!==false||
    r.backupOrPitrVerified!==false||r.completeRetentionDeploymentVerified!==false||
    r.deadlineDueObservedAtInitialRead!==false||r.databaseWritesPossible!==false||
    !Array.isArray(r.receipts)||r.receipts.length!==0||
    !a||!b||[a,b].some(x=>Object.keys(x).length!==statusKeys.length||
     !statusKeys.every(k=>Object.hasOwn(x,k))||!Number.isSafeInteger(x.claims)||x.claims<0||x.claims>31||
     x.deletionStopUnresolved!==false||counts.some(k=>x[k]!==0))||
    !statusKeys.every(k=>a[k]===b[k])||
    ![observed,created,done].every(Number.isFinite)||observed<created||observed>done+1000)
  HOLD("FULL_RETENTION_NATIVE_PRIVATE_APPLY_SCOPE");
 return {privateApplyReceiptVerified:true};
}
/** Exact same-code failed run where the only forwarding step did not execute.
 * Do not infer absence from missing step lists on an assigned runner. */
export function provesNoTargetStep(run,jobs){
 if(!run||!Number.isSafeInteger(run.id)||!sha(run.head_sha)||run.status!=="completed"||run.run_attempt!==1||
    !Array.isArray(jobs)||jobs.length!==3||new Set(jobs.map(j=>j.id)).size!==3||
    !jobs.every(j=>id(j.id)&&j.run_id===run.id&&j.head_sha===run.head_sha&&j.run_attempt===1&&j.status==="completed"))return false;
 const named=new Map(jobs.map(j=>[j.name,j]));
 if(named.size!==3||!["offline-tests","independent-pulse","target-forward"].every(k=>named.has(k)))return false;
 if(!["offline-tests","independent-pulse"].every(k=>{const j=named.get(k);return j.conclusion==="skipped"&&(j.steps==null||Array.isArray(j.steps)&&j.steps.length===0)}))return false;
 const j=named.get("target-forward");
 if(j.conclusion==="skipped")return j.steps==null||Array.isArray(j.steps)&&j.steps.length===0;
 if(!["failure","cancelled","timed_out"].includes(j.conclusion)||!Array.isArray(j.steps)||j.steps.length>20)return false;
 const step=j.steps.filter(s=>s.name==="Run node cli.mjs");
 return step.length===1&&step[0].status==="completed"&&step[0].conclusion==="skipped"&&
   (step[0].started_at==null||step[0].started_at===step[0].completed_at);
}


export function directTargetDisposition(run,jobs,verify=false){
 if(!Array.isArray(jobs)||jobs.length!==3||new Set(jobs.map(j=>j.id)).size!==3||
    !jobs.every(j=>id(j.id)&&j.run_id===run.id&&j.head_sha===run.head_sha&&j.run_attempt===1&&j.status==="completed"))return null;
 const name=verify?"direct-readonly-verify":"direct-protected-recovery-tick";
 if(!["offline-direct-recovery",verify?"direct-protected-recovery-tick":"direct-readonly-verify"].every(n=>
    jobs.filter(j=>j.name===n&&j.conclusion==="skipped"&&(j.steps==null||Array.isArray(j.steps)&&j.steps.length===0)).length===1))return null;
 const p=jobs.find(j=>j.name===name);
 if(!p||p.conclusion!=="success"||!Array.isArray(p.steps))return null;
 if(verify)return p.steps.filter(s=>s.name==="Verify exact direct wake and existing workflow metadata NO POST"&&s.status==="completed"&&s.conclusion==="success").length===1?"VERIFY_ONLY":null;
 if(
    !["Execute one direct recovery wave and reconcile exact parent ACKs","Preserve direct terminal operational receipt"].every(name=>
      p.steps.filter(s=>s.name===name&&s.status==="completed"&&s.conclusion==="success").length===1))return null;
 const marks=["Direct outcome TERMINAL_PARENT_ACKS_RECONCILED","Direct outcome PREFLIGHT_HOLD_NO_POST","Direct outcome KNOWN_ACTIVE_PARENT_ACKS_CARRIED"].map(name=>p.steps.filter(s=>s.name===name));
 if(marks.some(x=>x.length!==1||x[0].status!=="completed"||!["success","skipped"].includes(x[0].conclusion))||
    marks.filter(x=>x[0].conclusion==="success").length!==1)return null;
 return ["TERMINAL","PREFLIGHT_HOLD","CARRIED"][marks.findIndex(x=>x[0].conclusion==="success")];
}
export async function runPulse(env,{fetcher=fetch,now=Date.now,emit=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const configured=env.TRAVNR_RELAY_MODE||"CLOCK_ONLY", lane=env.TRAVNR_RELAY_LANE||"CLOCK_ONLY",
  multi=configured==="MULTI_LANE", shadow=configured==="SHADOW_PAIR", mode=multi||shadow?lane:configured, start=now(),runId=Number(env.GITHUB_RUN_ID);
 if(env.GITHUB_ACTIONS!=="true"||env.GITHUB_REPOSITORY!==RELAY||env.GITHUB_REF!=="refs/heads/main"||
   env.GITHUB_EVENT_NAME!=="workflow_dispatch"||env.GITHUB_RUN_ATTEMPT!=="1"||!id(runId)||!sha(env.GITHUB_SHA)||
   !["CLOCK_ONLY","PILOT","PRIMARY_BACKSTOP","ROLLING_ROOT"].includes(mode)||
   (shadow?!["PRIMARY_BACKSTOP","ROLLING_ROOT"].includes(lane)||!!env.TRAVNR_TARGET_ACTIONS_TOKEN:multi?!MULTI_LANES.includes(lane):lane!=="CLOCK_ONLY")||typeof env.GITHUB_TOKEN!=="string"||
   env.GITHUB_TOKEN.length<16||env.NODE_TLS_REJECT_UNAUTHORIZED==="0"||
   ["DATABASE_URL","AERODATABOX_API_KEY","RAPIDAPI_KEY","V39_DATABASE_RUNTIME_URL","AERODATABOX_WEBHOOK_SECRET"].some(k=>env[k]))HOLD("SCOPE");
 let reads=0,attempted=false;
 const auth=token=>({Accept:"application/vnd.github+json",Authorization:"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28"});
 const get=async(repo,path)=>{
  const token=repo===RELAY?env.GITHUB_TOKEN:env.TRAVNR_TARGET_ACTIONS_TOKEN;
  // Only bounded read-only preflight retries; the existing independent ACK
  // readback loop is unchanged. Every physical GET consumes the same budget.
  for(let i=0;;i++){
   if(++reads>40||now()-start>180000||!path.startsWith("/")||path.startsWith("//"))HOLD("READ_BOUND");
   let res,transport=false;
   try{
    res=await fetcher(ROOT+repo+path,{method:"GET",headers:auth(token),redirect:"error",signal:AbortSignal.timeout(10000)});
   }catch(e){
    if(!(e instanceof TypeError)&&!["TimeoutError","AbortError"].includes(e?.name))throw e;
    transport=true;
   }
   if(res?.ok)return res.json();
   const status=transport?"TRANSPORT":"HTTP_"+res.status;
   const ra=res?.headers?.get?.("retry-after");
   // A 429 without an explicitly short retry-after is not retried. Longer
   // provider advice is respected by deferring to the next scheduler pulse.
   const wait=ra==null?1000*(i+1):/^\d+$/.test(ra)&&Number(ra)<=3?Math.max(1000,Number(ra)*1000):null;
   const transient=transport||[502,503,504].includes(res?.status)||res?.status===429&&ra!=null;
   if(attempted||i>=2||!transient||wait===null||reads>=40||now()-start+wait+10000>120000)HOLD("GET_"+status);
   emit({status:"EXTERNAL_WAKE_PREFLIGHT_GET_RETRY_NO_POST",mode,relayRunId:runId,attempt:i+1,reason:status,waitMs:wait});
   await sleep(wait);
  }
 };
 const complete=(x,key)=>{if(!Number.isSafeInteger(x?.total_count)||x.total_count<0||x.total_count>100||!Array.isArray(x[key])||x[key].length!==x.total_count)HOLD("HISTORY_INCOMPLETE");return x[key];};
 const exact=(r,wf,repo)=>{if(!id(r?.id)||r.path!==".github/workflows/"+wf||r.head_branch!=="main"||!sha(r.head_sha)||
  !["schedule","workflow_dispatch"].includes(r.event)||!Number.isFinite(Date.parse(r.created_at))||r.run_attempt!==1||
  ![...active,"completed"].includes(r.status))HOLD("RUN_IDENTITY");return r;};
 const main=async()=>{const x=await get(TARGET,"/git/ref/heads/main");if(x?.object?.sha!==env.TRAVNR_APPROVED_TARGET_MAIN_SHA)HOLD("TARGET_MAIN_DRIFT");};
 try{
  const self=exact(await get(RELAY,"/actions/runs/"+runId),SELF,RELAY);
  if(self.id!==runId||self.head_sha!==env.GITHUB_SHA||self.event!=="workflow_dispatch"||self.status!=="in_progress"||
     (multi||shadow)&&self.display_title!==laneTitle(lane))HOLD("SELF_IDENTITY");
  const elapsed=now()-Date.parse(self.created_at);
  if(elapsed<0||elapsed>24*3600000)HOLD("SELF_CLOCK");
  const clock={relayRunId:runId,mode,actualCreatedUtc:self.created_at,runnerObservedUtc:iso(now()),creationToObservedMs:elapsed};
  if(mode==="CLOCK_ONLY")return result("EXTERNAL_CLOCK_OBSERVED_NO_TARGET_DISPATCH",clock);
  if(shadow)return result("EXTERNAL_RECOVERY_LANE_SHADOW_OBSERVED_NO_TARGET_DISPATCH",{...clock,relayDispatches:0});
  const lanePrefix=mode==="PRIMARY_BACKSTOP"?"TRAVNR_RELAY_PRIMARY":"TRAVNR_RELAY_ROLLING";
  if(multi&&env[lanePrefix+"_ENABLED"]!=="1")return result("DEFER_SEPARATE_LANE_OFF",clock);
  if(multi&&env.TRAVNR_TARGET_FORWARD_ENV_READY!=="1")HOLD("TARGET_FORWARD_ENV_NOT_COMMISSIONED");
  if(!sha(env.TRAVNR_APPROVED_TARGET_MAIN_SHA)||typeof env.TRAVNR_TARGET_ACTIONS_TOKEN!=="string"||env.TRAVNR_TARGET_ACTIONS_TOKEN.length<16)HOLD("TARGET_CONFIGURATION");
  const since=stamp(multi?env[lanePrefix+"_SINCE_UTC"]:env.TRAVNR_RELAY_MODE_SINCE_UTC);
  if(since>start||start-since>60*24*3600000)HOLD("MODE_CLOCK");
  // Any prior failed relay attempt in this owner-reviewed mode quarantines
  // uncertain POSTs indefinitely until mode is independently reconciled.
  // The date-filtered total_count is sufficient even if results paginate.
  for(const conclusion of ["failure","cancelled","timed_out","action_required","stale"]){
   const p=await get(RELAY,"/actions/workflows/"+SELF+"/runs?branch=main&event=workflow_dispatch&status="+conclusion+"&per_page="+(multi?100:1)+"&created="+encodeURIComponent(">="+iso(since)));
   if(!Number.isSafeInteger(p?.total_count)||p.total_count<0||!Array.isArray(p.workflow_runs)||
      p.workflow_runs.length!==Math.min(multi?100:1,p.total_count))HOLD("PRIOR_RELAY_HISTORY");
   if(!multi&&p.total_count>0)return result("QUARANTINED_PRIOR_RELAY_RUN_REVIEW",clock);
   if(multi){
    if(p.total_count>100)HOLD("PRIOR_RELAY_HISTORY");
    for(const row of p.workflow_runs){
     const other=exact(row,SELF,RELAY);
     if(other.status!=="completed"||other.conclusion!==conclusion||
        Date.parse(other.created_at)<Math.floor(since/1000)*1000)HOLD("PRIOR_RELAY_HISTORY");
     // Known other-lane failures do not couple the two recovery paths.
     // For this lane, only exact current-code job metadata proving the
     // *sole* target-capable step was skipped can remove quarantine.
     // Any started/ambiguous step, old code, missing job or unknown title
     // stays quarantined. No assumption from a failed workflow status.
     if(!MULTI_LANES.some(l=>other.display_title===laneTitle(l)))
      return result("QUARANTINED_PRIOR_RELAY_RUN_REVIEW",clock);
     if(other.display_title===laneTitle(lane)){
      if(other.head_sha!==env.GITHUB_SHA)return result("QUARANTINED_PRIOR_RELAY_RUN_REVIEW",clock);
      const jobs=complete(await get(RELAY,"/actions/runs/"+other.id+"/jobs?filter=latest&per_page=100"),"jobs");
      if(!provesNoTargetStep(other,jobs))return result("QUARANTINED_PRIOR_RELAY_RUN_REVIEW",clock);
      emit({status:"PRIOR_RELAY_FAILURE_EXACT_TARGET_STEP_SKIPPED_NO_POST",priorRelayRunId:other.id,mode});
     }
    }
   }
  }

  const rollingRoute=env.TRAVNR_RELAY_ROLLING_ROUTE||"DURABLE_ROOT";

  if(mode==="ROLLING_ROOT"&&!["DURABLE_ROOT","DIRECT_TICK","DIRECT_VERIFY"].includes(rollingRoute))HOLD("ROLLING_ROUTE");
  const direct=mode==="ROLLING_ROOT"&&["DIRECT_TICK","DIRECT_VERIFY"].includes(rollingRoute),verify=direct&&rollingRoute==="DIRECT_VERIFY";
  if(direct&&(!multi||(verify?env.TRAVNR_RELAY_DIRECT_TICK_APPROVED==="1":env.TRAVNR_RELAY_DIRECT_TICK_APPROVED!=="1")))HOLD("DIRECT_TICK_NOT_SEPARATELY_APPROVED");
  const expectedDirectTitle=verify?DIRECT_VERIFY_TITLE:DIRECT_TITLE;
  await main();
  const wf=mode==="PILOT"?PILOT:mode==="PRIMARY_BACKSTOP"?PRIMARY:direct?DIRECT:ROLLING;
  const q="/actions/workflows/"+wf+"/runs?branch=main&per_page=100";
  for(const state of active){
   const xs=complete(await get(TARGET,q+"&status="+state),"workflow_runs").map(r=>exact(r,wf,TARGET));
   if(xs.some(x=>x.status!==state))HOLD("ACTIVE_HISTORY_CHANGED");
   if(xs.length)return result("DEFER_TARGET_ALREADY_ACTIVE",clock);
  }

  let inputs,rootScope=null,directUntil=null;
  const fullRetention=mode==="PRIMARY_BACKSTOP"&&env.TRAVNR_RELAY_FULL_RETENTION_APPROVED==="1";
  if(fullRetention&&!multi)HOLD("FULL_RETENTION_REQUIRES_SEPARATE_MULTI_LANE");
  if(mode==="PRIMARY_BACKSTOP"&&!["","0","1"].includes(env.TRAVNR_RELAY_FULL_RETENTION_APPROVED??""))HOLD("FULL_RETENTION_MODE");

  if(direct){
   // Same single external wake and single POST; no dynamic root/custody
   // mutation, no new Cron lease and no production secrets at the relay.

   // Read-only commissioning uses at most two hours from its reviewed
   // mode start, without pretending a signed paid calendar already exists.
   const a=verify?since:stamp(env.TRAVNR_ROLLING_POLICY_FROM_UTC),z=verify?since+120*MIN:stamp(env.TRAVNR_ROLLING_POLICY_UNTIL_UTC);
   if(!verify&&(a%1000||z%1000||z<=a||z-a>60*24*3600000||since<a||since>=z))HOLD("DIRECT_POLICY_SCOPE");
   if(now()<a||z-now()<(verify?5:25)*MIN)return result("DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW",clock);
   directUntil=z;
   // Never launch direct recovery alongside an old controller. Native
   // worker schedules remain separate and use their existing locks.
   for(const state of active){
    const rows=complete(await get(TARGET,"/actions/workflows/"+ROLLING+"/runs?branch=main&per_page=100&status="+state),"workflow_runs").map(x=>exact(x,ROLLING,TARGET));
    if(rows.some(x=>x.status!==state))HOLD("DIRECT_ACTIVE_HISTORY");
    if(rows.length)return result("DEFER_TARGET_ALREADY_ACTIVE",clock);
   }
   const history="/actions/workflows/"+DIRECT+"/runs?branch=main&per_page=1&created="+encodeURIComponent(">="+iso(since));
   const counts=x=>{
    if(!Number.isSafeInteger(x?.total_count)||x.total_count<0||!Array.isArray(x.workflow_runs)||x.workflow_runs.length!==Math.min(1,x.total_count))HOLD("DIRECT_HISTORY");
    return x.total_count;
   };
   for(const status of ["failure","cancelled","timed_out","action_required","stale","neutral","skipped"]){
    const p=await get(TARGET,history+"&status="+status);
    if(counts(p)>0)return result("DEFER_DIRECT_PRIOR_ATTEMPT_REVIEW_NO_REPLAY",clock);
   }
   const p=await get(TARGET,history+"&status=success");
   if(counts(p)>0){
    const last=exact(p.workflow_runs[0],DIRECT,TARGET);
    if(last.head_sha!==env.TRAVNR_APPROVED_TARGET_MAIN_SHA||last.event!=="workflow_dispatch"||last.display_title!==expectedDirectTitle||
       last.status!=="completed"||last.conclusion!=="success"||Date.parse(last.created_at)<Math.floor(since/1000)*1000||Date.parse(last.created_at)>now())HOLD("DIRECT_PREDECESSOR_IDENTITY");
    const jobs=complete(await get(TARGET,"/actions/runs/"+last.id+"/jobs?filter=latest&per_page=100"),"jobs");
    if(!directTargetDisposition(last,jobs,verify))HOLD("DIRECT_PREDECESSOR_JOB");
    // Creation-time cooldown, not a claim of actual flight capture.
    if(now()-Date.parse(last.created_at)<8*MIN)return result("DEFER_RECENT_DIRECT_TICK_NOT_COLLECTION_PROOF",clock);
   }
  }
  if(mode==="PILOT"){
   // Exactly one existing nonpaid canary, only if not already running.
   inputs={mode:"OBSERVE"};
  }else if(mode==="PRIMARY_BACKSTOP"){
   // A successful manual VERIFY shares the same job and step name as APPLY.
   // Do not count it as proof the scheduled expiry actually ran.
   const p=await get(TARGET,"/actions/workflows/"+wf+"/runs?branch=main&per_page=20");
   if(!Number.isSafeInteger(p?.total_count)||p.total_count<0||!Array.isArray(p.workflow_runs)||
      p.workflow_runs.length!==Math.min(20,p.total_count))HOLD("PRIMARY_HISTORY");
   const eligible=p.workflow_runs.map(r=>exact(r,wf,TARGET)).filter(r=>r.head_sha===env.TRAVNR_APPROVED_TARGET_MAIN_SHA&&
     (r.event==="schedule"||r.event==="workflow_dispatch"&&r.display_title===(fullRetention?FULL_RETENTION_TITLE:"P5 PRIMARY BACKSTOP CHILD"))&&(!fullRetention||Date.parse(r.created_at)>=since))
     .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id);
   if(!eligible.length){
    // The old primary-only VERIFY bootstrap never proves full retention. The
    // owner must first execute the exact scoped manual dual-job APPLY or an
    // actual native dual-job APPLY with its private extension receipt.
    if(fullRetention)return result("DEFER_NO_CURRENT_MAIN_FULL_RETENTION_APPLY_BASELINE_REVIEW",clock);
    // A fresh, separately selected exact VERIFY receipt is only a bounded
    // first-wake baseline. Never bypass a prior failed/unknown APPLY.
    const v=env.TRAVNR_RELAY_PRIMARY_VERIFY_RUN_ID;
    if(!v)return result("DEFER_NO_CURRENT_MAIN_APPLY_BASELINE_REVIEW",clock);
    const verifyId=Number(v);
    if(!/^[1-9][0-9]{0,14}$/.test(v)||!id(verifyId))HOLD("PRIMARY_BOOTSTRAP_VERIFY_ID");
    const vr=exact(await get(TARGET,"/actions/runs/"+verifyId),wf,TARGET);
    const vj=await get(TARGET,"/actions/runs/"+verifyId+"/jobs?filter=latest&per_page=100");
    if(vr.head_sha!==env.TRAVNR_APPROVED_TARGET_MAIN_SHA||vr.status!=="completed"||vr.conclusion!=="success"||
       vr.event!=="workflow_dispatch"||vr.run_attempt!==1)HOLD("PRIMARY_BOOTSTRAP_VERIFY_SCOPE");
    const primary=primaryVerifyJob(vr,vj);
    reads+=2;if(reads>40||now()-start>120000)HOLD("READ_BOUND");
    const log=await readPrimaryVerifyLog(fetcher,env.TRAVNR_TARGET_ACTIONS_TOKEN,primary.id);
    const proof=verifyPrimaryBootstrapReceipt(vr,vj,log,env.TRAVNR_APPROVED_TARGET_MAIN_SHA,verifyId,now());
    emit({status:"EXTERNAL_FIRST_PRIMARY_WAKE_FROM_EXACT_VERIFY_NOT_APPLY_FRESHNESS",...proof});
   }else{
   const last=eligible[0];
   if(last.head_sha!==env.TRAVNR_APPROVED_TARGET_MAIN_SHA||last.status!=="completed"||last.conclusion!=="success")HOLD("PREVIOUS_PRIMARY_REVIEW");
   const js=complete(await get(TARGET,"/actions/runs/"+last.id+"/jobs?filter=latest&per_page=100"),"jobs");
   const good=js.filter(j=>j.name==="primary-fids-expiry"&&j.run_id===last.id&&j.head_sha===last.head_sha&&j.run_attempt===1&&j.status==="completed"&&j.conclusion==="success"&&
     j.steps?.filter(s=>s.name==="Verify exact main and execute only bounded primary FIDS expiry"&&s.status==="completed"&&s.conclusion==="success").length===1);
   if(good.length!==1||!Number.isFinite(Date.parse(good[0].completed_at))||Date.parse(good[0].completed_at)>now())HOLD("PRIMARY_STEP");
   let lastDone=Date.parse(good[0].completed_at);
   if(fullRetention){
    if(js.length!==2||!js.every(j=>id(j.id))||new Set(js.map(j=>j.id)).size!==2)HOLD("FULL_RETENTION_JOB_SET");
    const research=js.filter(j=>j.name==="phase7-expiry"&&j.run_id===last.id&&j.head_sha===last.head_sha&&j.run_attempt===1&&j.status==="completed"&&j.conclusion==="success"&&
      j.steps?.filter(s=>s.name==="Bounded derived research and temporary link due-only expiry"&&s.status==="completed"&&s.conclusion==="success").length===1);
    if(research.length!==1||!Number.isFinite(Date.parse(research[0].completed_at))||Date.parse(research[0].completed_at)>now())HOLD("FULL_RETENTION_RESEARCH_STEP");
    lastDone=Math.min(lastDone,Date.parse(research[0].completed_at));
    if(last.event==="schedule"){
     reads+=2;if(reads>40||now()-start>120000)HOLD("READ_BOUND");
     const log=await readPrimaryVerifyLog(fetcher,env.TRAVNR_TARGET_ACTIONS_TOKEN,good[0].id);
     verifyNativeFullRetentionPrivateReceipt(log,last,good[0]);
    }
   }
   if(now()-lastDone<(fullRetention?10:20)*MIN)return result("DEFER_RECENT_PRIMARY_STEP_NOT_DELETION_PROOF",clock);
   }
   inputs={confirm:fullRetention?FULL_RETENTION_CONFIRM:"APPLY_REVIEWED_PRIMARY_FIDS_BACKSTOP_NO_PRIVATE_MUTATION",approved_main_sha:env.TRAVNR_APPROVED_TARGET_MAIN_SHA};

  }else if(direct){
   inputs={confirm:verify?DIRECT_VERIFY_CONFIRM:DIRECT_CONFIRM,approved_main_sha:env.TRAVNR_APPROVED_TARGET_MAIN_SHA};
  }else{
   // Reuse existing manual dynamic root admission; do not simulate schedule
   // event or bypass the actual signed DB-clock authorization/custody.
   rootScope=rootInputs(now(),env.TRAVNR_ROLLING_POLICY_FROM_UTC,env.TRAVNR_ROLLING_POLICY_UNTIL_UTC,env.TRAVNR_APPROVED_TARGET_MAIN_SHA,env.TRAVNR_ROLLING_FOUR_APPROVED==="1");
   if(!rootScope)return result("DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW",clock);
   const startUtc=encodeURIComponent(">="+rootScope.windowStart);
   const current=complete(await get(TARGET,q+"&created="+startUtc),"workflow_runs").map(x=>exact(x,wf,TARGET));
   // A workflow record is not equivalent to a controller that executed.
   // Re-admit only when every existing record is exact-current-main, terminal,
   // and all jobs (including the protected session) independently prove SKIP.
   // Unknown/failed/partially executed roots still require custody reconciliation.
   if(current.length){
    for(const r of current){
     if(r.head_sha!==env.TRAVNR_APPROVED_TARGET_MAIN_SHA||r.status!=="completed"||
        !["success","skipped"].includes(r.conclusion))
       return result("DEFER_CURRENT_WINDOW_CUSTODY_REVIEW_NO_REPLAY",{...clock,existingRunId:r.id});
     const jobs=complete(await get(TARGET,"/actions/runs/"+r.id+"/jobs?filter=latest&per_page=100"),"jobs");
     const protectedJobs=jobs.filter(j=>j.name==="one-protected-bounded-session");
     if(protectedJobs.length!==1||!jobs.every(j=>id(j.id)&&j.run_id===r.id&&j.head_sha===r.head_sha&&
       j.run_attempt===1&&j.status==="completed"&&j.conclusion==="skipped"&&
       (j.steps==null||Array.isArray(j.steps)&&j.steps.length===0)))
       return result("DEFER_CURRENT_WINDOW_CUSTODY_REVIEW_NO_REPLAY",{...clock,existingRunId:r.id});
    }
    // This proves no protected session step ran, NOT that the DB window is free.
    // The existing target's exact policy/atomic claim/previous closure gate is final.
    emit({status:"EXTERNAL_WAKE_ONLY_SKIPPED_CONTROLLER_HISTORY_NO_DB_AUTHORITY",relayRunId:runId,skippedRuns:current.length});
   }
   // The target validates its immutable policy and prior closure with its
   // scoped live DB claim, not the relay's advisory wall clock.
   inputs=rootScope.inputs;
  }
  await main();
  if(now()-start>120000)HOLD("STALE_PREFLIGHT");

  if(rootScope&&now()+15*MIN>=Date.parse(inputs.window_deadline_utc))HOLD("ROOT_TOO_LATE");
  if(direct&&directUntil-now()<(verify?5:25)*MIN)HOLD("DIRECT_TOO_LATE");
  emit({status:"EXTERNAL_WAKE_TARGET_ATTEMPT_NO_REPLAY",mode,workflow:wf,relayRunId:runId,attemptUtc:iso(now())});
  attempted=true;
  const a=await fetcher(ROOT+TARGET+"/actions/workflows/"+wf+"/dispatches",{method:"POST",headers:{...auth(env.TRAVNR_TARGET_ACTIONS_TOKEN),"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(10000),body:JSON.stringify({ref:"main",return_run_details:true,inputs})});
  if(a.status!==200)HOLD("ACK_HTTP_"+a.status);
  const b=await a.json(),rid=b?.workflow_run_id;
  if(!id(rid)||b.run_url!==ROOT+TARGET+"/actions/runs/"+rid||b.html_url!=="https://github.com/"+TARGET+"/actions/runs/"+rid)HOLD("UNKNOWN_ACK");
  emit({status:"EXTERNAL_WAKE_TARGET_ACK_NOT_EXECUTION_PROOF",mode,runId:rid,relayRunId:runId});
  // A newly acknowledged run can be visible before its evaluated display
  // title. Four bounded GETs of the SAME acknowledged ID, never another POST.
  // Immutable mismatches and terminal wrong titles remain hard failures.
  let live;
  for(let i=0;i<4;i++){
   try{live=await get(TARGET,"/actions/runs/"+rid);}
   catch(e){if(i===3)throw e;await sleep(3000);continue;}
   exact(live,wf,TARGET);
   if(live.id!==rid||live.head_sha!==env.TRAVNR_APPROVED_TARGET_MAIN_SHA||live.event!=="workflow_dispatch")HOLD("ACK_READBACK_IMMUTABLE_DRIFT");
   if(live.status==="completed"&&live.conclusion!=="success")HOLD("ACK_TARGET_TERMINAL_FAILURE_REVIEW");
   if((direct&&live.display_title!==expectedDirectTitle)||(fullRetention&&live.display_title!==FULL_RETENTION_TITLE)){
    if(i===3||live.status==="completed")HOLD("ACK_READBACK_TITLE_DRIFT");
    emit({status:"EXTERNAL_WAKE_ACK_ACTIVE_TITLE_PENDING_GET_ONLY",mode,relayRunId:runId,targetRunId:rid,attempt:i+1});
    await sleep(3000);continue;
   }
   break;
  }
  return result("TARGET_ACK_AND_RUN_IDENTITY_VERIFIED_NOT_COLLECTION_PROOF",{...clock,targetRunId:rid,targetStatus:live.status,targetWorkflow:wf,relayDispatches:1});
 }catch(e){
  const m=/^HOLD_EXTERNAL_CLOCK_[A-Z0-9_]{1,80}$/.test(e?.message??"")?e.message:"HOLD_EXTERNAL_CLOCK_REDACTED";
  if(attempted)throw Error(m+"_NO_BLIND_REPLAY");
  // A known pre-POST read failure is safe to re-observe at the next pulse.
  return result("EXTERNAL_WAKE_PREFLIGHT_DEFERRED_NO_POST",{mode,relayRunId:runId,reason:m,relayDispatches:0});
 }
}
