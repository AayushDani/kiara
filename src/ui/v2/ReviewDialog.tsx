'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {Icon} from './Primitives';
import s from './workspace.module.css';

export function Modal({title,children,footer,close,error}:{title:string;children:ReactNode;footer?:ReactNode;close:()=>void;error?:string}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const before=document.activeElement as HTMLElement|null;ref.current?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close();if(event.key==='Tab'){const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,select,[tabindex="0"]')??[]);const first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();return}if(event.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);before?.focus()}},[close]);
  return <div className={s.modalBackdrop} onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div ref={ref} className={s.modal} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><header className={s.modalHeader}><h2>{title}</h2><button className={s.iconButton} onClick={close} aria-label="Close dialog"><Icon name="close"/></button></header><div className={s.modalBody}>{error&&<div className={s.error} role="alert">{error}</div>}{children}</div>{footer&&<footer className={s.modalFooter}>{footer}</footer>}</div></div>
}
