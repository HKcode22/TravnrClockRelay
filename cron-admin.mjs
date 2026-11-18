/** Owner-approved Cron account management, scoped to exact isolated relay jobs.
 * Cron account key never passed to relay workers; only relay-only PAT is sent
 * to cron service as destination auth. No production token or database here.
 * No automatic create/enable/rekey/replay. */
import {dirname,isAbsolute,resolve} from "node:path";
import {existsSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {PILOT,REPO,WF,validateJob} from "./cron-audit.mjs";
const URL="https://api.github.com/repos/"+REPO+"/actions/workflows/"+WF+"/dispatches",ROOT="https://api.cron-job.org";
const HOLD=s=>{throw Error("HOLD_CRON_ADMIN_"+s)};
const id=x=>Number.isSafeInteger(x)&&x>0,sha=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x),iso=x=>new Date(x).toISOString();
const time=s=>{let n=Date.parse(s);if(typeof s!=="string"||!Number.isFinite(n)||iso(n)!==s)HOLD("UTC");return n};
const utcNum=n=>Number(iso(n).slice(0,19).replace(/[-:T]/g,""));
const tokenOK=s=>typeof s==="string"&&/^github_pat_[A-Za-z0-9_]{25,}$/.test(s);
export const LANES=Object.freeze({
 CLOCK_ONLY:{title:"Travnr isolated clock-only monitored backup",minutes:[2,12,22,32,42,52]},
 PRIMARY_BACKSTOP:{title:"Travnr isolated primary expiry recovery",minutes:[4,19,34,49]},
 ROLLING_ROOT:{title:"Travnr isolated rolling root recovery",minutes:[8,18,28,38,48,58]}
});
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fixedHeaders=token=>({Authorization:"Bearer "+token,Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28"});
export function managedSpec({lane,until,token,now,forDisable=false}){
 if(!Object.hasOwn(LANES,lane)||(!forDisable&&!tokenOK(token))||!Number.isSafeInteger(now)||typeof forDisable!=="boolean")HOLD("SCOPE");
 const end=time(until);
 if(!forDisable&&(end<now+30*60000||end>now+32*86400000))HOLD("EXPIRY_BOUND");
 if(forDisable)token="github_pat_"+"x".repeat(40);
 const l=LANES[lane];
 return {title:l.title,url:URL,enabled:false,saveResponses:true,requestMethod:1,type:0,requestTimeout:30,redirectSuccess:false,
  auth:{enable:false},
  schedule:{timezone:"UTC",expiresAt:utcNum(end),hours:[-1],mdays:[-1],minutes:l.minutes,months:[-1],wdays:[-1]},
  notification:{onFailure:true,onFailureCount:1,onSuccess:true,onDisable:true,mode:1},
  extendedData:{headers:fixedHeaders(token),body:JSON.stringify({ref:"main",return_run_details:true,...(lane==="CLOCK_ONLY"?{}:{inputs:{lane}})})}};
}
export function exactManaged(j,s,n,enabled,{requireToken=true}={}){
 const h=Object.fromEntries(Object.entries(j?.extendedData?.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
 if(!j||j.jobId!==n||j.title!==s.title||j.url!==s.url||j.enabled!==enabled||j.saveResponses!==true||
    j.requestMethod!==1||j.type!==0||j.requestTimeout!==30||j.redirectSuccess!==false||j.auth?.enable!==false||
    j.extendedData?.body!==s.extendedData.body||Object.keys(h).length!==4||
    !/^Bearer github_pat_[A-Za-z0-9_]{25,}$/.test(h.authorization??"")||
    !Object.entries(s.extendedData.headers).every(([k,v])=>!requireToken&&k==="Authorization"||h[k.toLowerCase()]===v)||
    !Object.entries(s.schedule).every(([k,v])=>eq(j.schedule?.[k],v))||
    !Object.entries(s.notification).every(([k,v])=>eq(j.notification?.[k],v)))HOLD("JOB_READBACK");
 return true;
}
function listMatch(l,s,n,now){
 if(l?.someFailed!==false||!Array.isArray(l.jobs)||l.jobs.length>100)HOLD("LIST_INCOMPLETE");
 const known=new Set(Object.values(LANES).map(x=>x.title)),matches=l.jobs.filter(j=>j.title===s.title);
 if(l.jobs.some(j=>j.url===URL&&!known.has(j.title)&&!(j.jobId===PILOT.jobId&&j.title===PILOT.title&&now>=time(PILOT.until)&&j.schedule?.expiresAt===utcNum(time(PILOT.until)))))HOLD("UNKNOWN_OR_ACTIVE_PILOT_DESTINATION");
 if(l.jobs.some(j=>known.has(j.title)&&j.url!==URL))HOLD("MANAGED_TITLE_DESTINATION_DRIFT");
 if(n===null){if(matches.length)HOLD("MANAGED_JOB_ALREADY_EXISTS_INSPECT");}
 else if(matches.length!==1||matches[0].jobId!==n)HOLD("EXACT_EXISTING_MANAGED_JOB_REQUIRED");
}
const zero={providerCalls:0,databaseWrites:0,targetDispatches:0,paidAuthorityGranted:false};
export async function manage({op,lane,until,token,now,jobId,confirm,pin,env},{request,main,emit=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const rules={CREATE_DISABLED:"CREATE_EXACT_DISABLED_MANAGED_CRON_JOB",ENABLE_EXACT:"ENABLE_EXACT_MANAGED_CRON_JOB",DISABLE_EXACT:"DISABLE_EXACT_MANAGED_CRON_JOB"};
 if(!Object.hasOwn(rules,op)||confirm!==rules[op]||!sha(pin)||typeof request!=="function"||typeof main!=="function"||
    (op==="CREATE_DISABLED"?jobId!==null:!id(jobId)))HOLD("EXPLICIT_APPROVAL");
 const s=managedSpec({lane,until,token,now,forDisable:op==="DISABLE_EXACT"});
 const stable=async()=>{if(await main()!==pin)HOLD("RELAY_MAIN_DRIFT")};
 await stable();
 if(op==="ENABLE_EXACT"&&lane!=="CLOCK_ONLY"){
  const k=lane==="PRIMARY_BACKSTOP"?"TRAVNR_RELAY_PRIMARY_ENABLED":"TRAVNR_RELAY_ROLLING_ENABLED";
  if(env?.TRAVNR_RELAY_MODE!=="MULTI_LANE"||env[k]!=="1"||!sha(env.TRAVNR_APPROVED_TARGET_MAIN_SHA??"")||
     env.TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED!=="1")HOLD("SEPARATE_TARGET_LANE_APPROVAL_REQUIRED");
 }
 if(op!=="DISABLE_EXACT")listMatch(await request("GET","/jobs"),s,jobId,now);
 if(op==="CREATE_DISABLED"){
  await stable();emit({status:"CRON_CREATE_DISABLED_ATTEMPT_NO_REPLAY",lane,relayPin:pin});
  const a=await request("PUT","/jobs",{job:s});
  if(!id(a?.jobId))HOLD("CREATE_ACK_UNKNOWN_INSPECT");
  emit({status:"CRON_CREATE_DISABLED_ACK",lane,jobId:a.jobId});
  await sleep(1200);
  exactManaged((await request("GET","/jobs/"+a.jobId)).jobDetails,s,a.jobId,false);
  await stable();return {status:"MANAGED_CRON_CREATED_DISABLED_VERIFIED",lane,jobId:a.jobId,until,relayPin:pin,cronMutations:1,...zero};
 }
 const prior=(await request("GET","/jobs/"+jobId)).jobDetails,want=op==="ENABLE_EXACT";
 if(typeof prior?.enabled!=="boolean")HOLD("EXISTING_JOB_STATE");
 exactManaged(prior,s,jobId,prior.enabled,{requireToken:op!=="DISABLE_EXACT"});
 if(prior.enabled===want)return {status:want?"ALREADY_ENABLED_READBACK_NO_WRITE":"ALREADY_DISABLED_READBACK_NO_WRITE",lane,jobId,until,relayPin:pin,cronMutations:0,...zero};
 await stable();
 const attemptUtc=iso(Date.now());
 emit({status:want?"CRON_ENABLE_ATTEMPT_NO_REPLAY":"CRON_DISABLE_ATTEMPT_NO_REPLAY",lane,jobId,attemptUtc});
 await request("PATCH","/jobs/"+jobId,{job:{enabled:want}});
 const after=(await request("GET","/jobs/"+jobId)).jobDetails;
 exactManaged(after,s,jobId,want,{requireToken:op!=="DISABLE_EXACT"});
 await stable();
 return {status:want?"MANAGED_CRON_ENABLED_VERIFIED_NOT_EXECUTION_PROOF":"MANAGED_CRON_DISABLED_VERIFIED",lane,jobId,until,relayPin:pin,attemptUtc,readbackUtc:iso(Date.now()),cronMutations:1,...zero};
}
/** One owner-reviewed operation, create both recovery jobs disabled.
 * No subsequent mutation after a failed/ambiguous ACK; no rollback or retry.
 * A partial pair requires separately reviewed reconciliation, never another pair create.
 */
export async function createDisabledPair({until,token,now,jobId,confirm,pin,env},deps){
 const {request,main,emit=()=>{}}=deps;
 if(confirm!=="CREATE_BOTH_RECOVERY_CRON_JOBS_DISABLED_NO_FORWARD"||jobId!==null||!sha(pin)||
    !["","CLOCK_ONLY",undefined].includes(env?.TRAVNR_RELAY_MODE)||
    env?.TRAVNR_RELAY_PRIMARY_ENABLED==="1"||env?.TRAVNR_RELAY_ROLLING_ENABLED==="1"||
    env?.TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED==="1")HOLD("PAIR_STOP_SCOPE");
 const lanes=["PRIMARY_BACKSTOP","ROLLING_ROOT"],specs=lanes.map(lane=>managedSpec({lane,until,token,now}));
 const stable=async()=>{if(await main()!==pin)HOLD("RELAY_MAIN_DRIFT")};
 await stable();
 const before=await request("GET","/jobs");
 for(const s of specs)listMatch(before,s,null,now);
 const verified=[];
 for(const lane of lanes){
  const out=await manage({op:"CREATE_DISABLED",lane,until,token,now,jobId:null,
   confirm:"CREATE_EXACT_DISABLED_MANAGED_CRON_JOB",pin,env},deps);
  if(out.status!=="MANAGED_CRON_CREATED_DISABLED_VERIFIED"||!id(out.jobId)||
    verified.some(x=>x.jobId===out.jobId))HOLD("PAIR_ACK_SCOPE");
  verified.push({lane,jobId:out.jobId});
  emit({status:"PAIR_MEMBER_DISABLED_VERIFIED",...verified.at(-1),relayPin:pin});
 }
 const after=await request("GET","/jobs");
 for(let i=0;i<verified.length;i++){
  const v=verified[i],spec=specs[i];
  listMatch(after,spec,v.jobId,now);
  exactManaged((await request("GET","/jobs/"+v.jobId)).jobDetails,spec,v.jobId,false);
 }
 await stable();
 return {status:"MANAGED_RECOVERY_PAIR_DISABLED_VERIFIED_NO_FORWARD",jobs:verified,
  until,relayPin:pin,cronMutations:2,...zero};
}
/** Renew the same live lease, without enabling, re-keying or changing
 * cadence. Exact old expiry is a compare-before-write guard, not a remote CAS.
 * Unknown PATCH outcome requires independent readback, never automatic retry.
 */
export async function renewExactLease({lane,until,priorUntil,token,now,jobId,confirm,pin},{request,main,emit=()=>{}}){
 if(confirm!=="RENEW_ACTIVE_MANAGED_CRON_LEASE_ONLY"||!sha(pin)||!id(jobId)||!["PRIMARY_BACKSTOP","ROLLING_ROOT","CLOCK_ONLY"].includes(lane))HOLD("RENEW_APPROVAL");
 const old=time(priorUntil),end=time(until);
 if(!Number.isSafeInteger(now)||old<now+30*60000||old>now+7*86400000||
    end<=old||end-old>14*86400000||end>now+32*86400000)HOLD("RENEW_BOUNDS");
 const before=managedSpec({lane,until:priorUntil,token,now}),after=managedSpec({lane,until,token,now});
 const stable=async()=>{if(await main()!==pin)HOLD("RELAY_MAIN_DRIFT")};
 await stable();
 listMatch(await request("GET","/jobs"),before,jobId,now);
 const live=(await request("GET","/jobs/"+jobId)).jobDetails;
 if(live?.enabled!==true)HOLD("RENEW_ACTIVE_ONLY");
 if(live.schedule?.expiresAt===after.schedule.expiresAt){
  exactManaged(live,after,jobId,true);await stable();
  return {status:"EXACT_LEASE_ALREADY_RENEWED_NO_WRITE",lane,jobId,priorUntil,until,relayPin:pin,cronMutations:0,...zero};
 }
 exactManaged(live,before,jobId,true);
 await stable();
 emit({status:"CRON_LEASE_RENEW_ATTEMPT_NO_REPLAY",lane,jobId,priorUntil,until,relayPin:pin});
 await request("PATCH","/jobs/"+jobId,{job:{schedule:after.schedule}});
 exactManaged((await request("GET","/jobs/"+jobId)).jobDetails,after,jobId,true);
 await stable();
 return {status:"MANAGED_CRON_LEASE_RENEWED_VERIFIED_NOT_EXECUTION_PROOF",lane,jobId,priorUntil,until,relayPin:pin,cronMutations:1,...zero};
}
/** The current expiring pilot can be rekeyed locally without changing its
 * job identity, schedule, enabled setting, or relay main. Failed slots
 * remain in history; no attempt is made to repair/backdate them. */
export async function rekeyPilot({token,now,allowWrite=true},{request,main,emit=()=>{}}){
 if(!tokenOK(token)||typeof allowWrite!=="boolean"||!Number.isSafeInteger(now)||now>=time(PILOT.until))HOLD("PILOT_REKEY_SCOPE");
 const stable=async()=>{if(await main()!==PILOT.pin)HOLD("PILOT_RELAY_PIN_DRIFT")};
 await stable();
 const p="/jobs/"+PILOT.jobId,prior=(await request("GET",p)).jobDetails;
 const prev=validateJob(PILOT,prior);
 if(!prev.enabled)HOLD("PILOT_DISABLED_DO_NOT_REENABLE");
 const header=Object.entries(prior.extendedData.headers).find(([k])=>k.toLowerCase()==="authorization")?.[1];
 if(header===fixedHeaders(token).Authorization)return {status:"PILOT_ALREADY_REKEYED_NO_WRITE",jobId:PILOT.jobId,cronMutations:0,...zero};
 if(!allowWrite)HOLD("PILOT_REKEY_PREVIOUS_ATTEMPT_INSPECT_NO_REPLAY");
 await stable();
 emit({status:"PILOT_REKEY_ATTEMPT_NO_REPLAY",jobId:PILOT.jobId,attemptUtc:iso(Date.now())});
 await request("PATCH",p,{job:{extendedData:{headers:fixedHeaders(token),body:prior.extendedData.body}}});
 const after=(await request("GET",p)).jobDetails,verified=validateJob(PILOT,after);
 if(!verified.enabled||Object.entries(after.extendedData.headers).find(([k])=>k.toLowerCase()==="authorization")?.[1]!==fixedHeaders(token).Authorization)HOLD("PILOT_REKEY_READBACK");
 await stable();
 return {status:"PILOT_REKEY_VERIFIED_NOT_SLOT_PROOF",jobId:PILOT.jobId,expiryUnchanged:PILOT.until,readbackUtc:iso(Date.now()),cronMutations:1,...zero};
}
function requestWith(key,pair=false){
 if(typeof key!=="string"||key.length<16)HOLD("ACCOUNT_KEY_REQUIRED");
 let reads=0,writes=0;
 return async(method,path,body)=>{
  if(!["GET","PUT","PATCH"].includes(method)||!/^\/jobs(?:\/[1-9][0-9]{0,14})?$/.test(path)||
     (method==="GET"?++reads>(pair?8:6):++writes>(pair?2:1)))HOLD("API_BOUND");
  const r=await fetch(ROOT+path,{method,headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)HOLD("HTTP_"+r.status+"_INSPECT_NO_REPLAY");
  const x=await r.json();await new Promise(r=>setTimeout(r,250));return x;
 };
}
async function main(){
 const e=process.env,local=process.argv[2]==="--owner-rekey-pilot";
 if(e.DATABASE_URL||e.RAPIDAPI_KEY||e.AERODATABOX_API_KEY||e.TRAVNR_TARGET_ACTIONS_TOKEN||e.NODE_TLS_REJECT_UNAUTHORIZED==="0")HOLD("FORBIDDEN_CREDENTIAL_SCOPE");
 const pair=!local&&e.TRAVNR_MANAGED_OP==="CREATE_DISABLED_PAIR";
 const request=requestWith(e.TRAVNR_CRON_ACCOUNT_KEY,pair),token=e.TRAVNR_CRON_RELAY_TOKEN,emit=x=>console.log(JSON.stringify(x));
 const main=async()=>{
  if(local){try{return JSON.parse(execFileSync("gh",["api","--hostname","github.com","--method","GET","repos/"+REPO+"/git/ref/heads/main"],{env:{PATH:e.PATH,HOME:e.HOME,GH_PROMPT_DISABLED:"1",...(e.GH_CONFIG_DIR?{GH_CONFIG_DIR:e.GH_CONFIG_DIR}:{}),...(e.GH_TOKEN?{GH_TOKEN:e.GH_TOKEN}:{})},encoding:"utf8",timeout:15000,maxBuffer:32768,stdio:["ignore","pipe","ignore"]})).object?.sha}catch{HOLD("LOCAL_GITHUB_READ")}}
  const auth=e.GITHUB_TOKEN;
  const r=await fetch("https://api.github.com/repos/"+REPO+"/git/ref/heads/main",{method:"GET",headers:{Accept:"application/vnd.github+json",...(auth?{Authorization:"Bearer "+auth}:{})},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!r.ok)HOLD("RELAY_MAIN_READ");return (await r.json()).object?.sha;
 };
 if(local){
  if(e.GITHUB_ACTIONS==="true")HOLD("OWNER_LOCAL_ONLY");
  const journal=e.TRAVNR_PILOT_REKEY_JOURNAL;
  if(!journal||!isAbsolute(journal))HOLD("PRIVATE_JOURNAL_REQUIRED");
  const dir=lstatSync(dirname(journal));
  if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==process.getuid()||(dir.mode&0o077)!==0)HOLD("PRIVATE_JOURNAL_DIRECTORY");
  const exists=existsSync(journal);
  if(exists){const j=lstatSync(journal);if(!j.isFile()||j.isSymbolicLink()||j.uid!==process.getuid()||(j.mode&0o077)!==0||j.size>16384)HOLD("PRIVATE_JOURNAL_FILE");}
  const journalEmit=x=>{
   const fd=openSync(journal,"wx",0o600);
   try{writeFileSync(fd,JSON.stringify(x)+"\n");fsyncSync(fd);}finally{closeSync(fd);}
   emit(x);
  };
  const out=await rekeyPilot({token,now:Date.now(),allowWrite:!exists},{request,main,emit:journalEmit});
  if(existsSync(journal)){const fd=openSync(journal,"a",0o600);try{writeFileSync(fd,JSON.stringify(out)+"\n");fsyncSync(fd);}finally{closeSync(fd);}}
  console.log(JSON.stringify(out));return;
 }
 if(e.GITHUB_ACTIONS!=="true"||e.GITHUB_REPOSITORY!==REPO||e.GITHUB_REF!=="refs/heads/main"||e.GITHUB_EVENT_NAME!=="workflow_dispatch"||
    e.GITHUB_RUN_ATTEMPT!=="1"||e.GITHUB_SHA!==e.TRAVNR_APPROVED_RELAY_MAIN_SHA||e.TRAVNR_CRON_MANAGEMENT_ENV_READY!=="1")HOLD("EXACT_MAIN_MANUAL_ONLY");
 const jobId=e.TRAVNR_MANAGED_JOB_ID?Number(e.TRAVNR_MANAGED_JOB_ID):null;
 if(pair&&e.TRAVNR_MANAGED_LANE!=="RECOVERY_PAIR")HOLD("PAIR_LANE");
 const cfg={op:e.TRAVNR_MANAGED_OP,lane:e.TRAVNR_MANAGED_LANE,until:e.TRAVNR_MANAGED_UNTIL_UTC,priorUntil:e.TRAVNR_MANAGED_PRIOR_UNTIL_UTC,token,now:Date.now(),jobId,
  confirm:e.TRAVNR_MANAGED_CONFIRM,pin:e.GITHUB_SHA,env:e};
 const out=await (pair?createDisabledPair:cfg.op==="RENEW_EXACT_LEASE"?renewExactLease:manage)(cfg,{request,main,emit});
 console.log(JSON.stringify(out));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^HOLD_CRON_(ADMIN|MANAGER)_[A-Z0-9_]+$/.test(e?.message||"")?e.message:"HOLD_CRON_ADMIN_REDACTED_INSPECT_NO_REPLAY");process.exitCode=2});
