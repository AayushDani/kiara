// Run with Node --env-file=.env.local. Prints metadata only; never provider error bodies.
import OpenAI from 'openai';
const client=new OpenAI({maxRetries:0,timeout:20000});
const models=[process.env.KIARA_MODEL||'gpt-6-astra',process.env.KIARA_REVIEW_MODEL||'gpt-6-sol'];
const checks=[];
for(const model of new Set(models)){
  try{const {data:result,response}=await client.models.retrieve(model).withResponse();checks.push({requested_model:model,accessible:result.id===model,returned_model:result.id,provider_project:response.headers.get('openai-project'),provider_organization:response.headers.get('openai-organization')});}
  catch(error:any){checks.push({requested_model:model,accessible:false,http_status:error.status??null,code:typeof error.code==='string'?error.code:null});}
}
console.log(JSON.stringify({checked_at:new Date().toISOString(),credential_configured:!!process.env.OPENAI_API_KEY,checks,inference_tested:false},null,2));
if(checks.some(c=>!c.accessible))process.exitCode=1;
