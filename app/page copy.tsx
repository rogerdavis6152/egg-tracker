"use client";
// import { createClient } from "@/lib/supabase/client";
import { useRef, useState } from "react";

const flocks = ["Cinnamon Queen", "Leghorns", "Chocolate"];

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

type Egg = {
  weight: number | null;
  color: string;
  broken: boolean;
};

type FlockData = {
  eggs: Egg[];
  lastColor: string;
  notes: string;
};

type CompletedCollection = {
  id: number;
  started: Date;
  flockData: Record<string, FlockData>;
};

function classifyEgg(weight: number): string {
  if (weight < 43) return "Peewee";
  if (weight < 50) return "Small";
  if (weight < 57) return "Medium";
  if (weight < 64) return "Large";
  if (weight <= 70) return "Extra Large";
  return "Jumbo";
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function createEmptyFlockData(): Record<string, FlockData> {
  return {
    "Cinnamon Queen": {
      eggs: [],
      lastColor: "Brown",
      notes: "",
    },
    Leghorns: {
      eggs: [],
      lastColor: "White",
      notes: "",
    },
    Chocolate: {
      eggs: [],
      lastColor: "Brown",
      notes: "",
    },
  };
}

export default function Home() {
  const weightInputRef = useRef<HTMLInputElement>(null);

  const [collectionStarted, setCollectionStarted] =
    useState(new Date());

  const [selectedFlock, setSelectedFlock] =
    useState("Cinnamon Queen");

  const [weight, setWeight] = useState("");

  const [broken, setBroken] = useState(false);

  const [flockData, setFlockData] = useState<
    Record<string, FlockData>
  >(createEmptyFlockData());

  const [completedCollections, setCompletedCollections] =
    useState<CompletedCollection[]>([]);

  const [showFinishConfirmation, setShowFinishConfirmation] =
    useState(false);

  const [collectionFinished, setCollectionFinished] =
    useState(false);

  const currentFlock = flockData[selectedFlock];

  const currentColor = currentFlock.lastColor;

  const numericWeight = Number(weight);

  const classification =
    weight !== "" ? classifyEgg(numericWeight) : "";

  function focusWeightInput() {
    setTimeout(() => {
      weightInputRef.current?.focus();
    }, 50);
  }

  function selectFlock(flock: string) {
    setSelectedFlock(flock);
    setWeight("");
    setBroken(false);

    focusWeightInput();
  }

  function selectColor(color: string) {
    setFlockData((current) => ({
      ...current,
      [selectedFlock]: {
        ...current[selectedFlock],
        lastColor: color,
      },
    }));
  }

  function updateNotes(notes: string) {
    setFlockData((current) => ({
      ...current,
      [selectedFlock]: {
        ...current[selectedFlock],
        notes,
      },
    }));
  }

  function nextEgg() {
    if (weight === "" && !broken) return;

    const newEgg: Egg = {
      weight: weight === "" ? null : numericWeight,
      color: currentColor,
      broken,
    };

    setFlockData((current) => ({
      ...current,
      [selectedFlock]: {
        ...current[selectedFlock],
        eggs: [...current[selectedFlock].eggs, newEgg],
      },
    }));

    setWeight("");
    setBroken(false);

    focusWeightInput();
  }

  function getSellableCount(eggs: Egg[]) {
    return eggs.filter(
      (egg) =>
        !egg.broken &&
        egg.weight !== null &&
        egg.weight >= 43
    ).length;
  }

  function getTotalEggs(
    data: Record<string, FlockData>
  ) {
    return Object.values(data).reduce(
      (total, flock) => total + flock.eggs.length,
      0
    );
  }

  function getTotalBroken(
    data: Record<string, FlockData>
  ) {
    return Object.values(data).reduce(
      (total, flock) =>
        total +
        flock.eggs.filter((egg) => egg.broken).length,
      0
    );
  }

  function getTotalSellable(
    data: Record<string, FlockData>
  ) {
    return Object.values(data).reduce(
      (total, flock) =>
        total + getSellableCount(flock.eggs),
      0
    );
  }

  const totalEggs = getTotalEggs(flockData);

  const totalBroken = getTotalBroken(flockData);

  const totalSellable = getTotalSellable(flockData);

  function finishCollection() {
    const collection: CompletedCollection = {
      id: Date.now(),
      started: collectionStarted,
      flockData,
    };

    setCompletedCollections((current) => [
      collection,
      ...current,
    ]);

    setCollectionFinished(true);
    setShowFinishConfirmation(false);
  }

  function startNewCollection() {
    setCollectionStarted(new Date());
    setSelectedFlock("Cinnamon Queen");
    setWeight("");
    setBroken(false);
    setFlockData(createEmptyFlockData());
    setCollectionFinished(false);

    focusWeightInput();
  }

  /*
   * COLLECTION COMPLETE SCREEN
   */
  if (collectionFinished) {
    return (
      <main className="min-h-screen bg-gray-100 px-3 py-5">
        <div className="mx-auto max-w-md">

          <div className="mb-6 text-center">
            <div className="text-3xl font-bold text-gray-900">
              Collection Complete
            </div>

            <div className="mt-2 text-sm text-gray-500">
              {formatDate(collectionStarted)} •{" "}
              {formatTime(collectionStarted)}
            </div>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">

            {flocks.map((flock) => (
              <div
                key={flock}
                className="border-b py-4 last:border-b-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {flock}
                  </span>

                  <span className="text-xl font-bold">
                    {flockData[flock].eggs.length}
                  </span>
                </div>

                {flockData[flock].notes.trim() !== "" && (
                  <div className="mt-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                    <div className="mb-1 text-xs font-bold uppercase text-gray-400">
                      Notes
                    </div>

                    {flockData[flock].notes}
                  </div>
                )}
              </div>
            ))}

            <div className="mt-4 border-t pt-4">

              <div className="grid grid-cols-3 text-center">

                <div>
                  <div className="text-2xl font-bold">
                    {totalEggs}
                  </div>

                  <div className="text-xs text-gray-500">
                    Eggs
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-bold">
                    {totalSellable}
                  </div>

                  <div className="text-xs text-gray-500">
                    Sellable
                  </div>
                </div>

                <div>
                  <div className="text-2xl font-bold">
                    {totalBroken}
                  </div>

                  <div className="text-xs text-gray-500">
                    Broken
                  </div>
                </div>

              </div>

              <div className="mt-4 text-center">

                <span className="text-lg font-bold">
                  {Math.floor(totalSellable / 12)}
                </span>

                <span className="text-sm text-gray-500">
                  {" "}dozen + {totalSellable % 12} eggs
                </span>

              </div>

            </div>
          </div>

          <button
            type="button"
            onClick={startNewCollection}
            className="mt-4 w-full rounded-xl bg-gray-900 p-4 text-xl font-bold text-white"
          >
            + New Collection
          </button>

          <div className="mt-6 rounded-xl bg-white p-4 shadow-sm">

            <div className="mb-3 text-sm font-bold text-gray-700">
              Today's Collections
            </div>

            {completedCollections.map((collection) => {

              const eggs = getTotalEggs(
                collection.flockData
              );

              return (
                <div
                  key={collection.id}
                  className="flex justify-between border-b py-3 last:border-b-0"
                >
                  <div>
                    <div className="font-medium">
                      {formatTime(collection.started)}
                    </div>

                    <div className="text-xs text-gray-500">
                      Collection
                    </div>
                  </div>

                  <div className="font-bold">
                    {eggs} eggs
                  </div>
                </div>
              );
            })}

          </div>

        </div>
      </main>
    );
  }

  /*
   * CURRENT COLLECTION SCREEN
   */
  return (
    <main className="min-h-screen bg-gray-100 px-3 py-5">
      <div className="mx-auto max-w-md">

        <div className="mb-4">

          <h1 className="text-2xl font-bold text-gray-900">
            Egg Tracker
          </h1>

          <p className="text-sm text-gray-500">
            New Collection
          </p>

          <p className="text-sm text-gray-500">
            {formatDate(collectionStarted)} •{" "}
            {formatTime(collectionStarted)}
          </p>

        </div>

        {/* FLOCK SELECTOR */}
        <div className="mb-4 rounded-xl bg-white p-3 shadow-sm">

          <div className="mb-2 text-sm font-medium text-gray-600">
            Flock
          </div>

          <div className="grid grid-cols-3 gap-2">

            {flocks.map((flock) => {

              const count =
                flockData[flock].eggs.length;

              return (
                <button
                  key={flock}
                  type="button"
                  onClick={() => selectFlock(flock)}
                  className={`min-h-20 rounded-xl border-2 px-2 py-2 text-sm font-bold ${
                    selectedFlock === flock
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-300 bg-white text-gray-700"
                  }`}
                >
                  <div>{flock}</div>

                  <div className="mt-1 text-2xl">
                    {count}
                  </div>
                </button>
              );
            })}

          </div>
        </div>

        {/* EGG ENTRY */}
        <div className="rounded-xl bg-white p-5 shadow-sm">

          <div className="mb-4 text-center">

            <div className="text-sm text-gray-500">
              {selectedFlock}
            </div>

            <div className="text-xl font-bold">
              Egg #{currentFlock.eggs.length + 1}
            </div>

          </div>

          {/* COLOR */}
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Color
          </label>

          <div className="mb-5 grid grid-cols-2 gap-2">

            {colors.map((color) => (

              <button
                key={color}
                type="button"
                onClick={() => selectColor(color)}
                className={`rounded-lg border p-3 font-medium ${
                  currentColor === color
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300 bg-white text-gray-700"
                }`}
              >
                {color}
              </button>

            ))}

          </div>

          {/* WEIGHT */}
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Weight (grams)
          </label>

          <input
            ref={weightInputRef}
            autoFocus
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            min="0"
            step="1"
            enterKeyHint="done"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                nextEgg();
              }
            }}
            className="w-full rounded-xl border-2 border-gray-300 p-4 text-center text-4xl font-bold focus:border-gray-900 focus:outline-none"
            placeholder="0"
          />

          {/* CLASSIFICATION */}
          <div className="my-5 text-center">

            {classification ? (

              <>
                <div className="text-3xl font-bold">
                  {classification}
                </div>

                <div className="text-sm text-gray-500">
                  {numericWeight} grams
                </div>
              </>

            ) : (

              <div className="text-gray-400">
                Enter weight
              </div>

            )}

          </div>

          {/* BROKEN */}
          <button
            type="button"
            onClick={() => setBroken(!broken)}
            className={`mb-3 w-full rounded-xl border-2 p-4 text-lg font-bold ${
              broken
                ? "border-red-600 bg-red-600 text-white"
                : "border-gray-300 bg-white text-gray-700"
            }`}
          >
            {broken
              ? "BROKEN EGG"
              : "Mark Broken"}
          </button>

          {/* SAVE */}
          <button
            type="button"
            onClick={nextEgg}
            disabled={weight === "" && !broken}
            className="w-full rounded-xl bg-gray-900 p-4 text-xl font-bold text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            Save Egg & Next →
          </button>

        </div>

        {/* FLOCK NOTES */}
        <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">

          <div className="mb-1 text-sm font-bold text-gray-700">
            {selectedFlock} Notes
          </div>

          <div className="mb-3 text-xs text-gray-500">
            Record changes or things you're doing with this flock.
          </div>

          <textarea
            value={currentFlock.notes}
            onChange={(e) => updateNotes(e.target.value)}
            placeholder="Example: Increased protein feed, changed water, added oyster shell..."
            rows={4}
            className="w-full resize-none rounded-xl border-2 border-gray-300 p-3 text-base focus:border-gray-900 focus:outline-none"
          />

        </div>

        {/* COLLECTION SUMMARY */}
        <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">

          <div className="mb-3 text-sm font-bold text-gray-700">
            Collection Summary
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">

            <div>
              <div className="text-2xl font-bold">
                {totalEggs}
              </div>

              <div className="text-xs text-gray-500">
                Eggs
              </div>
            </div>

            <div>
              <div className="text-2xl font-bold">
                {totalSellable}
              </div>

              <div className="text-xs text-gray-500">
                Sellable
              </div>
            </div>

            <div>
              <div className="text-2xl font-bold">
                {totalBroken}
              </div>

              <div className="text-xs text-gray-500">
                Broken
              </div>
            </div>

          </div>

          <div className="mt-3 border-t pt-3 text-center">

            <span className="text-lg font-bold">
              {Math.floor(totalSellable / 12)}
            </span>

            <span className="text-sm text-gray-500">
              {" "}dozen + {totalSellable % 12} eggs
            </span>

          </div>

        </div>

        {/* FINISH COLLECTION */}
        <button
          type="button"
          onClick={() =>
            setShowFinishConfirmation(true)
          }
          disabled={totalEggs === 0}
          className="mt-4 w-full rounded-xl border-2 border-gray-900 bg-white p-4 text-lg font-bold text-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Finish Collection
        </button>

      </div>

      {/* FINISH CONFIRMATION */}
      {showFinishConfirmation && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">

          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">

            <h2 className="text-2xl font-bold text-gray-900">
              Finish this collection?
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              Make sure you've finished collecting from
              all three flocks.
            </p>

            <div className="my-5">

              {flocks.map((flock) => (

                <div
                  key={flock}
                  className="border-b py-3 last:border-b-0"
                >
                  <div className="flex justify-between">
                    <span>{flock}</span>

                    <span className="font-bold">
                      {flockData[flock].eggs.length}
                    </span>
                  </div>

                  {flockData[flock].notes.trim() !== "" && (
                    <div className="mt-2 rounded-lg bg-gray-50 p-2 text-sm text-gray-600">
                      {flockData[flock].notes}
                    </div>
                  )}
                </div>

              ))}

              <div className="mt-3 flex justify-between border-t pt-3 font-bold">
                <span>Total</span>
                <span>{totalEggs} eggs</span>
              </div>

            </div>

            <div className="grid grid-cols-2 gap-3">

              <button
                type="button"
                onClick={() =>
                  setShowFinishConfirmation(false)
                }
                className="rounded-xl border-2 border-gray-300 p-4 font-bold"
              >
                Go Back
              </button>

              <button
                type="button"
                onClick={finishCollection}
                className="rounded-xl bg-gray-900 p-4 font-bold text-white"
              >
                Finish
              </button>

            </div>

          </div>

        </div>

      )}

    </main>
  );
}