/* Full offline JSON Schema compilation and examples. No application/provider calls. */
const fs=require('fs'),path=require('path');
const Ajv2020=require('../research/T13/feasibility/node_modules/ajv/dist/2020');
const Ajv=require('../research/T13/feasibility/node_modules/ajv');
const formats=require('../research/T13/feasibility/node_modules/ajv-formats');
const root=path.resolve(__dirname,'..'),checks=[],schemas=new Map();
const ajv=new Ajv2020({strict:false,allErrors:true,validateFormats:true});formats(ajv);
const ajv7=new Ajv({strict:false,allErrors:true,validateFormats:true});formats(ajv7);
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const add=(name,passed,details)=>checks.push({name,passed:!!passed,...(details?{details}:{})});
function files(d){return fs.readdirSync(path.join(root,d),{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(d+'/'+x.name):[d+'/'+x.name]);}
for(const f of files('contracts')){
 if(!f.endsWith('.json'))continue; const s=read(f);if(!s.$schema||!s.$id)continue;
 const engine=s.$schema.includes('2020-12')?ajv:ajv7;
 try{engine.addSchema(s);schemas.set(f,{s,engine});add('schema_registered:'+f,true);}catch(e){add('schema_registered:'+f,false,e.message);}
}
for(const [f,{s,engine}]of schemas){
 if(f.startsWith('contracts/workflow/')){
  const alias='https://kiara.example/contracts/'+path.basename(f);
  if(!engine.getSchema(alias))engine.addSchema({$id:alias,$ref:s.$id});
 }
}
for(const [f,{s,engine}]of schemas){
 try{engine.getSchema(s.$id);for(const k of Object.keys(s.$defs||{}))engine.compile({$ref:s.$id+'#/$defs/'+k});add('schema_compiles_all_defs:'+f,true);}catch(e){add('schema_compiles_all_defs:'+f,false,e.message);}
}
function validate(label,file,fragment,data,expected=true){
 try{const q=schemas.get(file);if(!q)throw Error('Schema not registered '+file);const v=q.engine.compile({$ref:q.s.$id+(fragment||'')});const ok=v(data);add(label,ok===expected,ok===expected?undefined:v.errors);}catch(e){add(label,false,e.message);}
}
for(const x of read('contracts/runtime/runtime-examples.json').examples)validate('runtime:'+x.name,'contracts/runtime/runtime-contracts.schema.json','#/$defs/'+x.schema_def,x.value);
const ret=read('contracts/context/operation-examples.json').operations;
for(const x of read('contracts/context/operation-schema-map.json').operations)for(const k of ['request','success','error']){
 const[f,frag]=x[k+'_schema'].split('#');validate(x.operation_id+':'+k,'contracts/context/'+f,'#'+frag,ret[x.operation_id][k]);
}
for(const x of read('contracts/documents/document-io-examples.json').exchanges)for(const k of ['request','success','error'])validate(x.contract_id+':'+k,'contracts/documents/document-io.schema.json','#/$defs/'+x.contract_id.replaceAll('-','_')+'_'+k,x[k]);
for(const x of read('contracts/workflow/command-io.examples.json').examples){
 const frag=s=>s.includes('#')?s.substring(s.indexOf('#')):s;
 validate(x.case_id+':context','contracts/workflow/command-io.schema.json','#/$defs/TrustedCommandContext',x.context);
 validate(x.case_id+':request','contracts/workflow/command-io.schema.json',frag(x.request_schema),x.request);
 validate(x.case_id+':response','contracts/workflow/command-io.schema.json',frag(x.response_schema),x.response);
}
const obs=read('contracts/observability/read-models-bindings.json').endpoints;
for(const x of read('contracts/observability/read-models-examples.json').exchanges){const spec=obs.find(z=>z.endpoint_id===x.endpoint_id);for(const k of ['request','success'])validate(x.endpoint_id+':'+k,'contracts/observability/read-models.schema.json',spec[k+'_schema'],x[k]);for(const [i,e]of x.errors.entries())validate(x.endpoint_id+':error'+i,'contracts/observability/read-models.schema.json',spec.error_schema,e);}
const simple=[['example-events.json','event.schema.json'],['example-workflow.json','workflow.schema.json'],['example-job.json','job.schema.json'],['example-notification.json','notification.schema.json'],['example-review-bundle.json','review-bundle.schema.json'],['example-review-command.json','review-command.schema.json'],['example-feedback-command.json','feedback-command.schema.json']];
for(const [f,s]of simple){let xs=read('contracts/workflow/'+f);if(f==='example-events.json')xs=xs.events;if(!Array.isArray(xs))xs=[xs];xs.forEach((x,i)=>validate(f+':'+i,'contracts/workflow/'+s,'',x));}
const ux=read('contracts/ux/canonical-wire-examples.json');for(const [key,s]of [['review_commands','review-command.schema.json'],['feedback_commands','feedback-command.schema.json']])ux[key].forEach((x,i)=>validate('ux:'+key+':'+i,'contracts/workflow/'+s,'',x));
const hc=read('fixtures/harness/command-examples.json');for(const[k,s]of [['propose_harness_change','propose_harness_change_model_arguments'],['promote_harness_version','promote_harness_version_server_arguments'],['validation_result','validation_result']])validate('harness:'+k,'contracts/harness/harness-commands.schema.json','#/$defs/'+s,hc[k]);
for(const f of ['config-before.json','config-after.json'])validate('harness:'+f,'contracts/harness/harness-config.schema.json','',read('fixtures/harness/'+f));
read('contracts/observability/telemetry-examples.json').spans.forEach((x,i)=>validate('telemetry:'+i,'contracts/observability/telemetry-span.schema.json','',x));
const nt=read('contracts/notification/notification-examples.json');for(const[k,v]of Object.entries(nt))if(k!=='classification')validate('notification:'+k,'contracts/notification/notification-adapter.schema.json','#/$defs/'+(k.includes('request')?'request':'result'),v);
const result={checked_at:new Date().toISOString(),scope:'Ajv 8.17.1 with formats: complete schema compilation and supplied examples. No Atlas or runtime application behavior executed.',passed:checks.every(x=>x.passed),checks_count:checks.length,checks};fs.writeFileSync(path.join(root,'validation/wire-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,checks_count:checks.length,failures:checks.filter(x=>!x.passed)},null,2));process.exitCode=result.passed?0:1;
