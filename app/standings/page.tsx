import {supabase} from "@/lib/supabase";
export default async function Standings(){
 const {data}=await supabase.from("week_scores").select("*,profiles(display_name),weeks(week_number,season)").order("total_points",{ascending:false});
 const rows=data||[];
 const by:any={}; rows.forEach(r=>{const n=r.profiles?.display_name||"Player";by[n]=(by[n]||0)+r.total_points});
 const season=Object.entries(by).map(([name,total]:any)=>({name,total})).sort((a:any,b:any)=>b.total-a.total);
 return <main className="container"><section className="card"><h1>Season Standings</h1><table><thead><tr><th>Rank</th><th>Player</th><th>Points</th></tr></thead><tbody>{season.map((r:any,i)=><tr key={r.name}><td>{i+1}</td><td>{r.name}</td><td><b>{r.total}</b></td></tr>)}</tbody></table>{!season.length&&<p className="muted">Scores will appear after the commissioner records results.</p>}</section></main>
}