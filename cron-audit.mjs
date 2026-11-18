import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
export const REPO="HKcode22/TravnrClockRelay",WF="external-clock.yml";
const GH="https://api.github.com/repos/"+REPO,CRON="https://api.cron-job.org";
const URL=GH+"/actions/workflows/"+WF+"/dispatches";
const HOLD=s=>{throw Error("HOLD_CRON_MANAGER_"+s)};
const id=x=>Number.isSafeInteger(x)&&x>0,sha=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x),iso=x=>new Date(x).toISOString();
const time=x=>{const t=Date.parse(x);if(typeof x!=="string"||!Number.isFinite(t))HOLD("UTC");return t};
const mins=[2,12,22,32,42,52],utcNumber=x=>Number(iso(x).slice(0,19).replace(/[-:T]/g,""));
export const PILOT=Object.freeze({jobId:8889486,title:"Travnr isolated 90-minute external clock pilot",pin:"9cca29330405774520e0c7929f4916e24d9934e4",from:"2026-11-18T06:23:10.805Z",enabledReadback:"2026-11-18T06:23:11.184Z",until:"2026-11-18T07:53:06.000Z"});
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function config(env,mode){
 if(mode==="PILOT")return {...PILOT};
 if(mode!=="RECENT")HOLD("MODE");
 const c={jobId:Number(env.TRAVNR_CRON_JOB_ID),title:"Travnr isolated clock-only monitored backup",pin:env.TRAVNR_CRON_RELAY_SHA,from:env.TRAVNR_CRON_START_UTC,enabledReadback:env.TRAVNR_CRON_ENABLED_UTC,until:env.TRAVNR_CRON_UNTIL_UTC};
 if(!/^[1-9]\d{0,14}$/.test(env.TRAVNR_CRON_JOB_ID??"")||!sha(c.pin)||!id(c.jobId))HOLD("CONFIG");
 const a=time(c.from),b=time(c.enabledReadback),z=time(c.until);
 if(b<a||b-a>60000||z<=b||z-a>32*86400000)HOLD("CONFIG_WINDOW");
 return c;
}
export function validateJob(c,j){
 const s=j?.schedule,h=j?.extendedData?.headers??{},headers=Object.fromEntries(Object.entries(h).map(([k,v])=>[k.toLowerCase(),v]));
 if(!j||j.jobId!==c.jobId||j.title!==c.title||j.url!==URL||j.requestMethod!==1||j.type!==0||
    j.saveResponses!==true||j.redirectSuccess!==false||j.requestTimeout!==30||j.auth?.enable!==false||
    typeof j.enabled!=="boolean"||s?.timezone!=="UTC"||s?.expiresAt!==utcNumber(time(c.until))||
    !["hours","mdays","months","wdays"].every(k=>eq(s[k],[-1]))||!eq(s.minutes,mins)||
    j.extendedData?.body!==JSON.stringify({ref:"main",return_run_details:true})||
    Object.keys(headers).length!==4||headers.accept!=="application/vnd.github+json"||
    headers["content-type"]!=="application/json"||headers["x-github-api-version"]!=="2022-11-28"||
    !/^Bearer github_pat_[A-Za-z0-9_]{25,}$/.test(headers.authorization??"")||
    j.notification?.onFailure!==true||j.notification?.onFailureCount!==1||j.notification?.onDisable!==true)HOLD("EXACT_JOB_CONFIG");
 return {enabled:j.enabled,expiresAt:c.until};
}
export function planned(c,mode,now){
 const start=time(c.from),end=time(c.until);
 if(!Number.isSafeInteger(now)||end<=start)HOLD("CLOCK");
 const lower=mode==="PILOT"?start:Math.max(start,now-180*60000-120000);
 const upper=Math.min(end,now-120000); // two minute observation grace, not collection permission
 const out=[];
 for(let t=Math.floor(lower/60000)*60000+60000;t<end&&t<=upper;t+=60000)if(mins.includes(new Date(t).getUTCMinutes()))out.push(t/1000);
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
  if(x.datePlanned*1000<time(c.from)||x.datePlanned*1000>=time(c.until)||!mins.includes(new Date(x.datePlanned*1000).getUTCMinutes()))unexpected.push(x.datePlanned);
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
export function verifyReceipt(c,r,n,run,jobs,log){
 if(run?.id!==n||run.head_sha!==c.pin||run.head_branch!=="main"||run.path!==".github/workflows/"+WF||
    run.event!=="workflow_dispatch"||run.run_attempt!==1)HOLD("RUN_IDENTITY");
 if(run.status!=="completed")return {status:"RELAY_PENDING",runId:n};
 if(run.conclusion!=="success")return {status:"RELAY_FAILED",runId:n};
 if(!Array.isArray(jobs?.jobs)||jobs.total_count!==jobs.jobs.length||jobs.jobs.length>100)HOLD("JOBS");
 const matches=jobs.jobs.filter(j=>j.name==="independent-pulse");
 if(matches.length!==1)HOLD("PULSE_JOB");
 const j=matches[0];
 if(!id(j.id)||j.head_sha!==c.pin||j.run_id!==n||j.run_attempt!==1||j.status!=="completed"||j.conclusion!=="success"||
    j.steps?.filter(s=>s.name==="Run node cli.mjs"&&s.status==="completed"&&s.conclusion==="success").length!==1)HOLD("PULSE_STEP");
 const hits=String(log).split(/\r?\n/).filter(l=>l.includes('{"status":"EXTERNAL_CLOCK_OBSERVED_NO_TARGET_DISPATCH"'));
 if(hits.length!==1)HOLD("RECEIPT_COUNT");
 let x;try{x=JSON.parse(hits[0].slice(hits[0].indexOf('{"status":')).trim())}catch{HOLD("RECEIPT_JSON")}
 const created=time(run.created_at),observed=time(x.runnerObservedUtc);
 if(x.relayRunId!==n||x.mode!=="CLOCK_ONLY"||time(x.actualCreatedUtc)!==created||x.providerCallsByRelay!==0||
    x.databaseReadsByRelay!==0||x.databaseWritesByRelay!==0||x.paidAuthorityGranted!==false||
    !Number.isSafeInteger(x.creationToObservedMs)||x.creationToObservedMs<0||Math.abs(observed-created-x.creationToObservedMs)>1000||
    created<r.date*1000-5000||observed<created||observed<time(j.started_at)-5000||observed>time(j.completed_at)+1000)HOLD("RECEIPT_SCOPE");
 return {status:"CLOCK_ONLY_PROVEN",runId:n,jobId:j.id,plannedToRunnerMs:observed-r.datePlanned*1000,creationToRunnerMs:observed-created};
}
export function samples(rows,mode){
 const good=rows.filter(x=>x.status==="CRON_HTTP_ACK_ONLY");
 if(mode==="PILOT")return good;
 // At most three detail calls per two-hour audit (60 account requests/day worst case).
 const max=[...good].sort((a,b)=>b.row.jitter-a.row.jitter||a.planned-b.planned)[0];
 return [...new Map([good[0],good.at(-1),max].filter(Boolean).map(x=>[x.planned,x])).values()];
}
export async function audit({c,mode,now,cron,gh,logs}){
 const detail=validateJob(c,(await cron("/jobs/"+c.jobId)).jobDetails);
 const slots=planned(c,mode,now),h=await cron("/jobs/"+c.jobId+"/history"),{rows,unexpected}=classify(c,slots,h.history);
 const selected=samples(rows,mode),used=new Set();
 for(const x of selected){
  try{
   const r=x.row,n=ack(c,r,await cron("/jobs/"+c.jobId+"/history/"+encodeURIComponent(r.identifier)));
   if(used.has(n))HOLD("DUPLICATE_RUN_ACK");used.add(n);
   const run=await gh("/actions/runs/"+n);
   let jobs,log;
   if(run.status==="completed"&&run.conclusion==="success"){
    jobs=await gh("/actions/runs/"+n+"/jobs?filter=latest&per_page=100");
    const j=jobs.jobs?.find(v=>v.name==="independent-pulse");
    if(!id(j?.id))HOLD("PULSE_JOB");
    log=await logs(n,j.id);
   }
   Object.assign(x,verifyReceipt(c,r,n,run,jobs,log));
  }catch(e){x.status="EVIDENCE_HOLD";x.reason=/^HOLD_CRON_MANAGER_[A-Z0-9_]+$/.test(e?.message||"")?e.message:"HOLD_CRON_MANAGER_UNKNOWN";}
 }
 const safe=rows.map(({row,...x})=>({...x,plannedUtc:iso(x.planned*1000)}));
 const proven=safe.filter(x=>x.status==="CLOCK_ONLY_PROVEN"),late=proven.filter(x=>x.plannedToRunnerMs>120000),ackOnly=safe.filter(x=>x.status==="CRON_HTTP_ACK_ONLY");
 const bad=safe.filter(x=>!["CLOCK_ONLY_PROVEN","CRON_HTTP_ACK_ONLY"].includes(x.status));
 const expired=now>=time(c.until)+120000,disabledEarly=now<time(c.until)&&!detail.enabled;
 return {status:"READONLY_CRON_AND_RELAY_AUDIT_NOT_COLLECTION_PROOF",mode,jobId:c.jobId,relayPin:c.pin,observedUtc:iso(now),auditFirstPlannedUtc:slots.length?iso(slots[0]*1000):null,auditLastPlannedUtc:slots.length?iso(slots.at(-1)*1000):null,expected:slots.length,proven:proven.length,ackOnly:ackOnly.length,unresolved:bad.length,unexpectedRows:unexpected,over120Seconds:late.length,expired,disabledEarly,
  fullyProven:expired&&mode==="PILOT"&&slots.length>0&&proven.length===slots.length&&unexpected===0,
  timingTargetMet:expired&&mode==="PILOT"&&slots.length>0&&proven.length===slots.length&&unexpected===0&&late.length===0,
  maxPlannedToRunnerMs:proven.length?Math.max(...proven.map(x=>x.plannedToRunnerMs)):null,rows:safe,
  cronWrites:0,targetDispatches:0,providerCalls:0,databaseReads:0,databaseWrites:0,paidAuthorityGranted:false};
}
async function main(){
 const e=process.env,mode=e.TRAVNR_CRON_AUDIT_MODE;
 if(e.GITHUB_ACTIONS!=="true"||e.GITHUB_REPOSITORY!==REPO||e.GITHUB_REF!=="refs/heads/main"||
    !["schedule","push"].includes(e.GITHUB_EVENT_NAME)||e.GITHUB_RUN_ATTEMPT!=="1"||
    (e.GITHUB_EVENT_NAME==="schedule"?mode!=="RECENT":mode!=="PILOT"||e.TRAVNR_CRON_PREVIOUS_RELAY_SHA!==PILOT.pin||Date.now()<time(PILOT.until)+120000)||
    e.DATABASE_URL||e.RAPIDAPI_KEY||e.AERODATABOX_API_KEY||e.TRAVNR_TARGET_ACTIONS_TOKEN||
    typeof e.TRAVNR_CRON_ACCOUNT_KEY!=="string"||e.TRAVNR_CRON_ACCOUNT_KEY.length<16||
    typeof e.GITHUB_TOKEN!=="string"||e.GITHUB_TOKEN.length<16)HOLD("RUNTIME_SCOPE");
 const c=config(e,mode);let calls=0;
 const cron=async p=>{
  if(++calls>(mode==="PILOT"?15:5)||!new RegExp("^/jobs/"+c.jobId+"(?:/history(?:/[A-Za-z0-9-]{1,100})?)?$").test(p))HOLD("CRON_READ_BOUND");
  const a=await fetch(CRON+p,{method:"GET",headers:{Authorization:"Bearer "+e.TRAVNR_CRON_ACCOUNT_KEY},redirect:"error",signal:AbortSignal.timeout(12000)});
  if(!a.ok)HOLD("CRON_HTTP_"+a.status);
  const data=await a.json();await new Promise(r=>setTimeout(r,250));return data;
 };
 const gh=async p=>{
  if(!/^\/actions\/runs\/[1-9][0-9]{0,14}(?:\/jobs\?filter=latest&per_page=100)?$/.test(p))HOLD("GH_READ_SCOPE");
  const a=await fetch(GH+p,{method:"GET",headers:{Authorization:"Bearer "+e.GITHUB_TOKEN,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!a.ok)HOLD("GH_HTTP_"+a.status);return a.json();
 };
 const logs=(n,j)=>execFileSync("gh",["run","view",String(n),"-R",REPO,"--job",String(j),"--log"],{
   env:{PATH:e.PATH,HOME:e.HOME,GH_TOKEN:e.GITHUB_TOKEN,GH_PROMPT_DISABLED:"1"},encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024,stdio:["ignore","pipe","ignore"]});
 const out=await audit({c,mode,now:Date.now(),cron,gh,logs});console.log(JSON.stringify({...out,cronApiReads:calls}));
 if(out.unresolved||out.unexpectedRows||out.disabledEarly||out.over120Seconds||(out.expired&&mode==="PILOT"&&!out.fullyProven))process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^HOLD_CRON_MANAGER_[A-Z0-9_]+$/.test(e?.message||"")?e.message:"HOLD_CRON_MANAGER_REDACTED");process.exitCode=2});
