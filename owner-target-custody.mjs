/** Owner-only target custody (separate from Cron credentials).
 * This configures main-only GitHub environments and stores one target token,
 * but does not enable forwarding, modify production, or schedule work. */
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {ownerGhEnv,ghFailure} from "./owner-cron-custody.mjs";
import {RELAY,TARGET,PILOT} from "./relay.mjs";
const TARGET_SHA="45d04392e2eecfc1220230f252d2ada8cc6137e0",PILOT_BLOB="c1356a0aa278745708b5bb9d20e1cdc0bc2bdf2a";
const REHEARSE="travnr-target-rehearsal",FORWARD="travnr-target-forward",SECRET="TRAVNR_TARGET_ACTIONS_TOKEN";
const HOLD=s=>{throw Error("HOLD_TARGET_CUSTODY_"+s)};
const sha=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x);
const id=x=>Number.isSafeInteger(x)&&x>0;
const branchPolicy={protected_branches:false,custom_branch_policies:true};
const blank=e=>e?.deployment_branch_policy===null&&e.can_admins_bypass===true&&Array.isArray(e.protection_rules)&&e.protection_rules.length===0;
export function validEnvironment(e,name,owner,reviewer){
 const rs=e?.protection_rules;
 if(e?.name!==name||e.can_admins_bypass!==false||e.deployment_branch_policy?.protected_branches!==false||e.deployment_branch_policy?.custom_branch_policies!==true||
    !Array.isArray(rs)||rs.some(x=>!["branch_policy","required_reviewers"].includes(x.type)))return false;
 const review=rs.filter(x=>x.type==="required_reviewers");
 return reviewer?review.length===1&&review[0].prevent_self_review===false&&review[0].reviewers?.length===1&&review[0].reviewers[0].type==="User"&&review[0].reviewers[0].reviewer?.id===owner:review.length===0;
}
function checkStop(v){
 if(!Number.isSafeInteger(v?.total_count)||v.total_count>100||v.variables?.length!==v.total_count)HOLD("RELAY_VARIABLE_LIST");
 const m=new Map(v.variables.map(x=>[x.name,x.value]));
 if(m.size!==v.total_count||!["CLOCK_ONLY","",undefined].includes(m.get("TRAVNR_RELAY_MODE"))||
    ["TRAVNR_RELAY_PRIMARY_ENABLED","TRAVNR_RELAY_ROLLING_ENABLED","TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED"].some(k=>m.get(k)==="1"))HOLD("FORWARDING_NOT_STOPPED");
}
export async function setupTarget({token,relayPin},{api,readTarget,secretNames,setSecret,setVar,getVar,emit=()=>{}}){
 if(!/^github_pat_[A-Za-z0-9_]{25,}$/.test(token??"")||!sha(relayPin))HOLD("OWNER_INPUT");
 const root="/repos/"+RELAY,stable=async()=>{
  if((await api("GET",root+"/git/ref/heads/main"))?.object?.sha!==relayPin)HOLD("RELAY_PIN_DRIFT");
  checkStop(await api("GET",root+"/actions/variables?per_page=100"));
 };
 const actor=await api("GET","/user");if(actor?.login!=="HKcode22"||!id(actor.id))HOLD("OWNER_IDENTITY");
 await stable();
 // Read using the target PAT itself, not the broader local gh authentication.
 if((await readTarget("/git/ref/heads/main",token))?.object?.sha!==TARGET_SHA||
    (await readTarget("/contents/.github/workflows/"+PILOT+"?ref="+TARGET_SHA,token))?.sha!==PILOT_BLOB)HOLD("TARGET_PIN_OR_WORKFLOW");
 const test=await readTarget("/actions/runs?per_page=1",token);
 if(!Number.isSafeInteger(test?.total_count)||test.total_count<1||test.workflow_runs?.length!==1)HOLD("TARGET_ACTIONS_READ");
 const list=await api("GET",root+"/environments?per_page=100");
 if(!Number.isSafeInteger(list?.total_count)||list.total_count>100||list.environments?.length!==list.total_count)HOLD("ENVIRONMENT_LIST");
 for(const [name,reviewer] of [[REHEARSE,true],[FORWARD,false]]){
  const ep=root+"/environments/"+name;
  const found=list.environments.filter(x=>x.name===name);
  if(found.length>1)HOLD("ENVIRONMENT_DUPLICATE");
  let e=found.length?await api("GET",ep):null,names=e?await secretNames(name):[];
  if(!Array.isArray(names)||new Set(names).size!==names.length||names.some(k=>k!==SECRET))HOLD("UNRELATED_ENVIRONMENT_SECRET");
  if(!e||blank(e)&&names.length===0){
   await stable();emit({stage:"TARGET_ENVIRONMENT_CONFIGURE_ATTEMPT",name});
   await api("PUT",ep,{wait_timer:0,prevent_self_review:false,can_admins_bypass:false,
    reviewers:reviewer?[{type:"User",id:actor.id}]:[],deployment_branch_policy:branchPolicy});
   e=await api("GET",ep);
  }
  if(!validEnvironment(e,name,actor.id,reviewer))HOLD("ENVIRONMENT_PROTECTION_MISMATCH");
  const read=()=>api("GET",ep+"/deployment-branch-policies?per_page=100");
  let p=await read();
  if(!Number.isSafeInteger(p?.total_count)||p.total_count>100||p.branch_policies?.length!==p.total_count)HOLD("BRANCH_POLICY_LIST");
  if(p.total_count===0){
   if(names.length)HOLD("PROTECT_BEFORE_SECRET");
   emit({stage:"TARGET_MAIN_ONLY_BRANCH_POLICY_ATTEMPT",name});
   await api("POST",ep+"/deployment-branch-policies",{name:"main",type:"branch"});p=await read();
  }
  if(p.total_count!==1||p.branch_policies[0]?.name!=="main"||
     (p.branch_policies[0]?.type!==undefined&&p.branch_policies[0]?.type!=="branch"))HOLD("BRANCH_POLICY_NOT_MAIN_ONLY");
  await stable();
  await setSecret(name,SECRET,token);names=await secretNames(name);
  if(names.length!==1||names[0]!==SECRET)HOLD("SECRET_NAME_READBACK");
  const gate=reviewer?"TRAVNR_TARGET_REHEARSAL_ENV_READY":"TRAVNR_TARGET_FORWARD_ENV_READY";
  await setVar(name,gate,"1");if(await getVar(name,gate)!=="1")HOLD("ENV_READY_READBACK");
  emit({stage:"TARGET_ENVIRONMENT_SECRET_NAME_AND_POLICY_VERIFIED",name,mainOnly:true,ownerReviewer:reviewer});
 }
 await stable();
 if((await readTarget("/git/ref/heads/main",token))?.object?.sha!==TARGET_SHA)HOLD("TARGET_PIN_DRIFT");
 return {status:"TARGET_CUSTODY_VERIFIED_READ_SCOPE_AND_SECRET_NAMES_NOT_WRITE_PROOF",relayPin,targetPin:TARGET_SHA,
  rehearsalEnvironment:REHEARSE,forwardEnvironment:FORWARD,forwardingEnabled:false,providerCalls:0,productionDbWrites:0,targetDispatches:0,cronWrites:0};
}
async function main(){
 const e=process.env;
 if(e.GITHUB_ACTIONS==="true"||e.NODE_TLS_REJECT_UNAUTHORIZED==="0")HOLD("OWNER_LOCAL_ONLY");
 const env=ownerGhEnv(e);
 const run=(label,args,input)=>{
  try{return execFileSync("gh",args,{env,input,encoding:"utf8",timeout:30000,maxBuffer:1048576,stdio:[input===undefined?"ignore":"pipe","pipe","pipe"]}).trim();}
  catch(err){console.error(JSON.stringify({status:"TARGET_OWNER_GITHUB_OPERATION_HOLD",operation:label,reason:ghFailure(err),rawErrorRedacted:true}));HOLD("GITHUB_OPERATION_INSPECT");}
 };
 const api=async(method,p,body)=>JSON.parse(run(method+"_GITHUB_API",["api","--hostname","github.com","--method",method,"-H","X-GitHub-Api-Version:2022-11-28",p.replace(/^\//,""),...(body?["--input","-"]:[])],body?JSON.stringify(body):undefined));
 const readTarget=async(path,token)=>{
  if(!["/git/ref/heads/main","/contents/.github/workflows/"+PILOT+"?ref="+TARGET_SHA,"/actions/runs?per_page=1"].includes(path))HOLD("TARGET_SCOPE");
  const r=await fetch("https://api.github.com/repos/"+TARGET+path,{method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!r.ok)HOLD("TARGET_READ_HTTP_"+r.status);return r.json();
 };
 const secretNames=async n=>JSON.parse(run("LIST_SECRET_NAMES",["secret","list","-R",RELAY,"--env",n,"--json","name"])).map(x=>x.name);
 const setSecret=async(n,k,v)=>{run("SET_ENV_SECRET",["secret","set",k,"-R",RELAY,"--env",n],v)};
 const setVar=async(n,k,v)=>{run("SET_ENV_VARIABLE",["variable","set",k,"-R",RELAY,"--env",n,"--body",v])};
 const getVar=async(n,k)=>run("GET_ENV_VARIABLE",["variable","get",k,"-R",RELAY,"--env",n]);
 console.log(JSON.stringify(await setupTarget({token:e[SECRET],relayPin:e.TRAVNR_OWNER_APPROVED_RELAY_SHA},{api,readTarget,secretNames,setSecret,setVar,getVar,emit:x=>console.log(JSON.stringify(x))})));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^HOLD_TARGET_CUSTODY_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_TARGET_CUSTODY_REDACTED");process.exitCode=2;});
