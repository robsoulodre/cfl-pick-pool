import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SPORT_ID = 9; // CFL
const API_BASE = "https://therundown.io/api/v2";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function getWeekNumber(kickoff: Date, season: number) {
  // CFL season begins in June.
  // This gives us the normal CFL week number.
  const seasonStart = new Date(
    `${season}-06-01T00:00:00.000Z`
  );

  return (
    Math.floor(
      (kickoff.getTime() - seasonStart.getTime()) / MS_PER_WEEK
    ) + 1
  );
}

async function fetchCFLDate(
  date: string,
  apiKey: string
) {
  const apiUrl =
    `${API_BASE}/sports/${SPORT_ID}/events/${date}` +
    `?market_ids=1,2,3` +
    `&main_line=true`;

  const response = await fetch(apiUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-TheRundown-Key": apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `TheRundown returned ${response.status}: ${text.slice(0, 500)}`
    );
  }

  return response.json();
}

function getMainSpread(event: any, homeTeam: any, awayTeam: any) {
  const spreadMarket = event.markets?.find(
    (market: any) =>
      Number(market.market_id) === 2
  );

  if (!spreadMarket?.participants) {
    return null;
  }

  const homeParticipant =
    spreadMarket.participants.find(
      (participant: any) =>
        participant.name === homeTeam.name
    );

  const awayParticipant =
    spreadMarket.participants.find(
      (participant: any) =>
        participant.name === awayTeam.name
    );

  const participant =
    homeParticipant || awayParticipant;

  if (!participant?.lines) {
    return null;
  }

  // Prefer the main line.
  const mainLine =
    participant.lines.find(
      (line: any) =>
        line?.prices &&
        Object.values(line.prices).some(
          (price: any) =>
            price?.is_main_line === true
        )
    ) ||
    participant.lines[0];

  if (
    mainLine?.value === undefined ||
    mainLine?.value === null
  ) {
    return null;
  }

  const value = Number(mainLine.value);

  return Number.isFinite(value) ? value : null;
}

export async function POST(req: Request) {
  try {
    // ---------------------------------------------------------
    // 1. Security
    // ---------------------------------------------------------

    const secret =
      req.headers.get("x-sync-secret");

    if (
      !secret ||
      secret !== process.env.SYNC_SECRET
    ) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // ---------------------------------------------------------
    // 2. API key
    // ---------------------------------------------------------

    const apiKey =
      process.env.THERUNDOWN_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "THERUNDOWN_API_KEY is not configured",
        },
        { status: 500 }
      );
    }

    // ---------------------------------------------------------
    // 3. Parameters
    // ---------------------------------------------------------

    const requestUrl = new URL(req.url);

    const season = Number(
      requestUrl.searchParams.get("season") ||
        new Date().getFullYear()
    );

    /*
      Optional:

      ?date=2026-08-20

      If date is supplied, only that date is synced.

      Otherwise we sync the next 7 days.
    */

    const suppliedDate =
      requestUrl.searchParams.get("date");

    const startDate = suppliedDate
      ? new Date(`${suppliedDate}T00:00:00.000Z`)
      : new Date();

    // ---------------------------------------------------------
    // 4. Supabase
    // ---------------------------------------------------------

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            "Supabase server credentials are not configured",
        },
        { status: 500 }
      );
    }

    const db = createClient(
      supabaseUrl,
      serviceRoleKey
    );

    // ---------------------------------------------------------
    // 5. Determine dates to scan
    // ---------------------------------------------------------

    const dates: string[] = [];

    const numberOfDays = suppliedDate ? 1 : 7;

    for (
      let i = 0;
      i < numberOfDays;
      i++
    ) {
      const date = new Date(
        startDate.getTime() +
          i * MS_PER_DAY
      );

      dates.push(
        date.toISOString().slice(0, 10)
      );
    }

    // ---------------------------------------------------------
    // 6. Pull CFL games
    // ---------------------------------------------------------

    let eventsFound = 0;
    let imported = 0;
    let gamesSkipped = 0;

    const importedGames: any[] = [];

    for (const date of dates) {
      let payload: any;

      try {
        payload = await fetchCFLDate(
          date,
          apiKey
        );
      } catch (error: any) {
        console.error(
          `TheRundown error for ${date}:`,
          error
        );

        continue;
      }

      const events = Array.isArray(
        payload?.events
      )
        ? payload.events
        : [];

      eventsFound += events.length;

      // -------------------------------------------------------
      // 7. Import each game
      // -------------------------------------------------------

      for (const event of events) {
        const teams = Array.isArray(
          event.teams
        )
          ? event.teams
          : [];

        const awayTeam =
          teams.find(
            (team: any) =>
              team.is_away === true
          );

        const homeTeam =
          teams.find(
            (team: any) =>
              team.is_home === true
          );

        if (!awayTeam || !homeTeam) {
          gamesSkipped++;
          continue;
        }

        if (!event.event_id) {
          gamesSkipped++;
          continue;
        }

        if (!event.event_date) {
          gamesSkipped++;
          continue;
        }

        const kickoff =
          new Date(event.event_date);

        if (
          !Number.isFinite(
            kickoff.getTime()
          )
        ) {
          gamesSkipped++;
          continue;
        }

        const weekNumber =
          getWeekNumber(
            kickoff,
            season
          );

        if (!weekNumber) {
          gamesSkipped++;
          continue;
        }

        const externalId =
          String(event.event_id);

        // -----------------------------------------------------
        // Find existing week
        // -----------------------------------------------------

        const {
          data: existingWeek,
          error: existingWeekError,
        } = await db
          .from("weeks")
          .select(
            "id, deadline, status"
          )
          .eq("season", season)
          .eq(
            "week_number",
            weekNumber
          )
          .maybeSingle();

        if (existingWeekError) {
          console.error(
            "Week lookup error:",
            existingWeekError
          );

          gamesSkipped++;
          continue;
        }

        /*
          The pool deadline is based on the FIRST game
          of the week, not each individual game.
        */

        const gameDeadline =
          new Date(
            kickoff.getTime() -
              30 * 60 * 1000
          );

        let week;

        if (existingWeek) {
          const existingDeadline =
            existingWeek.deadline
              ? new Date(
                  existingWeek.deadline
                )
              : null;

          /*
            Only move the deadline earlier.
            Never accidentally move it later.
          */

          const deadline =
            !existingDeadline ||
            gameDeadline <
              existingDeadline
              ? gameDeadline.toISOString()
              : existingDeadline.toISOString();

          const {
            data: updatedWeek,
            error: updateWeekError,
          } = await db
            .from("weeks")
            .update({
              deadline,
              status: "open",
            })
            .eq(
              "id",
              existingWeek.id
            )
            .select()
            .single();

          if (updateWeekError) {
            console.error(
              "Week update error:",
              updateWeekError
            );

            gamesSkipped++;
            continue;
          }

          week = updatedWeek;
        } else {
          const {
            data: newWeek,
            error: newWeekError,
          } = await db
            .from("weeks")
            .insert({
              season,
              week_number: weekNumber,
              deadline:
                gameDeadline.toISOString(),
              status: "open",
            })
            .select()
            .single();

          if (newWeekError) {
            console.error(
              "Week creation error:",
              newWeekError
            );

            gamesSkipped++;
            continue;
          }

          week = newWeek;
        }

        // -----------------------------------------------------
        // 8. Get spread
        // -----------------------------------------------------

        const spread =
          getMainSpread(
            event,
            homeTeam,
            awayTeam
          );

        // -----------------------------------------------------
        // 9. Check existing game
        // -----------------------------------------------------

        const {
          data: existingGame,
          error: existingGameError,
        } = await db
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

        if (existingGameError) {
          console.error(
            "Game lookup error:",
            existingGameError
          );

          gamesSkipped++;
          continue;
        }

        // -----------------------------------------------------
        // 10. Build game update
        // -----------------------------------------------------

        const update: any = {
          week_id: week.id,

          external_id:
            externalId,

          kickoff:
            kickoff.toISOString(),

          away_team:
            awayTeam.name,

          home_team:
            homeTeam.name,

          status:
            event.status ===
              "STATUS_FINAL" ||
            event.status === "final"
              ? "final"
              : "scheduled",

          away_score:
            event.score
              ?.score_away ??
            null,

          home_score:
            event.score
              ?.score_home ??
            null,
        };

        /*
          Do not overwrite a spread that the commissioner
          has manually locked.
        */

        if (
          !existingGame?.spread_locked &&
          spread !== null
        ) {
          update.spread = spread;
          update.spread_source =
            "TheRundown";
        }

        // -----------------------------------------------------
        // 11. Save game
        // -----------------------------------------------------

        const {
          error: gameError,
        } = await db
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
            "Game save error:",
            gameError
          );

          gamesSkipped++;
          continue;
        }

        imported++;

        importedGames.push({
          week: weekNumber,
          date,
          away:
            awayTeam.name,
          home:
            homeTeam.name,
          spread,
          externalId,
        });
      }
    }

    // ---------------------------------------------------------
    // 12. Return result
    // ---------------------------------------------------------

    return NextResponse.json({
      ok: true,
      provider: "TheRundown",
      sport: "CFL",
      sportId: SPORT_ID,
      season,
      datesScanned: dates,
      eventsFound,
      imported,
      gamesSkipped,
      games: importedGames,
    });
  } catch (error: any) {
    console.error(
      "CFL sync fatal error:",
      error
    );

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
