"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  parseWorkbook,
  type ImportWarning,
  type LegacyDay,
  type LegacyFlock,
  type ParsedWorkbook,
} from "@/lib/legacy-import/parseWorkbook";

type Flock = { id: string; name: string };
type ExistingRound = {
  created_at: string;
  flock_collections: { flock_id: string; eggs: { id: string }[] }[];
};

function localDate(timestamp: string) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function localNoon(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toISOString();
}

function eggCount(days: LegacyDay[], flock: LegacyFlock) {
  return days.reduce((sum, day) => sum + (day.flocks[flock]?.length ?? 0), 0);
}

function brokenCount(days: LegacyDay[], flock: LegacyFlock) {
  return days.reduce(
    (sum, day) => sum + (day.flocks[flock] ?? []).filter((egg) => egg.broken).length,
    0
  );
}

function formatDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ImportPage() {
  const supabase = createClient();
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [flocks, setFlocks] = useState<Record<LegacyFlock, Flock | null>>({
    cinnamon: null,
    leghorn: null,
  });
  const [existingDates, setExistingDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function loadWorkbook(file?: File) {
    if (!file) return;
    setLoading(true);
    setError("");
    setWorkbook(null);
    setDone(false);

    try {
      const parsed = await parseWorkbook(file);
      if (parsed.days.length === 0) {
        throw new Error("No dated egg weights were found in this workbook.");
      }

      const { data: flockRows, error: flockError } = await supabase
        .from("flocks")
        .select("id, name")
        .order("name");
      if (flockError) throw flockError;

      const cinnamon = (flockRows ?? []).find((flock) =>
        flock.name.toLowerCase().includes("cinnamon queen")
      );
      const leghorn = (flockRows ?? []).find((flock) =>
        flock.name.toLowerCase().includes("leghorn")
      );
      if (!cinnamon || !leghorn) {
        throw new Error(
          "Could not find both a Cinnamon Queen flock and a Leghorn flock in the database."
        );
      }

      const firstDate = parsed.days[0].date;
      const lastDate = parsed.days[parsed.days.length - 1].date;
      const { data: rounds, error: roundsError } = await supabase
        .from("collection_rounds")
        .select("created_at, flock_collections(flock_id, eggs(id))")
        .gte("created_at", `${firstDate}T00:00:00.000Z`)
        .lte("created_at", `${lastDate}T23:59:59.999Z`)
        .limit(5000);
      if (roundsError) throw roundsError;

      const dates = new Set(
        ((rounds ?? []) as ExistingRound[]).map((round) => localDate(round.created_at))
      );

      setFlocks({ cinnamon, leghorn });
      setExistingDates(dates);
      setWorkbook(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this workbook.");
    } finally {
      setLoading(false);
    }
  }

  async function importWorkbook() {
    if (!workbook || !flocks.cinnamon || !flocks.leghorn) return;
    setImporting(true);
    setError("");
    setDone(false);
    let savingStarted = false;

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Please log in again before importing.");

      const days = workbook.days.filter((day) => !existingDates.has(day.date));
      if (days.length === 0) {
        throw new Error("Every workbook date already has a collection. Nothing was imported.");
      }

      setProgress(`Creating ${days.length} collection days…`);
      savingStarted = true;
      const { data: rounds, error: roundError } = await supabase
        .from("collection_rounds")
        .insert(
          days.map((day) => ({
            entered_by: user.id,
            created_at: localNoon(day.date),
          }))
        )
        .select("id, created_at");
      if (roundError) throw roundError;
      setExistingDates((previous) => new Set([
        ...previous,
        ...days.map((day) => day.date),
      ]));

      const roundIdByDate = new Map(
        (rounds ?? []).map((round) => [localDate(round.created_at), round.id] as const)
      );
      const flockCollectionRows = days.flatMap((day) => {
        const collectionRoundId = roundIdByDate.get(day.date);
        if (!collectionRoundId) throw new Error(`Could not match collection date ${day.date}.`);
        return (Object.entries(day.flocks) as [LegacyFlock, NonNullable<LegacyDay["flocks"][LegacyFlock]>][])
          .filter(([, eggs]) => eggs.length > 0)
          .map(([flockKey]) => ({
            collection_round_id: collectionRoundId,
            flock_id: flocks[flockKey]!.id,
          }));
      });

      setProgress("Creating flock records…");
      const { data: flockCollections, error: flockCollectionError } = await supabase
        .from("flock_collections")
        .insert(flockCollectionRows)
        .select("id, collection_round_id, flock_id");
      if (flockCollectionError) throw flockCollectionError;

      const dayByRound = new Map(
        days.map((day) => [roundIdByDate.get(day.date)!, day] as const)
      );
      const eggRows = (flockCollections ?? []).flatMap((collection) => {
        const date = localDate(
          (rounds ?? []).find((round) => round.id === collection.collection_round_id)!.created_at
        );
        const day = dayByRound.get(collection.collection_round_id);
        if (!day) throw new Error(`Could not match eggs for ${date}.`);
        const flockKey: LegacyFlock = collection.flock_id === flocks.cinnamon!.id
          ? "cinnamon"
          : "leghorn";
        return (day.flocks[flockKey] ?? []).map((egg) => ({
          flock_collection_id: collection.id,
          weight_grams: egg.weight,
          color: flockKey === "cinnamon" ? "Brown" : "White",
          broken: egg.broken,
          entered_by: user.id,
        }));
      });

      setProgress(`Saving ${eggRows.length} eggs…`);
      for (let offset = 0; offset < eggRows.length; offset += 500) {
        const { error: eggError } = await supabase
          .from("eggs")
          .insert(eggRows.slice(offset, offset + 500));
        if (eggError) throw eggError;
      }

      setProgress("");
      setDone(true);
    } catch (cause) {
      if (savingStarted) {
        setWorkbook(null);
        setFileInputKey((previous) => previous + 1);
      }
      setError(
        `${cause instanceof Error ? cause.message : "Import failed."} If saving started, some rows may already have been added. Check the collection history before trying again.`
      );
      setProgress("");
    } finally {
      setImporting(false);
    }
  }

  const warnings: ImportWarning[] = workbook?.warnings ?? [];
  const importableDays = workbook?.days.filter((day) => !existingDates.has(day.date)) ?? [];
  const skippedDays = workbook?.days.length ? workbook.days.length - importableDays.length : 0;

  return (
    <main className="min-h-screen bg-gray-100 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <header>
          <Link href="/" className="text-sm font-semibold text-gray-600 underline">
            ← Back to egg collection
          </Link>
          <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Import legacy egg records</h1>
          <p className="mt-2 text-sm text-gray-600">
            Upload the workbook to review the dates and egg counts before adding them to the tracker.
          </p>
        </header>

        <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <label htmlFor="workbook" className="block font-bold">Excel workbook</label>
          <input
            key={fileInputKey}
            id="workbook"
            type="file"
            accept=".xlsx,.xls"
            disabled={loading || importing}
            onChange={(event) => void loadWorkbook(event.target.files?.[0])}
            className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:font-semibold file:text-white"
          />
          {loading && <p className="mt-3 text-sm text-gray-600">Reading workbook and checking existing dates…</p>}
        </section>

        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

        {workbook && (
          <>
            <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              <h2 className="text-lg font-bold">Preview</h2>
              <p className="mt-1 text-sm text-gray-600">
                {formatDay(workbook.days[0].date)} – {formatDay(workbook.days[workbook.days.length - 1].date)}
                {" · "}{workbook.days.length} dates with eggs
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {([
                  ["cinnamon", "Cinnamon Queens"],
                  ["leghorn", "Leghorns"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="rounded-xl bg-gray-50 p-3">
                    <div className="text-sm text-gray-600">{label}</div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{eggCount(workbook.days, key)}</div>
                    <div className="text-xs text-gray-500">{brokenCount(workbook.days, key)} marked broken</div>
                  </div>
                ))}
              </div>
              {skippedDays > 0 && (
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  {skippedDays} date{skippedDays === 1 ? " is" : "s are"} already in the tracker and will be skipped to avoid duplicates.
                </p>
              )}
              <p className="mt-4 text-sm text-gray-600">
                Unsuffixed sheets and “Coop” map to Cinnamon Queens; “Mobile” maps to Leghorns. Cinnamon Queen eggs will be Brown and Leghorn eggs White because the workbook does not record color.
              </p>
              {workbook.ignoredSheets.length > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-semibold">{workbook.ignoredSheets.length} summary or empty sheets ignored</summary>
                  <p className="mt-2 text-gray-600">{workbook.ignoredSheets.join(", ")}</p>
                </details>
              )}
            </section>

            {warnings.length > 0 && (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
                <h2 className="font-bold text-amber-950">{warnings.length} entries need review</h2>
                <p className="mt-1 text-sm text-amber-900">
                  These values could not be read confidently and will be skipped. Review the workbook before importing if they matter.
                </p>
                <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-sm text-amber-950">
                  {warnings.slice(0, 50).map((warning, index) => (
                    <li key={`${warning.sheet}-${warning.row}-${index}`}>
                      {warning.sheet}, row {warning.row}: {warning.message}
                    </li>
                  ))}
                </ul>
                {warnings.length > 50 && <p className="mt-2 text-sm">Showing first 50 warnings.</p>}
              </section>
            )}

            <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              <h2 className="font-bold">Before importing</h2>
              <p className="mt-2 text-sm text-gray-600">
                About seven eggs collected before recordkeeping began have no individual dates or weights, so they are not included. Date notes and daily totals are not imported; only individual egg entries are used.
              </p>
              <p className="mt-2 text-sm text-gray-600">
                The import uses multiple database requests. If one fails after saving begins, a date may be only partly imported. Stop and check the collection history before retrying; the importer skips dates that already exist.
              </p>
              {done ? (
                <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 font-semibold text-green-800">
                  Import finished. Reload the collection screen to see the legacy records.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void importWorkbook()}
                  disabled={importing || importableDays.length === 0}
                  className="mt-4 w-full rounded-xl bg-black p-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing ? progress || "Importing…" : `Import ${eggCount(importableDays, "cinnamon") + eggCount(importableDays, "leghorn")} eggs from ${importableDays.length} days`}
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
