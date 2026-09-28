const loopback=(hostname:string)=>['localhost','127.0.0.1','[::1]'].includes(hostname);
/** Next's local request URL may normalize a numeric bind address to localhost.
 * Only the actual Host header can reconcile that local-only mismatch; forwarded
 * headers never establish an origin, and hosted requests always stay exact. */
export function requestOriginMatches(request:Request,allowLocalHostNormalization=false):boolean {
 const value=request.headers.get('origin');if(!value)return false;
 const target=new URL(request.url);if(value===target.origin)return true;
 if(!allowLocalHostNormalization||!loopback(target.hostname))return false;
 try{const origin=new URL(value),host=request.headers.get('host');return value===origin.origin&&!!host&&host===origin.host&&loopback(origin.hostname)&&origin.protocol===target.protocol&&origin.port===target.port;}catch{return false;}
}
