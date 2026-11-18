/** Owner-local exact existing pair credential repair after real HTTP401.
 * No new jobs, no production writes, no collection dispatch. The replacement
 * PAT must complete a real CLOCK_ONLY pulse before either old job is patched.
 * Journal fsync before every POST/PATCH; never repeat an ambiguous mutation. */
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {resolve,dirname,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {lstatSync,existsSync,openSync,writeFileSync,fsyncSync,closeSync} from "node:fs";
import {managedSpec,exactManaged,ACTUAL_PAIR} from "./cron-admin.mjs";
import {ownerGhEnv,ghFailure} from "./owner-cron-custody.mjs";
const REPO="HKcode22/TravnrClockRelay",ROOT="https://api.github.com/repos/"+REPO,CRON="https://api.cron-job.org";
const WF="external-clock.yml",UNTIL="2026-12-19T08:00:00.000Z",DIAG=44291773964;
const hold=s=>{throw Error("HOLD_CRON_PAIR_REPAIR_"+s)},id=n=>Number.isSafeInteger(n)&&n>0,sha=s=>typeof s==="string"&&/^[a-f0-9]{40}$/.test(s),iso=n=>new Date(n).toISOString();
const tokenOK=s=>typeof s==="string"&&/^github_pat_[A-Za-z0-9_]{25,}$/.test(s);
const active=["queued","in_progress","waiting","requested","pending"];
const zero={providerCalls:0,databaseWrites:0,targetDispatches:0,paidAuthorityGranted:false};
const auth=j=>Object.entries(j.extendedData.headers).find(([k])=>k.toLowerCase()==="authorization")?.[1];
export async function repairPair({token,pin,now,confirm},{cron,ownerGet,github,storeToken,journal,emit=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=Date.now}){
 if(confirm!=="REKEY_EXISTING_SHADOW_PAIR_NO_FORWARD"||!tokenOK(token)||!sha(pin)||!Number.isSafeInteger(now)||typeof journal!=="function")hold("SCOPE");
 const stable=async()=>{
  if((await ownerGet("/git/ref/heads/main")).object?.sha!==pin)hold("RELAY_MAIN_DRIFT");
  const v=await ownerGet("/actions/variables?per_page=100");
  if(!Number.isSafeInteger(v?.total_count)||v.total_count>100||v.variables?.length!==v.total_count)hold("VARIABLE_LIST");
  const m=new Map(v.variables.map(x=>[x.name,x.value]));
  if(m.size!==v.total_count||m.get("TRAVNR_RELAY_MODE")!=="CLOCK_ONLY"||
     ["TRAVNR_RELAY_PRIMARY_ENABLED","TRAVNR_RELAY_ROLLING_ENABLED","TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED"].some(k=>m.get(k)==="1"))hold("FORWARDING_NOT_STOPPED");
 };
 await stable();
 const d=await ownerGet("/actions/runs/"+DIAG);
 if(d.id!==DIAG||d.status!=="completed"||d.conclusion!=="success"||d.run_attempt!==1||
    d.head_sha!=="7b2a34dda6274d8f89fc903d72003c05dbdffde9"||d.path!==".github/workflows/cron-auth-diagnostic.yml")hold("DIAGNOSIS_IDENTITY");
 const specs=ACTUAL_PAIR.map(v=>managedSpec({lane:v.lane,until:UNTIL,token,now}));
 const list=await cron("GET","/jobs");if(list?.someFailed!==false||!Array.isArray(list.jobs)||list.jobs.length>100)hold("CRON_LIST");
 const prior=[];
 for(let i=0;i<ACTUAL_PAIR.length;i++){
  const v=ACTUAL_PAIR[i],s=specs[i];
  const matched=list.jobs.filter(j=>j.title===s.title);
  if(matched.length!==1||matched[0].jobId!==v.jobId)hold("EXACT_JOB");
  const j=(await cron("GET","/jobs/"+v.jobId)).jobDetails;
  if(j?.enabled!==true)hold("JOB_DISABLED_INSPECT_NO_AUTO_REENABLE");
  exactManaged(j,s,v.jobId,true,{requireToken:false});
  const old=auth(j);if(old==="Bearer "+token)hold("REPLACEMENT_EQUALS_STORED");
  prior.push(old);
 }
 if(prior[0]!==prior[1])hold("PARTIAL_PRIOR_REPAIR_INSPECT");
 // Confirm old shared token is still rejected, and new token can read.
 const old=await github("GET","/user",prior[0]);
 if(old.status!==401)hold("OLD_TOKEN_NOT_REJECTED_REVIEW");
 const u=await github("GET","/user","Bearer "+token);
 if(u.status!==200||u.data?.login!=="HKcode22")hold("NEW_TOKEN_USER_HTTP_"+u.status);
 const w=await github("GET","/actions/workflows/"+WF,"Bearer "+token);
 if(w.status!==200||w.data?.state!=="active"||w.data?.path!==".github/workflows/"+WF)hold("NEW_TOKEN_WORKFLOW_HTTP_"+w.status);
 for(const state of active){
  const v=await ownerGet("/actions/workflows/"+WF+"/runs?branch=main&status="+state+"&per_page=100");
  if(v.total_count!==0||v.workflow_runs?.length!==0)hold("ACTIVE_RELAY_RUN");
 }
 await stable();
 const started=clock();journal({status:"REPLACEMENT_TOKEN_CLOCK_ONLY_PROBE_ATTEMPT_NO_REPLAY",atUtc:iso(started),relayPin:pin});
 const p=await github("POST","/actions/workflows/"+WF+"/dispatches","Bearer "+token,{ref:"main",return_run_details:true,inputs:{lane:"CLOCK_ONLY"}});
 const n=p.data?.workflow_run_id;
 if(p.status!==200||!id(n)||p.data.run_url!==ROOT+"/actions/runs/"+n||p.data.html_url!=="https://github.com/"+REPO+"/actions/runs/"+n)hold("TOKEN_PROBE_ACK_HTTP_"+p.status+"_NO_REPLAY");
 journal({status:"REPLACEMENT_TOKEN_CLOCK_ONLY_PROBE_ACK",runId:n});emit({status:"REPLACEMENT_TOKEN_CLOCK_ONLY_PROBE_ACK",runId:n});
 let r;
 for(let k=0;k<30;k++){
  r=await ownerGet("/actions/runs/"+n);
  if(r.id!==n||r.head_sha!==pin||r.head_branch!=="main"||r.event!=="workflow_dispatch"||r.run_attempt!==1||
     r.path!==".github/workflows/"+WF||Date.parse(r.created_at)<started-5000)hold("TOKEN_PROBE_IDENTITY");
  if(r.status==="completed")break;await sleep(3000);
 }
 if(r?.status!=="completed"||r.conclusion!=="success"||r.display_title!=="TRAVNR EXTERNAL CLOCK CLOCK_ONLY")hold("TOKEN_PROBE_NOT_SUCCESS");
 const jobs=await ownerGet("/actions/runs/"+n+"/jobs?filter=latest&per_page=100");
 if(jobs.total_count!==3||jobs.jobs?.length!==3||new Set(jobs.jobs.map(j=>j.name)).size!==3||
    !jobs.jobs.every(j=>id(j.id)&&j.run_id===n&&j.head_sha===pin&&j.run_attempt===1&&j.status==="completed"))hold("TOKEN_PROBE_JOBS");
 const js=new Map(jobs.jobs.map(j=>[j.name,j]));
 if(!["offline-tests","target-forward"].every(k=>js.get(k)?.conclusion==="skipped"&&(js.get(k).steps==null||js.get(k).steps.length===0))||
    js.get("independent-pulse")?.conclusion!=="success"||js.get("independent-pulse").steps?.filter(s=>s.name==="Run node cli.mjs"&&s.conclusion==="success"&&s.status==="completed").length!==1)hold("TOKEN_PROBE_STEP");
 const probeJobId=js.get("independent-pulse").id;
 emit({status:"REPLACEMENT_TOKEN_REAL_CLOCK_ONLY_PROBE_VERIFIED",runId:n,jobId:probeJobId});
 await stable();
 const receipts=[];
 for(let i=0;i<ACTUAL_PAIR.length;i++){
  const v=ACTUAL_PAIR[i],s=specs[i],path="/jobs/"+v.jobId;
  const j=(await cron("GET",path)).jobDetails;
  exactManaged(j,s,v.jobId,true,{requireToken:false});
  if(auth(j)!==prior[i])hold("PRIOR_AUTHORIZATION_DRIFT");
  const attemptUtc=iso(clock()),record={status:"CRON_PAIR_ONE_AUTH_PATCH_ATTEMPT_NO_REPLAY",...v,attemptUtc,relayPin:pin};
  journal(record);emit(record);
  await cron("PATCH",path,{job:{extendedData:s.extendedData}});
  const after=(await cron("GET",path)).jobDetails;exactManaged(after,s,v.jobId,true);
  const readbackUtc=iso(clock());if(Date.parse(readbackUtc)-Date.parse(attemptUtc)>60000)hold("PATCH_BOUNDARY");
  const a={...v,attemptUtc,readbackUtc};receipts.push(a);journal({status:"CRON_PAIR_ONE_AUTH_PATCH_VERIFIED",...a});emit({status:"CRON_PAIR_ONE_AUTH_PATCH_VERIFIED",...a});
 }
 await stable();
 // Update existing management secret only after verified Cron header repair.
 // CLI encrypted stdin custody; never place token in argument list.
 await storeToken(token);
 const out={status:"EXACT_EXISTING_PAIR_AUTH_REPAIRED_NO_FORWARD",relayPin:pin,until:UNTIL,jobs:receipts,probeRunId:n,probeJobId,cronMutations:2,...zero};
 journal(out);return out;
}
async function main(){
 const e=process.env,token=e.TRAVNR_CRON_RELAY_TOKEN,key=e.TRAVNR_CRON_ACCOUNT_KEY,pin=e.TRAVNR_OWNER_APPROVED_RELAY_SHA,path=e.TRAVNR_PAIR_REPAIR_JOURNAL;
 if(e.GITHUB_ACTIONS==="true"||e.NODE_TLS_REJECT_UNAUTHORIZED==="0"||
    [e.DATABASE_URL,e.RAPIDAPI_KEY,e.AERODATABOX_API_KEY,e.TRAVNR_TARGET_ACTIONS_TOKEN].some(Boolean)||typeof key!=="string"||key.length<16||!isAbsolute(path??""))hold("OWNER_LOCAL_SCOPE");
 const dir=lstatSync(dirname(path));if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==process.getuid()||(dir.mode&0o077)!==0)hold("JOURNAL_DIR");
 if(existsSync(path))hold("PRIOR_ATTEMPT_INSPECT_NO_REPLAY");
 const ghEnv=ownerGhEnv(e),run=(label,args,input)=>{
  try{return execFileSync("gh",args,{env:ghEnv,input,encoding:"utf8",timeout:30000,maxBuffer:1048576,stdio:[input===undefined?"ignore":"pipe","pipe","pipe"]}).trim();}
  catch(err){console.error(JSON.stringify({status:"REPAIR_OWNER_GITHUB_HOLD",operation:label,reason:ghFailure(err),rawErrorRedacted:true}));hold("OWNER_GITHUB_INSPECT");}
 };
 if(JSON.parse(run("OWNER",["api","user"])).login!=="HKcode22")hold("OWNER_IDENTITY");
 const ownerGet=async p=>JSON.parse(run("OWNER_READ",["api","--hostname","github.com","--method","GET","repos/"+REPO+p]));
 let cr=0,cw=0;
 const cron=async(method,p,body)=>{
  if(!["GET","PATCH"].includes(method)||!/^\/jobs(?:\/889047[56])?$/.test(p)||(method==="GET"?++cr>7:++cw>2))hold("CRON_BOUND");
  const a=await fetch(CRON+p,{method,headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});
  if(!a.ok)hold("CRON_HTTP_"+a.status+"_INSPECT_NO_REPLAY");const x=await a.json();await new Promise(r=>setTimeout(r,250));return x;
 };
 const github=async(method,p,authorization,body)=>{
  if(!["GET","POST"].includes(method)||!["/user","/actions/workflows/"+WF,"/actions/workflows/"+WF+"/dispatches"].includes(p))hold("GITHUB_SCOPE");
  const url=p==="/user"?"https://api.github.com/user":ROOT+p;
  const a=await fetch(url,{method,headers:{Authorization:authorization,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",...(body?{"Content-Type":"application/json"}:{})},redirect:"error",signal:AbortSignal.timeout(10000),...(body?{body:JSON.stringify(body)}:{})});
  return {status:a.status,data:a.ok?await a.json():null};
 };
 let first=true;
 const journal=x=>{const fd=openSync(path,first?"wx":"a",0o600);first=false;try{writeFileSync(fd,JSON.stringify(x)+"\n");fsyncSync(fd)}finally{closeSync(fd)}};
 const storeToken=async t=>{
  const env="travnr-cron-management",p="/environments/"+env,e=await ownerGet(p),rules=e.protection_rules??[];
  if(e.name!==env||e.can_admins_bypass!==false||e.deployment_branch_policy?.custom_branch_policies!==true||rules.filter(x=>x.type==="required_reviewers").length!==1)hold("MANAGEMENT_ENV_PROTECTION");
  const b=await ownerGet(p+"/deployment-branch-policies?per_page=100");
  if(b.total_count!==1||b.branch_policies?.[0]?.name!=="main")hold("MANAGEMENT_MAIN_ONLY");
  const names=()=>JSON.parse(run("SECRET_NAMES",["secret","list","-R",REPO,"--env",env,"--json","name"])).map(x=>x.name).sort().join("|");
  if(names()!=="TRAVNR_CRON_ACCOUNT_KEY|TRAVNR_CRON_RELAY_TOKEN")hold("MANAGEMENT_NAMES");
  run("SECRET_ROTATE",["secret","set","TRAVNR_CRON_RELAY_TOKEN","-R",REPO,"--env",env],t);
  if(names()!=="TRAVNR_CRON_ACCOUNT_KEY|TRAVNR_CRON_RELAY_TOKEN")hold("MANAGEMENT_READBACK_NAMES");
 };
 console.log(JSON.stringify(await repairPair({token,pin,now:Date.now(),confirm:e.TRAVNR_PAIR_REPAIR_CONFIRM},{cron,ownerGet,github,storeToken,journal,emit:x=>console.log(JSON.stringify(x))})));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^HOLD_CRON_(PAIR_REPAIR|ADMIN|MANAGER)_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_CRON_PAIR_REPAIR_REDACTED_INSPECT_NO_REPLAY");process.exitCode=2});
