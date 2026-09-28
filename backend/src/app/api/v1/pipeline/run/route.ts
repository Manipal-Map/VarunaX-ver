export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { IncidentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/auth";
import { emitIncidentUpdate } from "@/lib/events";
import { generateIncidentId } from "@/lib/incident-id";
import { runPipeline } from "@/lib/pipeline-runner";

/**
 * POST /api/v1/pipeline/run   (multipart, field "file" = SAR scene, X-API-Key required)
 *
 * Creates an incident, then runs ML engines 1 -> 2 -> 3 -> 4, persisting each
 * stage and emitting SSE events as it goes.
 *
 *  default        -> 202 immediately; the pipeline continues in the background
 *                    (needs a long-running Node host — see README caveat)
 *  ?wait=true     -> holds the request open until the pipeline finishes
 */
export async function POST(request: NextRequest) {
  try {
    const authError = validateApiKey(request);
    if (authError) return authError;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: 'Multipart field "file" (SAR image) is required' }, { status: 400 });
    }

    const scan = {
      buffer: Buffer.from(await file.arrayBuffer()),
      name: file.name || "upload.tiff",
      type: file.type,
    };

    const id = await generateIncidentId();
    const incident = await prisma.incident.create({
      data: {
        id,
        status: IncidentStatus.system1_pending,
        observation: {
          scene_id: scan.name,
          source: "upload",
          observation_time: new Date().toISOString(),
          warnings: [],
        },
      },
    });

    emitIncidentUpdate({
      incidentId: id,
      system: "system1",
      status: incident.status,
      payload: {},
      timestamp: new Date().toISOString(),
    });

    const job = runPipeline(id, scan); // never rejects

    if (request.nextUrl.searchParams.get("wait") === "true") {
      await job;
      const done = await prisma.incident.findUnique({ where: { id } });
      return NextResponse.json(done ?? incident);
    }

    void job;
    return NextResponse.json(
      {
        incidentId: id,
        status: incident.status,
        streamUrl: `/api/v1/pipeline/stream?incidentId=${id}`,
        caseUrl: `/api/v1/cases/${id}`,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error starting pipeline:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
