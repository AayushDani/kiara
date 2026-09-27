import type {SlackDeliveryView} from '@/v2/integrations/slack-status';
import {Badge} from './Primitives';
import s from './workspace.module.css';

const labels:Record<SlackDeliveryView['status'],string>={waiting_answer:'Answer pending',prepared:'Answer prepared · Slack delivery pending',dispatched:'Slack delivery attempt · confirmation pending',verified:'Slack delivery verified',uncertain:'Slack delivery unconfirmed',blocked:'Slack delivery blocked'};
const detail:Record<SlackDeliveryView['status'],string>={waiting_answer:'Your request is saved. An answer has not yet been prepared for the authorized Slack thread.',prepared:'The answer is prepared. No completed Slack delivery is claimed.',dispatched:'A delivery attempt has started, but an exact Slack readback has not yet confirmed the outcome. Do not resend while reconciliation is pending.',verified:'An exact readback confirmed the answer in its authorized Slack thread.',uncertain:'The provider outcome is uncertain. Do not resend; reconciliation must determine whether the original delivery occurred.',blocked:'The thread authority or answer evidence changed. Delivery requires operator attention; no delivery is claimed.'};

export function SlackDeliveryStatus({deliveries,conversationId}:{deliveries:SlackDeliveryView[];conversationId:string}){
 const current=deliveries.filter(item=>item.conversationId===conversationId);
 if(!current.length)return null;
 return <section aria-label="Slack delivery status" aria-live="polite" className={s.stack} style={{marginBottom:16}}>{current.map(item=><article key={item.id} className={s.previewBox}><Badge tone={item.status==='verified'?'green':item.status==='uncertain'||item.status==='blocked'?'amber':'purple'}>{labels[item.status]}</Badge><p className={s.small} style={{marginTop:8}}>{detail[item.status]}</p><p className={s.small}>Updated {new Date(item.updatedAt).toLocaleString()}</p></article>)}</section>;
}
