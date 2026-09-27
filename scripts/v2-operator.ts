import {readFile,writeFile} from 'node:fs/promises';
import {backupWorkspace,restoreWorkspace,readWorkspace,transactWorkspace,closeV2Store} from '../src/v2/store';
import {importLegacySnapshot,exportLegacyArchive} from '../src/v2/migration';
import type {Role} from '../src/v2/contracts';

const [operation,tenantId,...args]=process.argv.slice(2);
const roles:Role[]=['member','admin','business_owner','fact_owner','legal_reviewer','publisher','signatory','evaluator','integration'];
async function main(){
 if(!tenantId)throw new Error('Usage: v2-operator <inspect|provision|backup|restore-check|restore|migrate-check|migrate|legacy-export> <tenant> [arguments]');
 if(operation==='inspect'){const s=await readWorkspace(tenantId);return {tenantId,version:s.version,memberships:s.memberships.map(m=>({actorId:m.actorId,roles:m.roles,revokedAt:m.revokedAt})),migration:s.migration?.status||null};}
 if(operation==='provision'){
  const [actorId,roleList,expected]=args,grants=(roleList||'').split(',') as Role[];
  if(!actorId||!grants.length||grants.some(r=>!roles.includes(r))||!/^\d+$/.test(expected||''))throw new Error('provision requires actor ID, comma-separated roles and inspected workspace version');
  return (await transactWorkspace(tenantId,s=>{if(s.version!==Number(expected))throw new Error('Workspace version changed');if(s.memberships.some(m=>m.actorId===actorId))throw new Error('Membership exists; use an audited change rather than overwrite');s.memberships.push({actorId,roles:grants,version:1,expiresAt:null,revokedAt:null,matterIds:null,entityIds:null});return {actorId,roles:grants};})).result;
 }
 if(operation==='backup'){if(!args[0])throw new Error('Supply a new backup path');await writeFile(args[0],JSON.stringify(await backupWorkspace(tenantId)),{flag:'wx',mode:0o600});return {backup:args[0],containsSensitiveData:true};}
 if(operation==='restore-check'||operation==='restore'){const backup=JSON.parse(await readFile(args[0],'utf8'));if(backup.state?.tenantId!==tenantId)throw new Error('Tenant does not match backup');return restoreWorkspace(backup,Number(args[1]),operation==='restore-check');}
 if(operation==='migrate-check'||operation==='migrate')return importLegacySnapshot(tenantId,await readFile(args[0]),Number(args[1]),operation==='migrate-check');
 if(operation==='legacy-export'){await writeFile(args[0],await exportLegacyArchive(tenantId),{flag:'wx',mode:0o600});return {path:args[0],effectOwner:'legacy'};}
 throw new Error('Unknown operation');
}
main().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error instanceof Error?error.message:'Operator command failed');process.exitCode=1;}).finally(closeV2Store);
