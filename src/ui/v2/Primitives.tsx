import type { ReactNode } from 'react';
import s from './workspace.module.css';

export type IconName = 'spark'|'chat'|'work'|'file'|'company'|'activity'|'arrow'|'plus'|'link'|'chevron'|'close'|'check'|'settings'|'shield'|'mic'|'clock'|'download';
export function Icon({name,size=18}:{name:IconName;size?:number}) {
  const shapes:Record<IconName,ReactNode> = {
    spark:<><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6"/></>,
    chat:<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/>,
    work:<><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18m-11 0v3h4v-3"/></>,
    file:<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></>,
    company:<><path d="M4 21V7l8-4 8 4v14M2 21h20M9 21v-5h6v5M8 9h1m6 0h1M8 12h1m6 0h1"/></>,
    activity:<path d="M3 12h4l3-7 4 14 3-7h4"/>,
    arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,plus:<path d="M12 5v14M5 12h14"/>,
    link:<><path d="m10 13 4-4M8 16l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 0 3-3a3 3 0 1 1 4 4l-5 5a3 3 0 0 1-4 0"/></>,
    chevron:<path d="m9 5 7 7-7 7"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,check:<path d="m5 12 4 4L19 6"/>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2-1 3 1 1 3 4-1 1-3 3-1v-4l-3-1-1-3-3-1Z"/></>,
    shield:<><path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6Z"/><path d="m8 12 3 3 5-6"/></>,
    mic:<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,download:<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}
export function Brand(){return <span className={s.brand}><span className={s.brandMark}><Icon name="spark" size={20}/></span>kiara<span className={s.brandDot}>.</span></span>}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'purple'|'green'|'amber'|'red'}){return <span className={s.badge} data-tone={tone}>{children}</span>}
export function Empty({icon='file',title,children,action}:{icon?:IconName;title:string;children:ReactNode;action?:ReactNode}){return <div className={s.empty}><span className={s.emptyIcon}><Icon name={icon} size={25}/></span><h3>{title}</h3><p>{children}</p>{action}</div>}
export function human(value:string){return value.replaceAll('_',' ').replace(/^./,x=>x.toUpperCase())}
export function date(value:string|null){return value?new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'Not set'}
