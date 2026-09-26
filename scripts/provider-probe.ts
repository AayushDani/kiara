import OpenAI from 'openai';
import {randomUUID} from 'node:crypto';
import {reserveGlobalSpend,settleGlobalSpend} from '../src/server/global-spend';
import {closeStore} from '../src/data/store';
import {tokenCost} from '../src/runtime/config';
Object.assign(process.env,{KIARA_OPENAI_BUDGET_USD:'50'});
const id=randomUUID(),model='gpt-6-sol';
const safe=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(value)?value:null;
try{
  await reserveGlobalSpend(id,0.02);
  try{
    const {data:response,response:http}=await new OpenAI({maxRetries:0,timeout:30000}).responses.create({model,input:'Reply OK.',max_output_tokens:32,reasoning:{effort:'low'},store:false}).withResponse();
    const cost=response.usage?tokenCost(model,response.usage.input_tokens,response.usage.output_tokens):0;
    await settleGlobalSpend(id,cost,!response.usage);
    console.log(JSON.stringify({provider_access:true,response_id:response.id,status:response.status,usage:response.usage,cost_usd:cost,rate_limits:Object.fromEntries(['x-ratelimit-limit-requests','x-ratelimit-limit-tokens','x-ratelimit-remaining-requests','x-ratelimit-remaining-tokens','x-ratelimit-reset-requests','x-ratelimit-reset-tokens'].map(key=>[key,http.headers.get(key)]))}));
  }catch(error:any){
    const rejected=[400,401,403,404,409,422,429].includes(error.status);await settleGlobalSpend(id,0,!rejected);
    console.log(JSON.stringify({provider_access:false,http_status:error.status??null,error_code:safe(error.code),error_type:safe(error.type),parameter:safe(error.param),retry_after:typeof error.headers?.get==='function'?error.headers.get('retry-after'):null}));process.exitCode=1;
  }
}finally{await closeStore();}
