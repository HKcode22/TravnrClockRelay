/** Actual 90-minute wait using the exact role-bound SOURCE adapter.
 * Disposable local PG16 only; each poll checks out and destroys a fresh
 * role-verified connection. No V0080 production claim or provider. */
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import pg from "./reviewed-production/node_modules/pg/lib/index.js";
import {makeP5Stage28DedicatedRolePool,P5_STAGE28_GROUPS} from "./reviewed-production/server/lib/disruption/phase5Stage28DedicatedRolePool_v39.ts";
import {waitForP5ScheduledPhysicalDispatch} from "./reviewed-production/server/lib/disruption/phase5V0080GitHubPrearm_v39.ts";
import {requireP5PaidGetBeforeHardLatest} from "./reviewed-production/server/lib/disruption/phase5SourceUpcomingDueQueueReadonly_v39.ts";
const M=60000,iso=n=>new Date(n).toISOString(),login="phase5_p5_source_login_20261108",db="postgresql://"+login+":ci-only@127.0.0.1:5432/neondb?sslmode=disable";
const e=process.env;
assert.equal(e.GITHUB_REPOSITORY,"HKcode22/TravnrClockRelay");
assert.equal(e.GITHUB_EVENT_NAME,"pull_request");
assert.equal(e.GITHUB_RUN_ATTEMPT,"1");
for(const k of ["DATABASE_URL","V39_P5_SOURCE_DATABASE_URL","V39_DATABASE_RUNTIME_URL","P6_PRIVATE_READER_DATABASE_URL","P5_V39_PRE_DATABASE_URL","AERODATABOX_API_KEY","RAPIDAPI_KEY","AERODATABOX_WEBHOOK_SECRET","TRAVNR_TARGET_ACTIONS_TOKEN","TRAVNR_CRON_ACCOUNT_KEY","TRAVNR_CRON_RELAY_TOKEN","GH_TOKEN","GITHUB_TOKEN"])assert(!e[k]);
const pool=new pg.Pool({connectionString:db,max:1,connectionTimeoutMillis:10000,query_timeout:10000,options:"-c default_transaction_read_only=on"});
const scoped=makeP5Stage28DedicatedRolePool(pool,{group:"source",reviewedDedicatedLogin:login,forbiddenApplicationLogin:"phase5_p30_prepare_login_20261107"});
let reads=0,maxReadMs=0,last=null,far=0,near=0,maxOvershootMs=0;
const pids=new Set(),durations=[];
async function clock(){
 const start=performance.now();
 const r=await scoped.query("SELECT clock_timestamp() AS t,pg_backend_pid() AS pid,current_user AS role,session_user AS login,current_setting('transaction_read_only') AS ro,pg_is_in_recovery() AS replica,current_setting('server_version_num')::int AS ver");
 const x=r.rows[0],d=performance.now()-start;
 assert(r.rowCount===1&&x.role===P5_STAGE28_GROUPS.source&&x.login===login&&x.ro==="on"&&x.replica===false&&x.ver>=160000&&x.ver<170000);
 assert(Number.isSafeInteger(x.pid)&&x.pid>0);
 assert(!pids.has(x.pid),"role-bound adapter must destroy every checked-out session");
 pids.add(x.pid);reads++;maxReadMs=Math.max(maxReadMs,d);durations.push(d);last=new Date(x.t).getTime();
 assert(Number.isFinite(last));return new Date(last);
}
try{
 const began=(await clock()).getTime(),mono=performance.now(),planned=began+90*M,cutoff=planned+15*M,hard=planned+M;
 console.log(JSON.stringify({status:"ACTUAL_PG16_ROLE_BOUND_90_MIN_WAIT_STARTED_DISPOSABLE_ONLY",runId:e.GITHUB_RUN_ID,beginUtc:iso(began),plannedUtc:iso(planned),hardLatestUtc:iso(hard),providerCalls:0,productionDatabaseWrites:0}));
 await waitForP5ScheduledPhysicalDispatch(iso(planned),iso(cutoff),180,clock,async d=>{
  const left=planned-last,before=performance.now();
  if(left>2*M){assert(d<=60000&&d<=left-2*M);far++;}else{assert(d<=5000&&d<=left);near++;}
  await new Promise(r=>setTimeout(r,d));
  maxOvershootMs=Math.max(maxOvershootMs,performance.now()-before-d);
  if((far+near)%15===0)console.log(JSON.stringify({status:"ACTUAL_PG16_ROLE_CLOCK_HEARTBEAT",reads,remainingMs:Math.max(0,planned-Date.now())}));
 });
 const observed=(await clock()).getTime();
 requireP5PaidGetBeforeHardLatest(new Date(observed),iso(hard));
 const slip=observed-planned,elapsed=performance.now()-mono;
 assert(slip>=0&&elapsed>=90*M-2000&&reads<=1501&&pids.size===reads);
 const ordered=[...durations].sort((a,b)=>a-b),percentile=q=>Math.ceil(ordered[Math.ceil(q*ordered.length)-1]);
 const out={status:"ACTUAL_PG16_ROLE_BOUND_90_MIN_WAIT_VERIFIED_NOT_PRODUCTION_PREARM",runId:e.GITHUB_RUN_ID,beginUtc:iso(began),plannedUtc:iso(planned),observedUtc:iso(observed),hardLatestUtc:iso(hard),elapsedMs:Math.round(elapsed),latenessMs:slip,dbClockReads:reads,distinctRoleVerifiedConnections:pids.size,farSleeps:far,nearSleeps:near,p50DbReadMs:percentile(.5),p95DbReadMs:percentile(.95),p99DbReadMs:percentile(.99),maxDbReadMs:Math.ceil(maxReadMs),maxSleepOvershootMs:Math.ceil(maxOvershootMs),diagnostic2sTimingTargetMet:slip<=2000,actualDisposablePg16:true,productionDatabaseReads:0,productionDatabaseWrites:0,providerCalls:0,dispatches:0,phase6PaidGo:false};
 console.log(JSON.stringify(out));if(slip>2000)process.exitCode=2;
}catch(e){console.error("HOLD_ACTUAL_PG16_ROLE_CLOCK_NO_PROVIDER_NO_REPLAY");process.exitCode=2;}
finally{await pool.end();}
