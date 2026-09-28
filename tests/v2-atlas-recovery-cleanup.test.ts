import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRecoveryCleanupInventory} from '../scripts/v2-atlas-recovery-state-qualify';

const expected={marker:'generated-marker',tenantId:'synthetic-recovery-generated'};
const inventory=()=>({collections:['qualification_identity','v2_normalized_heads','v2_records_sources','v2_original_manifests','v2_original_chunks','v2_original_fences'],markers:[{_id:expected.marker,tenantId:expected.tenantId}],foreignCounts:{v2_normalized_heads:0,v2_records_sources:0,v2_original_manifests:0},foreignChunks:0,foreignFences:0});

test('synthetic Atlas recovery cleanup requires exclusive ownership before database drop',()=>{
 assert.doesNotThrow(()=>assertRecoveryCleanupInventory(inventory(),expected));
 const cases=[
  {...inventory(),collections:[...inventory().collections,'customer_records']},
  {...inventory(),markers:[...inventory().markers,{_id:'foreign',tenantId:'other'}]},
  {...inventory(),markers:[{_id:expected.marker,tenantId:'other'}]},
  {...inventory(),foreignCounts:{...inventory().foreignCounts,v2_normalized_heads:1}},
  {...inventory(),foreignCounts:{...inventory().foreignCounts,v2_records_sources:1}},
  {...inventory(),foreignCounts:{...inventory().foreignCounts,v2_original_manifests:1}},
  {...inventory(),foreignChunks:1},
  {...inventory(),foreignFences:1},
 ];
 for(const found of cases)assert.throws(()=>assertRecoveryCleanupInventory(found,expected),/cleanup refused/);
});
