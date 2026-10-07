"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Flock = { id: string; name: string };
type Egg = {
  id: string;
  flock_id: string;
  flock_collection_id: string;
  collection_round_id: string;
  weight_grams: number | null;
  color: string;
  broken: boolean;
};
type CollectionRound = {
  created_at: string;
  flock_collections: {
    id: string;
    collection_round_id: string;
    flock_id: string;
    eggs: Omit<Egg, "flock_id" | "flock_collection_id" | "collection_round_id">[] | null;
  }[] | null;
};
type DayReport = {
  date: string;
  eggsByFlock: Record<string, Egg[]>;
};
type PendingEggDelete = { dayDate: string; egg: Egg };
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

const eggColors = ["Brown", "Dark Brown", "Light Brown", "White", "Cream", "Blue", "Green", "Other"];

function validateEgg(egg: Egg) {
  if (egg.weight_grams === null && !egg.broken) return "Enter a weight or mark this egg broken.";
  if (egg.weight_grams !== null && (!Number.isInteger(egg.weight_grams) || egg.weight_grams < 0)) return "Weight must be a whole number of 0 or more.";
  if (!eggColors.includes(egg.color)) return "Choose a valid color.";
  return "";
}

export default function ReportsPage() {
  const supabase = useMemo(() => createClient(), []);
  const today = new Date();
  const [view, setView] = useState<"month" | "year">("month");
  const [selectedMonth, setSelectedMonth] = useState(localDate(today).slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(String(today.getFullYear()));
  const [flocks, setFlocks] = useState<Flock[]>([]);
  const [days, setDays] = useState<DayReport[]>([]);
  const [savedEggs, setSavedEggs] = useState<Record<string, Egg>>({});
  const [collectionIds, setCollectionIds] = useState<Record<string, string>>({});
  const [pendingDeletes, setPendingDeletes] = useState<Record<string, PendingEggDelete>>({});
  const [savingDate, setSavingDate] = useState("");
  const [saveMessages, setSaveMessages] = useState<Record<string, string>>({});
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
            .select("created_at, flock_collections(id, collection_round_id, flock_id, eggs(id, weight_grams, color, broken))")
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
        const eggSnapshot: Record<string, Egg> = {};
        const collectionSnapshot: Record<string, string> = {};
        for (const round of allRounds) {
          const date = localDate(new Date(round.created_at));
          const day = byDate.get(date) ?? { date, eggsByFlock: {} };
          for (const flockCollection of round.flock_collections ?? []) {
            collectionSnapshot[`${flockCollection.collection_round_id}:${flockCollection.flock_id}`] = flockCollection.id;
            const eggs = (flockCollection.eggs ?? []).map((egg) => ({
              ...egg,
              flock_id: flockCollection.flock_id,
              flock_collection_id: flockCollection.id,
              collection_round_id: flockCollection.collection_round_id,
            }));
            for (const egg of eggs) eggSnapshot[egg.id] = egg;
            day.eggsByFlock[flockCollection.flock_id] = [
              ...(day.eggsByFlock[flockCollection.flock_id] ?? []),
              ...eggs,
            ];
          }
          byDate.set(date, day);
        }

        setFlocks(flockRows ?? []);
        setDays([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
        setSavedEggs(eggSnapshot);
        setCollectionIds(collectionSnapshot);
        setPendingDeletes({});
        setSaveMessages({});
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

  function updateEgg(dayDate: string, flockId: string, eggId: string, changes: Partial<Egg>) {
    const nextFlockId = changes.flock_id ?? flockId;
    setDays((previous) => previous.map((day) => {
      if (day.date !== dayDate) return day;
      const movingEgg = (day.eggsByFlock[flockId] ?? []).find((egg) => egg.id === eggId);
      if (!movingEgg) return day;
      if (nextFlockId !== flockId) {
        return {
          ...day,
          eggsByFlock: {
            ...day.eggsByFlock,
            [flockId]: (day.eggsByFlock[flockId] ?? []).filter((egg) => egg.id !== eggId),
            [nextFlockId]: [...(day.eggsByFlock[nextFlockId] ?? []), { ...movingEgg, ...changes }],
          },
        };
      }
      return {
        ...day,
        eggsByFlock: {
          ...day.eggsByFlock,
          [flockId]: (day.eggsByFlock[flockId] ?? []).map((egg) => egg.id === eggId ? { ...egg, ...changes } : egg),
        },
      };
    }));
    setSaveMessages((previous) => ({ ...previous, [dayDate]: "" }));
  }

  function stageEggDelete(dayDate: string, flockId: string, egg: Egg) {
    setDays((previous) => previous.map((day) => day.date !== dayDate ? day : {
      ...day,
      eggsByFlock: {
        ...day.eggsByFlock,
        [flockId]: (day.eggsByFlock[flockId] ?? []).filter((item) => item.id !== egg.id),
      },
    }));
    setPendingDeletes((previous) => ({ ...previous, [egg.id]: { dayDate, egg } }));
    setSaveMessages((previous) => ({ ...previous, [dayDate]: "" }));
  }

  function undoEggDelete(dayDate: string, eggId: string) {
    const pending = pendingDeletes[eggId];
    if (!pending) return;
    setDays((previous) => previous.map((day) => day.date !== dayDate ? day : {
      ...day,
      eggsByFlock: {
        ...day.eggsByFlock,
        [pending.egg.flock_id]: [...(day.eggsByFlock[pending.egg.flock_id] ?? []), pending.egg],
      },
    }));
    setPendingDeletes((previous) => {
      const next = { ...previous };
      delete next[eggId];
      return next;
    });
    setSaveMessages((previous) => ({ ...previous, [dayDate]: "" }));
  }

  async function saveDay(day: DayReport) {
    const eggs = eggsForDay(day);
    const invalidEggs = eggs.filter((egg) => validateEgg(egg));
    if (invalidEggs.length > 0) {
      setSaveMessages((previous) => ({ ...previous, [day.date]: `Fix ${invalidEggs.length} row${invalidEggs.length === 1 ? "" : "s"} before saving.` }));
      return;
    }

    const changedEggs = eggs.filter((egg) => {
      const saved = savedEggs[egg.id];
      return saved && (saved.weight_grams !== egg.weight_grams || saved.color !== egg.color || saved.broken !== egg.broken || saved.flock_id !== egg.flock_id);
    });
    const deletesForDay = Object.values(pendingDeletes).filter((pending) => pending.dayDate === day.date);
    if (changedEggs.length === 0 && deletesForDay.length === 0) {
      setSaveMessages((previous) => ({ ...previous, [day.date]: "No changes to save." }));
      return;
    }

    setSavingDate(day.date);
    setSaveMessages((previous) => ({ ...previous, [day.date]: "Saving changes…" }));
    const nextCollectionIds = { ...collectionIds };
    try {
      for (const egg of changedEggs) {
        const saved = savedEggs[egg.id];
        if (!saved || saved.flock_id === egg.flock_id) continue;
        const key = `${egg.collection_round_id}:${egg.flock_id}`;
        if (nextCollectionIds[key]) continue;
        const { data, error: collectionError } = await supabase
          .from("flock_collections")
          .insert({ collection_round_id: egg.collection_round_id, flock_id: egg.flock_id })
          .select("id")
          .single();
        if (collectionError) throw collectionError;
        nextCollectionIds[key] = data.id;
        setCollectionIds({ ...nextCollectionIds });
      }
    } catch (cause) {
      setSaveMessages((previous) => ({ ...previous, [day.date]: cause instanceof Error ? `Could not prepare the selected flock: ${cause.message}` : "Could not prepare the selected flock." }));
      setSavingDate("");
      return;
    }
    setCollectionIds(nextCollectionIds);

    const destinationCollectionId = (egg: Egg) => nextCollectionIds[`${egg.collection_round_id}:${egg.flock_id}`];
    const results = await Promise.allSettled(changedEggs.map(async (egg) => {
      const { data, error: updateError } = await supabase
        .from("eggs")
        .update({
          weight_grams: egg.weight_grams,
          color: egg.color,
          broken: egg.broken,
          flock_collection_id: destinationCollectionId(egg) ?? egg.flock_collection_id,
        })
        .eq("id", egg.id)
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("Egg record was not found or could not be updated.");
      return { ...egg, flock_collection_id: destinationCollectionId(egg) ?? egg.flock_collection_id };
    }));
    const saved = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const deleteResults = await Promise.allSettled(deletesForDay.map(async ({ egg }) => {
      const { data, error: deleteError } = await supabase
        .from("eggs")
        .delete()
        .eq("id", egg.id)
        .select("id")
        .maybeSingle();
      if (deleteError) throw deleteError;
      if (!data) throw new Error("Egg record was not found or could not be deleted.");
      return egg.id;
    }));
    const deletedIds = deleteResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (saved.length > 0) {
      setSavedEggs((previous) => ({ ...previous, ...Object.fromEntries(saved.map((egg) => [egg.id, egg])) }));
      setDays((previous) => previous.map((currentDay) => currentDay.date !== day.date ? currentDay : {
        ...currentDay,
        eggsByFlock: Object.fromEntries(Object.entries(currentDay.eggsByFlock).map(([flockId, currentEggs]) => [
          flockId,
          currentEggs.map((currentEgg) => saved.find((egg) => egg.id === currentEgg.id)
            ? { ...currentEgg, flock_collection_id: saved.find((egg) => egg.id === currentEgg.id)!.flock_collection_id }
            : currentEgg),
        ])),
      }));
    }
    if (deletedIds.length > 0) {
      setPendingDeletes((previous) => {
        const next = { ...previous };
        for (const eggId of deletedIds) delete next[eggId];
        return next;
      });
      setSavedEggs((previous) => {
        const next = { ...previous };
        for (const eggId of deletedIds) delete next[eggId];
        return next;
      });
    }
    const failures = [...results, ...deleteResults].filter((result) => result.status === "rejected");
    setSaveMessages((previous) => ({
      ...previous,
      [day.date]: failures.length === 0
        ? `Saved ${saved.length} correction${saved.length === 1 ? "" : "s"}${deletedIds.length ? ` and deleted ${deletedIds.length} egg${deletedIds.length === 1 ? "" : "s"}` : ""}.`
        : `${saved.length + deletedIds.length} changes saved; ${failures.length} failed. Check the rows and retry.`,
    }));
    setSavingDate("");
  }

  function dayHasChanges(day: DayReport) {
    return Object.values(pendingDeletes).some((pending) => pending.dayDate === day.date) || eggsForDay(day).some((egg) => {
      const saved = savedEggs[egg.id];
      return saved && (saved.weight_grams !== egg.weight_grams || saved.color !== egg.color || saved.broken !== egg.broken || saved.flock_id !== egg.flock_id);
    });
  }

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
                      const dayEggRows = Object.entries(day.eggsByFlock).flatMap(([flockId, flockEggs]) =>
                        flockEggs.map((egg) => ({ egg, flockId }))
                      );
                      const dayPendingDeletes = Object.values(pendingDeletes).filter((pending) => pending.dayDate === day.date);
                      return (
                        <details key={day.date} className="rounded-xl bg-gray-50 p-3">
                          <summary className="cursor-pointer list-none">
                            <div className="flex items-baseline justify-between gap-3">
                              <h3 className="font-bold">{formatDate(day.date)}</h3>
                              <span className="text-sm font-bold tabular-nums">{eggs.length} eggs · Edit day</span>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-gray-600 sm:grid-cols-3">
                              {flocks.map((flock) => (
                                <p key={flock.id} className="truncate">
                                  {flock.name}: <strong className="text-gray-900">{eggsForDay(day, flock.id).length}</strong>
                                </p>
                              ))}
                            </div>
                          </summary>
                          <div className="mt-4 border-t border-gray-200 pt-3">
                            <p className="text-sm font-semibold">Edit individual eggs for {formatDate(day.date)}</p>
                            <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
                              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                                <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                                  <tr><th className="px-3 py-2">Flock</th><th className="px-3 py-2">Weight (g)</th><th className="px-3 py-2">Color</th><th className="px-3 py-2">Broken</th><th className="px-3 py-2">Check</th><th className="px-3 py-2">Action</th></tr>
                                </thead>
                                <tbody>
                                  {dayEggRows.map(({ egg, flockId }, index) => {
                                    const issue = validateEgg(egg);
                                    return (
                                      <tr key={egg.id} className={`border-t border-gray-200 ${issue ? "bg-amber-50" : ""}`}>
                                        <td className="px-2 py-1"><select aria-label={`${formatDate(day.date)} egg ${index + 1} flock`} value={egg.flock_id} onChange={(event) => updateEgg(day.date, flockId, egg.id, { flock_id: event.target.value })} className="max-w-40 rounded border border-gray-300 bg-white px-2 py-2">{flocks.map((flock) => <option key={flock.id} value={flock.id}>{flock.name}</option>)}</select> <span className="text-xs text-gray-500">#{index + 1}</span></td>
                                        <td className="px-2 py-1"><input aria-label={`${formatDate(day.date)} egg ${index + 1} weight`} type="number" min="0" step="1" value={egg.weight_grams ?? ""} onChange={(event) => updateEgg(day.date, flockId, egg.id, { weight_grams: event.target.value === "" ? null : Number(event.target.value) })} className="w-24 rounded border border-gray-300 px-2 py-2" /></td>
                                        <td className="px-2 py-1"><select aria-label={`${formatDate(day.date)} egg ${index + 1} color`} value={egg.color} onChange={(event) => updateEgg(day.date, flockId, egg.id, { color: event.target.value })} className="rounded border border-gray-300 bg-white px-2 py-2">{eggColors.map((color) => <option key={color} value={color}>{color}</option>)}</select></td>
                                        <td className="px-3 py-2 text-center"><input aria-label={`${formatDate(day.date)} egg ${index + 1} broken`} type="checkbox" checked={egg.broken} onChange={(event) => updateEgg(day.date, flockId, egg.id, { broken: event.target.checked })} className="h-5 w-5" /></td>
                                        <td className="px-3 py-2 text-xs text-amber-900">{issue || "OK"}</td>
                                        <td className="px-2 py-1"><button type="button" onClick={() => stageEggDelete(day.date, flockId, egg)} className="rounded border border-red-200 px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button></td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {dayPendingDeletes.length > 0 && (
                              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                                <p className="text-sm font-semibold text-red-900">{dayPendingDeletes.length} egg{dayPendingDeletes.length === 1 ? "" : "s"} marked for deletion. These are removed from the database when you save.</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {dayPendingDeletes.map(({ egg }) => (
                                    <button key={egg.id} type="button" onClick={() => undoEggDelete(day.date, egg.id)} className="rounded border border-red-300 bg-white px-2 py-1.5 text-xs font-semibold text-red-800">Undo {flocks.find((flock) => flock.id === egg.flock_id)?.name ?? "egg"} · {egg.weight_grams ?? "unweighed"} g</button>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                              <button type="button" onClick={() => void saveDay(day)} disabled={!dayHasChanges(day) || savingDate !== "" || dayEggRows.some(({ egg }) => validateEgg(egg))} className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                                {savingDate === day.date ? "Saving…" : "Save day changes"}
                              </button>
                              {saveMessages[day.date] && <p role="status" className="text-sm text-gray-700">{saveMessages[day.date]}</p>}
                            </div>
                          </div>
                        </details>
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
