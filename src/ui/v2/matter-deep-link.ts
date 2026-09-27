/** URL identity is navigation input only; the authenticated snapshot decides access. */
export function requestedMatterId(search:string):string|null {
 const params=new URLSearchParams(search),values=params.getAll('matter');
 return [...params.keys()].every(key=>key==='matter')&&values.length===1&&/^[A-Za-z0-9-]{1,200}$/.test(values[0])?values[0]:null;
}
export const matterSignInReturnTo=(matterId:string)=>`/api/v2/auth/start?returnTo=${encodeURIComponent(`/?matter=${matterId}`)}`;
