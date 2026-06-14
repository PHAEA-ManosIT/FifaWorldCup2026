// Updates results.json with FIFA World Cup data from api-sports.io.
// Schedule-aware: only spends API calls when a match is live / just finished /
// about to start, so we stay well under the free 100-calls/day limit.
// Runs in GitHub Actions; the API key comes from the APISPORTS_KEY secret.
import fs from "fs";

const KEY = process.env.APISPORTS_KEY;
const OUT = "results.json";
const SCHED = "wc2026_data.json";
if (!KEY) { console.error("Missing APISPORTS_KEY"); process.exit(1); }

// ---- schedule gate: is any match within [-15min, +2h45] of its kick-off? ----
const sched = JSON.parse(fs.readFileSync(SCHED, "utf8"));
const fixtures = (sched.groupFixtures || []).concat(sched.knockout || []);
const now = Date.now();
const active = fixtures.some(fx => {
  const t = Date.parse(fx.utc);
  return t && now >= t - 15 * 60000 && now <= t + 165 * 60000;
});
if (!active) { console.log("No match window now — no API call."); process.exit(0); }

const dateStr = (off) => new Date(now + off * 86400000).toISOString().slice(0, 10);
async function fetchDate(date) {
  const r = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}`,
    { headers: { "x-apisports-key": KEY } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  if (j.errors && !Array.isArray(j.errors) && Object.keys(j.errors).length)
    throw new Error("api: " + JSON.stringify(j.errors));
  return j.response || [];
}
const isWorldCup = (it) => it.league && (it.league.id === 1 || it.league.name === "World Cup");

// fetch today; also yesterday in early UTC hours (matches that crossed midnight)
const dates = [dateStr(0)];
if (new Date().getUTCHours() < 8) dates.push(dateStr(-1));

const store = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
let changed = false, calls = 0;
const sig = (x) => x && JSON.stringify([x.hs, x.as, x.status, x.elapsed, x.extra, x.pfirst, x.psecond]);

for (const date of dates) {
  let arr = [];
  try { arr = await fetchDate(date); calls++; }
  catch (e) { console.error("fetch", date, "failed:", e.message); continue; }
  for (const it of arr) {
    if (!isWorldCup(it)) continue;
    const f = it.fixture, t = it.teams, g = it.goals, st = f.status, p = f.periods || {};
    const rec = {
      id: f.id, utc: f.date, home: t.home.name, away: t.away.name,
      hs: g.home, as: g.away, status: st.short, elapsed: st.elapsed, extra: st.extra || 0,
      pfirst: p.first || null, psecond: p.second || null
    };
    if (sig(store[f.id]) !== sig(rec)) { store[f.id] = rec; changed = true; }
  }
}

console.log("API calls:", calls);
if (changed) {
  fs.writeFileSync(OUT, JSON.stringify(store, null, 1));
  console.log("results.json updated -", Object.keys(store).length, "fixtures stored");
} else {
  console.log("no changes");
}
