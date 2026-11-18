import test from "node:test";
import assert from "node:assert/strict";
import {setupTarget,validEnvironment} from "./owner-target-custody.mjs";
const token="github_pat_"+"x".repeat(40),relayPin="a".repeat(40),target="45d04392e2eecfc1220230f252d2ada8cc6137e0";
const A="travnr-target-rehearsal",B="travnr-target-forward",S="TRAVNR_TARGET_ACTIONS_TOKEN";
function fixture(fault=""){
 const envs=new Map(),branches=new Map(),secrets=new Map(),vars=new Map(),calls=[],events=[];
 const seed=(name,e,p=[],ss=[])=>{envs.set(name,e);branches.set(name,p);secrets.set(name,new Set(ss));};
 if(fault==="badBranch")seed(A,{name:A,can_admins_bypass:false,deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},protection_rules:[{type:"branch_policy"},{type:"required_reviewers",prevent_self_review:false,reviewers:[{type:"User",reviewer:{id:5}}]}]},[{name:"main",type:"branch"},{name:"*"}]);
 const api=async(method,path,body)=>{
  calls.push({method,path});
  if(path==="/user")return {login:fault==="actor"?"different":"HKcode22",id:5};
  if(path.endsWith("/git/ref/heads/main"))return {object:{sha:fault==="drift"?target:relayPin}};
  if(path.endsWith("/actions/variables?per_page=100"))return fault==="on"?{total_count:1,variables:[{name:"TRAVNR_RELAY_ROLLING_ENABLED",value:"1"}]}:{total_count:1,variables:[{name:"TRAVNR_RELAY_MODE",value:"CLOCK_ONLY"}]};
  if(path.endsWith("/environments?per_page=100"))return {total_count:envs.size,environments:[...envs.values()]};
  const name=path.match(/\/environments\/([^/?]+)/)?.[1];if(!name)throw Error("fixture API");
  if(path.endsWith("/deployment-branch-policies?per_page=100")){const p=branches.get(name);return {total_count:p.length,branch_policies:p};}
  if(path.endsWith("/deployment-branch-policies")&&method==="POST"){branches.get(name).push(body);return body;}
  if(method==="PUT"){
   const e={name,can_admins_bypass:body.can_admins_bypass,deployment_branch_policy:body.deployment_branch_policy,protection_rules:[{type:"branch_policy"},...(body.reviewers.length?[{type:"required_reviewers",prevent_self_review:body.prevent_self_review,reviewers:body.reviewers.map(r=>({type:r.type,reviewer:{id:r.id}}))}]:[])]};
   seed(name,e);return e;
  }return envs.get(name);
 };
 return {calls,envs,branches,secrets,events,api,readTarget:async(p,t)=>{
  assert.equal(t,token);
  if(p==="/git/ref/heads/main")return {object:{sha:fault==="targetDrift"?relayPin:target}};
  if(p.startsWith("/contents/"))return {sha:"c1356a0aa278745708b5bb9d20e1cdc0bc2bdf2a"};
  return {total_count:1,workflow_runs:[{id:1}]};
 },secretNames:async n=>[...secrets.get(n)],setSecret:async(n,k,v)=>{assert.equal(v,token);calls.push({method:"SECRET",n,k});secrets.get(n).add(k)},setVar:async(n,k,v)=>vars.set(n+":"+k,v),getVar:async(n,k)=>vars.get(n+":"+k),emit:x=>events.push(x)};
}
test("one prompt stores target credential in separately restricted environments without enabling anything",async()=>{
 const f=fixture(),x=await setupTarget({token,relayPin},f);
 assert.equal(x.forwardingEnabled,false);assert.equal(x.targetDispatches,0);
 assert(validEnvironment(f.envs.get(A),A,5,true));assert(validEnvironment(f.envs.get(B),B,5,false));
 assert.deepEqual([...f.secrets.get(A)],[S]);assert.deepEqual([...f.secrets.get(B)],[S]);assert.deepEqual(f.branches.get(B),[{name:"main",type:"branch"}]);
 assert(!JSON.stringify([x,f.calls,f.events]).includes(token));
});
test("target pin drift, current forwarding or incorrect owner stop before secret/config mutation",async()=>{
 for(const fault of ["actor","drift","on","targetDrift"]){const f=fixture(fault);await assert.rejects(setupTarget({token,relayPin},f));assert(f.calls.every(c=>c.method==="GET"));}
});
test("existing invalid environment is not overwritten even if no secret exists",async()=>{
 const f=fixture("badBranch");await assert.rejects(setupTarget({token,relayPin},f),/BRANCH_POLICY_NOT_MAIN_ONLY/);assert(f.calls.every(c=>c.method==="GET"));
});
test("safe exact repeated owner setup never adds duplicate branch protections",async()=>{
 const f=fixture();await setupTarget({token,relayPin},f);const n=f.calls.length;await setupTarget({token,relayPin},f);assert.equal(f.calls.slice(n).filter(x=>["PUT","POST"].includes(x.method)).length,0);
});
