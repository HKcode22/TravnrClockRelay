import test from "node:test";
import assert from "node:assert/strict";
import {diagnose,verdict} from "./cron-auth-diagnostic.mjs";
import {managedSpec} from "./cron-admin.mjs";
const pin="a".repeat(40),old="ed35a5467dda0afc75eda386ad43ee4f401b23c4",now=Date.parse("2026-11-18T11:07:00Z"),until="2026-12-19T08:00:00.000Z";
const key="accountSecret"+"x".repeat(40),own="ghs_"+"y".repeat(40),stored="github_pat_"+"z".repeat(40);
const env={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"HKcode22/TravnrClockRelay",GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"push",GITHUB_RUN_ATTEMPT:"1",GITHUB_SHA:pin,TRAVNR_AUTH_DIAG_PREVIOUS_SHA:old,TRAVNR_RELAY_MODE:"CLOCK_ONLY",TRAVNR_CRON_ACCOUNT_KEY:key,GITHUB_TOKEN:own};
function fixture(fault=""){
 const calls=[],ids=[8890475,8890476],lanes=["PRIMARY_BACKSTOP","ROLLING_ROOT"];
 const response=(x,status=200)=>({status,ok:status===200,json:async()=>x});
 const fetcher=async(url,init)=>{
  calls.push({url,method:init.method});assert.equal(init.method,"GET");assert.equal(init.redirect,"error");
  const auth=init.headers.Authorization;
  if(url.startsWith("https://api.cron-job.org/")){
   assert.equal(auth,"Bearer "+key);
   const id=Number(url.split("/").at(-1)),i=ids.indexOf(id);assert(i>=0);
   const t=fault==="different"&&i===1?"github_pat_"+"w".repeat(40):stored;
   return response({jobDetails:{jobId:id,...managedSpec({lane:lanes[i],until,token:t,now}),enabled:true}});
  }
  if(url.endsWith("/git/ref/heads/main")){assert.equal(auth,"Bearer "+own);return response({object:{sha:fault==="drift"?old:pin}});}
  if(url.endsWith("/actions/runs/44281886719")){assert.equal(auth,"Bearer "+own);return response({id:44281886719,head_sha:old,status:"completed",conclusion:fault==="auditSuccess"?"success":"failure",run_attempt:1,path:".github/workflows/cron-admin.yml"});}
  if(url.endsWith("/actions/runs/44281886719/jobs?filter=latest&per_page=100")){assert.equal(auth,"Bearer "+own);return response({total_count:3,jobs:[{id:134724802849,name:"audit-actual-shadow-pair",status:"completed",conclusion:"failure"},{id:1},{id:2}]});}
  if(url==="https://api.github.com/user"||url.endsWith("/actions/workflows/external-clock.yml")){
   assert(/^Bearer github_pat_/.test(auth));return {status:fault==="valid"?200:401,ok:fault==="valid",json:async()=>{throw Error("never consume probe body")}};
  }
  throw Error("unexpected URL");
 };
 return {calls,fetcher};
}
test("both actual stored credentials rejected, ten GETs only; no credentials in receipt",async()=>{
 const f=fixture(),a=await diagnose(env,f);assert.equal(a.sameStoredAuthorization,true);assert.equal(a.readCount,10);assert(a.rows.every(x=>x.diagnosis==="STORED_CREDENTIAL_REJECTED_BY_GITHUB"));
 assert(a.rows.every(x=>x.githubUserHttpStatus===401&&x.githubWorkflowHttpStatus===401));assert.equal(a.cronWrites,0);assert.equal(a.targetDispatches,0);assert(!JSON.stringify(a).includes(stored));assert(!JSON.stringify(a).includes(key));assert(f.calls.every(x=>x.method==="GET"));
});
test("direct read-valid token is not write proof, differing authorizations flagged",async()=>{
 const a=await diagnose(env,fixture("valid"));assert(a.rows.every(x=>x.diagnosis==="STORED_CREDENTIAL_READ_VALID_CRON_TRANSMISSION_OR_WRITE_SCOPE_REVIEW"));
 const b=await diagnose(env,fixture("different"));assert.equal(b.sameStoredAuthorization,false);
});
test("bad scope, main drift or nonfailed audit cannot reach Cron credential",async()=>{
 for(const patch of [{TRAVNR_RELAY_MODE:"MULTI_LANE"},{TRAVNR_TARGET_ACTIONS_TOKEN:"x"},{GITHUB_RUN_ATTEMPT:"2"}]){const f=fixture();await assert.rejects(diagnose({...env,...patch},f),/SCOPE/);assert.equal(f.calls.length,0)}
 for(const fault of ["drift","auditSuccess"]){const f=fixture(fault);await assert.rejects(diagnose(env,f));assert(!f.calls.some(x=>x.url.startsWith("https://api.cron-job.org")));}
});
test("status classification does not infer write authority",()=>{
 assert.equal(verdict(200,404),"ACCESS_OR_RATE_LIMIT_REVIEW");assert.equal(verdict(200,401),"AUTH_RESPONSE_INCONSISTENT_REVIEW");assert.equal(verdict(500,500),"AUTH_PROBE_UNRESOLVED");
});
