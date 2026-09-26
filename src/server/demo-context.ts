import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './contracts';

export interface DemoScope {id:string;expires_at:number}
const context=new AsyncLocalStorage<DemoScope>();
export const publicDemo=()=>process.env.KIARA_AUTH_MODE==='public_demo';
export function demoScope(){
  const scope=context.getStore();
  if(publicDemo()&&!scope)throw new AppError('DEMO_SESSION_REQUIRED','Open the demo before continuing.',401);
  return scope;
}
export function withDemoScope<T>(scope:DemoScope,fn:()=>T):T{
  if(!/^[a-f0-9]{32}$/.test(scope.id)||!Number.isFinite(scope.expires_at)||scope.expires_at<=Date.now())throw new AppError('DEMO_EXPIRED','Open a fresh demo session.',401);
  return context.run(scope,fn);
}
