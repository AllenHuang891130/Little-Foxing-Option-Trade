import type {Metadata,Viewport} from 'next';
import './globals.css';
import Navigation from '../components/Navigation';

export const metadata:Metadata={
 title:{default:'Little Foxing | The Quantitative Gazette',template:'%s | Little Foxing'},
 description:'Independent quantitative finance research, markets, options analytics, academic literature and strategy research.',
 applicationName:'Little Foxing',
 manifest:'/manifest.webmanifest'
};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#f6f2e9'};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="en"><body><div className="shell"><Navigation/><main className="content">{children}</main></div></body></html>;
}
