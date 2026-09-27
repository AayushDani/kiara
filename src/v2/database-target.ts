import {V2Error} from './contracts';

/** Hosted v2 must never inherit the legacy demo database. */
export function v2DatabaseName(){
  const name=process.env.MONGODB_DB;
  if(process.env.VERCEL&&name!=='kiara_v2')throw new V2Error('V2_DATABASE_TARGET','Hosted v2 requires the dedicated kiara_v2 Atlas database.',503);
  return name||'kiara';
}
