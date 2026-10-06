export type LegacyEgg = {
  weight: number | null;
  broken: boolean;
};

export type LegacyFlock = "cinnamon" | "leghorn";

export type LegacyDay = {
  date: string;
  flocks: Partial<Record<LegacyFlock, LegacyEgg[]>>;
};

export type ImportWarning = {
  sheet: string;
  row: number;
  message: string;
};

export type ParsedWorkbook = {
  days: LegacyDay[];
  warnings: ImportWarning[];
  ignoredSheets: string[];
};

type SheetRow = (string | number | Date | null | undefined)[];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const yearValue = Number(match[3]);
  const year = yearValue < 100 ? 2000 + yearValue : yearValue;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseEggCell(value: unknown): { eggs: LegacyEgg[]; warnings: string[] } {
  const source = text(value);
  if (!source || /^(none|—|-|n\/a)$/i.test(source)) {
    return { eggs: [], warnings: [] };
  }

  const eggs: LegacyEgg[] = [];
  const warnings: string[] = [];
  const tokens = source.split(/[;,\n]+/).map((part) => part.trim()).filter(Boolean);

  for (const token of tokens) {
    if (/^b$/i.test(token) || /^\(broken\)$/i.test(token)) {
      eggs.push({ weight: null, broken: true });
      continue;
    }

    const broken = /broken/i.test(token);
    const weightMatch = token.match(/^(?:no\s+nest\s+|nn\s*)?(\d{1,3})(?:\s*g)?(?:\s*\(broken\))?$/i);
    if (weightMatch) {
      const weight = Number(weightMatch[1]);
      if (weight >= 10 && weight <= 120) {
        eggs.push({ weight, broken });
      } else {
        warnings.push(`Unusual weight “${token}” was skipped.`);
      }
      continue;
    }

    if (/^\(?broken\)?$/i.test(token)) {
      eggs.push({ weight: null, broken: true });
      continue;
    }

    warnings.push(`Could not read “${token}”; it was skipped.`);
  }

  return { eggs, warnings };
}

export async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const byDate = new Map<string, LegacyDay>();
  const warnings: ImportWarning[] = [];
  const ignoredSheets: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const normalizedName = sheetName.toLowerCase();
    if (normalizedName.includes("totals")) {
      ignoredSheets.push(sheetName);
      continue;
    }

    const flock: LegacyFlock | null = normalizedName.includes("mobile")
      ? "leghorn"
      : normalizedName.includes("coop") || /\b(24|25)\b/.test(normalizedName)
        ? "cinnamon"
        : null;

    if (!flock) {
      ignoredSheets.push(sheetName);
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<SheetRow>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });
    const headerIndex = rows.findIndex((row) => /^date$/i.test(text(row[0])));
    if (headerIndex < 0) {
      ignoredSheets.push(sheetName);
      continue;
    }

    const headers = rows[headerIndex].map((value) => text(value).toLowerCase());
    const summaryStart = headers.findIndex((value) => /^(pw|peewee|sm|me|la|xl|ju|totals?)$/.test(value));
    const eggColumnEnd = summaryStart > 0 ? summaryStart : headers.length;
    const useContinuationRows = /^(augsep|sep)\s*24$/i.test(sheetName);
    let currentDate: string | null = null;

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const firstCell = text(row[0]);
      const rowDate = parseDate(row[0]);

      if (rowDate) {
        currentDate = rowDate;
        if (useContinuationRows) continue;
      } else if (firstCell) {
        currentDate = null;
        continue;
      }

      if (!currentDate) continue;
      const day = byDate.get(currentDate) ?? { date: currentDate, flocks: {} };
      const flockEggs = day.flocks[flock] ?? [];

      for (let column = 1; column < eggColumnEnd; column += 1) {
        if (headers[column] === "b") continue;
        const parsed = parseEggCell(row[column]);
        flockEggs.push(...parsed.eggs);
        for (const message of parsed.warnings) {
          warnings.push({ sheet: sheetName, row: rowIndex + 1, message });
        }
      }

      day.flocks[flock] = flockEggs;
      byDate.set(currentDate, day);
    }
  }

  return {
    days: [...byDate.values()]
      .filter((day) => Object.values(day.flocks).some((eggs) => (eggs?.length ?? 0) > 0))
      .sort((a, b) => a.date.localeCompare(b.date)),
    warnings,
    ignoredSheets,
  };
}
