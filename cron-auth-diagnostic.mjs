/** Read-only diagnosis of actual shadow pair HTTP 401.
 * Never print Authorization, tokens, body, headers, raw upstream errors.
 * Cron GET exact two jobs, then GitHub GET with each stored token;
 * does not create, patch, enable, dispatch or grant paid authority. */
import {timingSafeEqual} from "node:crypto";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateJob,shadowConfigs} from "./cron-audit.mjs";
const REPO="HKcode22/TravnrClockRelay",GH="https://api.github.com",ROOT=GH+"/repos/"+REPO,CRON="https://api.cron-job.org";
const OLD="ed35a5467dda0afc75eda386ad43ee4f401b23c4",AUDIT=44281886719,JOB=134724802849;
const HOLD=s=>{throw Error("HOLD_CRON_AUTH_DIAGNOSTIC_"+s)};
const sha=s=>typeof s==="string"&&/^[a-f0-9]{40}$/.test(s);
const activation={status:"EXACT_EXISTING_PAIR_SHADOW_ENABLED_NO_FORWARD",relayPin:OLD,until:"2026-12-19T08:00:00.000Z",jobs:[{lane:"PRIMARY_BACKSTOP",jobId:8890475,attemptUtc:"2026-11-18T10:05:06.006Z",readbackUtc:"2026-11-18T10:05:06.789Z"},{lane:"ROLLING_ROOT",jobId:8890476,attemptUtc:"2026-11-18T10:05:07.058Z",readbackUtc:"2026-11-18T10:05:07.842Z"}],cronMutations:2,providerCalls:0,databaseWrites:0,targetDispatches:0,paidAuthorityGranted:false};
export function verdict(userStatus,workflowStatus){
 if(userStatus===401&&workflowStatus===401)return "STORED_CREDENTIAL_REJECTED_BY_GITHUB";
 if(userStatus===200&&workflowStatus===200)return "STORED_CREDENTIAL_READ_VALID_CRON_TRANSMISSION_OR_WRITE_SCOPE_REVIEW";
 if(userStatus===401||workflowStatus===401)return "AUTH_RESPONSE_INCONSISTENT_REVIEW";
 if(userStatus===403||workflowStatus===403||workflowStatus===404)return "ACCESS_OR_RATE_LIMIT_REVIEW";
 return "AUTH_PROBE_UNRESOLVED";
}
export async function diagnose(env,{fetcher=fetch}={}){
 if(env.GITHUB_ACTIONS!=="true"||env.GITHUB_REPOSITORY!==REPO||env.GITHUB_REF!=="refs/heads/main"||
   env.GITHUB_EVENT_NAME!=="push"||env.GITHUB_RUN_ATTEMPT!=="1"||env.TRAVNR_AUTH_DIAG_PREVIOUS_SHA!==OLD||
   !sha(env.GITHUB_SHA)||env.TRAVNR_RELAY_MODE!=="CLOCK_ONLY"||
   [env.TRAVNR_RELAY_PRIMARY_ENABLED,env.TRAVNR_RELAY_ROLLING_ENABLED,env.TRAVNR_EXTERNAL_LANE_COMMISSION_APPROVED].some(v=>v==="1")||
   [env.TRAVNR_TARGET_ACTIONS_TOKEN,env.TRAVNR_CRON_RELAY_TOKEN,env.DATABASE_URL,env.RAPIDAPI_KEY,env.AERODATABOX_API_KEY].some(Boolean)||
   typeof env.TRAVNR_CRON_ACCOUNT_KEY!=="string"||env.TRAVNR_CRON_ACCOUNT_KEY.length<16||typeof env.GITHUB_TOKEN!=="string"||env.GITHUB_TOKEN.length<16||
   env.NODE_TLS_REJECT_UNAUTHORIZED==="0")HOLD("SCOPE");
 let reads=0;
 const get=async(url,authorization)=>{
  if(++reads>10||!url.startsWith("https://"))HOLD("READ_BOUND");
  return fetcher(url,{method:"GET",headers:{Authorization:authorization,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},redirect:"error",signal:AbortSignal.timeout(10000)});
 };
 const json=async(url,key)=>{const a=await get(url,key);if(!a.ok)HOLD("READ_HTTP_"+a.status);return a.json()};
 const own="Bearer "+env.GITHUB_TOKEN,cron="Bearer "+env.TRAVNR_CRON_ACCOUNT_KEY;
 const stable=async()=>{if((await json(ROOT+"/git/ref/heads/main",own)).object?.sha!==env.GITHUB_SHA)HOLD("MAIN_DRIFT")};
 await stable();
 const a=await json(ROOT+"/actions/runs/"+AUDIT,own);
 if(a.id!==AUDIT||a.head_sha!==OLD||a.status!=="completed"||a.conclusion!=="failure"||a.run_attempt!==1||a.path!==".github/workflows/cron-admin.yml")HOLD("FAILED_AUDIT_IDENTITY");
 const q=await json(ROOT+"/actions/runs/"+AUDIT+"/jobs?filter=latest&per_page=100",own);
 if(q.total_count!==3||q.jobs?.length!==3||!q.jobs.some(j=>j.id===JOB&&j.name==="audit-actual-shadow-pair"&&j.status==="completed"&&j.conclusion==="failure"))HOLD("FAILED_AUDIT_JOB");
 const configs=shadowConfigs(JSON.stringify(activation),OLD),tokens=[],rows=[];
 for(const c of configs){
  const j=(await json(CRON+"/jobs/"+c.jobId,cron)).jobDetails;
  const v=validateJob(c,j);if(!v.enabled)HOLD("JOB_DISABLED");
  const h=Object.fromEntries(Object.entries(j.extendedData.headers).map(([k,v])=>[k.toLowerCase(),v]));
  const token=h.authorization;
  if(!/^Bearer github_pat_[A-Za-z0-9_]{25,}$/.test(token??""))HOLD("TOKEN_SHAPE");
  tokens.push(token);
  // Only exact fixed GitHub GET URLs. Response bodies are discarded,
  // particularly /user (which may include personal metadata).
  const u=await get(GH+"/user",token),w=await get(ROOT+"/actions/workflows/external-clock.yml",token);
  rows.push({lane:c.lane,jobId:c.jobId,githubUserHttpStatus:u.status,githubWorkflowHttpStatus:w.status,diagnosis:verdict(u.status,w.status)});
 }
 await stable();
 const same=tokens[0].length===tokens[1].length&&timingSafeEqual(Buffer.from(tokens[0]),Buffer.from(tokens[1]));
 return {status:"ACTUAL_STORED_CRON_AUTH_READONLY_DIAGNOSIS",relayPin:env.GITHUB_SHA,rows,sameStoredAuthorization:same,readCount:reads,cronWrites:0,targetDispatches:0,providerCalls:0,databaseWrites:0,paidAuthorityGranted:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await diagnose(process.env)))}
 catch(e){console.error(/^HOLD_CRON_AUTH_DIAGNOSTIC_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_CRON_AUTH_DIAGNOSTIC_REDACTED");process.exitCode=2;}
}
