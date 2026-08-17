import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export async function POST(req:Request){
  const secret=req.headers.get("x-sync-secret");
  if(!secret || secret!==process.env.SYNC_SECRET)
    return NextResponse.json({error:"Unauthorized"},{status:401});

  const year=Number(new URL(req.url).searchParams.get("season")||new Date().getFullYear());
  const apiUrl=process.env.CFL_API_URL || "https://api.cfl.ca/v1/games";
  const apiKey=process.env.CFL_API_KEY;
  if(!apiKey) return NextResponse.json({error:"CFL_API_KEY is not configured"},{status:500});

  // The exact CFL API contract can vary by access tier. Keep the provider-specific
  // request on the server so the key is never exposed to players.
  const response=await fetch(`${apiUrl}/${year}`,{
    headers:{Authorization:`Bearer ${apiKey}`,Accept:"application/json"},
    cache:"no-store"
  });
  if(!response.ok) return NextResponse.json({error:`CFL API returned ${response.status}`},{status:502});
  const payload=await response.json();

  const games=payload.games || payload.data || payload;
  if(!Array.isArray(games)) return NextResponse.json({error:"Unexpected CFL API response shape"},{status:502});

  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let imported=0;
  for(const g of games){
    const away=g.away_team?.name || g.awayTeam?.name || g.away_team;
    const home=g.home_team?.name || g.homeTeam?.name || g.home_team;
    const kickoff=g.date || g.kickoff || g.start_time;
    if(!away||!home||!kickoff) continue;

    const weekNumber=Number(g.week || g.week_number || 0);
    if(!weekNumber) continue;

    const {data:week}=await db.from("weeks").upsert({
      season:year,week_number:weekNumber,
      deadline:g.deadline || new Date(new Date(kickoff).getTime()-30*60*1000).toISOString(),
      status:"open"
    },{onConflict:"season,week_number"}).select().single();
    if(!week) continue;

    const externalId=String(g.id || g.game_id || `${year}-${kickoff}-${away}-${home}`);
    const {data:existing}=await db.from("games").select("id,spread_locked").eq("week_id",week.id).eq("external_id",externalId).maybeSingle();
    const incomingSpread = g.spread ?? g.point_spread ?? null;
    const update:any={
      week_id:week.id, external_id:externalId,
      kickoff:new Date(kickoff).toISOString(),
      away_team:away, home_team:home,
      status:g.status==="final"?"final":"scheduled",
      away_score:g.away_score ?? null, home_score:g.home_score ?? null
    };
    if(!existing?.spread_locked && incomingSpread!=null){
      update.spread=Number(incomingSpread);
      update.spread_source="theScore";
    }
    await db.from("games").upsert(update,{onConflict:"week_id,external_id"});
    imported++;
  }
  return NextResponse.json({ok:true,imported,season:year});
}