import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navigation from '../components/Navigation';
export const metadata: Metadata = {title:'Quant Research Lab',description:'Independent quantitative finance research, options analytics and literature reviews',applicationName:'Quant Research Lab',manifest:'/manifest.webmanifest'};
export const viewport: Viewport = {width:'device-width',initialScale:1,themeColor:'#0a1220'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><div className="shell"><Navigation/><main className="content">{children}</main></div></body></html>}
