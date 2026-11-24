// External clock wake -> isolated controller. No target token, provider or DB.
const repo="HKcode22/TravnrClockRelay",root="https://api.github.com/repos/"+repo,wf="phase6-relay-controller.yml";
const hold=s=>{throw Error("HOLD_ISOLATED_FORWARD_"+s)};
const id=x=>Number.isSafeInteger(x)&&x>0,sha=x=>/^[a-f0-9]{40}$/.test(x??"");
const title="P6 ISOLATED RELAY CONTROLLER",path=".github/workflows/"+wf;
export async function forward(e,{fetcher=fetch,now=Date.now,emit=()=>{}}={}){
 const start=now(),epoch=Date.parse(e.TRAVNR_RELAY_ROLLING_SINCE_UTC),self=Number(e.GITHUB_RUN_ID),pin=e.GITHUB_SHA;
 if(e.GITHUB_ACTIONS!=="true"||e.GITHUB_REPOSITORY!==repo||e.GITHUB_REF!=="refs/heads/main"||
 e.GITHUB_EVENT_NAME!=="workflow_dispatch"||e.GITHUB_RUN_ATTEMPT!=="1"||!id(self)||!sha(pin)||
 e.P6_RELAY_APPROVED_EXECUTABLE_SHA!==pin||e.P6_RELAY_ISOLATED_CONTROLLER_ENABLED!=="1"||
 e.TRAVNR_RELAY_ROLLING_ROUTE!=="ISOLATED_CONTROLLER"||e.TRAVNR_RELAY_ROLLING_ENABLED!=="1"||
 !Number.isSafeInteger(epoch)||epoch>start||start-epoch>60*86400000||
 new Date(epoch).toISOString()!==e.TRAVNR_RELAY_ROLLING_SINCE_UTC||
 typeof e.GITHUB_TOKEN!=="string"||e.GITHUB_TOKEN.length<16||
 ["TRAVNR_TARGET_ACTIONS_TOKEN","DATABASE_URL","RAPIDAPI_KEY","AERODATABOX_API_KEY"].some(k=>e[k]))hold("SCOPE");
 const headers={Authorization:"Bearer "+e.GITHUB_TOKEN,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
 let calls=0,attempted=false;
 const req=async(p,method="GET",body)=>{
  if(++calls>32||now()-start>90000||!p.startsWith("/")||p.startsWith("//"))hold("BOUND");
  const r=await fetcher(root+p,{method,headers:{...headers,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!r.ok)hold(method+"_HTTP_"+r.status);
  return r.json();
 };
 const exact=x=>id(x?.id)&&x.path===path&&x.head_branch==="main"&&x.head_sha===pin&&x.event==="workflow_dispatch"&&x.run_attempt===1&&x.display_title===title;
 const result=(status,x={})=>({status,relayRunId:self,relayExecutableSha:pin,providerCalls:0,databaseWrites:0,paidAuthorityGranted:false,...x});
 try{
  if((await req("/git/ref/heads/main")).object?.sha!==pin)hold("MAIN_DRIFT");
  const run=await req("/actions/runs/"+self);
  if(run.id!==self||run.head_sha!==pin||run.display_title!=="TRAVNR EXTERNAL CLOCK ROLLING_ROOT"||run.path!==".github/workflows/external-clock.yml"||run.head_branch!=="main"||run.run_attempt!==1||run.status!=="in_progress"||run.event!=="workflow_dispatch")hold("SELF_IDENTITY");
  // A failed earlier forwarding attempt may represent an uncertain POST.
  // Never infer that an absent controller run authorizes a fresh dispatch.
  for(const status of ["failure","cancelled","timed_out","action_required","stale","neutral"]){
   const q=await req("/actions/workflows/external-clock.yml/runs?branch=main&event=workflow_dispatch&status="+status+"&per_page=100&created="+encodeURIComponent(">="+new Date(epoch).toISOString()));
   if(!Number.isSafeInteger(q.total_count)||q.total_count<0||q.total_count>100||q.workflow_runs?.length!==q.total_count||new Set(q.workflow_runs.map(x=>x.id)).size!==q.total_count)hold("FORWARD_HISTORY_INCOMPLETE");
   if(q.workflow_runs.some(x=>x.display_title==="TRAVNR EXTERNAL CLOCK ROLLING_ROOT"))return result("ISOLATED_FORWARD_PRIOR_FAILURE_REVIEW",{dispatches:0});
  }
  for(const status of ["failure","cancelled","timed_out","action_required","stale","neutral","skipped","queued","in_progress","waiting","requested","pending"]){
   const active=["queued","in_progress","waiting","requested","pending"].includes(status);
   const q=await req("/actions/workflows/"+wf+"/runs?branch=main&status="+status+"&per_page=100"+(active?"":"&created="+encodeURIComponent(">="+new Date(epoch).toISOString())));
   if(!Number.isSafeInteger(q.total_count)||q.total_count<0||q.total_count>100||q.workflow_runs?.length!==q.total_count||new Set(q.workflow_runs.map(x=>x.id)).size!==q.total_count)hold("HISTORY_INCOMPLETE");
   if(q.total_count>0)return result(active?"ISOLATED_CONTROLLER_ACTIVE_NO_DISPATCH":"ISOLATED_CONTROLLER_PRIOR_FAILURE_REVIEW",{dispatches:0});
  }
  const q=await req("/actions/workflows/"+wf+"/runs?branch=main&status=success&per_page=1&created="+encodeURIComponent(">="+new Date(epoch).toISOString()));
  if(!Number.isSafeInteger(q.total_count)||q.total_count<0||q.workflow_runs?.length!==Math.min(1,q.total_count))hold("LATEST_COUNT");
  const last=q.workflow_runs[0];
  if(last&&(!exact(last)||last.status!=="completed"||last.conclusion!=="success"||!Number.isFinite(Date.parse(last.created_at))||Date.parse(last.created_at)<epoch))hold("LATEST_IDENTITY");
  if(last&&now()-Date.parse(last.created_at)<8*60000)return result("ISOLATED_CONTROLLER_RECENT_NO_DISPATCH",{dispatches:0});
  if((await req("/git/ref/heads/main")).object?.sha!==pin)hold("MAIN_DRIFT");
  attempted=true;emit(result("ISOLATED_CONTROLLER_DISPATCH_ATTEMPT_NO_REPLAY",{dispatches:1}));
  const a=await req("/actions/workflows/"+wf+"/dispatches","POST",{ref:"main",return_run_details:true,inputs:{confirm:"RUN_REVIEWED_ISOLATED_CONTROLLER_EXISTING_SIGNED_SCOPE",approved_executable_sha:pin}});
  const n=a.workflow_run_id;
  if(!id(n)||a.run_url!==root+"/actions/runs/"+n||a.html_url!=="https://github.com/"+repo+"/actions/runs/"+n)hold("ACK_IDENTITY");
  const live=await req("/actions/runs/"+n);
  if(!exact(live)||live.id!==n||!Number.isFinite(Date.parse(live.created_at))||Date.parse(live.created_at)<start-5000)hold("ACK_READBACK");
  return result("ISOLATED_CONTROLLER_ACK_NOT_COLLECTION_PROOF",{controllerRunId:n,dispatches:1});
 }catch(err){
  if(attempted)throw Error("HOLD_ISOLATED_FORWARD_UNKNOWN_OR_UNVERIFIED_ACK_NO_REPLAY");
  throw err;
 }
}
if(process.env.P6_ISOLATED_FORWARD_ENTRYPOINT==="1")forward(process.env,{emit:x=>console.log(JSON.stringify(x))}).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(/^HOLD_ISOLATED_FORWARD_[A-Z0-9_]+$/.test(e?.message??"")?e.message:"HOLD_ISOLATED_FORWARD_REDACTED");process.exitCode=2});
