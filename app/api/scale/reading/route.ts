import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function tokenMatches(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);

  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export async function POST(request: Request) {
  const deviceToken = process.env.SCALE_DEVICE_TOKEN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  const ownerId = process.env.SCALE_OWNER_USER_ID;

  if (!deviceToken || !supabaseUrl || !supabaseSecretKey || !ownerId) {
    return Response.json({ error: "Scale endpoint is not configured." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const providedToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!tokenMatches(providedToken, deviceToken)) {
    return Response.json({ error: "Unauthorized scale device." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid reading." }, { status: 400 });
  }

  const { event_id: eventId, weight_grams: weightGrams } = body as {
    event_id?: unknown;
    weight_grams?: unknown;
  };

  if (
    typeof eventId !== "string" ||
    eventId.length < 1 ||
    eventId.length > 80 ||
    typeof weightGrams !== "number" ||
    !Number.isFinite(weightGrams) ||
    weightGrams < 0 ||
    weightGrams > 500 ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(ownerId)
  ) {
    return Response.json({ error: "Invalid scale reading." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error } = await supabase.from("scale_readings").upsert(
    {
      event_id: eventId,
      owner_id: ownerId,
      weight_grams: weightGrams,
    },
    { onConflict: "event_id", ignoreDuplicates: true }
  );

  if (error) {
    console.error("Scale reading insert failed:", error.message);
    return Response.json({ error: "Could not save scale reading." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
