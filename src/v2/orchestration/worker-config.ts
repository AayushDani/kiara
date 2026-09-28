/** A managed worker must use the same issuer as the web tier to validate
 * the persisted OIDC binding carried by a queued browser request. */
export function assertManagedWorkerIdentityConfig(env:NodeJS.ProcessEnv):void{
 if(env.KIARA_V2_AUTH_MODE!=='oidc'||env.KIARA_OIDC_IDENTITY_SOURCE&&env.KIARA_OIDC_IDENTITY_SOURCE!=='mongo')throw new Error('Configure managed worker OIDC mode and MongoDB identity bindings.');
 let issuer:URL;
 try{issuer=new URL(env.KIARA_OIDC_ISSUER||'');}catch{throw new Error('Configure the managed worker OIDC issuer to match the web tier.');}
 if(issuer.protocol!=='https:'||issuer.username||issuer.password||issuer.search||issuer.hash||!issuer.hostname)throw new Error('Configure the managed worker OIDC issuer to match the web tier.');
}
