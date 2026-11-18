import test from "node:test";
import assert from "node:assert/strict";
import {setupCustody} from "./owner-cron-custody.mjs";
const pin="9cca29330405774520e0c7929f4916e24d9934e4",key="account-fixture-"+"k".repeat(32),token="github_pat_"+"x".repeat(40);
const A="travnr-cron-audit",M="travnr-cron-management",K="TRAVNR_CRON_ACCOUNT_KEY",P="TRAVNR_CRON_RELAY_TOKEN";
function fixture(fault=""){
 const envs=new Map(),policies=new Map(),names=new Map(),vars=new Map(),calls=[],events=[];
 function seed(n,e,pol=[],sec=[]){envs.set(n,e);policies.set(n,pol);names.set(n,new Set(sec))}
 if(fault==="existingUnsafe")seed(A,{name:A,can_admins_bypass:true,protection_rules:[],deployment_branch_policy:null},[],[K]);
 if(fault==="existingExtra")seed(A,{name:A,can_admins_bypass:false,protection_rules:[{type:"branch_policy"}],deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}},[{name:"main",type:"branch"},{name:"*"}],[]);
 const api=async(method,path,body)=>{
  calls.push({method,path});
  if(path==="/user")return {login:fault==="wrongOwner"?"other":"HKcode22",id:12};
  if(path.endsWith("/git/ref/heads/main"))return {object:{sha:fault==="drift"?"f".repeat(40):pin}};
  if(path.endsWith("/actions/variables?per_page=100"))return {total_count:fault==="activeAudit"?1:0,variables:fault==="activeAudit"?[{name:"TRAVNR_CRON_AUDIT_ENABLED",value:"1"}]:[]};
  if(path.endsWith("/environments?per_page=100"))return {total_count:envs.size,environments:[...envs.values()]};
  const n=path.match(/\/environments\/([^/?]+)/)?.[1];if(!n)throw Error("unexpected");
  if(path.endsWith("/deployment-branch-policies?per_page=100")){const x=policies.get(n)??[];return {total_count:x.length,branch_policies:x};}
  if(path.endsWith("/deployment-branch-policies")&&method==="POST"){policies.get(n).push(body);return body;}
  if(method==="PUT"){
   const rules=[{type:"branch_policy"},...(body.reviewers.length?[{type:"required_reviewers",prevent_self_review:body.prevent_self_review,reviewers:body.reviewers.map(r=>({type:r.type,reviewer:{id:r.id}}))}]:[])];
   const e={name:n,can_admins_bypass:body.can_admins_bypass,protection_rules:rules,deployment_branch_policy:body.deployment_branch_policy};seed(n,e);return e;
  }
  if(method==="GET")return envs.get(n);
  throw Error("unexpected");
 };
 return {api,calls,events,envs,policies,names,vars,secretNames:async n=>[...names.get(n)],
  setSecret:async(n,k,v)=>{calls.push({method:"SECRET",n,k});assert(v===key||v===token);names.get(n).add(k)},
  setVar:async(n,k,v)=>vars.set(n+":"+k,v),getVar:async(n,k)=>vars.get(n+":"+k),emit:x=>events.push(x)};
}
test("new protected audit and owner-reviewed write environments, exactly three secret writes",async()=>{
 const f=fixture(),x=await setupCustody({key,token},f);assert.equal(x.automaticPilotAuditOnReviewedMerge,true);
 assert.equal(x.targetForwardingEnabledByThisScript,false);assert.equal(f.calls.filter(c=>c.method==="SECRET").length,3);
 assert.deepEqual([...f.names.get(A)],[K]);assert.deepEqual([...f.names.get(M)],[K,P]);
 assert.equal(f.envs.get(M).protection_rules.find(r=>r.type==="required_reviewers").reviewers[0].reviewer.id,12);
 assert.deepEqual(f.policies.get(A),[{name:"main",type:"branch"}]);assert(!JSON.stringify({x,events:f.events,calls:f.calls}).includes(token));
});
test("wrong actor, drift, active routine audit fail before all secret/config mutations",async()=>{
 for(const fault of ["wrongOwner","drift","activeAudit"]){const f=fixture(fault);await assert.rejects(setupCustody({key,token},f));assert(f.calls.every(c=>c.method==="GET"))}
});
test("unsafe existing environment with a secret or broad branch policy cannot be overwritten",async()=>{
 for(const fault of ["existingUnsafe","existingExtra"]){const f=fixture(fault);await assert.rejects(setupCustody({key,token},f));assert.equal(f.calls.filter(c=>c.method==="SECRET").length,0);assert.equal(f.calls.filter(c=>c.method==="PUT").length,0)}
});
test("existing exact environments can safely rotate stored values without reconfiguring rules",async()=>{
 const f=fixture();await setupCustody({key,token},f);const n=f.calls.length;await setupCustody({key,token},f);
 assert.equal(f.calls.slice(n).filter(c=>["PUT","POST"].includes(c.method)).length,0);
 assert.equal(f.calls.slice(n).filter(c=>c.method==="SECRET").length,3);
});
