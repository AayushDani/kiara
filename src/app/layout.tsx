import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Kiara — Conversation, company memory, and legal work',description:'Talk to Kiara. Keep legal in step with your business. Explore, prepare, review and track authorized outcomes.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
