export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/api";

/**
 * POST /api/scan — server-side proxy so the backend's INTERNAL_API_KEY never
 * reaches the browser. Forwards the multipart upload to the backend pipeline.
 */
export async function POST(req: NextRequest) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "INTERNAL_API_KEY is not set on the frontend server (.env.local)" },
      { status: 500 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${API_URL}/api/v1/pipeline/run`, {
      method: "POST",
      headers: { "X-API-Key": key },
      body: form,
    });
    const data = await upstream.json().catch(() => ({ error: "Unreadable response from backend" }));
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    return NextResponse.json(
      { error: `Backend unreachable at ${API_URL} (${e instanceof Error ? e.message : String(e)})` },
      { status: 502 }
    );
  }
}
