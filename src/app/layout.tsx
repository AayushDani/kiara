import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Kiara — Company context, legal clarity',description:'From a business change to a source-backed legal review. A fictional company demo.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
