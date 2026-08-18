import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SPORT_ID = 9; // CFL
const API_BASE = "https://therundown.io/api/v2";

export async function POST(req: Request) {
  try {
    // Protect the sync endpoint
    const secret = req.headers.get("x-sync-secret");

    if (!secret || secret !== process.env.SYNC_SECRET) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const apiKey = process.env.THERUNDOWN_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "THERUNDOWN_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const url = new URL(req.url);

    const season = Number(
      url.searchParams.get("season") ||
        new Date().getFullYear()
    );

    const date =
      url.searchParams.get("date") ||
      new Date().toISOString().slice(0, 10);

    /*
      TheRundown CFL endpoint.

      Markets:
      1 = Moneyline
      2 = Spread
      3 = Total

      We only need the main lines for the pick pool.
    */

    const apiUrl =
      `${API_BASE}/sports/${SPORT_ID}/events/${date}` +
      `?market_ids=1,2,3` +
      `&main_line=true` +
      `&key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(apiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();

      return NextResponse.json(
        {
          error: "TheRundown API error",
          status: response.status,
          details: text.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const payload = await response.json();

    const events = Array.isArray(payload?.events)
      ? payload.events
      : [];

    if (!events.length) {
      return NextResponse.json({
        ok: true,
        season,
        date,
        imported: 0,
        message: "No CFL games found for this date.",
      });
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let imported = 0;

    for (const event of events) {
      const teams = Array.isArray(event.teams)
        ? event.teams
        : [];

      const awayTeam = teams.find(
        (team: any) => team.is_away
      );

      const homeTeam = teams.find(
        (team: any) => team.is_home
      );

      if (!awayTeam || !homeTeam) {
        continue;
      }

      const externalId = String(event.event_id);

      const kickoff = event.event_date;

      if (!kickoff) {
        continue;
      }

      /*
        Find or create the appropriate pool week.

        For now we use the CFL season week supplied by the API
        when available. If it isn't present, we calculate a
        reasonable week from the season start.
      */

      const seasonStart = new Date(`${season}-06-01T00:00:00Z`);
      const kickoffDate = new Date(kickoff);

      const calculatedWeek =
        Math.floor(
          (kickoffDate.getTime() - seasonStart.getTime()) /
            (7 * 24 * 60 * 60 * 1000)
        ) + 1;

      const weekNumber =
        Number(
          event.week ||
            event.week_number ||
            calculatedWeek
        );

      if (!weekNumber) {
        continue;
      }

      /*
        Deadline = 30 minutes before kickoff.

        We can change this later if your pool has a
        different deadline rule.
      */

      const deadline = new Date(
        new Date(kickoff).getTime() -
          30 * 60 * 1000
      ).toISOString();

      const { data: week, error: weekError } =
        await db
          .from("weeks")
          .upsert(
            {
              season,
              week_number: weekNumber,
              deadline,
              status: "open",
            },
            {
              onConflict: "season,week_number",
            }
          )
          .select()
          .single();

      if (weekError || !week) {
        console.error(
          "Week error:",
          weekError
        );
        continue;
      }

      /*
        Pull the main spread from the spread market.
      */

      let spread: number | null = null;

      const spreadMarket =
        event.markets?.find(
          (market: any) =>
            Number(market.market_id) === 2
        );

      if (spreadMarket?.participants) {
        const homeParticipant =
          spreadMarket.participants.find(
            (participant: any) =>
              participant.name ===
              homeTeam.name
          );

        const awayParticipant =
          spreadMarket.participants.find(
            (participant: any) =>
              participant.name ===
              awayTeam.name
          );

        const participant =
          homeParticipant ||
          awayParticipant;

        const line =
          participant?.lines?.find(
            (line: any) =>
              line.prices &&
              Object.values(line.prices).some(
                (price: any) =>
                  price?.is_main_line
              )
          );

        if (line?.value != null) {
          spread = Number(line.value);
        }
      }

      /*
        Look for an existing game.

        If the spread has been manually locked,
        we DON'T overwrite it.
      */

      const { data: existing } =
        await db
          .from("games")
          .select(
            "id, spread_locked"
          )
          .eq(
            "week_id",
            week.id
          )
          .eq(
            "external_id",
            externalId
          )
          .maybeSingle();

      const update: any = {
        week_id: week.id,
        external_id: externalId,
        kickoff:
          new Date(kickoff).toISOString(),

        away_team: awayTeam.name,
        home_team: homeTeam.name,

        status:
          event.status === "STATUS_FINAL" ||
          event.status === "final"
            ? "final"
            : "scheduled",

        away_score:
          event.score?.score_away ?? null,

        home_score:
          event.score?.score_home ?? null,
      };

      /*
        Only update the spread if it hasn't been
        manually locked by the commissioner.
      */

      if (
        !existing?.spread_locked &&
        spread !== null
      ) {
        update.spread = spread;
        update.spread_source = "TheRundown";
      }

      const { error: gameError } =
        await db
          .from("games")
          .upsert(
            update,
            {
              onConflict:
                "week_id,external_id",
            }
          );

      if (gameError) {
        console.error(
          "Game error:",
          gameError
        );
        continue;
      }

      imported++;
    }

    return NextResponse.json({
      ok: true,
      provider: "TheRundown",
      sport: "CFL",
      season,
      date,
      imported,
    });

  } catch (error: any) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error?.message ||
          "Unexpected sync error",
      },
      { status: 500 }
    );
  }
}
