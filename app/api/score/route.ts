import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export async function POST(req:Request){
 const secret=req.headers.get("x-score-secret");
 if(!secret || secret!==process.env.SCORE_SECRET) return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await req.json();
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
 const {weekId}=body;
 const {data:games}=await admin.from("games").select("*").eq("week_id",weekId).eq("status","final");
 const {data:picks}=await admin.from("picks").select("*").eq("week_id",weekId);
 if(!games||!picks)return NextResponse.json({error:"Missing data"},{status:400});
 const gameMap:any=Object.fromEntries(games.map(g=>[g.id,g]));
 const users:any={};
 for(const p of picks){
   const g=gameMap[p.game_id]; if(!g)continue;
   const winner=g.away_score>g.home_score?g.away_team:g.home_team;
   users[p.user_id]??={winner:0,spread:0};
   if(p.winner_team===winner)users[p.user_id].winner+=p.confidence;
   if(p.spread_team){
     const margin=g.away_score-g.home_score;
     const line=Number(g.spread||0);
     const covered=g.away_team===p.spread_team ? margin>line : margin < -line;
     if(covered)users[p.user_id].spread+=1;
   }
 }
 for(const [user_id,s] of Object.entries(users)){
   await admin.from("week_scores").upsert({user_id,week_id:weekId,winner_points:(s as any).winner,spread_points:(s as any).spread},{onConflict:"user_id,week_id"});
 }
 return NextResponse.json({ok:true,users:Object.keys(users).length});
}