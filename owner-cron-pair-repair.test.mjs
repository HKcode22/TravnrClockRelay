import test from "node:test";
import assert from "node:assert/strict";
import {repairPair} from "./owner-cron-pair-repair.mjs";
import {managedSpec,ACTUAL_PAIR} from "./cron-admin.mjs";
const pin="a".repeat(40),now=Date.parse("2026-11-18T11:12:00Z"),token="github_pat_"+"n".repeat(40),old="github_pat_"+"o".repeat(40),until="2026-12-19T08:00:00.000Z",root="https://api.github.com/repos/HKcode22/TravnrClockRelay",iso=n=>new Date(n).toISOString();
function fixture(fault=""){
 const calls=[],events=[],journaled=[],store=new Map(ACTUAL_PAIR.map(x=>[x.jobId,{jobId:x.jobId,...managedSpec({lane:x.lane,until,token:old,now}),enabled:true}]));
 if(fault==="disabled")store.get(8890475).enabled=false;
 if(fault==="partial")store.get(8890476).extendedData.headers.Authorization="Bearer "+token;
 const cron=async(method,p,body)=>{
  calls.push({method,p});
  if(p==="/jobs")return {someFailed:false,jobs:[...store.values()]};
  const n=Number(p.split("/").at(-1)),j=store.get(n);
  if(method==="GET")return {jobDetails:structuredClone(j)};
  assert.equal(method,"PATCH");assert.deepEqual(Object.keys(body.job),["extendedData"]);
  if(fault==="unknownPatch"&&n===8890476)throw Error("timeout");
  store.set(n,{...j,...body.job});return {};
 };
 const ownerGet=async p=>{
  if(p==="/git/ref/heads/main")return {object:{sha:fault==="drift"?"b".repeat(40):pin}};
  if(p.startsWith("/actions/variables"))return {total_count:1,variables:[{name:"TRAVNR_RELAY_MODE",value:fault==="forward"?"MULTI_LANE":"CLOCK_ONLY"}]};
  if(p==="/actions/runs/44291773964")return {id:44291773964,status:"completed",conclusion:"success",run_attempt:1,head_sha:"7b2a34dda6274d8f89fc903d72003c05dbdffde9",path:".github/workflows/cron-auth-diagnostic.yml"};
  if(p.includes("/runs?"))return {total_count:0,workflow_runs:[]};
  if(p==="/actions/runs/81")return {id:81,head_sha:pin,head_branch:"main",event:"workflow_dispatch",run_attempt:1,path:".github/workflows/external-clock.yml",created_at:iso(now),display_title:"TRAVNR EXTERNAL CLOCK CLOCK_ONLY",status:"completed",conclusion:fault==="probeFail"?"failure":"success"};
  if(p.startsWith("/actions/runs/81/jobs"))return {total_count:3,jobs:["independent-pulse","offline-tests","target-forward"].map((name,i)=>({id:82+i,name,run_id:81,head_sha:pin,run_attempt:1,status:"completed",conclusion:i?"skipped":"success",steps:i?[]:[{name:"Run node cli.mjs",status:"completed",conclusion:"success"}]}))};
  throw Error("unknown owner");
 };
 const github=async(method,p,auth,body)=>{
  calls.push({method,p,github:true});
  if(auth==="Bearer "+old)return {status:fault==="oldValid"?200:401};
  assert.equal(auth,"Bearer "+token);
  if(p==="/user")return {status:fault==="badNew"?401:200,data:{login:"HKcode22"}};
  if(method==="GET")return {status:200,data:{path:".github/workflows/external-clock.yml",state:"active"}};
  assert.deepEqual(body,{ref:"main",return_run_details:true,inputs:{lane:"CLOCK_ONLY"}});
  return {status:fault==="unknownPost"?503:200,data:{workflow_run_id:81,run_url:root+"/actions/runs/81",html_url:"https://github.com/HKcode22/TravnrClockRelay/actions/runs/81"}};
 };
 return {calls,events,journaled,store,cron,ownerGet,github,storeToken:async x=>{assert.equal(x,token);calls.push({method:"SECRET"});},journal:x=>journaled.push(x),emit:x=>events.push(x),clock:()=>now,sleep:async()=>{}};
}
const args={token,pin,now,confirm:"REKEY_EXISTING_SHADOW_PAIR_NO_FORWARD"};
test("probe replacement write access first, patch exact same pair only, preserve schedules and update management secret",async()=>{
 const f=fixture(),a=await repairPair(args,f);
 assert.equal(a.status,"EXACT_EXISTING_PAIR_AUTH_REPAIRED_NO_FORWARD");assert.equal(a.probeRunId,81);assert.equal(a.cronMutations,2);assert.equal(a.targetDispatches,0);
 assert.deepEqual(f.calls.filter(x=>["POST","PATCH","SECRET"].includes(x.method)).map(x=>x.method),["POST","PATCH","PATCH","SECRET"]);
 assert(f.journaled.length>=6);assert(!JSON.stringify([a,f.events,f.journaled]).includes(token));assert(!JSON.stringify([a,f.events,f.journaled]).includes(old));
 for(const j of f.store.values()){assert.equal(j.enabled,true);assert.equal(j.schedule.expiresAt,20261219080000);assert.equal(j.extendedData.headers.Authorization,"Bearer "+token)}
});
test("scope, disabled/partially repaired pair, invalid new token, currently valid old token stop prior to mutation",async()=>{
 for(const fault of ["drift","forward","disabled","partial","oldValid","badNew"]){const f=fixture(fault);await assert.rejects(repairPair(args,f));assert(f.calls.every(x=>x.method==="GET"));}
});
test("ambiguous probe or failed execution never patches Cron",async()=>{
 for(const fault of ["unknownPost","probeFail"]){const f=fixture(fault);await assert.rejects(repairPair(args,f));assert.equal(f.calls.filter(x=>x.method==="POST").length,1);assert.equal(f.calls.filter(x=>x.method==="PATCH").length,0)}
});
test("unknown second PATCH no rollback, no repeated mutation or secret adoption",async()=>{
 const f=fixture("unknownPatch");await assert.rejects(repairPair(args,f));assert.equal(f.calls.filter(x=>x.method==="PATCH").length,2);assert(!f.calls.some(x=>x.method==="SECRET"));assert.equal(f.journaled.filter(x=>x.status==="CRON_PAIR_ONE_AUTH_PATCH_VERIFIED").length,1);
});
