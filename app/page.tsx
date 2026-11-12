import Link from 'next/link';
import {ArrowUpRight,ChartNoAxesCombined,BookOpen,FlaskConical,Newspaper,ArrowRight} from 'lucide-react';
import SmileChart from '../components/SmileChart';

const editions=[
 {href:'/markets-insights',number:'01',label:'THE DAILY EDITION',title:'Markets',desc:'Global markets, macroeconomic releases, fixed income and independent commentary.',Icon:Newspaper},
 {href:'/research',number:'02',label:'THE RESEARCH DESK',title:'Research Library',desc:'Academic papers, literature reviews, working notes and empirical methods.',Icon:BookOpen},
 {href:'/strategies',number:'03',label:'THE STRATEGY DESK',title:'Strategy Lab',desc:'Trading hypotheses, backtests, execution research and performance evidence.',Icon:FlaskConical},
 {href:'/analytics/options',number:'04',label:'THE DATA DESK',title:'Options Analytics',desc:'TXO / MTX analytics, volatility smiles, open interest and market structure.',Icon:ChartNoAxesCombined}
];

export default function Home(){
 return <div className="gazette-home">
   <header className="gazette-masthead">
     <div className="gazette-masthead-top"><span>INDEPENDENT QUANTITATIVE FINANCE RESEARCH</span><span>TAIWAN · GLOBAL MARKETS</span></div>
     <div className="gazette-name">Little Foxing</div>
     <div className="gazette-masthead-bottom"><span>THE QUANTITATIVE GAZETTE</span><span>RESEARCH · DATA · EVIDENCE</span></div>
   </header>
   <section className="gazette-lead" aria-labelledby="gazette-lead-title">
     <div className="gazette-lead-copy">
       <div className="gazette-kicker">FROM THE EDITOR'S DESK</div>
       <h1 id="gazette-lead-title">Research markets.<br/><em>Understand risk.</em></h1>
       <p>Independent financial research at the intersection of options markets, empirical evidence and systematic trading.</p>
       <Link href="/markets-insights" className="gazette-cta">Read the latest market insights <ArrowUpRight size={17}/></Link>
       <div className="gazette-lead-note">ANALYSIS, NOT INVESTMENT ADVICE</div>
     </div>
     <div className="gazette-figure">
       <div className="gazette-figure-top"><span>FIG. 01 / OPTIONS MARKET STRUCTURE</span><span>ILLUSTRATIVE DATA</span></div>
       <SmileChart/>
       <p>Implied volatility, risk pricing and the shape of market expectations.</p>
     </div>
   </section>
   <section className="gazette-editions" aria-labelledby="gazette-editions-title">
     <div className="gazette-section-heading"><span>THE INDEX</span><h2 id="gazette-editions-title">Explore the Editions</h2><span>FOUR RESEARCH DESKS</span></div>
     <div className="gazette-edition-grid">
       {editions.map(({href,number,label,title,desc,Icon})=><Link href={href} key={href} className="gazette-edition">
         <div className="gazette-edition-top"><span>{number} / {label}</span><ArrowUpRight size={17}/></div>
         <div className="gazette-edition-body"><Icon size={23} strokeWidth={1.4}/><h3>{title}</h3><p>{desc}</p></div>
         <div className="gazette-edition-bottom">OPEN EDITION <ArrowRight size={15}/></div>
       </Link>)}
     </div>
   </section>
   <footer className="gazette-disclaimer">EDITORIAL NOTE — Little Foxing is an independent research project. Illustrative charts are not trading signals or investment recommendations.</footer>
 </div>;
}
