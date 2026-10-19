'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {House,ChartNoAxesCombined,BookOpen,FlaskConical,Atom} from 'lucide-react';
const links=[{href:'/',label:'Home',Icon:House},{href:'/analytics/options',label:'Analytics',Icon:ChartNoAxesCombined},{href:'/research',label:'Research',Icon:BookOpen},{href:'/strategies',label:'Strategies',Icon:FlaskConical}];
export default function Navigation(){const path=usePathname();return <><aside className="sidebar"><Link href="/" className="brand"><span className="brandmark"><Atom size={22}/></span><span>QUANT<span className="brandlight"> RESEARCH</span><small>Independent Research Lab</small></span></Link><div className="navlabel">WORKSPACE</div><nav>{links.map(({href,label,Icon})=><Link className={'navitem '+(path===href?'active':'')} href={href} key={href}><Icon size={19}/>{label}</Link>)}</nav><div className="sidefoot">Research • Data • Evidence<br/><span>Prototype v0.1</span></div></aside><nav className="bottomnav">{links.map(({href,label,Icon})=><Link className={path===href?'active':''} href={href} key={href}><Icon size={21}/><span>{label}</span></Link>)}</nav></>}
