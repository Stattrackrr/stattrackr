"use client";

import { supabase, supabaseSessionOnly } from "@/lib/supabaseClient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import {
  Edit2,
  Trash2,
  Moon,
  Sun,
  CalendarDays,
  TrendingUp,
  BarChart3,
  Filter,
  Share2,
} from "lucide-react";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { StatTrackrLogoWithText } from "@/components/StatTrackrLogo";
import Navigation from "@/components/navigation";
import LeftSidebar from "@/components/LeftSidebar";
import RightSidebar from "@/components/RightSidebar";
import { ThemeProvider } from "@/contexts/ThemeContext";

/* =========================================================
   StatTrackr Journal – Full Page
   - Header: “StatTrackr Journal” + “Track results. Master your game.”
   - Removed “Window: …” line under header
   - Daily calendar: month selector + solid colors, no overlap
   - Weekly calendar: solid circles (8 per row), no overlap
   - Year grid: fixed 2025–2032
   - Keeps Months view as-is
   - Account avatar button at right with Account settings + Log out
   ========================================================= */

const RESULTS = ["win", "loss", "void"] as const;
const RESULT_LABELS: Record<typeof RESULTS[number], string> = {
  win: "Win",
  loss: "Loss",
  void: "Void"
};
const SPORTS = ["Soccer", "NBA", "NBL", "Tennis", "AFL", "NRL"] as const;
type Sport = (typeof SPORTS)[number];

const CURRENCIES = ["AUD", "USD", "GBP", "EUR"] as const;
type Currency = (typeof CURRENCIES)[number];

const MARKET_BY_SPORT: Record<Sport, readonly string[]> = {
  Soccer: [
    "Match Winner",
    "Double Chance",
    "Both Teams To Score",
    "Over / Under",
    "Anytime Goalscorer",
    "Same Game Multi",
    "Other",
  ],
  NBA: [
    "Moneyline",
    "Spread",
    "Total Points",
    "Player Points",
    "Player Assists",
    "Player Rebounds",
    "Player PR",
    "Player PRA",
    "Player RA",
    "Same Game Multi",
    "Other",
  ],
  NBL: [
    "Moneyline",
    "Spread",
    "Total Points",
    "Player Points",
    "Player Assists",
    "Player Rebounds",
    "Player PR",
    "Player PRA",
    "Player RA",
    "Same Game Multi",
    "Other",
  ],
  Tennis: [
    "Match Winner",
    "Set Handicap",
    "Game Handicap",
    "Total Games",
    "Same Game Multi",
    "Other",
  ],
  AFL: [
    "Head to Head",
    "Line / Spread",
    "Total Points",
    "Anytime Goalscorer",
    "Same Game Multi",
    "Other",
  ],
  NRL: [
    "Head to Head",
    "Line / Spread",
    "Total Points",
    "Anytime Tryscorer",
    "Same Game Multi",
    "Other",
  ],
} as const;

const DEFAULT_MARKETS = ["Match Winner", "Line / Spread", "Total Points", "Other"] as const;

function getMarketOptionsForSport(sport: string | ""): readonly string[] {
  if (!sport) return DEFAULT_MARKETS;
  return (MARKET_BY_SPORT as any)[sport] ?? DEFAULT_MARKETS;
}

type Bet = {
  id: string;
  date: string; // yyyy-mm-dd
  sport: string;
  market?: string;
  selection: string;
  stake: number;
  currency: Currency;
  odds: number; // decimal
  result: (typeof RESULTS)[number];
};

const NAVY_DARK = "bg-gray-900 text-white";
const NAVY_CARD = "bg-gray-800 text-white";
const LIGHT_BG = "bg-white text-slate-900";
const LIGHT_CARD = "bg-slate-50 text-slate-900";

const UI_LOCALE = "en-US";

function toISODateLocal(date: Date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}
function formatCurrency(n: number, code: Currency = "AUD") {
  if (Number.isNaN(n) || n === undefined || n === null) return `${code} 0.00`;
  try {
    return new Intl.NumberFormat(UI_LOCALE, {
      style: "currency",
      currency: code,
      currencyDisplay: "symbol",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(n);
  } catch {
    const num = Number(n);
    return Number.isFinite(num) ? `${code} ${num.toFixed(2)}` : `${code} 0.00`;
  }
}
function currencySymbol(code: Currency) {
  try {
    return new Intl.NumberFormat(UI_LOCALE, {
      style: "currency",
      currency: code,
      currencyDisplay: "symbol",
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? "$";
  } catch {
    return "$";
  }
}
/** Compact currency for calendar cells */
function shortCurrency(n: number, code: Currency) {
  const sym = currencySymbol(code);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const roundTo = (v: number, step: number) => Math.round(v / step) * step;

  if (abs < 10) return `${sign}${sym}${roundTo(abs, 0.1).toFixed(1)}`;
  if (abs < 100) {
    const v = roundTo(abs, 0.5);
    const w = Math.round(v);
    const half = Math.abs(v - w) > 1e-9;
    return `${sign}${sym}${half ? v.toFixed(1) : String(w)}`;
  }
  if (abs < 1000) return `${sign}${sym}${Math.round(abs)}`;
  if (abs < 10_000) return `${sign}${sym}${(roundTo(abs, 100) / 1000).toFixed(1)}k`;
  if (abs < 100_000) return `${sign}${sym}${Math.round(roundTo(abs, 1000) / 1000)}k`;
  if (abs < 1_000_000) return `${sign}${sym}${Math.round(roundTo(abs, 1000) / 1000)}k`;
  return `${sign}${sym}${Math.round(abs / 1000)}k`;
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday=0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfNextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
function startOfNextYear(d: Date) {
  return new Date(d.getFullYear() + 1, 0, 1);
}

// ISO week helpers
function getISOWeekYear(d0: Date) {
  const d = new Date(d0);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  return d.getFullYear();
}
function getISOWeek(d0: Date) {
  const d = new Date(d0);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
    )
  );
}
function weeksInISOYear(year: number) {
  const dec28 = new Date(year, 11, 28);
  return getISOWeek(dec28);
}
function dateOfISOWeek(week: number, year: number) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = (simple.getDay() + 6) % 7;
  const monday = new Date(simple);
  monday.setDate(simple.getDate() - dow);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function isoWeekKeyFromISODateStr(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
}
function normalizeMarket(sport?: string, market?: string) {
  const options = getMarketOptionsForSport(sport || "");
  const t = (market || "").trim();
  if (!t) return "Other";
  const hit = options.find((opt) => opt.toLowerCase() === t.toLowerCase());
  return hit || "Other";
}

// Odds conversions
type OddsFormat = "decimal" | "american";
function americanToDecimal(str: string): number | null {
  const s = (str || "").replace(/\s+/g, "");
  if (!s) return null;
  let n = Number(s);
  if (!/^[+-]/.test(s) && Math.abs(n) >= 100) n = n;
  if (!isFinite(n) || Math.abs(n) < 100) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

/* =======================
   Supabase helpers
   ======================= */
// We gate the page behind email login; no anonymous signin here.
async function fetchBetsForUser(): Promise<Bet[]> {
  // Try to get user from persistent session first
  let { data: { user } } = await supabase.auth.getUser();
  let activeClient = supabase;
  
  // If no user in persistent session, try session-only
  if (!user) {
    const sessionResult = await supabaseSessionOnly.auth.getUser();
    user = sessionResult.data.user;
    activeClient = supabaseSessionOnly;
  }
  
  if (!user) return [];
  
  const { data, error } = await activeClient
    .from("bets")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({
    id: r.id,
    date: r.date,
    sport: r.sport,
    market: r.market ?? undefined,
    selection: r.selection,
    stake: Number(r.stake),
    currency: r.currency as Currency,
    odds: Number(r.odds),
    result: r.result as Bet["result"],
  }));
}
async function handleDeleteSupabase(id: string, setBets: React.Dispatch<React.SetStateAction<Bet[]>>) {
  try {
    const { error } = await supabase.from("bets").delete().eq("id", id);
    if (error) throw error;
    setBets((prev) => prev.filter((b) => b.id !== id));
  } catch (e: any) {
    alert("Delete failed: " + (e?.message ?? String(e)));
  }
}

async function handleQuickResultUpdate(id: string, newResult: Bet["result"], setBets: React.Dispatch<React.SetStateAction<Bet[]>>) {
  try {
    const { error } = await supabase
      .from("bets")
      .update({ result: newResult })
      .eq("id", id);
    if (error) throw error;
    setBets((prev) =>
      prev.map((b) => (b.id === id ? { ...b, result: newResult } : b))
    );
  } catch (e: any) {
    alert("Update failed: " + (e?.message ?? String(e)));
  }
}

/* =======================
   MAIN
   ======================= */

type Range = "Daily" | "Weekly" | "Monthly" | "Yearly" | "Last30" | "Last90" | "Last365" | "Custom";

function JournalPageContent() {
  const router = useRouter();
  const params = useSearchParams();

  const [bets, setBets] = useState<Bet[]>([]);
  const [themeDark, setThemeDark] = useState(true);
  const [editing, setEditing] = useState<Bet | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [range, setRange] = useState<Range>("Last30");

  const [chartFull, setChartFull] = useState(false);
  const [graphSport, setGraphSport] = useState<"All" | (typeof SPORTS)[number]>("All");
  const [plMode, setPlMode] = useState<"cumulative" | "perBet">("cumulative");
  const [currencyFilter, setCurrencyFilter] = useState<Currency | "All">("AUD");
  
  // Odds format state for sidebar
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('decimal');

  const [calView, setCalView] = useState<"Days" | "Weeks" | "Months" | "Years">("Days");
  const [anchorDate, setAnchorDate] = useState<Date | null>(null);

  const [loading, setLoading] = useState(true);

  // NEW: Sport/Result filters + Custom date inputs + Search
  const [sportFilter, setSportFilter] = useState<"All" | (typeof SPORTS)[number]>("All");
  const [resultFilter, setResultFilter] = useState<"All" | (typeof RESULTS)[number]>("All");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const readOnly = params?.get("share") === "1";
  const canEdit = !readOnly;

  // Account dropdown
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  
  // Pie chart hover state
  const [hoveredPieSegment, setHoveredPieSegment] = useState<string | null>(null);
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!accountMenuRef.current) return;
      if (!accountMenuRef.current.contains(e.target as Node)) setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Initial load (login guard + fetch)
  useEffect(() => {
    (async () => {
      try {
        // Check for session in both storage types
        let { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          // Try session-only storage
          const sessionResult = await supabaseSessionOnly.auth.getSession();
          session = sessionResult.data.session;
        }
        
        if (!session) {
          setLoading(false);
          router.replace("/login");
          return;
        }
        const rows = await fetchBetsForUser();
        setBets(rows);
      } catch (e: any) {
        alert(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
      const storedTheme = localStorage.getItem("betting-journal.themeDark");
      if (storedTheme !== null) setThemeDark(storedTheme === "1");
      const v = localStorage.getItem("betting-journal.currencyFilter");
      if (v && (v === "All" || (CURRENCIES as readonly string[]).includes(v)))
        setCurrencyFilter(v as any);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const betsForCal = useMemo(
    () => (currencyFilter === "All" ? bets : bets.filter((b) => b.currency === currencyFilter)),
    [bets, currencyFilter]
  );

  // --------- DATE WINDOWS (start, end) ----------
  const { startDate, endDate, windowLabel } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(toISODateLocal(now));

    if (range === "Daily") {
      const base = anchorDate ?? now;
      const s = new Date(toISODateLocal(base));
      return { startDate: s, endDate: addDays(s, 1), windowLabel: s.toDateString() };
    }
    if (range === "Weekly") {
      const base = anchorDate ?? now;
      const s = startOfWeek(base);
      return { startDate: s, endDate: addDays(s, 7), windowLabel: "This week" };
    }
    if (range === "Monthly") {
      const base = anchorDate ?? now;
      const s = startOfMonth(base);
      return {
        startDate: s,
        endDate: startOfNextMonth(s),
        windowLabel: s.toLocaleString("en-US", { month: "long", year: "numeric" }),
      };
    }
    if (range === "Yearly") {
      const base = anchorDate ?? now;
      const s = startOfYear(base);
      return { startDate: s, endDate: startOfNextYear(s), windowLabel: String(s.getFullYear()) };
    }

    if (range === "Custom") {
      const s = customStart ? new Date(customStart) : addDays(todayStart, -29);
      const e = customEnd ? addDays(new Date(customEnd), 1) : addDays(todayStart, 1);
      s.setHours(0, 0, 0, 0);
      e.setHours(0, 0, 0, 0);
      return {
        startDate: s,
        endDate: e,
        windowLabel: customStart && customEnd ? `${customStart} → ${customEnd}` : "Custom range",
      };
    }

    const end = addDays(todayStart, 1);
    if (range === "Last30")
      return { startDate: addDays(todayStart, -29), endDate: end, windowLabel: "Last 30 days" };
    if (range === "Last90")
      return { startDate: addDays(todayStart, -89), endDate: end, windowLabel: "Last 90 days" };
    return { startDate: addDays(todayStart, -364), endDate: end, windowLabel: "Last 365 days" };
  }, [range, anchorDate, customStart, customEnd]);

  const filteredBetsByDate = useMemo(() => {
    const startISO = toISODateLocal(startDate);
    const endISO = toISODateLocal(endDate);
    return bets.filter((b) => b.date >= startISO && b.date < endISO);
  }, [bets, startDate, endDate]);

  // NEW: add sport + result filters + search on top of date + currency
  const filteredBets = useMemo(() => {
    let rows = filteredBetsByDate;
    if (currencyFilter !== "All") rows = rows.filter((b) => b.currency === currencyFilter);
    if (sportFilter !== "All") rows = rows.filter((b) => b.sport === sportFilter);
    if (resultFilter !== "All") rows = rows.filter((b) => b.result === resultFilter);
    
    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      rows = rows.filter((b) => 
        b.selection.toLowerCase().includes(query) ||
        b.sport.toLowerCase().includes(query) ||
        (b.market || "").toLowerCase().includes(query) ||
        normalizeMarket(b.sport, b.market).toLowerCase().includes(query)
      );
    }
    
    return rows;
  }, [filteredBetsByDate, currencyFilter, sportFilter, resultFilter, searchQuery]);

  // ===== Stats
  const stats = useMemo(() => {
    let staked = 0,
      returned = 0,
      wins = 0,
      settled = 0;
    for (const b of filteredBets) {
      const stake = Number(b.stake) || 0;
      const odds = Number(b.odds) || 0;
      staked += stake;
      if (b.result !== "void") settled += 1;
      if (b.result === "win") {
        wins += 1;
        returned += stake * odds;
      }
      if (b.result === "void") {
        returned += stake;
      }
    }
    const pnl = returned - staked;
    const roi = staked > 0 ? (pnl / staked) * 100 : 0;
    const winRate = settled > 0 ? (wins / settled) * 100 : 0;
    return { staked, returned, pnl, roi, winRate };
  }, [filteredBets]);

  const streaks = useMemo(() => {
    const byTime = filteredBets
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || (a.id || "").localeCompare(b.id || ""));
    let bestWin = 0,
      bestLoss = 0,
      curWin = 0,
      curLoss = 0;
    for (const b of byTime) {
      if (b.result === "win") {
        curWin++;
        bestWin = Math.max(bestWin, curWin);
        curLoss = 0;
      } else if (b.result === "loss") {
        curLoss++;
        bestLoss = Math.max(bestLoss, curLoss);
        curWin = 0;
      } else {
        curWin = 0;
        curLoss = 0;
      }
    }
    return { longestWin: bestWin, longestLoss: bestLoss };
  }, [filteredBets]);

  // ===== Graph data
  const graphData = useMemo(() => {
    const pool = graphSport === "All" ? filteredBets : filteredBets.filter((b) => b.sport === graphSport);
    const sorted = pool
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || (a.id || "").localeCompare(b.id || ""));
    let running = 0;
    return sorted.map((b, idx) => {
      const stake = +b.stake || 0,
        odds = +b.odds || 0;
      let delta = 0;
      if (b.result === "win") delta = stake * odds - stake;
      if (b.result === "loss") delta = -stake;
      running += delta;
      return {
        betNumber: idx + 1,
        pnl: plMode === "cumulative" ? +running.toFixed(2) : +delta.toFixed(2),
      };
    });
  }, [filteredBets, graphSport, plMode]);

  // ===== Aggregations for calendars
  const dailyPNL = useMemo(() => aggregateDaily(betsForCal), [betsForCal]);
  const weeklyPNL = useMemo(() => aggregateWeekly(betsForCal), [betsForCal]);
  const monthlyPNL = useMemo(() => aggregateMonthly(betsForCal), [betsForCal]);
  const yearlyPNL = useMemo(() => aggregateYearly(betsForCal), [betsForCal]);

  // ===== Others
  const bySport = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of filteredBets) {
      const stake = +b.stake || 0,
        odds = +b.odds || 0;
      let delta = 0;
      if (b.result === "win") delta = stake * odds - stake;
      if (b.result === "loss") delta = -stake;
      map.set(b.sport, +(((map.get(b.sport) ?? 0) + delta).toFixed(2)));
    }
    const rows = Array.from(map.entries())
      .map(([sport, pnl]) => ({ sport, pnl }))
      .sort((a, b) => b.pnl - a.pnl);
    return {
      rows,
      best: rows[0]?.sport ?? null,
      worst: rows[rows.length - 1]?.sport ?? null,
    };
  }, [filteredBets]);

  const marketRowsAll = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of filteredBets) {
      const stake = Number(b.stake) || 0;
      const odds = Number(b.odds) || 0;
      let delta = 0;
      if (b.result === "win") delta = stake * odds - stake;
      if (b.result === "loss") delta = -stake;
      const key = normalizeMarket(b.sport, b.market);
      map.set(key, Number(((map.get(key) ?? 0) + delta).toFixed(2)));
    }
    return Array.from(map.entries())
      .map(([market, pnl]) => ({ market, pnl }))
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  }, [filteredBets]);

  const marketProfitRows = useMemo(() => marketRowsAll.filter((r) => r.pnl > 0), [marketRowsAll]);
  const marketLossRows = useMemo(
    () => marketRowsAll.filter((r) => r.pnl < 0).map((r) => ({ market: r.market, pnlAbs: Math.abs(r.pnl) })),
    [marketRowsAll]
  );
  const hasAnyProfit = marketProfitRows.length > 0;
  const hasAnyLoss = marketLossRows.length > 0;

  const bg = themeDark ? NAVY_DARK : LIGHT_BG;
  const card = themeDark ? NAVY_CARD : LIGHT_CARD;
  const border = themeDark ? "border-white/10" : "border-slate-200";
  const showCCY: Currency = currencyFilter === "All" ? "AUD" : currencyFilter;

  const PIE_COLORS_PROFIT = themeDark
    ? ["#34d399", "#60a5fa", "#f472b6", "#f59e0b", "#a78bfa", "#f87171", "#10b981", "#93c5fd"]
    : ["#059669", "#2563eb", "#db2777", "#d97706", "#7c3aed", "#ef4444", "#0ea5e9", "#16a34a"];
  const PIE_COLORS_LOSS = themeDark
    ? ["#fca5a5", "#f87171", "#fb7185", "#f43f5e", "#ef4444", "#dc2626", "#e11d48", "#be123c"]
    : ["#f87171", "#ef4444", "#dc2626", "#b91c1c", "#fca5a5", "#fb7185", "#e11d48", "#be123c"];

  function copyShareLink() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("share", "1");
      navigator.clipboard.writeText(url.toString());
      alert("Share link copied! Anyone with the link sees a read-only dashboard.");
    } catch {}
  }

  const selectedISO = anchorDate ? toISODateLocal(anchorDate) : "";
  const selectedWeekK = anchorDate ? isoWeekKeyFromISODateStr(toISODateLocal(anchorDate)) : "";
  const selectedMonthK = anchorDate ? toISODateLocal(anchorDate).slice(0, 7) : "";

  // Shared tooltip style base
  const tooltipBase: React.CSSProperties = {
    border: "none",
    borderRadius: 12,
    color: "white",
    fontSize: "12px",
  };

  // Custom tooltip with green/red background by value
  const ColoredTooltip = (props: any) => {
    const { active, payload, label } = props;
    if (!active || !payload || !payload.length) return null;
    const v = Number(payload[0].value ?? 0);
    const bg = v > 0 ? "#059669" : v < 0 ? "#dc2626" : themeDark ? "#334155" : "#475569";
    return (
      <div style={{ ...tooltipBase, background: bg, padding: "6px 8px" }}>
        <div className="font-medium">{payload[0].name ?? label}</div>
        <div>{formatCurrency(v, showCCY)}</div>
      </div>
    );
  };

  // Custom pie chart tooltip that uses the segment color
  const PieTooltip = ({ active, payload, isProfit }: { active?: boolean; payload?: any; isProfit: boolean }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0];
    const market = data.name;
    const value = Number(data.value ?? 0);
    
    // Find the index of this market in the data array to get the correct color
    const marketData = isProfit ? marketProfitRows : marketLossRows;
    const index = marketData.findIndex(item => item.market === market);
    const colors = isProfit ? PIE_COLORS_PROFIT : PIE_COLORS_LOSS;
    const color = colors[index % colors.length];
    
    return (
      <div style={{ ...tooltipBase, background: color, padding: "6px 8px" }}>
        <div className="font-medium">{market}</div>
        <div>{isProfit ? formatCurrency(value, showCCY) : `-${formatCurrency(value, showCCY)}`}</div>
      </div>
    );
  };

  return (
    <div className={`${bg} min-h-screen lg:h-screen transition-colors lg:overflow-hidden`}>
      <style jsx global>{`
        .journal-container {
          --sidebar-margin: 0px;
          --sidebar-width: 0px;
          --gap: 6px;
          --right-panel-width: 0px;
          --inner-max: 1440px;
          --app-max: calc(var(--sidebar-width) + var(--gap) + var(--inner-max) + var(--gap) + var(--right-panel-width));
          --content-margin-right: 0px;
          --content-padding-left: 0px;
          --content-padding-right: 0px;
        }

        @media (min-width: 1024px) {
          .journal-container {
            --sidebar-width: 340px;
            --right-panel-width: 280px;
          }
        }
        
        @media (min-width: 1500px) {
          .journal-container {
            --sidebar-margin: 0px;
            --sidebar-width: 400px;
            --right-panel-width: 320px;
            --content-margin-right: 0px;
            --content-padding-left: 0px;
            --content-padding-right: 0px;
          }
        }
        
        @media (min-width: 2200px) {
          .journal-container {
            --sidebar-margin: 0px;
            --sidebar-width: 460px;
            --right-panel-width: 360px;
            --content-margin-right: 0px;
            --content-padding-left: 0px;
            --content-padding-right: 0px;
          }
        }

        /* Mobile-only: reduce outer gap to tighten left/right padding */
        @media (max-width: 639px) {
          .journal-container { --gap: 6px; }
        }

        /* Custom scrollbar colors for light/dark mode */
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: #d1d5db transparent;
        }
        
        .dark .custom-scrollbar {
          scrollbar-color: #4b5563 transparent;
        }
        
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #d1d5db;
          border-radius: 8px;
        }
        
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #4b5563;
        }

        /* Desktop scrollbar styling: fade until hovered */
        @media (hover: hover) and (pointer: fine) {
          .fade-scrollbar { scrollbar-color: transparent transparent; }
          .fade-scrollbar:hover { scrollbar-color: #9ca3af1a transparent; }
          .fade-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
          .fade-scrollbar::-webkit-scrollbar-thumb { background: transparent; border-radius: 8px; }
          .fade-scrollbar:hover::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.2); }
        }
      `}</style>
      
      <div 
        className="px-0 journal-container" 
        style={{ 
          marginLeft: 'calc(var(--sidebar-width, 0px) + var(--gap, 6px))', 
          marginRight: 'calc(var(--right-panel-width, 0px) + var(--gap, 6px))',
          width: 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 6px) + var(--right-panel-width, 0px) + var(--gap, 6px)))' 
        }}
      >
        <div className="mx-auto w-full max-w-[1440px]">
          <div className="pt-4 min-h-0 lg:h-full journal-container">
            <LeftSidebar oddsFormat={oddsFormat} setOddsFormat={setOddsFormat} />
            <RightSidebar />
            <div
              className="relative z-50 min-w-0 min-h-0 flex flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-contain px-0 pb-3 lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar"
              style={{ scrollbarGutter: 'stable both-edges' }}
            >
        {/* Header */}
<header className="flex items-center justify-between gap-3 mb-4">
          {/* LEFT: Brand + tagline with logo */}
          <div>
<div className="flex items-center gap-2 mb-1.5">
              <StatTrackrLogoWithText 
                logoSize="w-10 h-10" 
                textSize="text-2xl md:text-3xl" 
                className="font-bold tracking-tight"
                isDark={themeDark}
              />
              <span className="text-2xl md:text-3xl font-light opacity-50">Journal</span>
            </div>
            <p className="text-sm opacity-70 font-medium">Track results. Master your game.</p>
            {readOnly && <p className="mt-1 text-xs opacity-70">Read-only shared view</p>}
          </div>

          {/* Right controls: Theme • Share • Account */}
          <div className="relative flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={() => {
                setThemeDark((v) => {
                  const nv = !v;
                  localStorage.setItem("betting-journal.themeDark", nv ? "1" : "0");
                  return nv;
                });
              }}
              className={`inline-flex items-center justify-center w-11 h-11 rounded-full border ${
                themeDark ? "border-white/20 text-white hover:bg-white/10" : "border-slate-300 hover:bg-slate-50"
              } transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 shadow-sm hover:shadow-md`}
              title={themeDark ? "Switch to light" : "Switch to dark"}
            >
              {themeDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            {/* Share */}
            <button
              onClick={copyShareLink}
              className="inline-flex items-center gap-2 px-4 h-11 rounded-2xl bg-slate-600 text-white font-medium hover:bg-slate-500 transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 shadow-md hover:shadow-lg"
              title="Copy read-only share link"
            >
              <Share2 className="w-5 h-5" />
              Share
            </button>

            {/* Account avatar + dropdown */}
            <div className="relative" ref={accountMenuRef}>
              <button
                onClick={() => setAccountMenuOpen((v) => !v)}
                className={`inline-flex items-center justify-center w-11 h-11 rounded-full border ${
                  themeDark ? "border-white/20 bg-black/20 hover:bg-black/40" : "border-slate-300 bg-white hover:bg-slate-50"
                } transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 shadow-sm hover:shadow-md`}
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                title="Account"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
                  <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm0 3.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5ZM12 19c-2.761 0-5-1.567-5-3.5 0-.966 1.567-2 5-2s5 1.034 5 2c0 1.933-2.239 3.5-5 3.5Z"/>
                </svg>
              </button>

              {accountMenuOpen && (
                <div
                  role="menu"
                  className={`absolute right-0 mt-2 w-56 rounded-xl border z-50 ${
                  themeDark ? "border-white/10 bg-gray-800 text-white" : "border-slate-200 bg-white text-slate-900"
                  } shadow-2xl overflow-hidden`}
                >
                  <button
                    onClick={() => {
                      setAccountMenuOpen(false);
                      // placeholder route; add page when ready
                      router.push("/account");
                    }}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-white/5 transition-colors duration-150 ease-in-out"
                    role="menuitem"
                  >
                    Account settings
                  </button>
                  <div className={themeDark ? "h-px bg-white/10" : "h-px bg-slate-200"} />
                  <button
                    onClick={async () => {
                      setAccountMenuOpen(false);
                      try {
                        // Sign out from both clients to be safe
                        await supabase.auth.signOut();
                        await supabaseSessionOnly.auth.signOut();
                      } finally {
                        // Clear any stored preferences
                        localStorage.removeItem('stattrackr_remember_me');
                        localStorage.removeItem('stattrackr_google_login');
                        router.replace("/login");
                      }
                    }}
                    className="w-full text-left px-4 py-3 text-sm text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-all duration-150 ease-in-out"
                    role="menuitem"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Filters */}
<section className={`rounded-xl ${card} shadow-lg border ${border} backdrop-blur-sm`}>
<div className="px-3 py-2 space-y-2">
            {/* Header */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 opacity-70" />
              <span className="text-sm opacity-80">Filters</span>
            </div>

            {/* Range filters - Mobile friendly */}
            <div className="flex flex-wrap gap-2">
              {(["Daily", "Weekly", "Last30", "Last90", "Last365", "Custom"] as Range[]).map((r) => (
                <button
                  key={`range-${r}`}
                  onClick={() => setRange(r)}
                  className={`h-9 px-3 rounded-xl text-sm border ${border} transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 ${
                    range === r
                      ? "bg-emerald-500 text-white border-transparent shadow-md hover:bg-emerald-600"
                      : themeDark
                      ? "bg-black/20 text-white hover:bg-black/40 hover:shadow-md"
                      : "bg-white text-slate-900 hover:bg-slate-50 hover:shadow-md"
                  }`}
                >
                  {r === "Last30" ? "Last 30" : r === "Last90" ? "Last 90" : r === "Last365" ? "Last 365" : r}
                </button>
              ))}
            </div>

            {/* Custom date inputs */}
            {range === "Custom" && (
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className={`h-9 px-2 rounded-lg border ${border} transition-colors duration-200 focus:ring-2 focus:ring-emerald-400 focus:border-transparent ${
                    themeDark ? "bg-gray-800 text-white" : "bg-white text-slate-900"
                  }`}
                  aria-label="Custom start date"
                />
                <span className="opacity-70 text-sm sm:mx-2">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className={`h-9 px-2 rounded-lg border ${border} transition-colors duration-200 focus:ring-2 focus:ring-emerald-400 focus:border-transparent ${
                    themeDark ? "bg-gray-800 text-white" : "bg-white text-slate-900"
                  }`}
                  aria-label="Custom end date"
                />
              </div>
            )}

            {/* Additional filters - Mobile stacked */}
<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Currency */}
              <div className="flex flex-col gap-1">
                <label className="text-xs opacity-80">Currency</label>
                <select
                  className={`h-9 px-2 rounded-lg border ${border} transition-colors duration-200 focus:ring-2 focus:ring-emerald-400 focus:border-transparent ${themeDark ? "bg-gray-800 text-white" : "bg-white text-slate-900"}`}
                  value={currencyFilter}
                  onChange={(e) => {
                    const v = e.target.value as any;
                    localStorage.setItem("betting-journal.currencyFilter", v);
                    setCurrencyFilter(v);
                  }}
                >
                  <option value="All">All</option>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sport filter */}
              <div className="flex flex-col gap-1">
                <label className="text-xs opacity-80">Sport</label>
                <select
                  className={`h-9 px-2 rounded-lg border ${border} transition-colors duration-200 focus:ring-2 focus:ring-emerald-400 focus:border-transparent ${themeDark ? "bg-gray-800 text-white" : "bg-white text-slate-900"}`}
                  value={sportFilter}
                  onChange={(e) => setSportFilter(e.target.value as any)}
                >
                  <option value="All">All</option>
                  {SPORTS.map((s) => (
                    <option key={`sf-${s}`} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Result filter */}
              <div className="flex flex-col gap-1">
                <label className="text-xs opacity-80">Result</label>
                <select
                  className={`h-9 px-2 rounded-lg border ${border} transition-colors duration-200 focus:ring-2 focus:ring-emerald-400 focus:border-transparent ${themeDark ? "bg-gray-800 text-white" : "bg-white text-slate-900"}`}
                  value={resultFilter}
                  onChange={(e) => setResultFilter(e.target.value as any)}
                >
                  <option value="All">All</option>
                  {RESULTS.map((r) => (
                    <option key={`rf-${r}`} value={r}>{RESULT_LABELS[r]}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* ===== Stats row - Mobile friendly ===== */}
<section className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
          <StatCard className={card + " border " + border} icon={<TrendingUp className="w-5 h-5" />} label={`P&L (${showCCY})`} value={formatCurrency(stats.pnl, showCCY)} emphasis={stats.pnl} />

<div className={card + " border " + border + " rounded-xl p-3 shadow-sm"}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm opacity-80">ROI</span>
              <BarChart3 className="opacity-80 w-4 h-4" />
            </div>
            <div className="text-2xl font-semibold">{stats.roi.toFixed(2)}%</div>
            <div className="mt-1 text-sm opacity-80">Win rate: {stats.winRate.toFixed(2)}%</div>
          </div>

          <StatCard className={card + " border " + border} icon={<BarChart3 className="w-5 h-5" />} label="Win rate" value={`${stats.winRate.toFixed(2)}%`} />
          <StatCard className={card + " border " + border} icon={<CalendarDays className="w-5 h-5" />} label={`Total staked (${showCCY})`} value={formatCurrency(stats.staked, showCCY)} />

<div className={card + " border " + border + " rounded-xl p-3 shadow-sm"}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm opacity-80">Streaks</span>
            </div>
            <div className="text-sm space-y-1">
              <div>Longest win: <b>{streaks.longestWin}</b></div>
              <div>Longest loss: <b>{streaks.longestLoss}</b></div>
            </div>
          </div>
        </section>

        {/* ===== Mobile-friendly layout ===== */}
<section className="mt-3 space-y-2">
          {/* Mobile: Add Bet - Full Width */}
<div className={`xl:hidden rounded-xl p-3 ${card} shadow-sm border ${border}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Add Bet</h3>
            </div>
            {canEdit ? (
              <InlineAddBet
                themeDark={themeDark}
                defaultCurrency={currencyFilter === "All" ? "AUD" : (currencyFilter as Currency)}
                onAdd={async (newBet) => {
                  try {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) throw new Error("Not signed in");
                    const { data, error } = await supabase
                      .from("bets")
                      .insert({ ...newBet, user_id: user.id, market: newBet.market ?? null })
                      .select()
                      .single();
                    if (error) throw error;
                    const row = data!;
                    setBets((prev) => [
                      {
                        id: row.id,
                        date: row.date,
                        sport: row.sport,
                        market: row.market ?? undefined,
                        selection: row.selection,
                        stake: Number(row.stake),
                        currency: row.currency,
                        odds: Number(row.odds),
                        result: row.result,
                      },
                      ...prev,
                    ]);
                    if (currencyFilter !== "All" && newBet.currency !== currencyFilter) {
                      setCurrencyFilter(newBet.currency);
                    }
                  } catch (e: any) {
                    alert("Insert failed: " + (e?.message ?? String(e)));
                  }
                }}
              />
            ) : (
              <p className="text-sm opacity-70">Read-only shared view.</p>
            )}
          </div>

          {/* Desktop Layout */}
<div className="hidden xl:grid xl:grid-cols-4 xl:gap-2 xl:items-start">
            {/* Add Bet - Desktop */}
<div className={`rounded-xl p-3 ${card} shadow-sm border ${border}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Add Bet</h3>
              </div>
              {canEdit ? (
                <InlineAddBet
                  themeDark={themeDark}
                  defaultCurrency={currencyFilter === "All" ? "AUD" : (currencyFilter as Currency)}
                  onAdd={async (newBet) => {
                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) throw new Error("Not signed in");
                      const { data, error } = await supabase
                        .from("bets")
                        .insert({ ...newBet, user_id: user.id, market: newBet.market ?? null })
                        .select()
                        .single();
                      if (error) throw error;
                      const row = data!;
                      setBets((prev) => [
                        {
                          id: row.id,
                          date: row.date,
                          sport: row.sport,
                          market: row.market ?? undefined,
                          selection: row.selection,
                          stake: Number(row.stake),
                          currency: row.currency,
                          odds: Number(row.odds),
                          result: row.result,
                        },
                        ...prev,
                      ]);
                      if (currencyFilter !== "All" && newBet.currency !== currencyFilter) {
                        setCurrencyFilter(newBet.currency);
                      }
                    } catch (e: any) {
                      alert("Insert failed: " + (e?.message ?? String(e)));
                    }
                  }}
                />
              ) : (
                <p className="text-sm opacity-70">Read-only shared view.</p>
              )}
            </div>

            {/* Center: Chart + Profit by Sport */}
<div className="xl:col-span-2 flex flex-col gap-2">
              {/* Chart */}
<div className={`relative rounded-xl p-3 ${card} shadow-sm border ${border}`}>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold">Performance ({windowLabel})</h3>
                  <span className="text-xs opacity-70">
                    X-axis: Bet Number • Y-axis: {plMode === "cumulative" ? "Cumulative" : "Per-Bet"} P&amp;L ({showCCY})
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs opacity-80">Sport</label>
                  <select
                    className={`h-9 px-2 rounded-lg border ${border} ${themeDark ? "bg-gray-800 text-white" : "bg-white text-slate-900"}`}
                    value={graphSport}
                    onChange={(e) => setGraphSport(e.target.value as any)}
                  >
                    <option value="All">All</option>
                    {SPORTS.map((s) => (
                      <option key={`g-${s}`} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setPlMode(plMode === "cumulative" ? "perBet" : "cumulative")}
                    className="h-9 px-3 rounded-xl text-sm border border-white/10 bg-black/20 hover:bg-black/30"
                  >
                    {plMode === "cumulative" ? "Per-Bet" : "Cumulative"}
                  </button>
                </div>
              </div>
              <div className="w-full h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={graphData} margin={{ top: 6, right: 12, bottom: 16, left: 26 }}>
                    <CartesianGrid strokeOpacity={themeDark ? 0.08 : 0.15} />
                    <XAxis dataKey="betNumber" tick={{ fontSize: 10 }} label={{ value: "Bet #", position: "bottom", offset: 0 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip content={<ColoredTooltip />} />
                    <Line type="linear" dataKey="pnl" strokeWidth={2} dot={false} name="P&L" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <button
                onClick={() => setChartFull(true)}
                className="absolute bottom-3 right-3 h-9 px-3 rounded-xl text-sm bg-black/30 hover:bg-black/40"
              >
                Fullscreen
              </button>
            </div>

            {/* Profit by Sport */}
            <div className={`rounded-xl p-3 ${card} shadow-sm border ${border}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Profit by Sport</h3>
                <div className="text-xs opacity-70">Best: {bySport.best ?? "-"} • Worst: {bySport.worst ?? "-"}</div>
              </div>
              {bySport.rows.length ? (
                <div className="w-full h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bySport.rows} margin={{ top: 4, right: 8, bottom: 12, left: 26 }}>
                      <CartesianGrid strokeOpacity={themeDark ? 0.08 : 0.15} />
                      <XAxis dataKey="sport" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip content={<ColoredTooltip />} />
                      <Bar dataKey="pnl">
                        {bySport.rows.map((r, i) => (
                          <Cell key={i} fill={r.pnl >= 0 ? "#10b981" : "#ef4444"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm opacity-70">No data in this range.</p>
              )}
            </div>
          </div>

            {/* Right: Calendar + Market - Desktop */}
            <div className="flex flex-col gap-2">
              <div className={`rounded-xl p-3 ${card} shadow-sm border ${border}`}>
              <div className="flex gap-1 mb-2 flex-wrap">
                {(["Days", "Weeks", "Months", "Years"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setCalView(v)}
                    className={`h-8 px-3 rounded-lg text-xs border ${border} transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 ${
                      calView === v
                        ? "bg-emerald-500 text-white border-transparent shadow-md hover:bg-emerald-600"
                        : themeDark
                        ? "bg-black/20 hover:bg-black/40 hover:shadow-md"
                        : "bg-white text-slate-900 hover:bg-slate-50 hover:shadow-md"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>

              {calView === "Days" && (
                <MiniCalendar
                  themeDark={themeDark}
                  dailyPNL={dailyPNL}
                  selectedISO={selectedISO}
                  onPickDay={(iso) => {
                    setAnchorDate(new Date(iso));
                    setRange("Daily");
                  }}
                />
              )}
              {calView === "Weeks" && (
                <YearWeeks
                  themeDark={themeDark}
                  weeklyPNL={weeklyPNL}
                  selectedWeekKey={selectedWeekK}
                  onPickWeek={(year, week) => {
                    setAnchorDate(dateOfISOWeek(week, year));
                    setRange("Weekly");
                  }}
                />
              )}
              {calView === "Months" && (
                <YearMonths
                  themeDark={themeDark}
                  monthlyPNL={monthlyPNL}
                  selectedMonthKey={selectedMonthK}
                  ccy={showCCY}
                  onPickMonth={(year, m) => {
                    setAnchorDate(new Date(year, m, 1));
                    setRange("Monthly");
                  }}
                />
              )}
              {calView === "Years" && (
                <YearGrid
                  themeDark={themeDark}
                  yearPNL={yearlyPNL}
                  ccy={showCCY}
                  selectedYear={anchorDate ? String(anchorDate.getFullYear()) : ""}
                  onPickYear={(y) => {
                    setAnchorDate(new Date(y, 0, 1));
                    setRange("Yearly");
                  }}
                />
              )}
            </div>

            <div className={`rounded-xl p-3 ${card} shadow-sm border ${border}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {hasAnyProfit ? "Profit by Market" : hasAnyLoss ? "Loss by Market" : "Profit by Market"}
                </h3>
                <span className="text-xs opacity-70">
                  {hasAnyProfit ? "Only profitable markets shown" : hasAnyLoss ? "Only losing markets shown" : "No data"}
                </span>
              </div>

              {hasAnyProfit && (
                <div className="space-y-2">
                  <div className="w-full h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie 
                          data={marketProfitRows} 
                          dataKey="pnl" 
                          nameKey="market" 
                          innerRadius={35} 
                          outerRadius={65}
                          paddingAngle={2}
                          onMouseEnter={(_, index) => {
                            setHoveredPieSegment(marketProfitRows[index]?.market || null);
                          }}
                          onMouseLeave={() => setHoveredPieSegment(null)}
                        >
                          {marketProfitRows.map((entry, i) => (
                            <Cell 
                              key={i} 
                              fill={PIE_COLORS_PROFIT[i % PIE_COLORS_PROFIT.length]}
                              stroke={hoveredPieSegment === entry.market ? '#ffffff' : 'transparent'}
                              strokeWidth={hoveredPieSegment === entry.market ? 2 : 0}
                            />
                          ))}
                        </Pie>
                        <Tooltip content={(props) => <PieTooltip {...props} isProfit={true} />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  
                  {/* Interactive Legend */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {marketProfitRows.map((row, i) => {
                      const color = PIE_COLORS_PROFIT[i % PIE_COLORS_PROFIT.length];
                      const isHovered = hoveredPieSegment === row.market;
                      return (
                        <div
                          key={row.market}
                          className={`flex items-center gap-2 p-2 rounded-lg transition-all duration-200 cursor-pointer ${
                            isHovered ? 'shadow-md transform scale-105' : 'hover:bg-black/5 shadow-sm'
                          }`}
                          style={{
                            backgroundColor: isHovered ? color : `${color}15`,
                            borderLeft: `4px solid ${color}`,
                            border: `1px solid ${color}40`,
                            color: isHovered ? 'white' : 'inherit'
                          }}
                          onMouseEnter={() => setHoveredPieSegment(row.market)}
                          onMouseLeave={() => setHoveredPieSegment(null)}
                        >
                          <div className="flex-1 font-medium" style={{ color: isHovered ? 'white' : color }}>{row.market}</div>
                          <div className="font-semibold" style={{ color: isHovered ? 'white' : '#10b981' }}>
                            {formatCurrency(row.pnl, showCCY)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!hasAnyProfit && hasAnyLoss && (
                <div className="space-y-4">
                  <div className="w-full h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie 
                          data={marketLossRows} 
                          dataKey="pnlAbs" 
                          nameKey="market" 
                          innerRadius={35} 
                          outerRadius={65}
                          paddingAngle={2}
                          onMouseEnter={(_, index) => {
                            setHoveredPieSegment(marketLossRows[index]?.market || null);
                          }}
                          onMouseLeave={() => setHoveredPieSegment(null)}
                        >
                          {marketLossRows.map((entry, i) => (
                            <Cell 
                              key={i} 
                              fill={PIE_COLORS_LOSS[i % PIE_COLORS_LOSS.length]}
                              stroke={hoveredPieSegment === entry.market ? '#ffffff' : 'transparent'}
                              strokeWidth={hoveredPieSegment === entry.market ? 2 : 0}
                            />
                          ))}
                        </Pie>
                        <Tooltip content={(props) => <PieTooltip {...props} isProfit={false} />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  
                  {/* Interactive Legend for Losses */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {marketLossRows.map((row, i) => {
                      const color = PIE_COLORS_LOSS[i % PIE_COLORS_LOSS.length];
                      const isHovered = hoveredPieSegment === row.market;
                      return (
                        <div
                          key={row.market}
                          className={`flex items-center gap-2 p-2 rounded-lg transition-all duration-200 cursor-pointer ${
                            isHovered ? 'shadow-md transform scale-105' : 'hover:bg-black/5 shadow-sm'
                          }`}
                          style={{
                            backgroundColor: isHovered ? color : `${color}15`,
                            borderLeft: `4px solid ${color}`,
                            border: `1px solid ${color}40`,
                            color: isHovered ? 'white' : 'inherit'
                          }}
                          onMouseEnter={() => setHoveredPieSegment(row.market)}
                          onMouseLeave={() => setHoveredPieSegment(null)}
                        >
                          <div className="flex-1 font-medium" style={{ color: isHovered ? 'white' : color }}>{row.market}</div>
                          <div className="font-semibold" style={{ color: isHovered ? 'white' : '#ef4444' }}>
                            -{formatCurrency(row.pnlAbs, showCCY)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!hasAnyProfit && !hasAnyLoss && (
                <p className="text-sm opacity-70">No data available for this range/currency.</p>
              )}
              </div>
            </div>
          </div>
          
          {/* Mobile Layout - Stacked */}
          <div className="xl:hidden space-y-2">
            {/* Chart + Profit by Sport - Mobile */}
            <div className="flex flex-col gap-2">
              {/* Chart */}
              <div className={`relative rounded-xl p-3 ${card} shadow-sm border ${border}`}>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-semibold">Performance ({windowLabel})</h3>
                    <span className="text-xs opacity-70">
                      X-axis: Bet Number • Y-axis: {plMode === "cumulative" ? "Cumulative" : "Per-Bet"} P&L ({showCCY})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs opacity-80">Sport</label>
                    <select
                      className={`h-9 px-2 rounded-lg border ${border} ${themeDark ? "bg-gray-800 text-white" : "bg-white text-slate-900"}`}
                      value={graphSport}
                      onChange={(e) => setGraphSport(e.target.value as any)}
                    >
                      <option value="All">All</option>
                      {SPORTS.map((s) => (
                        <option key={`gm-${s}`} value={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setPlMode(plMode === "cumulative" ? "perBet" : "cumulative")}
                      className="h-9 px-3 rounded-xl text-sm border border-white/10 bg-black/20 hover:bg-black/30"
                    >
                      {plMode === "cumulative" ? "Per-Bet" : "Cumulative"}
                    </button>
                  </div>
                </div>
                <div className="w-full h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={graphData} margin={{ top: 6, right: 12, bottom: 16, left: 26 }}>
                      <CartesianGrid strokeOpacity={themeDark ? 0.08 : 0.15} />
                      <XAxis dataKey="betNumber" tick={{ fontSize: 10 }} label={{ value: "Bet #", position: "bottom", offset: 0 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip content={<ColoredTooltip />} />
                      <Line type="linear" dataKey="pnl" strokeWidth={2} dot={false} name="P&L" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <button
                  onClick={() => setChartFull(true)}
                  className="absolute bottom-3 right-3 h-9 px-3 rounded-xl text-sm bg-black/30 hover:bg-black/40"
                >
                  Fullscreen
                </button>
              </div>

              {/* Profit by Sport - Mobile */}
              <div className={`rounded-xl p-3 ${card} shadow-sm border ${border}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Profit by Sport</h3>
                  <div className="text-xs opacity-70">Best: {bySport.best ?? "-"} • Worst: {bySport.worst ?? "-"}</div>
                </div>
                {bySport.rows.length ? (
                  <div className="w-full h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={bySport.rows} margin={{ top: 4, right: 8, bottom: 12, left: 26 }}>
                        <CartesianGrid strokeOpacity={themeDark ? 0.08 : 0.15} />
                        <XAxis dataKey="sport" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip content={<ColoredTooltip />} />
                        <Bar dataKey="pnl">
                          {bySport.rows.map((r, i) => (
                            <Cell key={i} fill={r.pnl >= 0 ? "#10b981" : "#ef4444"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm opacity-70">No data in this range.</p>
                )}
              </div>
            </div>

            {/* Calendar + Market - Mobile - Side by side on mobile */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className={`rounded-xl p-3 ${card} shadow-sm border ${border}`}>
                <div className="flex gap-1 mb-2 flex-wrap">
                  {(["Days", "Weeks", "Months", "Years"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setCalView(v)}
                      className={`h-8 px-3 rounded-lg text-xs border ${border} transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 ${
                        calView === v
                          ? "bg-emerald-500 text-white border-transparent shadow-md hover:bg-emerald-600"
                          : themeDark
                          ? "bg-black/20 hover:bg-black/40 hover:shadow-md"
                          : "bg-white text-slate-900 hover:bg-slate-50 hover:shadow-md"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                {calView === "Days" && (
                  <MiniCalendar
                    themeDark={themeDark}
                    dailyPNL={dailyPNL}
                    selectedISO={selectedISO}
                    onPickDay={(iso) => {
                      setAnchorDate(new Date(iso));
                      setRange("Daily");
                    }}
                  />
                )}
                {calView === "Weeks" && (
                  <YearWeeks
                    themeDark={themeDark}
                    weeklyPNL={weeklyPNL}
                    selectedWeekKey={selectedWeekK}
                    onPickWeek={(year, week) => {
                      setAnchorDate(dateOfISOWeek(week, year));
                      setRange("Weekly");
                    }}
                  />
                )}
                {calView === "Months" && (
                  <YearMonths
                    themeDark={themeDark}
                    monthlyPNL={monthlyPNL}
                    selectedMonthKey={selectedMonthK}
                    ccy={showCCY}
                    onPickMonth={(year, m) => {
                      setAnchorDate(new Date(year, m, 1));
                      setRange("Monthly");
                    }}
                  />
                )}
                {calView === "Years" && (
                  <YearGrid
                    themeDark={themeDark}
                    yearPNL={yearlyPNL}
                    ccy={showCCY}
                    selectedYear={anchorDate ? String(anchorDate.getFullYear()) : ""}
                    onPickYear={(y) => {
                      setAnchorDate(new Date(y, 0, 1));
                      setRange("Yearly");
                    }}
                  />
                )}
              </div>

              <div className={`rounded-2xl p-4 ${card} shadow-sm border ${border}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">
                    {hasAnyProfit ? "Profit by Market" : hasAnyLoss ? "Loss by Market" : "Profit by Market"}
                  </h3>
                  <span className="text-xs opacity-70">
                    {hasAnyProfit ? "Only profitable markets shown" : hasAnyLoss ? "Only losing markets shown" : "No data"}
                  </span>
                </div>

                {hasAnyProfit && (
                  <div className="space-y-4">
                    <div className="w-full h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie 
                            data={marketProfitRows} 
                            dataKey="pnl" 
                            nameKey="market" 
                            innerRadius={35} 
                            outerRadius={65}
                            paddingAngle={2}
                            onMouseEnter={(_, index) => {
                              setHoveredPieSegment(marketProfitRows[index]?.market || null);
                            }}
                            onMouseLeave={() => setHoveredPieSegment(null)}
                          >
                            {marketProfitRows.map((entry, i) => (
                              <Cell 
                                key={i} 
                                fill={PIE_COLORS_PROFIT[i % PIE_COLORS_PROFIT.length]}
                                stroke={hoveredPieSegment === entry.market ? '#ffffff' : 'transparent'}
                                strokeWidth={hoveredPieSegment === entry.market ? 2 : 0}
                              />
                            ))}
                          </Pie>
                          <Tooltip content={(props) => <PieTooltip {...props} isProfit={true} />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    
                    {/* Interactive Legend */}
                    <div className="grid grid-cols-1 gap-2 text-sm">
                      {marketProfitRows.map((row, i) => {
                        const color = PIE_COLORS_PROFIT[i % PIE_COLORS_PROFIT.length];
                        const isHovered = hoveredPieSegment === row.market;
                        return (
                          <div
                            key={row.market}
                            className={`flex items-center gap-2 p-2 rounded-lg transition-all duration-200 cursor-pointer ${
                              isHovered ? 'shadow-md transform scale-105' : 'hover:bg-black/5 shadow-sm'
                            }`}
                            style={{
                              backgroundColor: isHovered ? color : `${color}15`,
                              borderLeft: `4px solid ${color}`,
                              border: `1px solid ${color}40`,
                              color: isHovered ? 'white' : 'inherit'
                            }}
                            onMouseEnter={() => setHoveredPieSegment(row.market)}
                            onMouseLeave={() => setHoveredPieSegment(null)}
                          >
                            <div className="flex-1 font-medium" style={{ color: isHovered ? 'white' : color }}>{row.market}</div>
                            <div className="font-semibold" style={{ color: isHovered ? 'white' : '#10b981' }}>
                              {formatCurrency(row.pnl, showCCY)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!hasAnyProfit && hasAnyLoss && (
                  <div className="space-y-4">
                    <div className="w-full h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie 
                            data={marketLossRows} 
                            dataKey="pnlAbs" 
                            nameKey="market" 
                            innerRadius={35} 
                            outerRadius={65}
                            paddingAngle={2}
                            onMouseEnter={(_, index) => {
                              setHoveredPieSegment(marketLossRows[index]?.market || null);
                            }}
                            onMouseLeave={() => setHoveredPieSegment(null)}
                          >
                            {marketLossRows.map((entry, i) => (
                              <Cell 
                                key={i} 
                                fill={PIE_COLORS_LOSS[i % PIE_COLORS_LOSS.length]}
                                stroke={hoveredPieSegment === entry.market ? '#ffffff' : 'transparent'}
                                strokeWidth={hoveredPieSegment === entry.market ? 2 : 0}
                              />
                            ))}
                          </Pie>
                          <Tooltip content={(props) => <PieTooltip {...props} isProfit={false} />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    
                    {/* Interactive Legend for Losses */}
                    <div className="grid grid-cols-1 gap-2 text-sm">
                      {marketLossRows.map((row, i) => {
                        const color = PIE_COLORS_LOSS[i % PIE_COLORS_LOSS.length];
                        const isHovered = hoveredPieSegment === row.market;
                        return (
                          <div
                            key={row.market}
                            className={`flex items-center gap-2 p-2 rounded-lg transition-all duration-200 cursor-pointer ${
                              isHovered ? 'shadow-md transform scale-105' : 'hover:bg-black/5 shadow-sm'
                            }`}
                            style={{
                              backgroundColor: isHovered ? color : `${color}15`,
                              borderLeft: `4px solid ${color}`,
                              border: `1px solid ${color}40`,
                              color: isHovered ? 'white' : 'inherit'
                            }}
                            onMouseEnter={() => setHoveredPieSegment(row.market)}
                            onMouseLeave={() => setHoveredPieSegment(null)}
                          >
                            <div className="flex-1 font-medium" style={{ color: isHovered ? 'white' : color }}>{row.market}</div>
                            <div className="font-semibold" style={{ color: isHovered ? 'white' : '#ef4444' }}>
                              -{formatCurrency(row.pnlAbs, showCCY)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!hasAnyProfit && !hasAnyLoss && (
                  <p className="text-sm opacity-70">No data available for this range/currency.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ===== History ===== */}
        <section className={`mt-3 rounded-xl ${card} shadow-sm overflow-hidden border ${border}`}>
          <div className="px-4 py-3 border-b border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Bets</h3>
              <div className="flex items-center gap-3">
                <div className="text-sm opacity-70">
                  {loading
                    ? "Loading…"
                    : `${filteredBets.length} in ${windowLabel.toLowerCase()} • ${
                        currencyFilter === "All" ? "mixed currencies" : currencyFilter
                      }`}
                </div>
                {/* Export CSV */}
                <button
                  onClick={() => {
                    const rows = filteredBets.map(b => ({
                      id: b.id,
                      date: b.date,
                      sport: b.sport,
                      market: b.market ?? "",
                      selection: b.selection,
                      stake: b.stake,
                      currency: b.currency,
                      odds: b.odds,
                      result: b.result,
                    }));
                    const headers = Object.keys(rows[0] ?? { id:"", date:"", sport:"", market:"", selection:"", stake:"", currency:"", odds:"", result:"" });
                    const csv = [
                      headers.join(","),
                      ...rows.map(r =>
                        headers
                          .map(h => String((r as any)[h]).replace(/"/g,'""'))
                          .map(v => `"${v}"`)
                          .join(",")
                      ),
                    ].join("\n");
                    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `bets_${new Date().toISOString().slice(0,10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="h-9 px-3 rounded-xl border border-white/20 bg-black/20 hover:bg-black/40 text-sm transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 hover:shadow-md"
                  title="Export current table to CSV"
                >
                  Export CSV
                </button>
              </div>
            </div>
            
            {/* Search Box */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search by selection, sport, or market..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full h-10 pl-10 pr-4 rounded-xl border ${border} transition-colors duration-200 focus:ring-2 focus:ring-emerald-400 focus:border-transparent ${
                  themeDark ? "bg-gray-800 text-white placeholder-white/60" : "bg-white text-slate-900 placeholder-slate-400"
                }`}
              />
              <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                <svg className="w-4 h-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
                </svg>
              </div>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 opacity-60 hover:opacity-100"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          {/* Mobile: Card view, Desktop: Table view */}
          <div className="block md:hidden px-4 pb-4 space-y-3">
            {loading && (
              <div className="text-center py-8 opacity-70">Loading…</div>
            )}
            {!loading && filteredBets.length === 0 && (
              <div className="text-center py-8 opacity-70">No bets in this range.</div>
            )}
            {!loading && filteredBets.map((b) => {
              const stake = Number(b.stake) || 0;
              const odds = Number(b.odds) || 0;
              const payout = b.result === "win" ? stake * odds : b.result === "loss" ? 0 : stake;
              const profit = b.result === "win" ? stake * odds - stake : b.result === "loss" ? -stake : 0;
              return (
                <div key={b.id} className={`rounded-xl p-3 ${themeDark ? "bg-gray-800" : "bg-slate-50"} border ${border}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="font-medium text-sm mb-1">{b.selection}</div>
                      <div className="text-xs opacity-70">{b.date} • {b.sport} • {normalizeMarket(b.sport, b.market)}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-semibold ${profit > 0 ? "text-emerald-300" : profit < 0 ? "text-rose-300" : ""}`}>
                        {formatCurrency(profit, b.currency)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex gap-4">
                      <span>{formatCurrency(stake, b.currency)} @ {odds.toFixed(2)}</span>
                      <span className="opacity-70">{b.currency}</span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {canEdit ? (
                        <div className="flex gap-1">
                          {RESULTS.map((result) => (
                            <button
                              key={result}
                              onClick={() => handleQuickResultUpdate(b.id, result, setBets)}
                              className={`px-2 py-1 rounded text-xs font-semibold transition-all duration-150 hover:scale-105 ${
                                b.result === result
                                  ? result === "win"
                                    ? "bg-emerald-500 text-white shadow-md"
                                    : result === "loss"
                                    ? "bg-rose-500 text-white shadow-md"
                                    : "bg-indigo-500 text-white shadow-md"
                                  : result === "win"
                                  ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/40"
                                  : result === "loss"
                                  ? "bg-rose-500/20 text-rose-200 hover:bg-rose-500/40"
                                  : "bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/40"
                              }`}
                              title={`Set result to ${RESULT_LABELS[result]}`}
                            >
                              {result === "win" ? "W" : result === "loss" ? "L" : "V"}
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              setEditing(b);
                              setShowForm(true);
                            }}
                            className="ml-1 p-1 rounded hover:bg-black/20"
                            title="Edit"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteSupabase(b.id, setBets)}
                            className="p-1 rounded hover:bg-red-500/20"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            b.result === "win"
                              ? "bg-emerald-500/20 text-emerald-200"
                              : b.result === "loss"
                              ? "bg-rose-500/20 text-rose-200"
                              : "bg-indigo-500/20 text-indigo-200"
                          }`}
                        >
                          {b.result}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Desktop: Table view */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={themeDark ? "bg-gray-800/50" : "bg-slate-100"}>
                <tr className="text-left">
                  <Th>Date</Th>
                  <Th>Sport</Th>
                  <Th>CCY</Th>
                  <Th>Market</Th>
                  <Th>Selection</Th>
                  <Th className="text-right">Stake</Th>
                  <Th className="text-right">Odds (dec)</Th>
                  <Th>Result</Th>
                  <Th className="text-right">Payout</Th>
                  <Th className="text-right">Profit</Th>
                  {canEdit && <Th className="text-right">Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={canEdit ? 11 : 10} className="text-center py-8 opacity-70">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && filteredBets.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 11 : 10} className="text-center py-8 opacity-70">
                      No bets in this range.
                    </td>
                  </tr>
                )}
                {!loading &&
                  filteredBets.map((b) => {
                    const stake = Number(b.stake) || 0;
                    const odds = Number(b.odds) || 0;
                    const payout = b.result === "win" ? stake * odds : b.result === "loss" ? 0 : stake;
                    const profit = b.result === "win" ? stake * odds - stake : b.result === "loss" ? -stake : 0;
                    return (
                      <tr key={b.id} className="border-t border-white/10">
                        <Td>{b.date}</Td>
                        <Td>{b.sport}</Td>
                        <Td>{b.currency}</Td>
                        <Td>{normalizeMarket(b.sport, b.market)}</Td>
                        <Td className="max-w-[320px] truncate">{b.selection}</Td>
                        <Td className="text-right">{formatCurrency(stake, b.currency)}</Td>
                        <Td className="text-right">{odds.toFixed(2)}</Td>
                        <Td>
                          {canEdit ? (
                            <div className="flex gap-1">
                              {RESULTS.map((result) => (
                                <button
                                  key={result}
                                  onClick={() => handleQuickResultUpdate(b.id, result, setBets)}
                                  className={`px-2 py-1 rounded text-xs font-semibold transition-all duration-150 hover:scale-105 ${
                                    b.result === result
                                      ? result === "win"
                                        ? "bg-emerald-500 text-white shadow-md"
                                        : result === "loss"
                                        ? "bg-rose-500 text-white shadow-md"
                                        : "bg-indigo-500 text-white shadow-md"
                                      : result === "win"
                                      ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/40"
                                      : result === "loss"
                                      ? "bg-rose-500/20 text-rose-200 hover:bg-rose-500/40"
                                      : "bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/40"
                                  }`}
                                  title={`Set result to ${RESULT_LABELS[result]}`}
                                >
                                  {result === "win" ? "W" : result === "loss" ? "L" : "V"}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                b.result === "win"
                                  ? "bg-emerald-500/20 text-emerald-200"
                                  : b.result === "loss"
                                  ? "bg-rose-500/20 text-rose-200"
                                  : "bg-indigo-500/20 text-indigo-200"
                              }`}
                            >
                              {b.result}
                            </span>
                          )}
                        </Td>
                        <Td className="text-right">{formatCurrency(payout, b.currency)}</Td>
                        <Td className={`text-right ${profit > 0 ? "text-emerald-300" : profit < 0 ? "text-rose-300" : ""}`}>
                          {formatCurrency(profit, b.currency)}
                        </Td>
                        {canEdit && (
                          <Td className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <IconButton
                                title="Edit"
                                onClick={() => {
                                  setEditing(b);
                                  setShowForm(true);
                                }}
                              >
                                <Edit2 className="w-4 h-4" />
                              </IconButton>
                              <IconButton
                                title="Delete"
                                onClick={() => handleDeleteSupabase(b.id, setBets)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </IconButton>
                            </div>
                          </Td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
            </div>
          </div>
        </div>
      </div>

      {chartFull && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setChartFull(false);
          }}
        >
          <div className={`w-full h-[80vh] max-w-6xl rounded-2xl ${card} border ${border} p-4 relative`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold">Performance — {windowLabel} – {graphSport}</h3>
                <span className="text-xs opacity-70">
                  X-axis: Bet Number • Y-axis: {plMode === "cumulative" ? "Cumulative" : "Per-Bet"} P&L ({showCCY})
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className={`h-9 px-2 rounded-lg border ${border} ${themeDark ? "bg-gray-800 text-white" : "bg-white text-slate-900"}`}
                  value={graphSport}
                  onChange={(e) => setGraphSport(e.target.value as any)}
                >
                  <option value="All">All</option>
                  {SPORTS.map((s) => (
                    <option key={`fg-${s}`} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setPlMode(plMode === "perBet" ? "cumulative" : "perBet")}
                  className="h-9 px-3 rounded-xl text-sm border border-white/10 bg-black/20 hover:bg-black/30"
                >
                  {plMode === "cumulative" ? "Per-Bet" : "Cumulative"}
                </button>
                <button
                  onClick={() => setChartFull(false)}
                  className="h-9 px-3 rounded-xl bg-black/20 hover:bg-black/30"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="w-full h-[calc(80vh-88px)]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={graphData} margin={{ top: 8, right: 16, bottom: 28, left: 28 }}>
                  <CartesianGrid strokeOpacity={themeDark ? 0.08 : 0.15} />
                  <XAxis dataKey="betNumber" tick={{ fontSize: 12 }} label={{ value: "Bet #", position: "bottom", offset: 2 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip content={<ColoredTooltip />} />
                  <Line type="linear" dataKey="pnl" strokeWidth={2} dot={false} name="P&L" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ===== Edit Modal Mount ===== */}
      {showForm && editing && (
        <EditBetDialog
          themeDark={themeDark}
          bet={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSave={async (updated) => {
            try {
              const patch = {
                date: updated.date,
                sport: updated.sport,
                market: updated.market ?? null,
                selection: updated.selection,
                stake: updated.stake,
                currency: updated.currency,
                odds: updated.odds,
                result: updated.result,
              };
              const { data, error } = await supabase
                .from("bets")
                .update(patch)
                .eq("id", updated.id)
                .select()
                .single();
              if (error) throw error;
              setBets((prev) =>
                prev.map((b) =>
                  b.id === updated.id
                    ? {
                        ...b,
                        date: data.date,
                        sport: data.sport,
                        market: data.market ?? undefined,
                        selection: data.selection,
                        stake: Number(data.stake),
                        currency: data.currency,
                        odds: Number(data.odds),
                        result: data.result,
                      }
                    : b
                )
              );
            } catch (e: any) {
              alert("Update failed: " + (e?.message ?? String(e)));
            } finally {
              setShowForm(false);
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

/* =======================
   Inline Add Bet
   ======================= */
function InlineAddBet({
  themeDark,
  onAdd,
  defaultCurrency,
}: {
  themeDark: boolean;
  onAdd: (b: Omit<Bet, "id">) => Promise<void>;
  defaultCurrency: Currency;
}) {
  const [date, setDate] = useState(toISODateLocal());
  const [sport, setSport] = useState<typeof SPORTS[number] | "">("");
  const [market, setMarket] = useState<string>(getMarketOptionsForSport("").at(0) || "Match Winner");
  const [selection, setSelection] = useState("");
  const [stakeRaw, setStakeRaw] = useState("");
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [result, setResult] = useState<(typeof RESULTS)[number]>("win");

  const [oddsFormat, setOddsFormat] = useState<OddsFormat>("decimal");
  const [oddsRaw, setOddsRaw] = useState("");
  const [oddsError, setOddsError] = useState("");

  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    setCurrency(defaultCurrency);
  }, [defaultCurrency]);

  useEffect(() => {
    const opts = getMarketOptionsForSport(sport);
    if (!opts.includes(market)) setMarket(opts[0]);
  }, [sport, market]);

  function parseDecimalOddsFromRaw(): number | null {
    if (!oddsRaw.trim()) return null;
    const n = Number(oddsRaw);
    if (!Number.isFinite(n) || n <= 1) return null;
    return n;
  }

  function clear() {
    setDate(toISODateLocal());
    setSport("");
    setMarket(getMarketOptionsForSport("").at(0) || "Match Winner");
    setSelection("");
    setStakeRaw("");
    setCurrency(defaultCurrency);
    setOddsFormat("decimal");
    setOddsRaw("");
    setResult("win");
    setOddsError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const stake = parseFloat(stakeRaw);
    if (!date || !selection || !Number.isFinite(stake) || stake <= 0 || !sport || !currency) return;

    let dec: number | null = null;
    if (oddsFormat === "decimal") dec = parseDecimalOddsFromRaw();
    else dec = americanToDecimal(oddsRaw);

    if (!dec || dec <= 1) {
      setOddsError(oddsFormat === "decimal" ? "Enter decimal odds > 1.00" : "Enter American odds like -110 or +150");
      return;
    }

    await onAdd({
      date,
      sport,
      market: normalizeMarket(sport, market),
      selection,
      stake,
      currency,
      odds: +dec.toFixed(3),
      result,
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
    clear();
  }

  const inputBase = `w-full h-12 px-3 rounded-xl border ${
    themeDark
      ? "bg-gray-800 border-white/20 text-white placeholder-white/60"
      : "bg-white border-slate-300 text-slate-900 placeholder-slate-400"
  }`;
  const selectBase = inputBase + " appearance-none";

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {justAdded && (
        <div role="status" className="text-xs rounded-lg px-3 py-2 bg-emerald-500/15 text-emerald-200 border border-emerald-400/30">
          Added!
        </div>
      )}

      <div>
        <label className="text-xs opacity-80">Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputBase} required />
      </div>

      <div>
        <label className="text-xs opacity-80">Sport</label>
        <select value={sport} onChange={(e) => setSport(e.target.value as any)} className={selectBase} required>
          <option value="" disabled>Select sport</option>
          {SPORTS.map((s) => (
            <option key={`is-${s}`} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs opacity-80">Market</label>
        <select value={market} onChange={(e) => setMarket(e.target.value)} className={selectBase} required>
          {getMarketOptionsForSport(sport).map((m) => (
            <option key={`im-${m}`} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs opacity-80">Selection / Notes</label>
        <input
          className={inputBase}
          placeholder="Team/Player, market, bookie, etc."
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-xs opacity-80 block mb-1">Stake</label>
          <div className="grid grid-rows-2 gap-2">
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={selectBase} required>
              {CURRENCIES.map((c) => (
                <option key={`ccy-${c}`} value={c}>{c}</option>
              ))}
            </select>
            <input
              type="text"
              inputMode="decimal"
              value={stakeRaw}
              onChange={(e) => setStakeRaw(e.target.value.replace(/[^\d.]/g, ""))}
              className={inputBase}
              placeholder="Enter stake"
              required
            />
          </div>
        </div>

        <div>
          <label className="text-xs opacity-80 block mb-1">Odds</label>
          <div className="grid grid-rows-2 gap-2">
            <select value={oddsFormat} onChange={(e) => setOddsFormat(e.target.value as any)} className={selectBase}>
              <option value="decimal">Decimal</option>
              <option value="american">American</option>
            </select>
            <input
              type="text"
              inputMode="decimal"
              value={oddsRaw}
              onChange={(e) => {
                setOddsError("");
                setOddsRaw(e.target.value.replace(/[^\d.+-]/g, ""));
              }}
              className={inputBase + (oddsError ? " border-rose-400" : "")}
              placeholder={oddsFormat === "decimal" ? "e.g. 1.85" : "e.g. -110 or +150"}
              required
            />
            {oddsError && <div className="text-xs text-rose-300">{oddsError}</div>}
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs opacity-80">Result</label>
        <select value={result} onChange={(e) => setResult(e.target.value as any)} className={selectBase}>
          {RESULTS.map((r) => (
            <option key={`res-${r}`} value={r}>
              {RESULT_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="w-full h-12 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500"
      >
        Add bet
      </button>
    </form>
  );
}

/* =======================
   Edit Modal
   ======================= */
function EditBetDialog({
  themeDark,
  bet,
  onClose,
  onSave,
}: {
  themeDark: boolean;
  bet: Bet;
  onClose: () => void;
  onSave: (b: Bet) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Bet>({ ...bet });

  useEffect(() => setDraft({ ...bet }), [bet.id]); // refresh when editing different row

  const inputBase = `w-full h-11 px-3 rounded-xl border ${
    themeDark
      ? "bg-gray-800 border-white/20 text-white placeholder-white/60"
      : "bg-white border-slate-300 text-slate-900 placeholder-slate-400"
  }`;
  const selectBase = inputBase + " appearance-none";

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 grid place-items-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${themeDark ? NAVY_CARD : LIGHT_CARD} w-full max-w-lg rounded-2xl border ${themeDark ? "border-white/10" : "border-slate-200"} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Edit Bet</h3>
          <button onClick={onClose} className="text-sm opacity-80 hover:opacity-100">Close</button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="text-xs opacity-80">Date</label>
            <input className={inputBase} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })}/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs opacity-80">Sport</label>
              <select className={selectBase} value={draft.sport} onChange={(e) => {
                const s = e.target.value as Sport;
                const opts = getMarketOptionsForSport(s);
                setDraft((d) => ({ ...d, sport: s, market: opts.includes(d.market ?? "") ? d.market : opts[0] }));
              }}>
                {SPORTS.map((s) => <option key={`es-${s}`} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs opacity-80">Market</label>
              <select className={selectBase} value={draft.market ?? ""} onChange={(e) => setDraft({ ...draft, market: e.target.value })}>
                {getMarketOptionsForSport(draft.sport).map((m) => <option key={`em-${m}`} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs opacity-80">Selection / Notes</label>
            <input className={inputBase} value={draft.selection} onChange={(e) => setDraft({ ...draft, selection: e.target.value })}/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs opacity-80">Stake</label>
              <input className={inputBase} inputMode="decimal" value={String(draft.stake)} onChange={(e) => setDraft({ ...draft, stake: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })}/>
            </div>
            <div>
              <label className="text-xs opacity-80">Currency</label>
              <select className={selectBase} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value as Currency })}>
                {CURRENCIES.map((c) => <option key={`ec-${c}`} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs opacity-80">Odds (decimal)</label>
              <input className={inputBase} inputMode="decimal" value={String(draft.odds)} onChange={(e) => setDraft({ ...draft, odds: Number(e.target.value.replace(/[^\d.]/g, "")) || 1 })}/>
            </div>
            <div>
              <label className="text-xs opacity-80">Result</label>
              <select className={selectBase} value={draft.result} onChange={(e) => setDraft({ ...draft, result: e.target.value as Bet["result"] })}>
                {RESULTS.map((r) => <option key={`er-${r}`} value={r}>{RESULT_LABELS[r]}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-xl border border-white/20 bg-black/20 hover:bg-black/30">Cancel</button>
          <button
            onClick={() => onSave(draft)}
            className="h-10 px-4 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* =======================
   Calendars (updated)
   ======================= */

/* MiniCalendar (Days) — with month selector + solid colors */
function MiniCalendar({
  themeDark,
  dailyPNL,
  selectedISO,
  onPickDay,
}: {
  themeDark: boolean;
  dailyPNL: Record<string, number>;
  selectedISO: string;
  onPickDay: (iso: string) => void;
}) {
  const [viewDate, setViewDate] = React.useState<Date>(() => {
    return selectedISO ? new Date(selectedISO + "T00:00:00") : new Date();
  });

  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const lastOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const monthLabel = firstOfMonth.toLocaleString("en-US", { month: "long", year: "numeric" });

  // Only include days that belong to the current month
  const days: { iso: string; dayOfMonth: number; pnl: number }[] = [];
  for (let day = 1; day <= lastOfMonth.getDate(); day++) {
    const d = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const iso = toISODateLocal(d);
    const pnl = dailyPNL[iso] ?? 0;
    days.push({ iso, dayOfMonth: day, pnl });
  }

  const nextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };
  const prevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };

  return (
    <div>
      {/* Month selector */}
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={prevMonth}
          className={`h-8 px-3 rounded-lg border ${themeDark ? "border-white/15 bg-black/20" : "border-slate-200 bg-white"}`}
        >
          ‹
        </button>
        <div className="text-sm font-medium">{monthLabel}</div>
        <button
          onClick={nextMonth}
          className={`h-8 px-3 rounded-lg border ${themeDark ? "border-white/15 bg-black/20" : "border-slate-200 bg-white"}`}
        >
          ›
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 text-[11px] opacity-70 mb-1">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
          <div key={d} className="text-center">{d}</div>
        ))}
      </div>

      {/* Grid - flexible layout for actual month days only */}
      <div className="grid grid-cols-7 gap-2">
        {/* Calculate starting position based on first day of month */}
        {(() => {
          const firstDayOfWeek = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
          const emptySlots = [];
          
          // Add empty slots for days before the month starts
          for (let i = 0; i < firstDayOfWeek; i++) {
            emptySlots.push(
              <div key={`empty-${i}`} className="aspect-square min-h-9"></div>
            );
          }
          
          return emptySlots;
        })()}
        
        {days.map(({ iso, dayOfMonth, pnl }) => {
          const isSelected = selectedISO === iso;
          const color =
            pnl > 0 ? "bg-emerald-600 text-white"
            : pnl < 0 ? "bg-rose-600 text-white"
            : themeDark ? "bg-gray-700 text-white" : "bg-slate-200 text-slate-900";

          return (
            <button
              key={iso}
              onClick={() => onPickDay(iso)}
              className={`aspect-square min-h-9 rounded-xl text-[11px] leading-tight flex flex-col items-center justify-center
                ${color}
                ${isSelected ? "ring-2 ring-yellow-400" : ""}
              `}
              title={`${iso} • ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}
            >
              <div className="text-[10px] opacity-90">{dayOfMonth}</div>
              <div className="font-semibold">{formatShortPnl(pnl)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatShortPnl(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1000) return (n > 0 ? "+" : n < 0 ? "-" : "") + (abs/1000).toFixed(abs >= 10000 ? 0 : 1) + "k";
  if (abs >= 100) return (n > 0 ? "+" : n < 0 ? "-" : "") + Math.round(abs);
  if (abs >= 10) return (n > 0 ? "+" : n < 0 ? "-" : "") + abs.toFixed(1);
  return (n > 0 ? "+" : n < 0 ? "-" : "") + abs.toFixed(1);
}

/* YearWeeks — split into two halves for better display */
function YearWeeks({
  themeDark,
  weeklyPNL,
  selectedWeekKey,
  onPickWeek,
}: {
  themeDark: boolean;
  weeklyPNL: Record<string, number>;
  selectedWeekKey: string;
  onPickWeek: (year: number, week: number) => void;
}) {
  // Determine a sensible default year
  const now = new Date();
  const [year, setYear] = useState<number>(() => now.getFullYear());
  const [showFirstHalf, setShowFirstHalf] = useState<boolean>(true);

  const weeksCount = weeksInISOYear(year);
  const allWeeks = Array.from({ length: weeksCount }, (_, i) => i + 1);
  
  // Split weeks into two halves
  const midPoint = Math.ceil(weeksCount / 2);
  const firstHalf = allWeeks.slice(0, midPoint); // weeks 1-26 (or 1-27)
  const secondHalf = allWeeks.slice(midPoint); // weeks 27-52 (or 28-53)
  
  const weeks = showFirstHalf ? firstHalf : secondHalf;

  const goPrevYear = () => setYear((y) => y - 1);
  const goNextYear = () => setYear((y) => y + 1);

  return (
    <div>
      {/* Year navigation */}
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={goPrevYear}
          className={`h-8 px-3 rounded-lg border ${themeDark ? "border-white/15 bg-black/20" : "border-slate-200 bg-white"}`}
        >
          ‹
        </button>
        <div className="text-sm font-medium">{year}</div>
        <button
          onClick={goNextYear}
          className={`h-8 px-3 rounded-lg border ${themeDark ? "border-white/15 bg-black/20" : "border-slate-200 bg-white"}`}
        >
          ›
        </button>
      </div>

      {/* Half selector */}
      <div className="mb-2 flex items-center justify-center gap-1">
        <button
          onClick={() => setShowFirstHalf(true)}
          className={`h-8 px-3 rounded-lg text-xs transition-all duration-200 ${
            showFirstHalf
              ? "bg-emerald-500 text-white shadow-md"
              : themeDark
              ? "bg-gray-700 text-white hover:bg-gray-600"
              : "bg-white text-slate-900 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          Weeks 1-{midPoint}
        </button>
        <button
          onClick={() => setShowFirstHalf(false)}
          className={`h-8 px-3 rounded-lg text-xs transition-all duration-200 ${
            !showFirstHalf
              ? "bg-emerald-500 text-white shadow-md"
              : themeDark
              ? "bg-gray-700 text-white hover:bg-gray-600"
              : "bg-white text-slate-900 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          Weeks {midPoint + 1}-{weeksCount}
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weeks.map((w) => {
          const key = `${year}-W${String(w).padStart(2, "0")}`;
          const pnl = weeklyPNL[key] ?? 0;
          const color =
            pnl > 0 ? "bg-emerald-600 text-white"
            : pnl < 0 ? "bg-rose-600 text-white"
            : themeDark ? "bg-gray-700 text-white" : "bg-slate-200 text-slate-900";
          const selected = selectedWeekKey === key;
          return (
            <button
              key={key}
              onClick={() => onPickWeek(year, w)}
              className={`aspect-square min-h-9 rounded-xl text-[11px] leading-tight flex flex-col items-center justify-center mx-0.5 my-1
                ${color}
                ${selected ? "ring-2 ring-yellow-400" : ""}
              `}
              title={`Week ${w} • ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}
            >
              <div className="text-[10px] opacity-90">W{w}</div>
              <div className="font-semibold">{formatShortPnl(pnl)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* YearMonths — kept simple, shows P&L per month with crisp colors */
function YearMonths({
  themeDark,
  monthlyPNL,
  selectedMonthKey,
  ccy,
  onPickMonth,
}: {
  themeDark: boolean;
  monthlyPNL: Record<string, number>;
  selectedMonthKey: string;
  ccy: Currency;
  onPickMonth: (year: number, monthIndex0: number) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState<number>(() => now.getFullYear());

  const months = Array.from({ length: 12 }, (_, i) => i); // 0..11

  const goPrev = () => setYear((y) => y - 1);
  const goNext = () => setYear((y) => y + 1);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={goPrev}
          className={`h-8 px-3 rounded-lg border ${themeDark ? "border-white/15 bg-black/20" : "border-slate-200 bg-white"}`}
        >
          ‹
        </button>
        <div className="text-sm font-medium">Months in {year}</div>
        <button
          onClick={goNext}
          className={`h-8 px-3 rounded-lg border ${themeDark ? "border-white/15 bg-black/20" : "border-slate-200 bg-white"}`}
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {months.map((m) => {
          const key = `${year}-${String(m + 1).padStart(2, "0")}`;
          const pnl = monthlyPNL[key] ?? 0;
          const color =
            pnl > 0 ? "bg-emerald-600 text-white"
            : pnl < 0 ? "bg-rose-600 text-white"
            : themeDark ? "bg-gray-700 text-white" : "bg-slate-200 text-slate-900";
          const selected = selectedMonthKey === key;
          return (
            <button
              key={key}
              onClick={() => onPickMonth(year, m)}
              className={`h-16 rounded-xl px-2 text-[12px] flex flex-col items-center justify-center ${color} ${selected ? "ring-2 ring-yellow-400" : ""}`}
              title={`${key} • ${formatCurrency(pnl, ccy)}`}
            >
              <div className="font-semibold">{new Date(year, m, 1).toLocaleString("en-US", { month: "short" })}</div>
              <div className="opacity-95">{shortCurrency(pnl, ccy)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* YearGrid — fixed 2025–2032 */
function YearGrid({
  themeDark,
  yearPNL,
  ccy,
  selectedYear,
  onPickYear,
}: {
  themeDark: boolean;
  yearPNL: Record<string, number>;
  ccy: Currency;
  selectedYear: string;
  onPickYear: (year: number) => void;
}) {
  const years = Array.from({ length: 8 }, (_, i) => 2025 + i);

  return (
    <div className="grid grid-cols-4 gap-3">
      {years.map((year) => {
        const key = String(year);
        const pnl = yearPNL[key] ?? 0;
        const color =
          pnl > 0 ? "bg-emerald-600 text-white"
          : pnl < 0 ? "bg-rose-600 text-white"
          : themeDark ? "bg-gray-700 text-white" : "bg-slate-200 text-slate-900";
        const selected = selectedYear === key;
        return (
          <button
            key={key}
            onClick={() => onPickYear(year)}
            className={`h-16 rounded-xl px-2 text-[12px] flex flex-col items-center justify-center ${color} ${selected ? "ring-2 ring-yellow-400" : ""}`}
            title={`${year} • ${formatCurrency(pnl, ccy)}`}
          >
            <div className="font-semibold">{year}</div>
            <div className="opacity-95">{shortCurrency(pnl, ccy)}</div>
          </button>
        );
      })}
    </div>
  );
}

/* =======================
   Aggregation helpers
   ======================= */
function aggregateDaily(bets: Bet[]): Record<string, number> {
  const map = new Map<string, number>();
  for (const b of bets) {
    const pnl = calculateBetPnl(b);
    map.set(b.date, (map.get(b.date) ?? 0) + pnl);
  }
  return Object.fromEntries(Array.from(map.entries()).map(([k, v]) => [k, +v.toFixed(2)]));
}

function aggregateWeekly(bets: Bet[]): Record<string, number> {
  const map = new Map<string, number>();
  for (const b of bets) {
    const pnl = calculateBetPnl(b);
    const key = isoWeekKeyFromISODateStr(b.date);
    map.set(key, (map.get(key) ?? 0) + pnl);
  }
  return Object.fromEntries(Array.from(map.entries()).map(([k, v]) => [k, +v.toFixed(2)]));
}

function aggregateMonthly(bets: Bet[]): Record<string, number> {
  const map = new Map<string, number>();
  for (const b of bets) {
    const pnl = calculateBetPnl(b);
    const key = b.date.slice(0, 7); // "2024-12"
    map.set(key, (map.get(key) ?? 0) + pnl);
  }
  return Object.fromEntries(Array.from(map.entries()).map(([k, v]) => [k, +v.toFixed(2)]));
}

function aggregateYearly(bets: Bet[]): Record<string, number> {
  const map = new Map<string, number>();
  for (const b of bets) {
    const pnl = calculateBetPnl(b);
    const key = b.date.slice(0, 4); // "2024"
    map.set(key, (map.get(key) ?? 0) + pnl);
  }
  return Object.fromEntries(Array.from(map.entries()).map(([k, v]) => [k, +v.toFixed(2)]));
}

function calculateBetPnl(b: Bet): number {
  const stake = +b.stake || 0;
  const odds = +b.odds || 0;
  if (b.result === "win") return stake * odds - stake;
  if (b.result === "loss") return -stake;
  return 0; // void
}

/* =======================
   Helper Components
   ======================= */

function Th({ children, className = "" }: React.PropsWithChildren<{ className?: string }>) {
  return <th className={`px-3 py-2 text-xs font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: React.PropsWithChildren<{ className?: string }>) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
function IconButton({
  children,
  onClick,
  title,
}: React.PropsWithChildren<{ onClick?: () => void; title?: string }>) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-white/15 bg-black/20 hover:bg-black/40 transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 hover:shadow-md"
    >
      {children}
    </button>
  );
}

function StatCard({
  className = "",
  icon,
  label,
  value,
  emphasis,
}: {
  className?: string;
  icon?: React.ReactNode;
  label: string;
  value: string;
  emphasis?: number;
}) {
  const positive = (emphasis ?? 0) > 0;
  const negative = (emphasis ?? 0) < 0;
  return (
    <div className={`${className} rounded-xl p-3 shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm opacity-80">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-semibold ${positive ? "text-emerald-400" : negative ? "text-rose-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}

     
      
// PieTooltip component
const PieTooltip = ({ active, payload, isProfit }: { active?: boolean; payload?: any; isProfit: boolean }) => {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0];
  const market = data.name;
  const value = Number(data.value ?? 0);
  const showCCY = "AUD"; // Default currency for tooltip
  
  const tooltipBase: React.CSSProperties = {
    border: "none",
    borderRadius: 12,
    color: "white",
    fontSize: "12px",
    padding: "6px 8px"
  };
  
  return (
    <div style={{ ...tooltipBase, background: isProfit ? "#059669" : "#dc2626" }}>
      <div className="font-medium">{market}</div>
      <div>{isProfit ? formatCurrency(value, showCCY) : `-${formatCurrency(value, showCCY)}`}</div>
    </div>
  );
};

// ColoredTooltip component
const ColoredTooltip = (props: any) => {
  const { active, payload, label } = props;
  if (!active || !payload || !payload.length) return null;
  const v = Number(payload[0].value ?? 0);
  const bg = v > 0 ? "#059669" : v < 0 ? "#dc2626" : "#334155";
  const showCCY = "AUD";
  
  const tooltipBase: React.CSSProperties = {
    border: "none",
    borderRadius: 12,
    color: "white",
    fontSize: "12px",
    padding: "6px 8px"
  };
  
  return (
    <div style={{ ...tooltipBase, background: bg }}>
      <div className="font-medium">{payload[0].name ?? label}</div>
      <div>{formatCurrency(v, showCCY)}</div>
    </div>
  );
};

// Wrapper with Suspense for useSearchParams
export default function JournalPage() {
  return (
    <ThemeProvider>
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">Loading journal...</div>}>
        <JournalPageContent />
      </Suspense>
    </ThemeProvider>
  );
}

