"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Flock = {
  id: string;
  name: string;
  breed: string | null;
};

type Egg = {
  id: string;
  weight: number | null;
  color: string;
  broken: boolean;
};

type FlockData = {
  flockCollectionId: string;
  eggs: Egg[];
  lastColor: string;
  notes: string;
};

type RecentCollectionRound = {
  created_at: string;
  flock_collections: {
    flock_id: string;
    eggs: { id: string }[];
  }[];
};

type RecentCollectionDay = {
  date: string;
  eggCounts: Record<string, number>;
};

const colors = [
  "Brown",
  "Dark Brown",
  "Light Brown",
  "White",
  "Cream",
  "Blue",
  "Green",
  "Other",
];

function createEmptyFlockData(flockName?: string): FlockData {
  let defaultColor = "Dark Brown";

  if (flockName === "Cinnamon Queen") {
    defaultColor = "Brown";
  } else if (flockName === "Leghorns") {
    defaultColor = "White";
  }

  return {
    flockCollectionId: "",
    eggs: [],
    lastColor: defaultColor,
    notes: "",
  };
}

function getEggCategory(weight: number | null) {
  if (weight === null) return "Unweighed";
  if (weight < 43) return "Peewee";
  if (weight < 50) return "Small";
  if (weight < 57) return "Medium";
  if (weight < 64) return "Large";
  if (weight <= 70) return "Extra Large";
  return "Jumbo";
}

function isSellable(egg: Egg) {
  return !egg.broken && egg.weight !== null && egg.weight >= 43;
}

function formatDozens(count: number) {
  const dozens = Math.floor(count / 12);
  const eggs = count % 12;

  if (dozens === 0) return `${eggs} eggs`;
  if (eggs === 0) return `${dozens} sellable dozen`;
  return `${dozens} sellable dozen + ${eggs} eggs`;
}

function getLocalDateValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function Home() {
  const supabase = createClient();
  const weightInputRef = useRef<HTMLInputElement>(null);

  const [flocks, setFlocks] = useState<Flock[]>([]);
  const [recentCollectionDays, setRecentCollectionDays] = useState<
    RecentCollectionDay[]
  >([]);
  const [recentCollectionsError, setRecentCollectionsError] = useState("");
  const [selectedFlockId, setSelectedFlockId] = useState("");
  const [flockData, setFlockData] = useState<Record<string, FlockData>>({});

  const [collectionRoundId, setCollectionRoundId] = useState("");
  const [collectionDate, setCollectionDate] = useState("");
  const [collectionTimestamp, setCollectionTimestamp] = useState("");
  const [collectionDateSaving, setCollectionDateSaving] = useState(false);
  const [collectionDateError, setCollectionDateError] = useState("");
  const [collectionStarted, setCollectionStarted] = useState(false);

  const [weight, setWeight] = useState("");
  const [broken, setBroken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [showFinishConfirmation, setShowFinishConfirmation] =
    useState(false);
  const [collectionFinished, setCollectionFinished] = useState(false);

  useEffect(() => {
    loadFlocks();
  }, []);

  async function loadFlocks() {
    const { data, error } = await supabase
      .from("flocks")
      .select("id, name, breed")
      .eq("active", true)
      .order("name");

    if (error) {
      setMessage(`Error loading flocks: ${error.message}`);
      setLoading(false);
      return;
    }

    const initialData: Record<string, FlockData> = {};

    for (const flock of data ?? []) {
      initialData[flock.id] = createEmptyFlockData();
    }

    setFlocks(data ?? []);
    setFlockData(initialData);

    await loadRecentCollections();

    if (data && data.length > 0) {
      setSelectedFlockId(data[0].id);
    }

    setLoading(false);
  }

  async function loadRecentCollections() {
    const { data: rounds, error: roundsError } = await supabase
      .from("collection_rounds")
      .select("created_at, flock_collections(flock_id, eggs(id))")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (roundsError) {
      setRecentCollectionsError(roundsError.message);
    } else {
      const daysByDate = new Map<string, RecentCollectionDay>();

      for (const round of (rounds ?? []) as RecentCollectionRound[]) {
        const collectedAt = new Date(round.created_at);
        const date = [
          collectedAt.getFullYear(),
          String(collectedAt.getMonth() + 1).padStart(2, "0"),
          String(collectedAt.getDate()).padStart(2, "0"),
        ].join("-");

        let day = daysByDate.get(date);
        if (!day) {
          day = { date, eggCounts: {} };
          daysByDate.set(date, day);
        }

        for (const flockCollection of round.flock_collections ?? []) {
          day.eggCounts[flockCollection.flock_id] =
            (day.eggCounts[flockCollection.flock_id] ?? 0) +
            (flockCollection.eggs?.length ?? 0);
        }
      }

      setRecentCollectionDays(
        [...daysByDate.values()]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 5)
      );
    }
  }

  const selectedFlock = flocks.find(
    (flock) => flock.id === selectedFlockId
  );

  const currentFlock = selectedFlockId
    ? flockData[selectedFlockId] ?? createEmptyFlockData()
    : createEmptyFlockData();

  function focusWeight() {
    setTimeout(() => {
      weightInputRef.current?.focus();
    }, 0);
  }

  async function startCollection() {
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("You must be logged in to start a collection.");
      return;
    }

    const { data, error } = await supabase
      .from("collection_rounds")
      .insert({
        entered_by: user.id,
      })
      .select("id, created_at")
      .single();

    if (error) {
      setMessage(`Error starting collection: ${error.message}`);
      return;
    }

    const initialData: Record<string, FlockData> = {};

    for (const flock of flocks) {
      initialData[flock.id] = createEmptyFlockData(flock.name);
    }

    let firstFlockId = "";

    if (flocks.length > 0) {
      firstFlockId = flocks[0].id;

      const { data: flockCollection, error: flockError } = await supabase
        .from("flock_collections")
        .insert({
          collection_round_id: data.id,
          flock_id: firstFlockId,
        })
        .select("id")
        .single();

      if (flockError) {
        setMessage(`Error starting flock collection: ${flockError.message}`);
        return;
      }

      initialData[firstFlockId] = {
        ...initialData[firstFlockId],
        flockCollectionId: flockCollection.id,
      };
    }

    setCollectionRoundId(data.id);
    setCollectionTimestamp(data.created_at);
    setCollectionDate(getLocalDateValue(new Date(data.created_at)));
    setCollectionDateError("");
    setCollectionStarted(true);
    setCollectionFinished(false);
    setFlockData(initialData);
    setSelectedFlockId(firstFlockId);

    focusWeight();
  }

  async function updateCollectionDate(date: string) {
    if (!collectionRoundId || !date || !collectionTimestamp) return;

    const [year, month, day] = date.split("-").map(Number);
    const updatedTimestamp = new Date(collectionTimestamp);
    updatedTimestamp.setFullYear(year, month - 1, day);

    setCollectionDateSaving(true);
    setCollectionDateError("");

    const { data, error } = await supabase
      .from("collection_rounds")
      .update({ created_at: updatedTimestamp.toISOString() })
      .eq("id", collectionRoundId)
      .select("id")
      .maybeSingle();

    if (error || !data) {
      setCollectionDateError(
        `Could not update date: ${error?.message ?? "Collection round not found."}`
      );
      setCollectionDateSaving(false);
      return;
    }

    setCollectionDate(date);
    setCollectionTimestamp(updatedTimestamp.toISOString());
    setCollectionDateSaving(false);
    await loadRecentCollections();
  }

  async function selectFlock(flockId: string) {
    setWeight("");
    setBroken(false);
    setMessage("");

    let flockCollectionId = flockData[flockId]?.flockCollectionId;

    if (collectionRoundId && !flockCollectionId) {
      const { data, error } = await supabase
        .from("flock_collections")
        .insert({
          collection_round_id: collectionRoundId,
          flock_id: flockId,
        })
        .select("id")
        .single();

      if (error) {
        setMessage(`Error selecting flock: ${error.message}`);
        return;
      }

      flockCollectionId = data.id;

      setFlockData((prev) => ({
        ...prev,
        [flockId]: {
          ...(prev[flockId] ?? createEmptyFlockData()),
          flockCollectionId: data.id,
        },
      }));
    }

    setSelectedFlockId(flockId);

    focusWeight();
  }
  async function saveEgg() {
    const selectedFlockData = selectedFlockId
      ? flockData[selectedFlockId]
      : null;
    if (!selectedFlockId || !selectedFlockData?.flockCollectionId) {
      setMessage("Please select a flock before saving.");
      return;
    }

    if (!weight && !broken) {
      setMessage("Enter a weight or mark the egg as broken.");
      return;
    }

    const parsedWeight = weight ? Number(weight) : null;

    if (
      parsedWeight !== null &&
      (!Number.isInteger(parsedWeight) || parsedWeight < 0)
    ) {
      setMessage("Weight must be a whole number.");
      return;
    }

    setSaving(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("You must be logged in to save an egg.");
      setSaving(false);
      return;
    }

    const { data, error } = await supabase
      .from("eggs")
      .insert({
        flock_collection_id: selectedFlockData.flockCollectionId,
        weight_grams: parsedWeight,
        color: currentFlock.lastColor,
        broken,
        entered_by: user.id,
      })
      .select("id, weight_grams, color, broken")
      .single();

    if (error) {
      setMessage(`Error saving egg: ${error.message}`);
      setSaving(false);
      return;
    }

    const newEgg: Egg = {
      id: data.id,
      weight: data.weight_grams,
      color: data.color,
      broken: data.broken,
    };

    setFlockData((prev) => ({
      ...prev,
      [selectedFlockId]: {
        ...prev[selectedFlockId],
        eggs: [...prev[selectedFlockId].eggs, newEgg],
      },
    }));

    setWeight("");
    setBroken(false);
    setSaving(false);

    focusWeight();
  }

  async function updateNotes(notes: string) {
    if (!selectedFlockId) return;

    setFlockData((prev) => ({
      ...prev,
      [selectedFlockId]: {
        ...prev[selectedFlockId],
        notes,
      },
    }));

    if (!currentFlock.flockCollectionId) return;

    const { error } = await supabase
      .from("flock_collections")
      .update({ notes })
      .eq("id", currentFlock.flockCollectionId);

    if (error) {
      setMessage(`Error saving notes: ${error.message}`);
    }
  }

  const allEggs = useMemo(
    () =>
      Object.values(flockData).flatMap((data) => data.eggs),
    [flockData]
  );

  const weightedEggs = allEggs.filter((egg) => egg.weight !== null);

  const totalWeight = weightedEggs.reduce(
    (sum, egg) => sum + (egg.weight ?? 0),
    0
  );

  const averageWeight =
    weightedEggs.length > 0
      ? totalWeight / weightedEggs.length
      : 0;

  const sellableEggs = allEggs.filter(isSellable);

  const sellableWeightedEggs = sellableEggs.filter(
    (egg) => egg.weight !== null
  );

  const sellableWeight = sellableWeightedEggs.reduce(
    (sum, egg) => sum + (egg.weight ?? 0),
    0
  );

  const averageSellableWeight =
    sellableWeightedEggs.length > 0
      ? sellableWeight / sellableWeightedEggs.length
      : 0;

  async function finishCollection() {
    if (!collectionRoundId || allEggs.length === 0) return;

    const { error } = await supabase
      .from("collection_rounds")
      .update({
        completed_at: new Date().toISOString(),
      })
      .eq("id", collectionRoundId);

    if (error) {
      setMessage(`Error finishing collection: ${error.message}`);
      return;
    }

    setShowFinishConfirmation(false);
    setCollectionFinished(true);
  }

  function startNewCollection() {
    setCollectionRoundId("");
    setCollectionDate("");
    setCollectionTimestamp("");
    setCollectionStarted(false);
    setCollectionFinished(false);
    setShowFinishConfirmation(false);
    setWeight("");
    setBroken(false);

    const initialData: Record<string, FlockData> = {};

    for (const flock of flocks) {
      initialData[flock.id] = createEmptyFlockData();
    }

    setFlockData(initialData);

    if (flocks.length > 0) {
      setSelectedFlockId(flocks[0].id);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-6">
        <div className="mx-auto max-w-xl">
          <p>Loading...</p>
        </div>
      </main>
    );
  }

  if (!collectionStarted) {
    return (
      <main className="min-h-screen bg-gray-100 p-4">
        <div className="mx-auto max-w-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">
                Egg Collection
              </h1>

              <p className="mt-2 text-gray-600">
                Start a new collection round when you begin collecting eggs.
              </p>
            </div>

            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/login";
              }}
              className="rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-sm font-semibold"
            >
              Log Out
            </button>
          </div>

          <button
            onClick={startCollection}
            className="mt-8 w-full rounded-2xl bg-black p-5 text-xl font-bold text-white"
          >
            Start New Collection
          </button>

          <section className="mt-8 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-lg font-bold">Recent Egg Collections</h2>
            <p className="mt-1 text-sm text-gray-500">
              Eggs collected by flock for the five most recent collection days.
            </p>

            {recentCollectionsError ? (
              <p className="mt-4 text-sm text-red-600">
                Could not load recent collections: {recentCollectionsError}
              </p>
            ) : recentCollectionDays.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">
                No collection history yet.
              </p>
            ) : (
              <>
                <div className="mt-4 space-y-3 sm:hidden">
                  {recentCollectionDays.map((day) => {
                    const [year, month, date] = day.date.split("-").map(Number);
                    const label = new Date(
                      year,
                      month - 1,
                      date
                    ).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    });

                    return (
                      <section key={day.date} className="rounded-xl bg-gray-50 p-3">
                        <h3 className="mb-2 text-sm font-bold">{label}</h3>
                        <dl className="grid grid-cols-3 gap-2">
                          {flocks.map((flock) => (
                            <div
                              key={flock.id}
                              className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-white px-2 py-2"
                            >
                              <dt className="min-w-0 text-xs leading-tight text-gray-600">
                                {flock.name}
                              </dt>
                              <dd className="shrink-0 text-sm font-bold tabular-nums">
                                {day.eggCounts[flock.id] ?? 0}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    );
                  })}
                </div>

                <div className="mt-4 hidden overflow-x-auto sm:block">
                <table className="w-full min-w-max border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-600">
                      <th scope="col" className="px-3 py-2 font-semibold">Day</th>
                      {flocks.map((flock) => (
                        <th key={flock.id} scope="col" className="px-3 py-2 font-semibold">
                          {flock.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentCollectionDays.map((day) => {
                      const [year, month, date] = day.date.split("-").map(Number);
                      const label = new Date(
                        year,
                        month - 1,
                        date
                      ).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      });

                      return (
                        <tr key={day.date} className="border-b border-gray-100 last:border-0">
                          <th scope="row" className="whitespace-nowrap px-3 py-3 font-semibold">
                            {label}
                          </th>
                          {flocks.map((flock) => (
                            <td key={flock.id} className="px-3 py-3 text-center tabular-nums">
                              {day.eggCounts[flock.id] ?? 0}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </section>

          {message && (
            <p className="mt-4 text-red-600">{message}</p>
          )}
        </div>
      </main>
    );
  }

  if (collectionFinished) {
    return (
      <main className="min-h-screen bg-gray-100 p-4">
        <div className="mx-auto max-w-xl">
          <h1 className="text-3xl font-bold">
            Collection Complete
          </h1>

          <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">
              Collection Summary
            </h2>

            <div className="mt-4 space-y-3">
              {flocks.map((flock) => {
                const data = flockData[flock.id];

                if (!data || data.eggs.length === 0) return null;

                return (
                  <div
                    key={flock.id}
                    className="rounded-xl bg-gray-50 p-3"
                  >
                    <div className="font-bold">
                      {flock.name}
                    </div>
                    <div>{data.eggs.length} eggs</div>

                    {data.notes && (
                      <div className="mt-2 text-sm text-gray-600">
                        <strong>Notes:</strong> {data.notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 border-t pt-4">
              <div>
                Total eggs: <strong>{allEggs.length}</strong>
              </div>

              <div>
                Sellable:{" "}
                <strong>{formatDozens(sellableEggs.length)}</strong>
              </div>

              <div>
                Broken:{" "}
                <strong>
                  {allEggs.filter((egg) => egg.broken).length}
                </strong>
              </div>

              <div>
                Average egg weight:{" "}
                <strong>
                  {averageWeight
                    ? `${averageWeight.toFixed(1)} g`
                    : "—"}
                </strong>
              </div>

              <div>
                Average sellable egg weight:{" "}
                <strong>
                  {averageSellableWeight
                    ? `${averageSellableWeight.toFixed(1)} g`
                    : "—"}
                </strong>
              </div>
            </div>
          </div>

          <button
            onClick={startNewCollection}
            className="mt-6 w-full rounded-2xl bg-black p-4 text-lg font-bold text-white"
          >
            + New Collection
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-3 pb-6 sm:p-4 sm:pb-8">
      <div className="mx-auto max-w-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">
              Egg Collection
            </h1>

            <label className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span>Collection date</span>
              <input
                type="date"
                aria-label="Collection date"
                value={collectionDate}
                onChange={(event) => updateCollectionDate(event.target.value)}
                disabled={collectionDateSaving}
                className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-medium text-gray-900 disabled:opacity-60"
              />
            </label>
            {collectionDateSaving && (
              <p className="mt-1 text-xs text-gray-500">Saving date...</p>
            )}
            {collectionDateError && (
              <p className="mt-1 text-xs text-red-600">{collectionDateError}</p>
            )}
          </div>

          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/login";
            }}
            className="rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Log Out
          </button>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sm:mt-4 sm:grid sm:grid-cols-3 sm:overflow-visible">
          {flocks.map((flock) => {
            const data = flockData[flock.id] ?? createEmptyFlockData();
            const selected = flock.id === selectedFlockId;

            return (
              <button
                key={flock.id}
                onClick={() => selectFlock(flock.id)}
                className={`min-w-24 shrink-0 rounded-xl p-2 text-sm font-bold sm:min-w-0 sm:p-3 ${selected
                  ? "bg-black text-white"
                  : "bg-white text-gray-800"
                  }`}
              >
                {flock.name}
                <div className="mt-0.5 text-base sm:mt-1 sm:text-lg">
                  {data.eggs.length}
                </div>
              </button>
            );
          })}
        </div>

        {selectedFlock && (
          <>
            <div className="mt-3 rounded-2xl bg-white p-3 shadow-sm sm:mt-5 sm:p-5">
              <div className="mb-2 flex items-center justify-between sm:mb-3">
                <div className="text-lg font-bold sm:text-xl">
                  {selectedFlock.name}
                </div>
                <div className="text-sm text-gray-500">
                  Egg #{currentFlock.eggs.length + 1}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-bold">
                  Egg Color
                </div>

                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-4 sm:gap-2">
                  {colors.map((color) => (
                    <button
                      key={color}
                      onClick={() => {
                        setFlockData((prev) => ({
                          ...prev,
                          [selectedFlockId]: {
                            ...prev[selectedFlockId],
                            lastColor: color,
                          },
                        }));
                      }}
                      className={`min-h-10 rounded-lg border p-1.5 text-xs font-semibold sm:rounded-xl sm:border-2 sm:p-3 sm:text-sm ${currentFlock.lastColor === color
                        ? "border-black bg-gray-200"
                        : "border-gray-200 bg-white"
                        }`}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 sm:mt-5">
                <label className="mb-2 block text-sm font-bold">
                  Weight (grams)
                </label>

                <input
                  ref={weightInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min="0"
                  step="1"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      saveEgg();
                    }
                  }}
                  className="w-full rounded-xl border-2 border-gray-300 p-3 text-2xl sm:p-4"
                  placeholder="0"
                />
              </div>

              <button
                onClick={() => setBroken((value) => !value)}
                className={`mt-3 w-full rounded-xl border-2 p-3 font-bold sm:mt-4 sm:p-4 ${broken
                  ? "border-red-500 bg-red-100 text-red-700"
                  : "border-gray-300 bg-white"
                  }`}
              >
                {broken
                  ? "Broken Egg — Tap to Undo"
                  : "Mark Egg as Broken"}
              </button>

              <button
                onClick={saveEgg}
                disabled={saving}
                className="mt-3 w-full rounded-xl bg-black p-3 text-lg font-bold text-white disabled:opacity-50 sm:mt-4 sm:p-4"
              >
                {saving ? "Saving..." : "Save Egg & Next"}
              </button>

              {weight && (
                <div className="mt-3 text-center font-semibold">
                  {getEggCategory(Number(weight))}
                </div>
              )}
            </div>

            <details className="mt-3 rounded-xl bg-white p-3 shadow-sm sm:mt-4 sm:p-4">
              <summary className="cursor-pointer select-none text-sm font-bold text-gray-700">
                {selectedFlock.name} Notes
              </summary>
              <div className="mt-2">
              <div className="mb-2 text-xs text-gray-500">
                Record changes or things you're doing with this flock.
              </div>

              <textarea
                value={currentFlock.notes}
                onChange={(e) => updateNotes(e.target.value)}
                placeholder="Example: Increased protein feed, changed water, added oyster shell..."
                rows={2}
                className="w-full resize-none rounded-xl border-2 border-gray-300 p-3 text-base focus:border-gray-900 focus:outline-none"
              />
              </div>
            </details>
          </>
        )}

        <details className="mt-3 rounded-2xl bg-white p-4 shadow-sm sm:mt-4 sm:p-5">
          <summary className="cursor-pointer select-none text-base font-bold sm:text-lg">
            Current Collection · {allEggs.length} eggs
          </summary>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:text-base">
            <div className="rounded-lg bg-gray-50 p-2">
              Total eggs: <strong>{allEggs.length}</strong>
            </div>

            <div className="rounded-lg bg-gray-50 p-2">
              Sellable:{" "}
              <strong>{formatDozens(sellableEggs.length)}</strong>
            </div>

            <div className="rounded-lg bg-gray-50 p-2">
              Broken:{" "}
              <strong>
                {allEggs.filter((egg) => egg.broken).length}
              </strong>
            </div>

            <div className="rounded-lg bg-gray-50 p-2">
              Average egg weight:{" "}
              <strong>
                {averageWeight
                  ? `${averageWeight.toFixed(1)} g`
                  : "—"}
              </strong>
            </div>

            <div className="col-span-2 rounded-lg bg-gray-50 p-2">
              Average sellable egg weight:{" "}
              <strong>
                {averageSellableWeight
                  ? `${averageSellableWeight.toFixed(1)} g`
                  : "—"}
              </strong>
            </div>
          </div>
        </details>

        <button
          onClick={() => setShowFinishConfirmation(true)}
          disabled={allEggs.length === 0}
          className="mt-3 w-full rounded-2xl bg-gray-800 p-3 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:mt-5 sm:p-4"
        >
          Finish Collection
        </button>

        {message && (
          <p className="mt-4 text-center text-red-600">{message}</p>
        )}

        {showFinishConfirmation && (
          <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 sm:items-center sm:justify-center">
            <div className="w-full max-w-xl rounded-2xl bg-white p-5">
              <h2 className="text-2xl font-bold">
                Finish Collection?
              </h2>

              <p className="mt-2 text-gray-600">
                Review this collection before finishing.
              </p>

              <div className="mt-5 space-y-3">
                {flocks.map((flock) => {
                  const data = flockData[flock.id];

                  if (!data || data.eggs.length === 0) return null;

                  return (
                    <div
                      key={flock.id}
                      className="rounded-xl bg-gray-100 p-3"
                    >
                      <div className="font-bold">
                        {flock.name}
                      </div>
                      <div>{data.eggs.length} eggs</div>

                      {data.notes && (
                        <div className="mt-1 text-sm text-gray-600">
                          Notes: {data.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 border-t pt-4">
                <div>
                  Total: <strong>{allEggs.length} eggs</strong>
                </div>

                <div>
                  Sellable:{" "}
                  <strong>{formatDozens(sellableEggs.length)}</strong>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowFinishConfirmation(false)}
                  className="rounded-xl border-2 border-gray-300 p-4 font-bold"
                >
                  Go Back
                </button>

                <button
                  onClick={finishCollection}
                  className="rounded-xl bg-black p-4 font-bold text-white"
                >
                  Finish
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
