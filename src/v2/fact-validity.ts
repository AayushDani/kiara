import type {FactAssertion} from './contracts';
/** Historical assertions stay readable, but may not authorize a new present-tense decision. */
export function factCurrentlyConfirmed(f:FactAssertion,now=Date.now()){return f.status==='confirmed'&&(!f.validFrom||Number.isFinite(Date.parse(f.validFrom))&&Date.parse(f.validFrom)<=now)&&(!f.validUntil||Number.isFinite(Date.parse(f.validUntil))&&Date.parse(f.validUntil)>now);}
