export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toCaseRecord } from "@/lib/case-mapper";

/** GET /api/v1/cases/:id — one incident shaped as a frontend CaseRecord. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const incident = await prisma.incident.findUnique({ where: { id: params.id } });
    if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    return NextResponse.json(toCaseRecord(incident));
  } catch (error) {
    console.error("Error fetching case:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
