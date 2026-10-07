"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  parseWorkbook,
  type ImportWarning,
  type EditableEggRow,
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

function colorSummary(days: LegacyDay[], flock: LegacyFlock) {
  const counts = new Map<string, number>();
  for (const day of days) {
    for (const egg of day.flocks[flock] ?? []) {
      const color = egg.color ?? (flock === "cinnamon" ? "Brown" : "White");
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([color, count]) => `${color} ${count}`).join(" · ");
}

function formatDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function rowFlock(value: string): LegacyFlock | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("cinnamon") || normalized.includes("coop")) return "cinnamon";
  if (normalized.includes("leghorn") || normalized.includes("mobile")) return "leghorn";
  return null;
}

function validateRow(row: EditableEggRow) {
  const parts = row.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null;
  const date = !!parts && parsed !== null && parsed.getFullYear() === Number(parts[1]) && parsed.getMonth() + 1 === Number(parts[2]) && parsed.getDate() === Number(parts[3]);
  if (!date) return "Enter a valid date.";
  if (!rowFlock(row.flock)) return "Choose a flock.";
  if (row.weight.trim() && (!/^\d+$/.test(row.weight.trim()) || Number(row.weight) < 10 || Number(row.weight) > 120)) return "Weight must be 10–120 grams.";
  if (!row.weight.trim() && !row.broken) return "Enter a weight or mark this egg broken.";
  if (!/^(brown|dark brown|light brown|white|cream|blue|green|other)$/i.test(row.color.trim())) return "Choose a color.";
  if (row.review.trim()) return "Clear the review note after resolving this row.";
  return "";
}

function rowsToDays(rows: EditableEggRow[]): LegacyDay[] {
  const byDate = new Map<string, LegacyDay>();
  for (const row of rows) {
    if (validateRow(row)) continue;
    const flock = rowFlock(row.flock)!;
    const day = byDate.get(row.date) ?? { date: row.date, flocks: {} };
    day.flocks[flock] = [
      ...(day.flocks[flock] ?? []),
      { weight: row.weight.trim() ? Number(row.weight) : null, broken: row.broken, color: row.color.trim() },
    ];
    byDate.set(row.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export default function ImportPage() {
  const supabase = createClient();
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [editableRows, setEditableRows] = useState<EditableEggRow[]>([]);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
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

  useEffect(() => () => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
  }, [pdfPreviewUrl]);

  async function loadWorkbook(file?: File) {
    if (!file) return;
    setLoading(true);
    setError("");
    setWorkbook(null);
    setEditableRows([]);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl("");
    setDone(false);

    try {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) setPdfPreviewUrl(URL.createObjectURL(file));
      const parsed: ParsedWorkbook = isPdf
        ? { days: [], warnings: [], ignoredSheets: [], requiresReview: false, editableRows: [], canonicalFormat: true }
        : await parseWorkbook(file);
      if (!isPdf && parsed.days.length === 0 && parsed.editableRows.length === 0) {
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
      const sourceRows = parsed.canonicalFormat ? parsed.editableRows : [];
      const importedDays = parsed.canonicalFormat ? rowsToDays(sourceRows) : parsed.days;
      if (parsed.canonicalFormat) {
        const needsCinnamon = sourceRows.some((row) => rowFlock(row.flock) === "cinnamon");
        const needsLeghorn = sourceRows.some((row) => rowFlock(row.flock) === "leghorn");
        if ((needsCinnamon && !cinnamon) || (needsLeghorn && !leghorn)) {
          throw new Error("Could not find the flock listed in the uploaded rows.");
        }
      } else if (!cinnamon || !leghorn) {
        throw new Error("Could not find both a Cinnamon Queen flock and a Leghorn flock in the database.");
      }

      const sortedDates = importedDays.map((day) => day.date).sort();
      let rounds: ExistingRound[] = [];
      if (sortedDates.length > 0) {
        const { data, error: roundsError } = await supabase
          .from("collection_rounds")
          .select("created_at, flock_collections(flock_id, eggs(id))")
          .gte("created_at", `${sortedDates[0]}T00:00:00.000Z`)
          .lte("created_at", `${sortedDates[sortedDates.length - 1]}T23:59:59.999Z`)
          .limit(5000);
        if (roundsError) throw roundsError;
        rounds = (data ?? []) as ExistingRound[];
      }

      const dates = new Set(
        rounds.map((round) => localDate(round.created_at))
      );

      setFlocks({ cinnamon: cinnamon ?? null, leghorn: leghorn ?? null });
      setExistingDates(dates);
      setWorkbook(parsed);
      setEditableRows(sourceRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this workbook.");
    } finally {
      setLoading(false);
    }
  }

  async function importWorkbook() {
    if (!workbook) return;
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

      const currentDays = workbook.canonicalFormat ? rowsToDays(editableRows) : workbook.days;
      const days = currentDays.filter((day) => !existingDates.has(day.date));
      if (days.length === 0) {
        throw new Error("Every workbook date already has a collection. Nothing was imported.");
      }
      if (days.some((day) => day.flocks.cinnamon?.length && !flocks.cinnamon) || days.some((day) => day.flocks.leghorn?.length && !flocks.leghorn)) {
        throw new Error("The selected rows include a flock that could not be found in the tracker.");
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
          color: egg.color ?? (flockKey === "cinnamon" ? "Brown" : "White"),
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
  const reviewErrors = editableRows.map((row) => validateRow(row)).filter(Boolean).length;
  const displayedDays = workbook?.canonicalFormat ? rowsToDays(editableRows) : (workbook?.days ?? []);
  const importableDays = displayedDays.filter((day) => !existingDates.has(day.date));
  const skippedDays = displayedDays.length ? displayedDays.length - importableDays.length : 0;
  const sortedEditableRows = [...editableRows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  return (
    <main className="min-h-screen bg-gray-100 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header>
          <Link href="/" className="text-sm font-semibold text-gray-600 underline">
            ← Back to egg collection
          </Link>
          <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Import legacy egg records</h1>
          <p className="mt-2 text-sm text-gray-600">
            Upload a spreadsheet to populate the grid, or select a scanned PDF to view it while entering and checking egg records.
          </p>
        </header>

        <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <label htmlFor="workbook" className="block font-bold">Spreadsheet or scanned PDF</label>
          <input
            key={fileInputKey}
            id="workbook"
            type="file"
            accept=".xlsx,.xls,.csv,.pdf,application/pdf"
            disabled={loading || importing}
            onChange={(event) => void loadWorkbook(event.target.files?.[0])}
            className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:font-semibold file:text-white"
          />
          {loading && <p className="mt-3 text-sm text-gray-600">Reading workbook and checking existing dates…</p>}
        </section>

        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

        {workbook && (
          <>
            {pdfPreviewUrl && (
              <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                <h2 className="font-bold">Scanned source</h2>
                <p className="mt-1 text-sm text-gray-600">The scan is shown for reference. PDF handwriting is not automatically transcribed; enter each egg in the grid below.</p>
                <iframe src={pdfPreviewUrl} title="Scanned egg records PDF" className="mt-3 h-[70vh] min-h-[520px] w-full rounded-lg border border-gray-200" />
              </section>
            )}
            <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              <h2 className="text-lg font-bold">Preview</h2>
              <p className="mt-1 text-sm text-gray-600">
                {displayedDays.length > 0
                  ? `${formatDay(displayedDays[0].date)} – ${formatDay(displayedDays[displayedDays.length - 1].date)} · ${displayedDays.length} dates with valid entries`
                  : "Correct the rows below to build the import preview."}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {([
                  ["cinnamon", "Cinnamon Queens"],
                  ["leghorn", "Leghorns"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="rounded-xl bg-gray-50 p-3">
                    <div className="text-sm text-gray-600">{label}</div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{eggCount(displayedDays, key)}</div>
                    <div className="text-xs text-gray-500">{brokenCount(displayedDays, key)} marked broken</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {colorSummary(displayedDays, key) || "No color data"}
                    </div>
                  </div>
                ))}
              </div>
              {skippedDays > 0 && (
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  {skippedDays} date{skippedDays === 1 ? " is" : "s are"} already in the tracker and will be skipped to avoid duplicates.
                </p>
              )}
              <p className="mt-4 text-sm text-gray-600">
                {workbook.canonicalFormat
                  ? "Edit cells directly. Rows with a review note or invalid value must be corrected or removed before saving. Source references are retained here for checking against the scan."
                  : "Unsuffixed sheets and Coop map to Cinnamon Queens; Mobile maps to Leghorns. This workbook does not record egg color, so the flock default is used."}
              </p>
              {workbook.ignoredSheets.length > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-semibold">{workbook.ignoredSheets.length} summary or empty sheets ignored</summary>
                  <p className="mt-2 text-gray-600">{workbook.ignoredSheets.join(", ")}</p>
                </details>
              )}
            </section>

            {workbook.canonicalFormat && (
              <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold">Review and correct eggs</h2>
                    <p className="text-sm text-gray-600">{editableRows.length} rows · {reviewErrors} need attention</p>
                  </div>
                  <button type="button" onClick={() => setEditableRows((rows) => [...rows, { id: `new-${Date.now()}`, date: "", flock: "Cinnamon Queens", weight: "", color: "Brown", broken: false, source: "Added in app", review: "", issue: "" }])} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold">Add egg row</button>
                </div>
                <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                    <thead className="bg-gray-100 text-xs uppercase text-gray-600"><tr>{["Date", "Flock", "Weight (g)", "Color", "Broken", "Source", "Review note", ""].map((label) => <th key={label} className="px-2 py-2">{label}</th>)}</tr></thead>
                    <tbody>{sortedEditableRows.map((row, index) => {
                      const issue = validateRow(row);
                      const update = (changes: Partial<EditableEggRow>) => setEditableRows((rows) => rows.map((item) => item.id === row.id ? { ...item, ...changes } : item));
                      const firstForDay = index === 0 || sortedEditableRows[index - 1].date !== row.date;
                      const dayNotes = editableRows.filter((item) => item.date === row.date && item.review.trim()).length;
                      return <Fragment key={row.id}>
                      {firstForDay && <tr className="border-t-2 border-gray-300 bg-gray-50"><th colSpan={8} className="px-3 py-2 text-left"><div className="flex flex-wrap items-center justify-between gap-2"><span>{row.date ? formatDay(row.date) : "Date needed"}</span><button type="button" onClick={() => setEditableRows((rows) => rows.map((item) => item.date === row.date ? { ...item, review: "" } : item))} disabled={dayNotes === 0} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40">Clear notes for this day ({dayNotes})</button></div></th></tr>}
                      <tr className={issue ? "border-t border-amber-200 bg-amber-50" : "border-t border-gray-200"}>
                        <td className="p-1"><input aria-label={`Date row ${index + 1}`} type="date" value={row.date} onChange={(event) => update({ date: event.target.value })} className="w-36 rounded border border-gray-300 bg-white px-2 py-2" /></td>
                        <td className="p-1"><select aria-label={`Flock row ${index + 1}`} value={rowFlock(row.flock) ?? ""} onChange={(event) => update({ flock: event.target.value === "cinnamon" ? "Cinnamon Queens" : "Leghorns" })} className="w-40 rounded border border-gray-300 bg-white px-2 py-2"><option value="">Choose flock</option><option value="cinnamon">Cinnamon Queens</option><option value="leghorn">Leghorns</option></select></td>
                        <td className="p-1"><input aria-label={`Weight row ${index + 1}`} type="number" min="10" max="120" value={row.weight} onChange={(event) => update({ weight: event.target.value })} className="w-24 rounded border border-gray-300 bg-white px-2 py-2" /></td>
                        <td className="p-1"><select aria-label={`Color row ${index + 1}`} value={row.color} onChange={(event) => update({ color: event.target.value })} className="w-32 rounded border border-gray-300 bg-white px-2 py-2">{["", "Brown", "Dark Brown", "Light Brown", "White", "Cream", "Blue", "Green", "Other"].map((color) => <option key={color} value={color}>{color || "Choose color"}</option>)}</select></td>
                        <td className="p-1 text-center"><input aria-label={`Broken row ${index + 1}`} type="checkbox" checked={row.broken} onChange={(event) => update({ broken: event.target.checked })} className="h-5 w-5" /></td>
                        <td className="max-w-48 p-2 text-xs text-gray-600">{row.source || "—"}</td>
                        <td className="p-1"><div className="flex items-center gap-2"><input aria-label={`Review note row ${index + 1}`} value={row.review} onChange={(event) => update({ review: event.target.value })} placeholder={issue || "No review note"} className={`w-64 rounded border px-2 py-2 ${issue ? "border-amber-400 bg-white" : "border-gray-300 bg-white"}`} /><button type="button" aria-label={`Clear review note row ${index + 1}`} onClick={() => update({ review: "" })} disabled={!row.review} className="shrink-0 rounded border border-gray-300 bg-white px-2 py-2 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40">Clear review</button></div>{issue && <div className="px-1 pt-1 text-xs text-amber-900">{issue}</div>}</td>
                        <td className="p-1"><button type="button" aria-label={`Remove row ${index + 1}`} onClick={() => setEditableRows((rows) => rows.filter((item) => item.id !== row.id))} className="rounded px-2 py-2 font-semibold text-red-700 hover:bg-red-50">Remove</button></td>
                      </tr></Fragment>;
                    })}</tbody>
                  </table>
                </div>
              </section>
            )}

            {warnings.length > 0 && !workbook.canonicalFormat && (
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

            {workbook.requiresReview && !workbook.canonicalFormat && (
              <p role="alert" className="rounded-xl bg-amber-100 p-4 text-sm font-semibold text-amber-950">
                Resolve the flagged rows in the review sheet, save it, and upload it again before importing.
              </p>
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
                  disabled={importing || importableDays.length === 0 || reviewErrors > 0 || (workbook.requiresReview && !workbook.canonicalFormat)}
                  className="mt-4 w-full rounded-xl bg-black p-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing ? progress || "Saving…" : `Save ${eggCount(importableDays, "cinnamon") + eggCount(importableDays, "leghorn")} eggs to tracker`}
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
