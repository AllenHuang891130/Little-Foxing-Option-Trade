'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {House,ChartNoAxesCombined,BookOpen,FlaskConical,Newspaper,Feather} from 'lucide-react';

const links=[
  {href:'/',label:'Home',Icon:House},
  {href:'/analytics/options',label:'Analytics',Icon:ChartNoAxesCombined},
  {href:'/markets-insights',label:'Markets',Icon:Newspaper},
  {href:'/research',label:'Research',Icon:BookOpen},
  {href:'/strategies',label:'Strategies',Icon:FlaskConical}
];

export default function Navigation(){
  const path=usePathname();
  const active=(href:string)=>href==='/'?path===href:path===href||path.startsWith(href+'/');
  return <>
    <aside className="sidebar gazette-sidebar">
      <Link href="/" className="brand gazette-brand" aria-label="Little Foxing home">
        <span className="brandmark"><Feather size={24}/></span>
        <span className="brandwords"><strong>LITTLE FOXING</strong><small>THE QUANTITATIVE GAZETTE</small></span>
      </Link>
      <div className="navlabel">THE EDITIONS</div>
      <nav aria-label="Primary navigation">
        {links.map(({href,label,Icon})=><Link className={'navitem '+(active(href)?'active':'')} href={href} key={href}><Icon size={18}/><span>{label}</span></Link>)}
      </nav>
      <div className="sidefoot"><span className="sidefoot-rule"/>Independent research<br/>Markets · Methods · Evidence</div>
    </aside>
    <nav className="bottomnav" aria-label="Mobile navigation">
      {links.map(({href,label,Icon})=><Link className={active(href)?'active':''} href={href} key={href}><Icon size={20}/><span>{label}</span></Link>)}
    </nav>
  </>;
}
