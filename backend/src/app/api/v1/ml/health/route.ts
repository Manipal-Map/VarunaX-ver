export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { mlHealth } from "@/lib/ml-client";

/** GET /api/v1/ml/health — proxies the ML service /health (always 200; check `status`). */
export async function GET() {
  return NextResponse.json(await mlHealth());
}
