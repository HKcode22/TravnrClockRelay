/** One bounded automatic rehearsal of each exact target path following the
 * already approved, successful two-lane shadow audit. No new release flags.
 * Primary = actual read-only retention VERIFY; rolling = no-provider short
 * three-session rehearsal, its successors use the target GITHUB_TOKEN.
 * A completed rehearsal is not a claim of paid worker recovery. */
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {RELAY,TARGET,PRIMARY,PILOT,readPrimaryVerifyLog,verifyPrimaryBootstrapReceipt} from "./relay.mjs";
const API="https://api.github.com/repos/",TARGET_SHA="45d04392e2eecfc1220230f252d2ada8cc6137e0",ACTIVATION_SHA="b53c43de45c56d439525e72d0233e71770176f24";
const WF="autonomous-lane-rehearsal.yml",AUDIT_RUN=44300842416,AUDIT_JOB=134789859088;
const PINNED_BLOBS={[PRIMARY]:"fe6768a52899f05b208baa316a0686011abf46a7",[PILOT]:"c1356a0aa278745708b5bb9d20e1cdc0bc2bdf2a"};
const ID=x=>Number.isSafeInteger(x)&&x>0,SHA=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x),iso=x=>new Date(x).toISOString(),hold=s=>{throw Error("HOLD_AUTONOMOUS_REHEARSAL_"+s)};
const ACTIVE=["queued","in_progress","waiting","requested","pending"];
const ZERO={providerCallsByRelay:0,databaseWritesByRelay:0,phase6PaidGo:false};
function hits(log,predicate){
 const a=[];
 for(const l of String(log).split(/\r?\n/)){
  const at=l.indexOf('{"status":');const at2=l.indexOf('{"schema":');
  const n=at>=0?at:at2;if(n<0)continue;
  let x;try{x=JSON.parse(l.slice(n))}catch{continue}
  if(predicate(x))a.push(x);
 }
 return a;
}
export function verifyShadowAudit(run,jobs,log){
 if(run?.id!==AUDIT_RUN||run.head_sha!==ACTIVATION_SHA||run.head_branch!=="main"||
    run.path!==".github/workflows/cron-repair-audit.yml"||run.event!=="workflow_dispatch"||run.run_attempt!==1||run.status!=="completed"||run.conclusion!=="success"||
    jobs?.total_count!==2||jobs.jobs?.length!==2||new Set(jobs.jobs.map(j=>j.id)).size!==2||
    !jobs.jobs.every(j=>ID(j.id)&&j.run_id===AUDIT_RUN&&j.head_sha===ACTIVATION_SHA&&j.run_attempt===1&&j.status==="completed")||
    !jobs.jobs.some(j=>j.name==="offline"&&j.conclusion==="skipped"&&(j.steps==null||Array.isArray(j.steps)&&j.steps.length===0)))hold("AUDIT_IDENTITY");
 const j=jobs.jobs.find(x=>x.id===AUDIT_JOB);
 if(j?.name!=="actual-post-repair"||j.run_id!==AUDIT_RUN||j.head_sha!==ACTIVATION_SHA||j.run_attempt!==1||j.status!=="completed"||j.conclusion!=="success"||
    j.steps?.filter(s=>s.name==="Independently observe first hour after exact credential readback"&&s.status==="completed"&&s.conclusion==="success").length!==1)hold("AUDIT_STEP");
 const rows=hits(log,x=>x.status==="READONLY_CRON_AND_RELAY_AUDIT_NOT_COLLECTION_PROOF");
 if(rows.length!==2)hold("AUDIT_RECEIPTS");
 for(const [lane,jobId,min] of [["PRIMARY_BACKSTOP",8890475,3],["ROLLING_ROOT",8890476,5]]){
  const a=rows.filter(x=>x.lane===lane);
  const x=a[0];
  if(a.length!==1||x.jobId!==jobId||x.relayPin!==ACTIVATION_SHA||x.mode!=="SHADOW"||x.shadowFullyProven!==true||Date.parse(x.auditFirstPlannedUtc)<=Date.parse("2026-11-18T12:06:53.372Z")||!Number.isFinite(Date.parse(x.auditFirstPlannedUtc))||
     !Number.isSafeInteger(x.expected)||x.expected<min||x.expected>6||x.proven!==x.expected||
     x.ackOnly!==0||x.unresolved!==0||x.unexpectedRows!==0||x.over120Seconds!==0||x.disabledEarly!==false||
     x.relayTargetAcks!==0||x.targetDispatches!==0||x.cronWrites!==0||x.providerCalls!==0||x.databaseReads!==0||x.databaseWrites!==0||x.paidAuthorityGranted!==false||
     !Array.isArray(x.rows)||x.rows.length!==x.expected||new Set(x.rows.map(v=>v.runId)).size!==x.expected||
     !x.rows.every(v=>v.status==="SHADOW_LANE_PROVEN_NO_FORWARD"&&ID(v.runId)&&ID(v.jobId)))hold("AUDIT_SCOPE");
 }
 return rows.map(x=>({lane:x.lane,jobId:x.jobId,expected:x.expected,proven:x.proven,maxPlannedToRunnerMs:x.maxPlannedToRunnerMs}));
}
export function verifyRollingReceipt(run,jobs,log,chain,hop,parent,deadline){
 const name="rolling-no-provider-rehearsal",wanted="P5 ROLLING "+chain+" "+hop+" "+parent;
 if(run?.head_sha!==TARGET_SHA||run.head_branch!=="main"||run.path!==".github/workflows/"+PILOT||run.event!=="workflow_dispatch"||
    run.run_attempt!==1||run.status!=="completed"||run.conclusion!=="success"||run.display_title!==wanted||!ID(run.id)||
    jobs?.total_count!==5||jobs.jobs?.length!==5||new Set(jobs.jobs.map(j=>j.name)).size!==5||new Set(jobs.jobs.map(j=>j.id)).size!==5||
    !jobs.jobs.every(j=>ID(j.id)&&j.run_id===run.id&&j.head_sha===TARGET_SHA&&j.run_attempt===1&&j.status==="completed"))hold("ROLLING_IDENTITY");
 const j=jobs.jobs.find(x=>x.name===name);
 const skipped=["six-slot-cron-observation-only","actual-readonly-preview-diagnostic","bounded-manual-github-handoff","bounded-primary-retention-backstop"];
 if(!skipped.every(k=>jobs.jobs.some(x=>x.name===k&&x.conclusion==="skipped"&&(x.steps==null||Array.isArray(x.steps)&&x.steps.length===0)))||
    j?.conclusion!=="success"||!["Observe two real read-only rolling waves and admit at most one rehearsal successor","Publish exact non-sensitive rehearsal successor receipt"].every(n=>j.steps?.filter(x=>x.name===n&&x.status==="completed"&&x.conclusion==="success").length===1))hold("ROLLING_STEPS");
 const a=hits(log,x=>x.schema==="v39.phase5.rolling-continuation-rehearsal.v1"),x=a[0];
 if(a.length!==1||x.chainId!==chain||x.hop!==hop||x.parentRunId!==String(parent)||x.runId!==String(run.id)||x.reviewedMainSha!==TARGET_SHA||x.deadlineUtc!==deadline||
    x.providerCalls!==0||x.databaseReads!==0||x.databaseWrites!==0||x.collectionDispatches!==0||x.phase6PaidGo!==false||x.profile!==undefined||
    !Array.isArray(x.waves)||x.waves.length!==2||!x.waves.every((v,i)=>v.wave===i+1&&v.lanes===8))hold("ROLLING_RECEIPT");
 if(hop===2){if(x.status!=="TERMINAL_REHEARSAL_NO_MORE_DISPATCH"||x.rehearsalDispatches!==0||x.nextRunId!==null)hold("ROLLING_TERMINAL");}
 else if(x.status!=="ONE_REHEARSAL_SUCCESSOR_ACKNOWLEDGED"||x.rehearsalDispatches!==1||!ID(Number(x.nextRunId))||Number(x.nextRunId)===run.id||!Number.isFinite(Date.parse(x.nextDispatchAtUtc)))hold("ROLLING_SUCCESSOR");
 return {runId:run.id,jobId:j.id,hop,nextRunId:x.nextRunId===null?null:Number(x.nextRunId),nextDispatchAtUtc:x.nextDispatchAtUtc??null};
}
export async function rehearse(env,{fetcher=fetch,ownLog=(n,j)=>execFileSync("gh",["run","view",String(n),"-R",RELAY,"--job",String(j),"--log"],{env:{PATH:process.env.PATH,HOME:process.env.HOME,GH_TOKEN:env.GITHUB_TOKEN,GH_PROMPT_DISABLED:"1"},encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024,stdio:["ignore","pipe","ignore"]}),targetLog=(t,j)=>readPrimaryVerifyLog(fetcher,t,j),now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),emit=()=>{}}={}){
 const lane=env.TRAVNR_EXERCISE_LANE,pin=env.GITHUB_SHA,runId=Number(env.GITHUB_RUN_ID),own=env.GITHUB_TOKEN,token=env.TRAVNR_TARGET_ACTIONS_TOKEN;
 if(env.GITHUB_ACTIONS!=="true"||env.GITHUB_REPOSITORY!==RELAY||env.GITHUB_REF!=="refs/heads/main"||env.GITHUB_EVENT_NAME!=="push"||
    env.GITHUB_RUN_ATTEMPT!=="1"||env.TRAVNR_REHEARSAL_PREVIOUS_SHA!==ACTIVATION_SHA||!SHA(pin)||!ID(runId)||
    !["PRIMARY_BACKSTOP","ROLLING_ROOT"].includes(lane)||env.TRAVNR_TARGET_FORWARD_ENV_READY!=="1"||env.TRAVNR_RELAY_MODE!=="CLOCK_ONLY"||
    [env.TRAVNR_RELAY_PRIMARY_ENABLED,env.TRAVNR_RELAY_ROLLING_ENABLED,env.TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED].some(x=>x==="1")||
    typeof own!=="string"||own.length<16||!/^github_pat_[A-Za-z0-9_]{25,}$/.test(token??"")||
    [env.DATABASE_URL,env.RAPIDAPI_KEY,env.AERODATABOX_API_KEY,env.TRAVNR_CRON_ACCOUNT_KEY,env.TRAVNR_CRON_RELAY_TOKEN].some(Boolean))hold("SCOPE");
 const began=now(),wf=lane==="PRIMARY_BACKSTOP"?PRIMARY:PILOT;let reads=0,attempted=false;
 const hdr=t=>({Authorization:"Bearer "+t,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"});
 async function get(repo,path){if(++reads>200||now()-began>24*60000)hold("READ_BOUND");
  const r=await fetcher(API+repo+path,{method:"GET",headers:hdr(repo===RELAY?own:token),redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!r.ok)hold("READ_HTTP_"+r.status);return r.json();}
 const stable=async()=>{if((await get(RELAY,"/git/ref/heads/main")).object?.sha!==pin||(await get(TARGET,"/git/ref/heads/main")).object?.sha!==TARGET_SHA)hold("MAIN_DRIFT")};
 try{
  await stable();
  const self=await get(RELAY,"/actions/runs/"+runId);
  if(self.id!==runId||self.head_sha!==pin||self.head_branch!=="main"||self.event!=="push"||self.run_attempt!==1||self.path!==".github/workflows/"+WF||self.status!=="in_progress")hold("SELF_IDENTITY");
  const ownRuns=await get(RELAY,"/actions/workflows/"+WF+"/runs?branch=main&per_page=100");
  if(ownRuns.total_count!==1||ownRuns.workflow_runs?.length!==1||ownRuns.workflow_runs[0]?.id!==runId)hold("ONE_SHOT_HISTORY");
  const audit=await get(RELAY,"/actions/runs/"+AUDIT_RUN),aj=await get(RELAY,"/actions/runs/"+AUDIT_RUN+"/jobs?filter=latest&per_page=100");
  const shadow=verifyShadowAudit(audit,aj,await ownLog(AUDIT_RUN,AUDIT_JOB));
  if((await get(TARGET,"/contents/.github/workflows/"+wf+"?ref="+TARGET_SHA)).sha!==PINNED_BLOBS[wf])hold("TARGET_WORKFLOW_BLOB");
  for(const q of ACTIVE){const a=await get(TARGET,"/actions/workflows/"+wf+"/runs?branch=main&status="+q+"&per_page=100");if(a.total_count!==0||a.workflow_runs?.length!==0)hold("TARGET_ACTIVE");}
  await stable();
  const sent=now(),chain=createHash("sha256").update("travnr-nov18-autonomous-rolling|"+runId+"|"+pin).digest("hex").slice(0,32),deadline=iso(sent+29*60000);
  const inputs=lane==="PRIMARY_BACKSTOP"?{confirm:"VERIFY_PRIMARY_FIDS_ONLY_NO_WRITES",approved_main_sha:TARGET_SHA}:
   {mode:"ROLLING_REHEARSAL",handoff_confirm:"REHEARSE_THREE_ROLLING_SESSIONS_NO_PROVIDER_NO_DB",approved_main_sha:TARGET_SHA,chain_id:chain,hop:"0",parent_run_id:"0",deadline_utc:deadline,sent_at_utc:""};
  attempted=true;emit({status:"AUTONOMOUS_LANE_EXACT_REHEARSAL_ATTEMPT_NO_REPLAY",lane,relayRunId:runId,targetWorkflow:wf,sentUtc:iso(sent)});
  const p=await fetcher(API+TARGET+"/actions/workflows/"+wf+"/dispatches",{method:"POST",headers:{...hdr(token),"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(10000),body:JSON.stringify({ref:"main",return_run_details:true,inputs})});
  if(p.status!==200)hold("ACK_HTTP_"+p.status);
  const a=await p.json(),n=a.workflow_run_id;
  if(!ID(n)||a.run_url!==API+TARGET+"/actions/runs/"+n||a.html_url!=="https://github.com/"+TARGET+"/actions/runs/"+n)hold("UNKNOWN_ACK");
  emit({status:"AUTONOMOUS_LANE_ROOT_ACK_NOT_EXECUTION_PROOF",lane,targetRunId:n});
  const terminal=async id=>{
   for(let i=0;i<60;i++){const r=await get(TARGET,"/actions/runs/"+id);
    if(r.id!==id||r.head_sha!==TARGET_SHA||r.path!==".github/workflows/"+wf||r.head_branch!=="main"||r.event!=="workflow_dispatch"||r.run_attempt!==1||Date.parse(r.created_at)<sent-5000)hold("TARGET_IDENTITY");
    if(r.status==="completed"){if(r.conclusion!=="success")hold("TARGET_TERMINAL_FAILURE");return r;}
    await sleep(10000);}
   hold("TARGET_TERMINAL_TIMEOUT");
  };
  let proof;
  if(lane==="PRIMARY_BACKSTOP"){
   const r=await terminal(n),j=await get(TARGET,"/actions/runs/"+n+"/jobs?filter=latest&per_page=100");
   if(!ID(j.jobs?.[0]?.id))hold("PRIMARY_JOB");
   proof=verifyPrimaryBootstrapReceipt(r,j,await targetLog(token,j.jobs[0].id),TARGET_SHA,n,now());
  }else{
   let id=n,parent=0;const rows=[];
   for(let hop=0;hop<3;hop++){
    const r=await terminal(id),j=await get(TARGET,"/actions/runs/"+id+"/jobs?filter=latest&per_page=100"),k=j.jobs?.find(x=>x.name==="rolling-no-provider-rehearsal");
    if(!ID(k?.id))hold("ROLLING_JOB");
    const a=verifyRollingReceipt(r,j,await targetLog(token,k.id),chain,hop,parent,deadline);
    if(rows.some(x=>x.runId===a.runId)||hop<2&&rows.some(x=>x.runId===a.nextRunId))hold("ROLLING_DUPLICATE");
    rows.push(a);parent=id;id=a.nextRunId;
   }
   proof={chain,rows,botSuccessorDispatches:2};
  }
  await stable();
  return {status:"AUTONOMOUS_BACKUP_PATH_REHEARSAL_VERIFIED_NOT_PRODUCTION_RECOVERY_PROOF",lane,relayRunId:runId,relayPin:pin,targetPin:TARGET_SHA,rootDispatches:1,shadow,proof,...ZERO};
 }catch(e){const m=/^HOLD_(AUTONOMOUS_REHEARSAL|EXTERNAL_CLOCK)_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_AUTONOMOUS_REHEARSAL_REDACTED";throw Error(attempted?m+"_NO_BLIND_REPLAY":m);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await rehearse(process.env,{emit:x=>console.log(JSON.stringify(x))})))}
 catch(e){console.error(/^HOLD_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_AUTONOMOUS_REHEARSAL_REDACTED");process.exitCode=2;}
}
