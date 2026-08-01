import "dotenv/config";
import express from "express";
import { google } from "googleapis";
const app = express();

app.use((req, res, next) => {
  console.log("REQUEST:", req.method, req.url);
  next();
});
const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const googleAuth = new google.auth.GoogleAuth({
  credentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : undefined,
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? undefined
    : "./google-service-account.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
});



if (!process.env.TBA_AUTH_KEY) {
  throw new Error("Missing TBA_AUTH_KEY in .env");
}

if (!process.env.SCOUTING_SHEET_2026ONCMP2) {
  console.warn("Missing SCOUTING_SHEET_2026ONCMP2 in .env");
}
const sheets = google.sheets({
  version: "v4",
  auth: googleAuth
});

async function tba(path) {
  const response = await fetch(`${TBA_BASE}${path}`, {
    headers: {
      "X-TBA-Auth-Key": process.env.TBA_AUTH_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`TBA request failed: ${response.status}`);
  }

  return response.json();
}

// All results for an event, such as "2026onott"
app.get("/api/events/:eventKey/matches", async (req, res) => {
  try {
    const matches = await tba(`/event/${req.params.eventKey}/matches`);

    // Return a simpler shape for a basic UI
    res.json(matches.map(match => ({
      key: match.key,
      level: match.comp_level,       // qm, sf, f, etc.
      number: match.match_number,
      red: match.alliances.red,
      blue: match.alliances.blue,
      winner: match.winning_alliance,
      time: match.actual_time,
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Event rankings
app.get("/api/events/:eventKey/rankings", async (req, res) => {
  try {
    res.json(await tba(`/event/${req.params.eventKey}/rankings`));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Event OPR statistics
app.get("/api/events/:eventKey/oprs", async (req, res) => {
  try {
    res.json(await tba(`/event/${req.params.eventKey}/oprs`));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// A team's events in a given year
app.get("/api/teams/:teamKey/events/:year", async (req, res) => {
  try {
    res.json(await tba(`/team/${req.params.teamKey}/events/${req.params.year}`));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/scouting/:eventKey", async (req, res) => {
  console.log("SCOUTING ROUTE HIT");
  console.log("Event key:", req.params.eventKey);

  try {
    const { eventKey } = req.params;

    const sheetIds = {
      "2026oncmp2": process.env.SCOUTING_SHEET_2026ONCMP2,
      "2026ontor": process.env.SCOUTING_SHEET_2026ONTOR,
      "2026onwin": process.env.SCOUTING_SHEET_2026ONWIN
    };

    const spreadsheetId = sheetIds[eventKey];

    console.log("Spreadsheet ID:", spreadsheetId);

    if (!spreadsheetId) {
      console.log("No spreadsheet configured");
      return res.json([]);
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Scouting Raw Data'!A:AF"
    });

    console.log("Google Sheets request succeeded");

    const [headers, ...rows] = response.data.values || [];

    if (!headers) {
      return res.json([]);
    }

    const scoutingData = rows.map(row =>
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          row[index] ?? ""
        ])
      )
    );

    res.json(scoutingData);

  } catch (error) {
    console.error("SCOUTING ERROR:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/pitscouting/:eventKey", async (req, res) => {
  console.log("SCOUTING ROUTE HIT");
  console.log("Event key:", req.params.eventKey);

  try {
    const { eventKey } = req.params;

    const sheetIds = {
      "2026oncmp2": process.env.SCOUTING_SHEET_2026ONCMP2,
      "2026ontor": process.env.SCOUTING_SHEET_2026ONTOR,
      "2026onwin": process.env.SCOUTING_SHEET_2026ONWIN
    };

    const spreadsheetId = sheetIds[eventKey];

    console.log("Spreadsheet ID:", spreadsheetId);

    if (!spreadsheetId) {
      console.log("No spreadsheet configured");
      return res.json([]);
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Pit Scouting Raw Data'!A:AL"
    });

    console.log("Google Sheets request succeeded");

    const [headers, ...rows] = response.data.values || [];

    if (!headers) {
      return res.json([]);
    }

    const scoutingData = rows.map(row =>
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          row[index] ?? ""
        ])
      )
    );

    res.json(scoutingData);

  } catch (error) {
    console.error("SCOUTING ERROR:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/statbotics/team-event/:team/:event", async (req, res) => {
  const { team, event } = req.params;
  const url = `https://api.statbotics.io/v3/team_event/${team}/${event}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { rawResponse: text };
    }

    if (!response.ok) {
      console.error("Statbotics response:", response.status, data);

      return res.status(response.status).json({
        error: `Statbotics returned ${response.status}`,
        details: data
      });
    }

    res.json(data);
  } catch (error) {
    console.error("Statbotics connection error:", error.message);

    res.status(502).json({
      error: "Could not contact Statbotics",
      details: error.message
    });
  }
});

app.get("/api/statbotics/team-matches/:team/:event", async (req, res) => {
  const { team, event } = req.params;
  const query = new URLSearchParams({
    team,
    event,
    limit: "100"
  });
  const url = `https://api.statbotics.io/v3/matches?${query}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { rawResponse: text };
    }

    if (!response.ok) {
      console.error("Statbotics match-history response:", response.status, data);

      return res.status(response.status).json({
        error: `Statbotics returned ${response.status}`,
        details: data
      });
    }

    res.json(data);
  } catch (error) {
    console.error("Statbotics match-history connection error:", error.message);

    res.status(502).json({
      error: "Could not contact Statbotics",
      details: error.message
    });
  }
});

app.use("/", express.static("public/index"));
app.use(express.static("public"));
const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Open http://localhost:${PORT}`);
});
