import test from "node:test";
import assert from "node:assert/strict";
import {independentWake,routes} from "./independent-wake.mjs";
const target="9".repeat(40),relay="a".repeat(40),clock=Date.parse("2026-11-25T04:20:00.000Z");
const env={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"HKcode22/TravnrClockRelay",GITHUB_REF:"refs/heads/main",
 GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:"12345",GITHUB_SHA:relay,
 P6_RELAY_APPROVED_EXECUTABLE_SHA:relay,TRAVNR_RELAY_MODE:"MULTI_LANE",TRAVNR_RELAY_LANE:"ROLLING_ROOT",
 TRAVNR_RELAY_ROLLING_ROUTE:"INDEPENDENT_WAKE",TRAVNR_RELAY_ROLLING_ENABLED:"1",
 TRAVNR_TARGET_FORWARD_ENV_READY:"1",TRAVNR_APPROVED_TARGET_MAIN_SHA:target,TRAVNR_ROLLING_POLICY_FROM_UTC:"2026-11-23T00:00:00.000Z",
 TRAVNR_ROLLING_POLICY_UNTIL_UTC:"2026-12-26T00:00:00.000Z",TRAVNR_TARGET_ACTIONS_TOKEN:"test-token-not-real-012345"};
function fixture({fault,drift=false,busy,readFail}={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push({url,method:init.method,body:init.body});
  if(init.method==="GET"){
   if(url.endsWith("/git/ref/heads/main"))return Response.json({object:{sha:drift?"0".repeat(40):target}});
   const u=new URL(url),r=routes.find(r=>u.pathname.endsWith("/"+r.workflow+"/runs"));
   assert(r);assert(["queued","in_progress","waiting","requested","pending"].includes(u.searchParams.get("status")));
   assert.equal(u.searchParams.get("per_page"),"1");
   if(r.lane===readFail)throw Error("fixture active read unavailable");
   // Inconsistent page length is deliberately not a global hold.
   return Response.json({total_count:r.lane===busy?2:0,workflow_runs:[]});
  }
  const route=routes.find(r=>url.endsWith("/"+r.workflow+"/dispatches"));
  assert(route);
  assert.deepEqual(JSON.parse(init.body),{ref:"main",return_run_details:true,inputs:route.inputs});
  if(route.lane===fault)throw Error("synthetic uncertain dispatch");
  const id=12345+calls.length;
  return Response.json({workflow_run_id:id,run_url:"https://api.github.com/repos/HKcode22/ReplitTranvr/actions/runs/"+id,
    html_url:"https://github.com/HKcode22/ReplitTranvr/actions/runs/"+id});
 };
 return {calls,fetcher};
}
test("one independent wake per reviewed route, no run-history requests",async()=>{
 const f=fixture(),out=await independentWake(env,{fetcher:f.fetcher,now:()=>clock});
 assert.equal(out.lanes.length,7);assert.equal(f.calls.length,43);
 assert.equal(new Set(f.calls.filter(x=>x.method==="POST").map(x=>x.url)).size,7);
 assert(out.lanes.every(x=>x.status==="ACK_NOT_COLLECTION_PROOF"));
 assert.equal(out.providerCalls,0);assert.equal(out.paidAuthorityGranted,false);
});
test("uncertain SOURCE/POST parent acknowledgment does not block other lanes and never retransmits",async()=>{
 const f=fixture({fault:"SOURCE_POST"}),out=await independentWake(env,{fetcher:f.fetcher,now:()=>clock});
 assert.equal(out.lanes[0].status,"ACK_UNKNOWN_OR_REFUSED");
 assert(out.lanes.slice(1).every(x=>x.status==="ACK_NOT_COLLECTION_PROOF"));
 assert.equal(f.calls.length,43);
});
test("separate executable pin, target main drift, scope, credential and policy checks",async()=>{
 for(const e of [{...env,GITHUB_RUN_ATTEMPT:"2"},{...env,TRAVNR_RELAY_ROLLING_ENABLED:"0"},{...env,DATABASE_URL:"not allowed"},{...env,TRAVNR_RELAY_ROLLING_ROUTE:"DIRECT_TICK"},{...env,P6_RELAY_APPROVED_EXECUTABLE_SHA:target}]){
  const f=fixture();await assert.rejects(independentWake(e,{fetcher:f.fetcher,now:()=>clock}),/SCOPE/);assert.equal(f.calls.length,0);
 }
 const f=fixture({drift:true});await assert.rejects(independentWake(env,{fetcher:f.fetcher,now:()=>clock}),/TARGET_MAIN_DRIFT/);assert.equal(f.calls.length,1);
});
test("early draw only near original six-slot clock, all other lanes unaffected",async()=>{
 const f=fixture(),out=await independentWake(env,{fetcher:f.fetcher,now:()=>Date.parse("2026-11-25T03:50:00.000Z")});
 assert.equal(out.lanes.length,6);assert(!out.lanes.some(x=>x.lane==="EARLY_DRAW"));
});

test("active count mismatch is local; an unavailable active read defers only its own route",async()=>{
 const f=fixture({busy:"SOURCE_POST",readFail:"T24"}),out=await independentWake(env,{fetcher:f.fetcher,now:()=>clock});
 assert.equal(out.lanes[0].status,"ACTIVE_DEFERRED");
 assert.equal(out.lanes.find(x=>x.lane==="T24").status,"ACTIVE_READ_UNAVAILABLE_DEFERRED");
 assert(out.lanes.filter(x=>!["SOURCE_POST","T24"].includes(x.lane)).every(x=>x.status==="ACK_NOT_COLLECTION_PROOF"));
 assert.equal(f.calls.filter(x=>x.method==="POST").length,5);
});

test("slow first route cannot serialize its paired independent lane; concurrency stays bounded",async()=>{
 const f=fixture();let release,paired;const gate=new Promise(r=>release=r),seen=new Promise(r=>paired=r);
 const fetcher=async(url,init)=>{
  if(init.method==="GET"&&url.includes("/"+routes[0].workflow+"/runs"))await gate;
  const response=await f.fetcher(url,init);
  if(init.method==="POST"&&url.endsWith("/"+routes[1].workflow+"/dispatches"))paired();
  return response;
 };
 const pending=independentWake(env,{fetcher,now:()=>clock});
 await seen;
 assert(!f.calls.some(x=>x.url.includes("/"+routes[2].workflow+"/")));
 release();
 const result=await pending;
 assert.deepEqual(result.lanes.map(x=>x.lane),routes.map(x=>x.lane));
 assert.equal(f.calls.filter(x=>x.method==="POST").length,7);
});
test("deadline crossed during active reads prevents a POST, never retries",async()=>{
 const f=fixture();let time=clock;
 const fetcher=async(url,init)=>{
  const response=await f.fetcher(url,init);
  if(url.includes("/runs?"))time=clock+111000;
  return response;
 };
 const result=await independentWake(env,{fetcher,now:()=>time});
 assert.equal(f.calls.filter(x=>x.method==="POST").length,0);
 assert(result.lanes.every(x=>x.status==="DEFERRED_DEADLINE"));
});
