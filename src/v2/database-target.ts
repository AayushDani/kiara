import {V2Error} from './contracts';

/** Hosted v2 must never inherit the legacy demo database. */
export function v2DatabaseName(){
  const name=process.env.MONGODB_DB;
  const hosted=!!process.env.VERCEL||process.env.NODE_ENV==='production'||process.env.KIARA_V2_AUTH_MODE==='oidc'||process.env.KIARA_V2_ORCHESTRATION_MODE==='temporal'||!!process.env.KIARA_V2_WORKER_HOST;
  if(hosted&&name!=='kiara_v2')throw new V2Error('V2_DATABASE_TARGET','Hosted v2 requires the dedicated kiara_v2 Atlas database.',503);
  return name||'kiara';
}
