/** One-time owner-local secret custody. No plaintext secret is logged or
 * written to disk; GitHub CLI encrypts values from stdin. No provider/DB. */
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
const REPO="HKcode22/TravnrClockRelay",PIN="9cca29330405774520e0c7929f4916e24d9934e4",
 AUDIT="travnr-cron-audit",ADMIN="travnr-cron-management",KEY="TRAVNR_CRON_ACCOUNT_KEY",PAT="TRAVNR_CRON_RELAY_TOKEN";
const hold=s=>{throw Error("HOLD_OWNER_CRON_CUSTODY_"+s)};
const id=x=>Number.isSafeInteger(x)&&x>0;
const policy={protected_branches:false,custom_branch_policies:true};
function exactEnvironment(e,name,owner,reviewer){
 const rules=e?.protection_rules,rs=rules?.filter(x=>x.type==="required_reviewers")??[];
 return e?.name===name&&e.can_admins_bypass===false&&e.deployment_branch_policy?.protected_branches===false&&
  e.deployment_branch_policy?.custom_branch_policies===true&&Array.isArray(rules)&&
  rules.every(x=>["required_reviewers","branch_policy"].includes(x.type))&&
  (reviewer?rs.length===1&&rs[0].prevent_self_review===false&&rs[0].reviewers?.length===1&&rs[0].reviewers[0].type==="User"&&rs[0].reviewers[0].reviewer?.id===owner:rs.length===0);
}
const blank=e=>e?.deployment_branch_policy===null&&e.can_admins_bypass===true&&Array.isArray(e.protection_rules)&&e.protection_rules.length===0;
export async function setupCustody({key,token},{api,secretNames,setSecret,setVar,getVar,emit=()=>{}}){
 if(typeof key!=="string"||key.length<16||typeof token!=="string"||!/^github_pat_[A-Za-z0-9_]{25,}$/.test(token))hold("SECRET_FORMAT");
 const root="/repos/"+REPO,stable=async()=>{if((await api("GET",root+"/git/ref/heads/main"))?.object?.sha!==PIN)hold("PILOT_RELAY_PIN_DRIFT")};
 const actor=await api("GET","/user");
 if(actor?.login!=="HKcode22"||!id(actor.id))hold("OWNER_IDENTITY");
 await stable();
 const v=await api("GET",root+"/actions/variables?per_page=100");
 if(!Number.isSafeInteger(v?.total_count)||v.total_count>100||v.variables?.length!==v.total_count||
    v.variables.some(x=>x.name==="TRAVNR_CRON_AUDIT_ENABLED"&&x.value==="1"))hold("ROUTINE_AUDIT_NOT_STOPPED");
 const list=await api("GET",root+"/environments?per_page=100");
 if(!Number.isSafeInteger(list?.total_count)||list.total_count>100||list.environments?.length!==list.total_count)hold("ENVIRONMENT_LIST");
 for(const [name,reviewer,allowed] of [[AUDIT,false,[KEY]],[ADMIN,true,[KEY,PAT]]]){
  const ep=root+"/environments/"+name;
  let e=list.environments.find(x=>x.name===name);
  if(e)e=await api("GET",ep);
  let names=e?await secretNames(name):[];
  if(!Array.isArray(names)||new Set(names).size!==names.length||names.some(k=>!allowed.includes(k)))hold("UNRELATED_ENVIRONMENT_SECRETS");
  if(!e||blank(e)&&names.length===0){
   await stable();emit({stage:"ENVIRONMENT_CREATE_OR_EMPTY_CONFIGURE_ATTEMPT",name});
   await api("PUT",ep,{wait_timer:0,prevent_self_review:false,can_admins_bypass:false,
    reviewers:reviewer?[{type:"User",id:actor.id}]:[],deployment_branch_policy:policy});
   e=await api("GET",ep);
  }
  if(!exactEnvironment(e,name,actor.id,reviewer))hold("ENVIRONMENT_PROTECTION_MISMATCH");
  const getPolicies=()=>api("GET",ep+"/deployment-branch-policies?per_page=100");
  let p=await getPolicies();
  if(!Number.isSafeInteger(p?.total_count)||p.total_count>100||p.branch_policies?.length!==p.total_count)hold("BRANCH_POLICY_LIST");
  if(p.total_count===0){
   if(names.length!==0)hold("NO_SECRETS_BEFORE_BRANCH_POLICY");
   emit({stage:"ADD_MAIN_ONLY_BRANCH_POLICY_ATTEMPT",name});
   await api("POST",ep+"/deployment-branch-policies",{name:"main",type:"branch"});p=await getPolicies();
  }
  if(p.total_count!==1||p.branch_policies?.length!==1||p.branch_policies[0].name!=="main"||
    (p.branch_policies[0].type!==undefined&&p.branch_policies[0].type!=="branch"))hold("BRANCH_POLICY_NOT_MAIN_ONLY");
  await stable();
  await setSecret(name,KEY,key);
  if(reviewer)await setSecret(name,PAT,token);
  names=await secretNames(name);
  if(names.length!==allowed.length||allowed.some(k=>names.filter(n=>n===k).length!==1))hold("SECRET_NAMES_READBACK");
  if(reviewer){await setVar(name,"TRAVNR_CRON_MANAGEMENT_ENV_READY","1");if(await getVar(name,"TRAVNR_CRON_MANAGEMENT_ENV_READY")!=="1")hold("MANAGEMENT_READY_READBACK");}
  emit({stage:"ENVIRONMENT_SECRET_NAMES_VERIFIED",name,mainOnly:true,requiredOwnerReviewer:reviewer,secretNames:allowed});
 }
 await stable();
 
 // Initial post-pilot merge can audit without another manual dispatch. This flag
 // never enables target forwarding or recurring cron mutation.
 await setVar(null,"TRAVNR_CRON_PILOT_AUDIT_AFTER_MERGE","1");
 if(await getVar(null,"TRAVNR_CRON_PILOT_AUDIT_AFTER_MERGE")!=="1")hold("PILOT_AUDIT_FLAG_READBACK");
 await stable();
 return {status:"OWNER_CRON_SECRET_CUSTODY_VERIFIED_NAMES_AND_RULES_ONLY",relayMain:PIN,
  auditEnvironment:AUDIT,adminEnvironment:ADMIN,automaticPilotAuditOnReviewedMerge:true,
  routineAuditEnabled:false,targetForwardingEnabledByThisScript:false,providerCalls:0,productionDbWrites:0,cronWrites:0};
}
// Preserve the owner's actual CLI config lookup, not just HOME. Never
// inherit the Cron credentials or production environment in the gh child.
export function ownerGhEnv(e){
 const out={GH_HOST:"github.com",GH_PROMPT_DISABLED:"1"};
 for(const k of ["PATH","HOME","GH_CONFIG_DIR","XDG_CONFIG_HOME","GH_TOKEN","GITHUB_TOKEN"])
  if(typeof e[k]==="string"&&e[k])out[k]=e[k];
 return out;
}
export function ghFailure(e){
 const stderr=typeof e?.stderr==="string"?e.stderr:"";
 const http=stderr.match(/\bHTTP (401|403|404|409|422|429|500|502|503|504)\b/);
 if(http)return "HTTP_"+http[1];
 if(e?.code==="ETIMEDOUT")return "TIMEOUT";
 if(e?.code==="ENOENT")return "CLI_MISSING";
 if(/gh auth login|authentication required|not logged in/i.test(stderr))return "AUTH_REQUIRED";
 return "UNVERIFIED";
}
async function main(){
 const e=process.env;
 if(e.GITHUB_ACTIONS==="true"||e.NODE_TLS_REJECT_UNAUTHORIZED==="0")hold("OWNER_LOCAL_ONLY");
 const env=ownerGhEnv(e);
 function run(label,args,input){
  try{return execFileSync("gh",args,{env,input,encoding:"utf8",timeout:30000,maxBuffer:1048576,stdio:[input===undefined?"ignore":"pipe","pipe","pipe"]}).trim()}
  catch(err){console.error(JSON.stringify({status:"OWNER_GITHUB_OPERATION_HOLD",operation:label,reason:ghFailure(err),rawErrorRedacted:true}));hold("GITHUB_OPERATION_UNVERIFIED_INSPECT")}
 }
 const api=async(method,path,body)=>JSON.parse(run(method+"_"+(path==="/user"?"USER":path.endsWith("/git/ref/heads/main")?"MAIN":path.includes("/actions/variables")?"REPO_VARIABLES":path.includes("/deployment-branch-policies")?"BRANCH_POLICY": "ENVIRONMENT"),["api","--hostname","github.com","--method",method,"-H","X-GitHub-Api-Version:2022-11-28",path.replace(/^\//,""),...(body?["--input","-"]:[])],body?JSON.stringify(body):undefined));
 const secretNames=async n=>JSON.parse(run("LIST_SECRET_NAMES",["secret","list","-R",REPO,"--env",n,"--json","name"])).map(x=>x.name);
 const setSecret=async(n,k,value)=>{run("SET_ENV_SECRET",["secret","set",k,"-R",REPO,"--env",n],value)};
 const setVar=async(n,k,value)=>{run("SET_VARIABLE",["variable","set",k,"-R",REPO,...(n?["--env",n]:[]),"--body",value])};
 const getVar=async(n,k)=>run("GET_VARIABLE",["variable","get",k,"-R",REPO,...(n?["--env",n]:[])]);
 const out=await setupCustody({key:e[KEY],token:e[PAT]},{api,secretNames,setSecret,setVar,getVar,emit:x=>console.log(JSON.stringify(x))});
 console.log(JSON.stringify(out));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^HOLD_OWNER_CRON_CUSTODY_[A-Z_]+$/.test(e?.message||"")?e.message:"HOLD_OWNER_CRON_CUSTODY_REDACTED_INSPECT");process.exitCode=2});
