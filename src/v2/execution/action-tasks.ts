import {randomUUID} from 'node:crypto';
import type {Action,Matter,MatterTask} from '../contracts';

function taskFor(matter:Matter,action:Action){return matter.tasks.find(task=>task.kind==='action'&&task.evidenceIds.includes(action.id));}

/** An authorized effect has an owned open task until exact completion evidence exists. */
export function assignActionTask(matter:Matter,action:Action,ownerId:string){
 const existing=taskFor(matter,action);
 if(existing){existing.ownerId=ownerId;existing.status='pending';return existing;}
 const task:MatterTask={id:randomUUID(),title:`Complete or reconcile “${action.title}”`,ownerId,status:'pending',kind:'action',purpose:'work',dueAt:null,deadlineType:'undated',evidenceIds:[action.id]};
 matter.tasks.push(task);
 return task;
}

export function setActionTaskStatus(matter:Matter,action:Action,status:MatterTask['status']){
 const task=taskFor(matter,action);
 if(task)task.status=status;
}

/** A reviewed no-action decision cancels the effect and retires its open task. */
export function retireCanceledActionTask(matter:Matter,action:Action){matter.tasks=matter.tasks.filter(task=>!(task.kind==='action'&&task.evidenceIds.includes(action.id)));}
