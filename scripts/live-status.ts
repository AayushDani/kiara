import {readFile} from 'node:fs/promises';
import {withDemoScope} from '../src/server/demo-context';
import {readState,closeStore} from '../src/data/store';
import {globalSpendStatus} from '../src/server/global-spend';
Object.assign(process.env,{KIARA_AUTH_MODE:'public_demo',KIARA_OPENAI_BUDGET_USD:'50'});
const label=process.env.KIARA_ACCEPTANCE_RUN||'';if(!/^[a-z0-9-]{0,40}$/.test(label))throw new Error('Invalid run label');
const {scope}=JSON.parse(await readFile('.kiara/live-acceptance-scope'+(label?'-'+label:'')+'.json','utf8'));
try{await withDemoScope(scope,async()=>{const s=await readState();console.log(JSON.stringify({workflows:s.workflows.map(w=>({id:w.workflow_id,state:w.state,model_status:w.model_status,cost:w.cost_usd,attempts:w.model_attempts,failure:w.failure})),last_events:s.events.slice(-5).map(e=>({type:e.type,detail:e.detail})),global_budget:await globalSpendStatus()},null,2));});}finally{await closeStore();}
