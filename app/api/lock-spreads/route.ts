import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
export async function POST(req:Request){
 const secret=req.headers.get("x-commissioner-secret");
 if(secret!==process.env.COMMISSIONER_SECRET)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {weekId}=await req.json();
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
 const now=new Date().toISOString();
 const {data,error}=await db.from("games").update({spread_locked:true,spread_locked_at:now}).eq("week_id",weekId).select("id,spread");
 if(error)return NextResponse.json({error:error.message},{status:400});
 return NextResponse.json({ok:true,locked:data?.length||0,locked_at:now});
}