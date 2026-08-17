 "use client";
import {useState} from "react";
import {supabase} from "../../lib/supabase";

export default function PicksClient({week,games}:{week:any,games:any[]}){
 const [values,setValues]=useState<any>({});
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState("");
 if(!week) return <main className="container"><section className="card"><h1>No week is open</h1><p>The commissioner has not published the next CFL week yet.</p></section></main>;
 const set=(id:string,key:string,value:any)=>setValues((v:any)=>({...v,[id]:{...(v[id]||{}),[key]:value}}));
 const submit=async()=>{
   setMessage(""); setSaving(true);
   const {data:{user}}=await supabase.auth.getUser();
   if(!user){setMessage("Please log in before submitting picks.");setSaving(false);return;}
   const picks=games.map(g=>({user_id:user.id,week_id:week.id,game_id:g.id,winner_team:values[g.id]?.winner,confidence:Number(values[g.id]?.confidence),spread_team:values[g.id]?.spread||null}));
   if(picks.some(p=>!p.winner||![1,2,3,4].includes(p.confidence))){setMessage("Choose a winner and confidence number for every game.");setSaving(false);return;}
   if(new Set(picks.map(p=>p.confidence)).size!==4){setMessage("Use confidence numbers 1, 2, 3 and 4 exactly once.");setSaving(false);return;}
   if(picks.filter(p=>p.spread_team).length!==2){setMessage("Choose exactly two point-spread games.");setSaving(false);return;}
   const {error}=await supabase.from("picks").upsert(picks,{onConflict:"user_id,week_id,game_id"});
   setMessage(error?error.message:"Your picks are locked in for this week!");
   setSaving(false);
 };
 return <main className="container">
   <section className="hero"><div><span className="pill">WEEK {week.week_number}</span><h1>Make your CFL picks</h1><p>Pick every winner, use confidence 1–4 exactly once, and choose two games against the spread. Other players’ picks stay hidden until each game kicks off.</p></div><div className="deadline">Deadline<br/><b>{new Date(week.deadline).toLocaleString()}</b></div></section>
   <div className="gamegrid">{games.map(g=><article className="game card" key={g.id}>
     <div className="muted">{new Date(g.kickoff).toLocaleString()}</div><h2>{g.away_team} <span>@</span> {g.home_team}</h2>
     <label>Winner</label><select value={values[g.id]?.winner||""} onChange={e=>set(g.id,"winner",e.target.value)}><option value="">Choose winner</option><option>{g.away_team}</option><option>{g.home_team}</option></select>
     <label>Confidence</label><div className="confidence">{[1,2,3,4].map(n=><button className={values[g.id]?.confidence===n?"selected":""} onClick={()=>set(g.id,"confidence",n)} key={n}>{n}</button>)}</div>
     <label>Point spread pick</label><select value={values[g.id]?.spread||""} onChange={e=>set(g.id,"spread",e.target.value)}><option value="">No spread pick</option><option>{g.away_team}</option><option>{g.home_team}</option></select>
     {g.spread!=null && <small>Frozen line: {g.spread > 0 ? "+" : ""}{g.spread} {g.spread_locked ? "🔒" : ""}</small>}
   </article>)}</div>
   <section className="card submit"><button className="primary" disabled={saving} onClick={submit}>{saving?"Saving…":"Submit My Picks"}</button>{message&&<strong>{message}</strong>}</section>
 </main>
}
