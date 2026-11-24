import test from "node:test";
import assert from "node:assert/strict";
import {forward} from "./forward.mjs";
const repo="HKcode22/TravnrClockRelay",root="https://api.github.com/repos/"+repo,sha="a".repeat(40),now=Date.parse("2026-11-24T16:00:00.000Z"),self=1234,child=2345;
function fixture(fault=""){
 const calls=[],e={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:repo,GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:String(self),GITHUB_SHA:sha,GITHUB_TOKEN:"synthetic-no-access-token",P6_RELAY_APPROVED_EXECUTABLE_SHA:sha,P6_RELAY_ISOLATED_CONTROLLER_ENABLED:"1",TRAVNR_RELAY_ROLLING_ROUTE:"ISOLATED_CONTROLLER",TRAVNR_RELAY_ROLLING_ENABLED:"1",TRAVNR_RELAY_ROLLING_SINCE_UTC:new Date(now-3600000).toISOString()};
 const row={id:child,path:".github/workflows/phase6-relay-controller.yml",head_branch:"main",head_sha:sha,event:"workflow_dispatch",run_attempt:1,display_title:"P6 ISOLATED RELAY CONTROLLER",status:"queued",conclusion:null,created_at:new Date(now).toISOString()};
 const res=(x,status=200)=>({ok:status===200,status,json:async()=>x});
 const options={now:()=>now,fetcher:async(url,opt)=>{
  const u=new URL(url);calls.push({url,method:opt.method});const status=u.searchParams.get("status");
  if(u.pathname.endsWith("/git/ref/heads/main"))return res({object:{sha}});
  if(u.pathname.endsWith("/actions/runs/"+self))return res({...row,id:self,path:".github/workflows/external-clock.yml",display_title:"TRAVNR EXTERNAL CLOCK ROLLING_ROOT",status:"in_progress"});
  if(u.pathname.endsWith("/actions/runs/"+child))return res(row);
  if(opt.method==="POST")return fault==="unknown"?res({},503):res({workflow_run_id:child,run_url:root+"/actions/runs/"+child,html_url:"https://github.com/"+repo+"/actions/runs/"+child});
  if(fault==="prior"&&status==="failure"&&u.pathname.includes("external-clock.yml"))return res({total_count:1,workflow_runs:[{id:3456,display_title:"TRAVNR EXTERNAL CLOCK ROLLING_ROOT"}]});
  if(fault==="active"&&status==="queued"&&u.pathname.includes("phase6-relay-controller.yml"))return res({total_count:1,workflow_runs:[row]});
  if(fault==="recent"&&status==="success")return res({total_count:1,workflow_runs:[{...row,status:"completed",conclusion:"success",created_at:new Date(now-60000).toISOString()}]});
  if(fault==="count"&&status==="queued")return res({total_count:1,workflow_runs:[]});
  return res({total_count:0,workflow_runs:[]});
 }};
 return {e,options,calls,posts:()=>calls.filter(x=>x.method==="POST").length};
}
test("exact wake dispatches one relay controller and verifies ACK",async()=>{
 const f=fixture(),x=await forward(f.e,f.options);assert.equal(x.status,"ISOLATED_CONTROLLER_ACK_NOT_COLLECTION_PROOF");assert.equal(x.controllerRunId,child);assert.equal(f.posts(),1);
});
test("active recent or prior uncertain forward refuses new POST",async()=>{
 for(const fault of ["active","recent","prior"]){const f=fixture(fault);await forward(f.e,f.options);assert.equal(f.posts(),0);}
});
test("incomplete GET and unknown POST fail without retry",async()=>{
 const a=fixture("count");await assert.rejects(forward(a.e,a.options),/HISTORY_INCOMPLETE/);assert.equal(a.posts(),0);
 const b=fixture("unknown");await assert.rejects(forward(b.e,b.options),/NO_REPLAY/);assert.equal(b.posts(),1);
});
test("wrong executable pin or target token fails before any request",async()=>{
 for(const p of [{P6_RELAY_APPROVED_EXECUTABLE_SHA:"b".repeat(40)},{TRAVNR_TARGET_ACTIONS_TOKEN:"not-allowed"}]){
 const f=fixture();await assert.rejects(forward({...f.e,...p},f.options),/SCOPE/);assert.equal(f.calls.length,0);}
});
