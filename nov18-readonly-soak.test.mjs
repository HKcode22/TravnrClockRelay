import test from "node:test";
import assert from "node:assert/strict";
import {slotFor,expectedSlots,classifyList,receiptFor,FROM,UNTIL,MIN,RELAY_SHA} from "./nov18-readonly-soak.mjs";
const iso=n=>new Date(n).toISOString(),at=Date.parse("2026-11-18T16:18:19.000Z"),lane="ROLLING_ROOT",run=(x={})=>({id:1,head_sha:RELAY_SHA,head_branch:"main",event:"workflow_dispatch",run_attempt:1,path:".github/workflows/external-clock.yml",display_title:"TRAVNR EXTERNAL CLOCK "+lane,created_at:iso(at),...x});
const receipt=(p={})=>({status:"DEFER_RECENT_DIRECT_TICK_NOT_COLLECTION_PROOF",relayRunId:1,mode:lane,actualCreatedUtc:iso(at),runnerObservedUtc:iso(at+9000),creationToObservedMs:9000,providerCallsByRelay:0,databaseReadsByRelay:0,databaseWritesByRelay:0,paidAuthorityGranted:false,...p});
test("slot offsets preserve both independent cron cadences",()=>{
 assert.equal(iso(slotFor(lane,at)),"2026-11-18T16:18:00.000Z");
 assert.equal(iso(slotFor("PRIMARY_BACKSTOP",Date.parse("2026-11-18T16:19:14Z"))),"2026-11-18T16:19:00.000Z");
 assert.equal(expectedSlots(FROM).length,0);assert.equal(expectedSlots(at+2*MIN).length,1);
});
test("missing or duplicate slots are not successes",()=>{
 const a=classifyList([run(),run({id:2,created_at:iso(at+1000)})],Date.parse("2026-11-18T16:32:00Z"));
 assert.equal(a.slots[0].count,2);assert(a.slots.some(x=>x.count===0));
});
test("wrong pin, rerun, foreign title, or duplicate ID fails evidence",()=>{
 for(const r of [run({head_sha:"a".repeat(40)}),run({run_attempt:2}),run({display_title:"wrong"})])
  assert.equal(classifyList([r],at+MIN).unexpected.length,1);
 assert.throws(()=>classifyList([run(),run()],at+MIN),/LIST_SCOPE/);
});
test("strict exact ACK pair, correct route, no paid authority",()=>{
 const q=receipt({status:"TARGET_ACK_AND_RUN_IDENTITY_VERIFIED_NOT_COLLECTION_PROOF",relayDispatches:1,targetRunId:9,targetWorkflow:"phase6-direct-recovery-tick.yml"});
 const a={status:"EXTERNAL_WAKE_TARGET_ATTEMPT_NO_REPLAY",relayRunId:1,workflow:q.targetWorkflow},b={status:"EXTERNAL_WAKE_TARGET_ACK_NOT_EXECUTION_PROOF",relayRunId:1,runId:9};
 assert.equal(receiptFor(run(),lane,[q,a,b]).targetId,9);
 assert.throws(()=>receiptFor(run(),lane,[q,a]),/ACK_PAIR/);
 assert.throws(()=>receiptFor(run(),lane,[{...q,paidAuthorityGranted:true},a,b]),/RELAY_RECEIPT_COUNT/);
});
test("expiry is only expected at the reviewed 5m headroom or later",()=>{
 assert.throws(()=>receiptFor(run(),lane,[receipt({status:"DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW"})]),/PREMATURE_EXPIRY/);
 const t=UNTIL+MIN,r=run({created_at:iso(t)}),q=receipt({actualCreatedUtc:iso(t),runnerObservedUtc:iso(t+9000),status:"DEFER_OUTSIDE_OR_LATE_POLICY_WINDOW"});
 assert.equal(receiptFor(r,lane,[q]).disposition,q.status);
});
test("preflight uncertainty and unexpected post are not silently green",()=>{
 const q=receipt({status:"QUARANTINED_PRIOR_RELAY_RUN_REVIEW"});
 assert.equal(receiptFor(run(),lane,[q]).disposition,"REVIEW");
 assert.throws(()=>receiptFor(run(),lane,[q,{status:"EXTERNAL_WAKE_TARGET_ATTEMPT_NO_REPLAY",relayRunId:1}]),/NON_ACK/);
});
