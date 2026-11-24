import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {directAdmissionFailures,runDirectTick,directDisposition,readDirectReceipt,downloadDirectArchive,retryableDirectRouteHistory,retryableDirectObservationError,DIRECT_WF,DIRECT_TITLE,DIRECT_CONFIRM} from "./controller.mjs";
import {P6_ROLLING_ROUTES,assessP6RollingRoute} from "./phase6RollingGithubController_v39.mjs";
const sha="a".repeat(40),relaySha="d".repeat(40),hash="b".repeat(64),start=Date.parse("2030-01-02T00:00:00.000Z"),MIN=60000,H=60*MIN;
const iso=t=>new Date(t).toISOString(),digest=b=>createHash("sha256").update(b).digest("hex");
const root="https://api.github.com/repos/HKcode22/ReplitTranvr",old="phase6-rolling-controller-bounded-session.yml";
const flags=["P6_ROLLING_CONTROLLER_ENABLED","P6_RELAY_ISOLATED_CONTROLLER_ENABLED","P6_RELAY_ISOLATED_CONTROLLER_APPROVED","V39_PHASE5_FREEZE_SIGNED","V39_PHASE5_SOURCE_RIGHTS_APPROVED","V39_P5_SEVEN_REST_BUDGET_SIGNED","V39_PHASE6_PROCESS_ARMED","V39_PHASE6_OWNER_APPROVED"];
function fixture(fault=""){
 let clock=start,seq=20000,posts=0,prev=null,archive=null,previousReceipt=null,completeBusy=false;const plans=new Map(),runs=[],events=[],calls=[];
 const pins=Array.from({length:31},(_,i)=>{
  const service=start+(i===0?25*H:(25+24*i)*H),templates=[];
  for(const [horizon,off] of [["T-24h",24*H],["T-6h",6*H],["T-90m",90*MIN]])for(let slot=0;slot<4;slot++)
   templates.push({queryKey:"d"+i+"."+horizon+"."+slot,runDayIndex:i+1,horizon,serviceWindowStartUtc:iso(service),
    serviceWindowEndUtc:iso(service+4*H),earliestPlannedCutoffUtc:iso(service-off),scheduledRequestUtc:iso(service-off-15*MIN)});
  const bytes=Buffer.from(JSON.stringify({schema:"v39.phase6.reviewed-future-day-source-plan.v1",runDayIndex:i+1,expectedServiceStartUtc:iso(service),templates}));
  plans.set("data-collection/phase5/planning/phase6-source-day-"+String(i+1).padStart(2,"0")+".json",bytes);return {runDayIndex:i+1,sha256:digest(bytes)};
 });
 const policy=Buffer.from(JSON.stringify({schema:"v39.phase6.delegated-daily-source-review-policy.v1",delegatedDailyPacketProductionApproved:true,
  approvedCodeSha:sha,manifestSha256:hash,calendarSha256:hash,releaseSha256:hash,rightsSha256:hash,dayPlanSha256s:pins,
  validFromUtc:iso(start-24*H),validUntilUtc:iso(start+40*24*H)}));
 const env={...Object.fromEntries(flags.map(k=>[k,"1"])),GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"HKcode22/TravnrClockRelay",
  GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:"12345",GITHUB_SHA:relaySha,P6_RELAY_TARGET_MAIN_SHA:sha,P6_RELAY_APPROVED_EXECUTABLE_SHA:relaySha,P6_RELAY_REQUESTED_EXECUTABLE_SHA:relaySha,TRAVNR_TARGET_ACTIONS_TOKEN:"synthetic-target-token-no-access",
  V39_P5_APPROVED_CODE_SHA:sha,P6_ROLLING_REQUESTED_MAIN_SHA:sha,P6_ROLLING_SESSION_CONFIRM:DIRECT_CONFIRM,
  P6_ROLLING_DIRECT_RECOVERY_SINCE_UTC:iso(start-5*H),P5_CD_GH_PRE_STOP:"0",ADB_AUTO_COLLECT:"0",GITHUB_TOKEN:"synthetic-test-token-no-access",
  V39_P5_MANIFEST_SHA256:hash,V39_P5_CALENDAR_HASH:hash,V39_P5_RELEASE_SHA256:hash,V39_P5_RIGHTS_SHA256:hash,
  P6_NONPAID_DAILY_POLICY_BASE64:policy.toString("base64"),P6_NONPAID_DAILY_POLICY_SHA256:digest(policy)};
 let self={id:12345,path:".github/workflows/"+DIRECT_WF,head_sha:relaySha,head_branch:"main",event:"workflow_dispatch",run_attempt:1,
  display_title:DIRECT_TITLE,status:"in_progress",conclusion:null,created_at:iso(start)};
 const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
 const wrap=xs=>response({total_count:xs.length,workflow_runs:xs});
 const options={now:()=>clock,sleep:async m=>{clock+=m;if((fault==="busy"&&clock>=start+MIN)||completeBusy)for(const r of runs){r.status="completed";r.conclusion="success";}},
  readPlan:p=>plans.get(p),emit:e=>events.push(e),readArchive:async()=>fault==="badArchive"?Buffer.from("tampered"):archive,fetcher:async(url,opt)=>{
   calls.push({url,method:opt.method,token:opt.headers?.Authorization});const u=new URL(url),p=u.pathname,st=u.searchParams.get("status"),ev=u.searchParams.get("event");
   if(p.endsWith("/git/ref/heads/main"))return response({object:{sha:fault==="drift"?"c".repeat(40):p.includes("/TravnrClockRelay/")?relaySha:sha}});
   if(p.includes("/actions/variables/")){const name=p.split("/").at(-1);return response({name,value:name==="P6_ROLLING_CONTROLLER_ENABLED"?"1":fault==="legacyEnabled"?"1":"0"});}
   if(p.endsWith("/workflows/phase6-direct-recovery-tick.yml/runs"))return wrap(fault==="oldDirectActive"&&st==="in_progress"?[{...self,id:99998}]:[]);
   if(p.endsWith("/actions/runs/"+self.id))return response(self);
   const route=P6_ROLLING_ROUTES.find(r=>p.includes("/workflows/"+r.workflow+"/"));
   if(opt.method==="POST"){
    assert(route);posts++;assert.deepEqual(JSON.parse(opt.body).inputs,{...route.inputs,...(route.lane==="RETENTION_MONITOR"?{approved_main_sha:sha}:{})});
    if(fault==="unknown")return response({},503);
    const id=++seq;
    runs.push({id,path:".github/workflows/"+route.workflow,head_branch:"main",head_sha:sha,event:"workflow_dispatch",
     run_attempt:1,status:["busy","carry","badArchive","lostAck","failedInherited"].includes(fault)&&!completeBusy?"in_progress":"completed",conclusion:["busy","carry","badArchive","lostAck","failedInherited"].includes(fault)&&!completeBusy?null:fault==="childFailure"?"failure":"success",created_at:iso(clock)});
    return response({workflow_run_id:id,run_url:root+"/actions/runs/"+id,html_url:"https://github.com/HKcode22/ReplitTranvr/actions/runs/"+id});
   }
   if(prev&&p.endsWith("/actions/runs/"+prev.id+"/artifacts")){
    return response({total_count:1,artifacts:[{id:777,name:"p6-direct-terminal-"+prev.id,expired:false,size_in_bytes:archive.length,digest:"sha256:"+digest(archive),workflow_run:{id:prev.id}}]});
   }
   if(prev&&p.endsWith("/actions/runs/"+prev.id+"/jobs")){
    const mk=(name,conclusion="success")=>({name,status:"completed",conclusion});
    const j={id:900,run_id:prev.id,head_sha:relaySha,run_attempt:1,status:"completed",conclusion:"success",name:"direct-protected-recovery-tick",steps:[
     mk("Execute one direct recovery wave and reconcile exact parent ACKs"),mk("Preserve direct terminal operational receipt"),
     mk("Direct outcome TERMINAL_PARENT_ACKS_RECONCILED",previousReceipt.pending.length?"skipped":"success"),
     mk("Direct outcome PREFLIGHT_HOLD_NO_POST","skipped"),mk("Direct outcome KNOWN_ACTIVE_PARENT_ACKS_CARRIED",previousReceipt.pending.length?"success":"skipped")]};
    return response({total_count:2,jobs:[j,...["offline-isolated-controller"].map((name,i)=>({...j,id:901+i,name,conclusion:"skipped",steps:[]}))]});
   }
   const m=/\/actions\/runs\/(\d+)(\/jobs)?$/.exec(p);
   if(m){
    const r=runs.find(x=>x.id===Number(m[1]));assert(r);
    if(!m[2])return response(r);
    const jobs=P6_ROLLING_ROUTES.find(x=>r.path.endsWith("/"+x.workflow)).jobs.map((j,i)=>({id:r.id*10+i+1,run_id:r.id,head_sha:sha,run_attempt:1,
     name:j.name,status:"completed",conclusion:"success",steps:j.step?[{name:j.step,status:"completed",conclusion:"success"}]:
      j.parentOutcome?["SAFE_PREFLIGHT_HOLD","MISSING_EVIDENCE","NO_DUE_WORK","NO_NEW_ACK","ACKNOWLEDGED_NOT_PAID_RECEIPT"].map(x=>({name:"Parent outcome "+x,status:"completed",conclusion:x==="NO_DUE_WORK"?"success":"skipped"})):[]}));
    return response({total_count:jobs.length,jobs});
   }
   if(p.endsWith("/workflows/"+DIRECT_WF+"/runs")){
    if(st==="in_progress")return wrap([self]);
    if(st==="success"&&prev)return wrap([prev]);
    if(st==="failure"&&fault==="priorRootFailure")return wrap([{...self,id:11111,status:"completed",conclusion:"failure",created_at:iso(start-3.5*H)}]);
    if(st==="skipped"&&fault==="priorSkipped")return wrap([{...self,id:11111,status:"completed",conclusion:"skipped"}]);
    return wrap([]);
   }
   if(p.endsWith("/workflows/"+old+"/runs"))return wrap(fault==="oldActive"&&st==="in_progress"?[{...self,id:99999}]:[]);

   if(p.endsWith("/actions/runs")){
    if(u.searchParams.has("created")){
     if(st==="failure"&&fault==="overflowFailure")
      return response({total_count:101,workflow_runs:Array.from({length:100},(_,i)=>({id:i+50000}))});
     if(st==="failure"&&["priorRootFailure","oldSourceFailure"].includes(fault))
      return wrap([{...self,id:11111,path:fault==="oldSourceFailure"?".github/workflows/"+P6_ROLLING_ROUTES[0].workflow:self.path,
       status:"completed",conclusion:"failure",created_at:iso(start-3.5*H)}]);
     if(st==="failure"&&fault==="unrelatedFailure")
      return wrap([{...self,id:11111,path:".github/workflows/unrelated.yml",status:"completed",conclusion:"failure",created_at:iso(start-3.5*H)}]);
     return wrap([]);
    }
    return wrap([self,...runs,...(fault==="oldActive"?[{...self,id:99999,path:".github/workflows/"+old}]:[])].filter(r=>r.status===st));
   }
   assert(route,p);
   if(st==="failure"&&route.lane==="SOURCE_POST"&&["oldSourceFailure","overflowFailure"].includes(fault))
    return wrap([{id:11111,status:"completed",conclusion:"failure",created_at:iso(start-3.5*H)}]);
   if(st)return wrap([]);
   const bounds=u.searchParams.get("created")?.split("..").map(Date.parse);
   assert(bounds?.length===2&&bounds.every(Number.isFinite),"exact bounded route history query");
   return wrap(runs.filter(r=>r.path.endsWith("/"+route.workflow)&&r.event===ev&&Date.parse(r.created_at)>=bounds[0]&&Date.parse(r.created_at)<=bounds[1]&&!(fault==="lostAck"&&prev&&r.status==="in_progress")));
  }};
 function advance(receipt,{settle=false,fail=false}={}){
  prev={...self,status:"completed",conclusion:"success"};previousReceipt=receipt;
  const dir=mkdtempSync(join(tmpdir(),"direct-fixture-"));
  try{writeFileSync(join(dir,"p6-direct-terminal.json"),JSON.stringify(receipt));
   execFileSync("zip",["-q","receipt.zip","p6-direct-terminal.json"],{cwd:dir});
   archive=readFileSync(join(dir,"receipt.zip"));}
  finally{rmSync(dir,{recursive:true,force:true});}
  clock=start+10*MIN;self={...self,id:self.id+1,created_at:iso(clock)};env.GITHUB_RUN_ID=String(self.id);
  if(settle||fail){completeBusy=true;for(const row of runs){row.status="completed";row.conclusion=fail?"failure":"success";}}
 }
 return {env,options,events,calls,runs,posts:()=>posts,advance};
}

test("independent relay execution retains exact signed target SHA and separates tokens",async()=>{
 const f=fixture(),o=await runDirectTick(f.env,f.options);
 assert.equal(o.status,"DIRECT_WAVE_TERMINAL_NOT_COLLECTION_PROOF");
 assert.equal(o.reviewedMainSha,sha);assert.equal(o.controllerExecutableSha,relaySha);
 assert(o.terminalAcknowledgements.some(r=>r.lane==="SOURCE_POST"));
 assert.equal(o.verifiedTerminal,f.posts());
 assert(f.calls.filter(x=>x.url.includes("/TravnrClockRelay/")).every(x=>x.method==="GET"&&x.token==="Bearer synthetic-test-token-no-access"));
 assert(f.calls.filter(x=>x.url.includes("/ReplitTranvr/")).every(x=>x.token==="Bearer synthetic-target-token-no-access"));
 assert(f.calls.filter(x=>x.method==="POST").every(x=>x.url.includes("/ReplitTranvr/")));
 assert.equal(o.providerCalls,0);assert.equal(o.databaseWrites,0);
});
test("relay successor reads exact relay predecessor archive, target remains immutable",async()=>{
 const f=fixture(),a=await runDirectTick(f.env,f.options);f.advance(a);
 const b=await runDirectTick(f.env,f.options);
 assert.equal(b.controllerExecutableSha,relaySha);assert.equal(b.reviewedMainSha,sha);
 assert.equal(b.predecessorRunId,a.runId);assert.equal(b.unknownAttempts,0);
});
test("wrong executable pin, target pin or shared token is rejected before any request",async()=>{
 for(const p of [{P6_RELAY_APPROVED_EXECUTABLE_SHA:sha},{P6_RELAY_TARGET_MAIN_SHA:relaySha},{TRAVNR_TARGET_ACTIONS_TOKEN:"synthetic-test-token-no-access"}]){
  const f=fixture();await assert.rejects(runDirectTick({...f.env,...p},f.options),/HOLD_/);assert.equal(f.calls.length,0);
 }
});
test("legacy controller enabled or active, changed target/relay main, or uncertain POST never replays",async()=>{
 for(const fault of ["legacyEnabled","oldDirectActive","oldActive","drift","priorRootFailure"]){
  const f=fixture(fault);const o=await runDirectTick(f.env,f.options);assert.equal(o.status,"DIRECT_PREFLIGHT_HOLD_NO_POST");assert.equal(f.posts(),0);
 }
 const f=fixture("unknown");await assert.rejects(runDirectTick(f.env,f.options),/NO_REPLAY/);assert.equal(f.posts(),1);
});
test("active sweep fallback continues with complete route-specific evidence only",async()=>{
 const f=fixture(),original=f.options.fetcher;let mismatches=0;
 f.options.fetcher=async(url,opt)=>{
  const u=new URL(url);
  if(f.posts()>0&&opt.method==="GET"&&u.searchParams.has("status")&&!u.searchParams.has("created")&&u.pathname==="/repos/HKcode22/ReplitTranvr/actions/runs"&&mismatches<3){
   mismatches++;return {ok:true,status:200,json:async()=>({total_count:1,workflow_runs:[]})};
  }
  return original(url,opt);
 };
 const o=await runDirectTick(f.env,f.options);assert.equal(mismatches,3);assert.equal(o.status,"DIRECT_WAVE_TERMINAL_NOT_COLLECTION_PROOF");assert.equal(o.verifiedTerminal,f.posts());
});
