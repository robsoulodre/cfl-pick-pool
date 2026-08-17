import { supabase } from "@/lib/supabase";
import PicksClient from "./client";

export default async function Picks(){
  const {data: weeks} = await supabase.from("weeks").select("*").order("week_number",{ascending:false}).limit(1);
  const week = weeks?.[0];
  const {data: games} = week ? await supabase.from("games").select("*").eq("week_id",week.id).order("kickoff") : {data:[]};
  return <PicksClient week={week ?? null} games={games ?? []}/>;
}