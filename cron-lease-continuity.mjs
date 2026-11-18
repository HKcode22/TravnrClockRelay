/** One fixed extension of the two existing live Cron leases. No new job,
 * enabling, credential change, paid authority or workflow dispatch.
 * Deliberate commissioning boundary: separate main-only no-review environment,
 * not the read-only audit or existing protected management environment. */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {ACTUAL_PAIR,LANES,managedSpec,exactManaged} from "./cron-admin.mjs";
import {REPO,WF,PILOT} from "./cron-audit.mjs";
export const OLD="2026-12-19T08:00:00.000Z",EXTENDED="2026-12-27T08:00:00.000Z";
export const RENEW_FROM="2026-12-12T08:00:00.000Z",RENEW_LAST="2026-12-19T07:30:00.000Z";
const HOL=s=>{throw Error("HOLD_LEASE_CONTINUITY_"+s)},sha=s=>typeof s==="string"&&/^[a-f0-9]{40}$/.test(s),id=x=>Number.isSafeInteger(x)&&x>0;
const zero={providerCalls:0,databaseWrites:0,targetDispatches:0,paidAuthorityGranted:false};
const PATH=".github/workflows/cron-lease-continuity.yml",ROOT="https://api.github.com/repos/"+REPO;
export function renewalMode(env){
 const m=env.TRAVNR_RELAY_MODE,p=env.TRAVNR_RELAY_PRIMARY_ENABLED,r=env.TRAVNR_RELAY_ROLLING_ENABLED,a=env.TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED;
 if(m==="CLOCK_ONLY"&&[p,r,a].every(v=>v!=="1"))return "SHADOW";
 if(m==="MULTI_LANE"&&p==="1"&&r==="1"&&a==="1"&&sha(env.TRAVNR_APPROVED_TARGET_MAIN_SHA)){
  const end=Date.parse(env.TRAVNR_ROLLING_POLICY_UNTIL_UTC);
  if(Number.isFinite(end)&&end<=Date.parse(EXTENDED)&&end>Date.parse(OLD))return "RELEASED";
 }
 HOL("MODE_OR_POLICY");
}
export async function renewPair({env,now,priorRisk},{request,main,emit=()=>{},probe}){
 if(env.TRAVNR_LEASE_CONTINUITY_ARMED!=="1"||!sha(env.GITHUB_SHA)||!Number.isSafeInteger(now)||
    !Array.isArray(priorRisk)||priorRisk.length>100||priorRisk.some(v=>!id(v))||
    typeof env.TRAVNR_CRON_RELAY_TOKEN!=="string"||!/^github_pat_[A-Za-z0-9_]{25,}$/.test(env.TRAVNR_CRON_RELAY_TOKEN))HOL("SCOPE");
 const mode=renewalMode(env),pin=env.GITHUB_SHA,token=env.TRAVNR_CRON_RELAY_TOKEN;
 if(now<Date.parse(RENEW_FROM)||now>Date.parse(RENEW_LAST))return {status:"LEASE_OUTSIDE_FIXED_RENEWAL_WINDOW_NO_WRITE",mode,cronMutations:0,...zero};
 const stable=async()=>{if(await main()!==pin)HOL("MAIN_DRIFT")};
 const specs=ACTUAL_PAIR.map(x=>({old:managedSpec({lane:x.lane,until:OLD,token,now}),next:managedSpec({lane:x.lane,until:EXTENDED,token,now})}));
 await stable();
 const l=await request("GET","/jobs");
 if(l?.someFailed!==false||!Array.isArray(l.jobs)||l.jobs.length>100)HOL("ACCOUNT_LIST");
 const dest=ROOT+"/actions/workflows/"+WF+"/dispatches",known=new Set(Object.values(LANES).map(x=>x.title));
 if(l.jobs.some(j=>known.has(j.title)&&j.url!==dest||j.url===dest&&!known.has(j.title)&&!(j.jobId===PILOT.jobId&&j.title===PILOT.title&&Date.parse(PILOT.until)<now)))HOL("ACCOUNT_DESTINATION_DRIFT");
 const get=async i=>{
  const x=ACTUAL_PAIR[i],s=specs[i],j=(await request("GET","/jobs/"+x.jobId)).jobDetails;
  const matches=l.jobs.filter(k=>k.title===s.old.title);
  if(matches.length!==1||matches[0].jobId!==x.jobId)HOL("EXACT_ID");
  const which=j?.schedule?.expiresAt===s.next.schedule.expiresAt?"next":"old";
  exactManaged(j,s[which],x.jobId,true);
  return which;
 };
 const before=[await get(0),await get(1)];
 if(before.every(x=>x==="next")){await stable();return {status:"EXACT_PAIR_ALREADY_EXTENDED_INDEPENDENT_READBACK_NO_WRITE",until:EXTENDED,mode,cronMutations:0,...zero};}
 if(before.some(x=>x==="next")||priorRisk.length)HOL("PRIOR_OR_PARTIAL_ATTEMPT_INSPECT_NO_REPLAY");
 // Confirm stored token still valid before any schedule mutation. Never
 // repair/rekey/re-enable an invalid credential as part of renewal.
 if(await probe(token)!==true)HOL("RELAY_TOKEN_READ_INVALID");
 await stable();const rows=[];
 for(let i=0;i<ACTUAL_PAIR.length;i++){
  const x=ACTUAL_PAIR[i],s=specs[i];
  if(await get(i)!=="old")HOL("PREPATCH_DRIFT");
  await stable();
  emit({status:"FIXED_LEASE_EXTENSION_ATTEMPT_NO_REPLAY",...x,priorUntil:OLD,until:EXTENDED,relayPin:pin});
  await request("PATCH","/jobs/"+x.jobId,{job:{schedule:s.next.schedule}});
  if(await get(i)!=="next")HOL("POSTPATCH_READBACK");
  rows.push({...x,until:EXTENDED});emit({status:"FIXED_LEASE_EXTENSION_READBACK",...rows.at(-1),relayPin:pin});
 }
 await stable();
 return {status:"EXACT_PAIR_FIXED_LEASE_EXTENDED_VERIFIED",mode,relayPin:pin,priorUntil:OLD,until:EXTENDED,rows,cronMutations:2,...zero};
}
/** Complete bounded history. A previous successful run is not evidence a
 * write never occurred; if jobs remain old and any attempt entered the
 * capable step, stop. Exact skipped steps can be excluded without replay. */
export function classifyPriorRun(r,jobs,pin){
 if(!id(r?.id)||r.head_sha!==pin||r.head_branch!=="main"||r.event!=="schedule"||r.path!==PATH||
    r.status!=="completed"||r.run_attempt!==1||jobs?.total_count!==2||jobs.jobs?.length!==2||
    new Set(jobs.jobs.map(j=>j.id)).size!==2||
    !jobs.jobs.every(j=>id(j.id)&&j.run_id===r.id&&j.head_sha===pin&&j.status==="completed"&&j.run_attempt===1))return true;
 const j=jobs.jobs.filter(x=>x.name==="extend-exact-existing-pair"),offline=jobs.jobs.filter(x=>x.name==="offline");
 if(j.length!==1||offline.length!==1||offline[0].conclusion!=="skipped"||!(offline[0].steps==null||offline[0].steps.length===0))return true;
 if(j[0].conclusion==="skipped"&&(j[0].steps==null||j[0].steps.length===0))return false;
 const step=j[0].steps?.filter(x=>x.name==="Extend exact existing pair only, no replay");
 return step?.length!==1||step[0].status!=="completed"||step[0].conclusion!=="skipped";
}
async function run(){
 const e=process.env;
 if(e.GITHUB_ACTIONS!=="true"||e.GITHUB_REPOSITORY!==REPO||e.GITHUB_REF!=="refs/heads/main"||
    e.GITHUB_EVENT_NAME!=="schedule"||e.GITHUB_RUN_ATTEMPT!=="1"||!sha(e.GITHUB_SHA)||
    !id(Number(e.GITHUB_RUN_ID))||e.TRAVNR_LEASE_CONTINUITY_ARMED!=="1"||e.TRAVNR_LEASE_ENV_READY!=="1"||
    [e.TRAVNR_TARGET_ACTIONS_TOKEN,e.DATABASE_URL,e.AERODATABOX_API_KEY,e.RAPIDAPI_KEY].some(Boolean)||
    typeof e.GITHUB_TOKEN!=="string"||e.GITHUB_TOKEN.length<16||
    typeof e.TRAVNR_CRON_ACCOUNT_KEY!=="string"||e.TRAVNR_CRON_ACCOUNT_KEY.length<16||
    e.NODE_TLS_REJECT_UNAUTHORIZED==="0")HOL("WORKFLOW_SCOPE");
 const now=Date.now();
 if(now<Date.parse(RENEW_FROM)||now>Date.parse(RENEW_LAST)){
  console.log(JSON.stringify({status:"LEASE_OUTSIDE_FIXED_RENEWAL_WINDOW_NO_WRITE",cronMutations:0,...zero}));return;
 }
 const get=async path=>{
  const r=await fetch(ROOT+path,{method:"GET",headers:{Authorization:"Bearer "+e.GITHUB_TOKEN,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!r.ok)HOL("GITHUB_READ_"+r.status);return r.json();
 };
 const main=async()=>(await get("/git/ref/heads/main")).object?.sha;
 const self=await get("/actions/runs/"+e.GITHUB_RUN_ID);
 if(self.id!==Number(e.GITHUB_RUN_ID)||self.head_sha!==e.GITHUB_SHA||self.head_branch!=="main"||
    self.event!=="schedule"||self.path!==PATH||self.run_attempt!==1||self.status!=="in_progress")HOL("SELF_IDENTITY");
 const h=await get("/actions/workflows/cron-lease-continuity.yml/runs?branch=main&event=schedule&per_page=100&created="+encodeURIComponent(">="+RENEW_FROM));
 if(!Number.isSafeInteger(h.total_count)||h.total_count>100||h.workflow_runs?.length!==h.total_count||
    new Set(h.workflow_runs.map(x=>x.id)).size!==h.total_count||!h.workflow_runs.some(x=>x.id===self.id))HOL("HISTORY_BOUND");
 const priorRisk=[];
 for(const r of h.workflow_runs.filter(x=>x.id!==self.id)){
  if(r.status!=="completed")HOL("PRIOR_ACTIVE");
  if(r.head_sha!==e.GITHUB_SHA){priorRisk.push(r.id);continue;}
  const j=await get("/actions/runs/"+r.id+"/jobs?filter=latest&per_page=100");
  if(classifyPriorRun(r,j,e.GITHUB_SHA))priorRisk.push(r.id);
 }
 let reads=0,writes=0;
 const request=async(method,p,body)=>{
  if(!["GET","PATCH"].includes(method)||!/^\/jobs(?:\/889047[56])?$/.test(p)||
    (method==="GET"?++reads>7:++writes>2))HOL("CRON_BOUND");
  const r=await fetch("https://api.cron-job.org"+p,{method,headers:{Authorization:"Bearer "+e.TRAVNR_CRON_ACCOUNT_KEY,"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)HOL("CRON_HTTP_"+r.status+"_NO_REPLAY");
  const a=await r.json();await new Promise(r=>setTimeout(r,250));return a;
 };
 const probe=async token=>{
  const r=await fetch(ROOT+"/actions/workflows/"+WF,{method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!r.ok)return false;
  const x=await r.json();return x.path===".github/workflows/"+WF&&x.state==="active";
 };
 const out=await renewPair({env:e,now,priorRisk},{request,main,probe,emit:x=>console.log(JSON.stringify(x))});
 console.log(JSON.stringify({...out,cronApiReads:reads}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(e=>{console.error(/^HOLD_(LEASE_CONTINUITY|CRON_ADMIN)_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_LEASE_CONTINUITY_REDACTED_INSPECT_NO_REPLAY");process.exitCode=2});
