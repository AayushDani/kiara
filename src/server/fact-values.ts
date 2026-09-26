import {AppError,type Fact,type Json} from './contracts';

export const FACT_LIMITS=Object.freeze({count:128,key:80,json_bytes:16384,depth:6,nodes:512,string:8192,collection:128});
/** Bounds untrusted proposals without treating any proposed value as verified context. */
export function validateProposedFactValue(fact_key:string,value:unknown,existingFacts:readonly Fact[]):asserts value is Json{
  if(typeof fact_key!=='string'||! /^[a-z][a-z0-9_]{0,79}$/.test(fact_key)||['__proto__','constructor','prototype'].includes(fact_key))throw new AppError('INVALID_FACT_KEY','Fact keys must start with a lowercase letter and contain at most 80 lowercase letters, numbers, or underscores.',400);
  if(!existingFacts.some(f=>f.fact_key===fact_key)&&existingFacts.length>=FACT_LIMITS.count)throw new AppError('FACT_CAPACITY','The verified company context has reached its 128-fact limit.',400);
  let nodes=0;
  function visit(v:unknown,depth:number):boolean{
    if(++nodes>FACT_LIMITS.nodes||depth>FACT_LIMITS.depth)return false;
    if(v===null||typeof v==='boolean')return true;
    if(typeof v==='number')return Number.isFinite(v);
    if(typeof v==='string')return v.length<=FACT_LIMITS.string;
    if(Array.isArray(v))return v.length<=FACT_LIMITS.collection&&v.every(x=>visit(x,depth+1));
    if(typeof v!=='object'||!v||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;
    const entries=Object.entries(v);return entries.length<=FACT_LIMITS.collection&&entries.every(([key,item])=>key.length<=FACT_LIMITS.key&&!['__proto__','constructor','prototype'].includes(key)&&visit(item,depth+1));
  }
  if(!visit(value,0)||Buffer.byteLength(JSON.stringify(value),'utf8')>FACT_LIMITS.json_bytes)throw new AppError('INVALID_FACT_VALUE','Provide a bounded JSON fact (at most 16 KB, six nested levels, and 512 values).',400);
}
