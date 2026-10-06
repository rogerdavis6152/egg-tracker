"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Flock = { id: string; name: string };
type Egg = { weight_grams: number | null; broken: boolean };
type CollectionRound = {
  created_at: string;
  flock_collections: {
    flock_id: string;
    eggs: Egg[] | null;
  }[] | null;
};
type DayReport = {
  date: string;
  eggsByFlock: Record<string, Egg[]>;
};
type EggStats = {
  eggs: number;
  broken: number;
  weightTotal: number;
  weighed: number;
};

function localDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateBounds(year: number, month?: number) {
  const start = new Date(year, month ?? 0, 1);
  const end = month === undefined
    ? new Date(year + 1, 0, 1)
    : new Date(year, month + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function emptyStats(): EggStats {
  return { eggs: 0, broken: 0, weightTotal: 0, weighed: 0 };
}

function statsForEggs(eggs: Egg[]): EggStats {
  return eggs.reduce((stats, egg) => {
    stats.eggs += 1;
    if (egg.broken) stats.broken += 1;
    if (egg.weight_grams !== null) {
      stats.weightTotal += egg.weight_grams;
      stats.weighed += 1;
    }
    return stats;
  }, emptyStats());
}

function statsForDays(days: DayReport[], flockId?: string): EggStats {
  const eggs = days.flatMap((day) =>
    flockId
      ? day.eggsByFlock[flockId] ?? []
      : Object.values(day.eggsByFlock).flat()
  );
  return statsForEggs(eggs);
}

function formatDate(date: string, includeYear = false) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
  });
}

function formatAverage(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function eggsForDay(day: DayReport, flockId?: string) {
  return flockId
    ? day.eggsByFlock[flockId] ?? []
    : Object.values(day.eggsByFlock).flat();
}

export default function ReportsPage() {
  const supabase = useMemo(() => createClient(), []);
  const today = new Date();
  const [view, setView] = useState<"month" | "year">("month");
  const [selectedMonth, setSelectedMonth] = useState(localDate(today).slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(String(today.getFullYear()));
  const [flocks, setFlocks] = useState<Flock[]>([]);
  const [days, setDays] = useState<DayReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError("");
      const requestedYear = view === "month"
        ? Number(selectedMonth.slice(0, 4))
        : Number(selectedYear);
      const requestedMonth = view === "month"
        ? Number(selectedMonth.slice(5, 7))
        : undefined;
      if (
        !Number.isInteger(requestedYear) ||
        requestedYear < 2000 ||
        requestedYear > 2200 ||
        (view === "month" && (!Number.isInteger(requestedMonth) || requestedMonth! < 1 || requestedMonth! > 12))
      ) {
        setDays([]);
        setError(`Choose a valid ${view}.`);
        setLoading(false);
        return;
      }
      const year = requestedYear;
      const month = view === "month"
        ? requestedMonth! - 1
        : undefined;
      const { start, end } = dateBounds(year, month);

      try {
        const { data: flockRows, error: flockError } = await supabase
          .from("flocks")
          .select("id, name")
          .order("name");
        if (flockError) throw flockError;

        const allRounds: CollectionRound[] = [];
        const pageSize = 1000;
        for (let offset = 0; ; offset += pageSize) {
          const { data, error: roundsError } = await supabase
            .from("collection_rounds")
            .select("created_at, flock_collections(flock_id, eggs(weight_grams, broken))")
            .gte("created_at", start)
            .lt("created_at", end)
            .order("created_at", { ascending: true })
            .range(offset, offset + pageSize - 1);
          if (roundsError) throw roundsError;
          const rows = (data ?? []) as CollectionRound[];
          allRounds.push(...rows);
          if (rows.length < pageSize) break;
        }

        if (cancelled) return;

        const byDate = new Map<string, DayReport>();
        for (const round of allRounds) {
          const date = localDate(new Date(round.created_at));
          const day = byDate.get(date) ?? { date, eggsByFlock: {} };
          for (const flockCollection of round.flock_collections ?? []) {
            const eggs = flockCollection.eggs ?? [];
            day.eggsByFlock[flockCollection.flock_id] = [
              ...(day.eggsByFlock[flockCollection.flock_id] ?? []),
              ...eggs,
            ];
          }
          byDate.set(date, day);
        }

        setFlocks(flockRows ?? []);
        setDays([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load this report.");
          setDays([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [supabase, view, selectedMonth, selectedYear]);

  const monthStats = useMemo(() => statsForDays(days), [days]);
  const recordedDayCount = days.length;
  const monthAverage = recordedDayCount > 0 ? monthStats.eggs / recordedDayCount : 0;

  const months = useMemo(() => {
    if (view !== "year") return [];
    const year = Number(selectedYear);
    return Array.from({ length: 12 }, (_, monthIndex) => {
      const monthDays = days.filter((day) => Number(day.date.slice(5, 7)) === monthIndex + 1);
      const date = new Date(year, monthIndex, 1);
      const stats = statsForDays(monthDays);
      const flockStats = Object.fromEntries(
        flocks.map((flock) => [flock.id, statsForDays(monthDays, flock.id)])
      );
      return {
        monthIndex,
        label: date.toLocaleDateString(undefined, { month: "long" }),
        days: monthDays.length,
        stats,
        flockStats,
      };
    });
  }, [days, flocks, selectedYear, view]);

  const title = view === "month"
    ? new Date(`${selectedMonth}-15T12:00:00`).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : selectedYear;

  return (
    <main className="min-h-screen bg-gray-100 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <Link href="/" className="text-sm font-semibold text-gray-600 underline">
            ← Back to egg collection
          </Link>
          <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Egg reports</h1>
          <p className="mt-1 text-sm text-gray-600">
            Daily averages count only dates with a recorded collection.
          </p>
        </header>

        <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
            {(["month", "year"] as const).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setView(period)}
                aria-pressed={view === period}
                className={`rounded-lg px-3 py-2 text-sm font-bold capitalize ${view === period ? "bg-white shadow-sm" : "text-gray-600"}`}
              >
                {period} report
              </button>
            ))}
          </div>
          <label className="mt-4 block text-sm font-semibold" htmlFor="report-period">
            {view === "month" ? "Choose month" : "Choose year"}
          </label>
          {view === "month" ? (
            <input
              id="report-period"
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="mt-2 w-full rounded-xl border border-gray-300 bg-white p-3 text-base sm:w-auto"
            />
          ) : (
            <input
              id="report-period"
              type="number"
              min="2000"
              max="2200"
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
              className="mt-2 w-full rounded-xl border border-gray-300 bg-white p-3 text-base sm:w-40"
            />
          )}
        </section>

        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Could not load report: {error}</p>}
        {loading ? (
          <p className="rounded-2xl bg-white p-5 text-gray-600 shadow-sm">Loading {title} report…</p>
        ) : !error && (
          <>
            <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              <h2 className="text-lg font-bold">{title} summary</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Eggs collected", monthStats.eggs],
                  ["Collection days", recordedDayCount],
                  ["Average per collection day", formatAverage(monthAverage)],
                  ["Broken eggs", monthStats.broken],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-gray-50 p-3">
                    <div className="text-xs leading-tight text-gray-600">{label}</div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {flocks.map((flock) => {
                  const stats = statsForDays(days, flock.id);
                  return (
                    <div key={flock.id} className="rounded-xl border border-gray-100 p-3">
                      <h3 className="font-bold">{flock.name}</h3>
                      <p className="mt-1 text-sm text-gray-700">{stats.eggs} eggs · {stats.broken} broken</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Average weight: {stats.weighed ? `${(stats.weightTotal / stats.weighed).toFixed(1)} g` : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {view === "month" ? (
              <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                <h2 className="text-lg font-bold">Collection days</h2>
                {days.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">No collections recorded for {title}.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {days.map((day) => {
                      const eggs = eggsForDay(day);
                      return (
                        <article key={day.date} className="rounded-xl bg-gray-50 p-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="font-bold">{formatDate(day.date)}</h3>
                            <span className="text-sm font-bold tabular-nums">{eggs.length} eggs</span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-gray-600 sm:grid-cols-3">
                            {flocks.map((flock) => (
                              <p key={flock.id} className="truncate">
                                {flock.name}: <strong className="text-gray-900">{eggsForDay(day, flock.id).length}</strong>
                              </p>
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : (
              <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                <h2 className="text-lg font-bold">Month-by-month summary</h2>
                <div className="mt-3 space-y-2">
                  {months.map((month) => (
                    <article key={month.monthIndex} className="rounded-xl bg-gray-50 p-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="font-bold">{month.label}</h3>
                        <span className="text-sm font-bold tabular-nums">{month.stats.eggs} eggs</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-600">
                        {month.days} collection days · {month.days ? `${formatAverage(month.stats.eggs / month.days)} eggs per collection day` : "no collections"}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-gray-600 sm:grid-cols-3">
                        {flocks.map((flock) => (
                          <p key={flock.id} className="truncate">
                            {flock.name}: <strong className="text-gray-900">{month.flockStats[flock.id]?.eggs ?? 0}</strong>
                          </p>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
