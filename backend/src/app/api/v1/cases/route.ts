export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMlIncident, toCaseRecord } from "@/lib/case-mapper";

/** GET /api/v1/cases — ML-produced incidents, shaped as frontend CaseRecord[]. */
export async function GET(request: NextRequest) {
  try {
    const raw = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 50, 1), 200);

    const rows = await prisma.incident.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return NextResponse.json(rows.filter(isMlIncident).map(toCaseRecord));
  } catch (error) {
    console.error("Error listing cases:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
