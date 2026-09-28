import { NextRequest, NextResponse } from "next/server";
import { z, ZodTypeAny } from "zod";
import { IncidentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/auth";
import { advanceIncident } from "@/lib/pipeline-runner";

/**
 * Manual "push" endpoints for external callers. They now store the REAL
 * request body (validated against the ML contracts) — the old versions
 * ignored the body and wrote MOCK_INCIDENTS[0] into the database.
 * The normal path is POST /api/v1/pipeline/run, which does all of this itself.
 */

const geom = z.object({ type: z.string(), coordinates: z.any() });

export const SlickObservationSchema = z
  .object({
    slick_id: z.string(),
    scene_id: z.string(),
    t_sat_utc: z.string(),
    polygon_wgs84: geom,
    centroid: z.tuple([z.number(), z.number()]),
    area_km2: z.number(),
  })
  .passthrough();

export const OriginFieldSchema = z
  .object({
    slick_id: z.string(),
    origin_field: z.array(z.any()),
    map_origin: z.object({ lon: z.number(), lat: z.number(), t_utc: z.string() }),
    time_window_90: z.tuple([z.string(), z.string()]),
  })
  .passthrough();

export const AttributionSchema = z
  .object({
    incident_id: z.string(),
    suspects: z.array(
      z
        .object({
          rank: z.number(),
          mmsi: z.number(),
          score: z.number(),
          evidence: z.record(z.number()),
        })
        .passthrough()
    ),
  })
  .passthrough();

export function systemPushHandler(
  system: "system1" | "system2" | "system3",
  nextStatus: IncidentStatus,
  schema: ZodTypeAny,
  obsFromPayload?: (p: any) => Record<string, unknown>
) {
  return async function POST(request: NextRequest, { params }: { params: { id: string } }) {
    try {
      const authError = validateApiKey(request);
      if (authError) return authError;

      const body = await request.json().catch(() => null);
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: `Invalid ${system} payload`, details: parsed.error.errors },
          { status: 400 }
        );
      }

      const exists = await prisma.incident.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!exists) return NextResponse.json({ error: "Incident not found" }, { status: 404 });

      const incident = await advanceIncident(
        params.id,
        system,
        nextStatus,
        parsed.data,
        obsFromPayload ? obsFromPayload(parsed.data) : {}
      );
      return NextResponse.json(incident);
    } catch (error) {
      console.error(`Error updating ${system}:`, error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
