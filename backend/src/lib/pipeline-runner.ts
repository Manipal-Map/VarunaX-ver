import { IncidentStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { emitIncidentUpdate } from "./events";
import { generateIncidentId } from "./incident-id";
import * as ml from "./ml-client";
import type { UploadedScan, SlickObservation } from "./ml-client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SystemKey = "system1" | "system2" | "system3";
type ObsPatch = Record<string, unknown> & { warnings?: string[] };

async function readObservation(id: string): Promise<Record<string, unknown>> {
  const row = await prisma.incident.findUnique({ where: { id }, select: { observation: true } });
  if (!row) throw new Error(`Incident ${id} not found`);
  return (row.observation ?? {}) as Record<string, unknown>;
}

/**
 * Persist one system's output, merge metadata into `observation`, move the
 * status forward and emit an SSE event. Shared by the pipeline runner AND the
 * manual POST /incidents/:id/systemN routes.
 */
export async function advanceIncident(
  id: string,
  system: SystemKey,
  status: IncidentStatus,
  payload: unknown,
  obsPatch: ObsPatch = {}
) {
  const prev = await readObservation(id);
  const { warnings: newWarnings = [], ...rest } = obsPatch;
  const prevWarnings = Array.isArray(prev.warnings) ? (prev.warnings as string[]) : [];
  const observation = { ...prev, ...rest, warnings: [...prevWarnings, ...newWarnings] };

  const incident = await prisma.incident.update({
    where: { id },
    data: {
      [system]: payload as Prisma.InputJsonValue,
      status,
      observation: observation as Prisma.InputJsonValue,
    } as Prisma.IncidentUpdateInput,
  });

  emitIncidentUpdate({
    incidentId: id,
    system,
    status: incident.status,
    payload: (payload ?? {}) as Record<string, unknown>,
    timestamp: new Date().toISOString(),
  });
  return incident;
}

async function fail(id: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[pipeline] ${id} failed:`, message);
  try {
    const prev = await readObservation(id);
    await prisma.incident.update({
      where: { id },
      data: {
        status: IncidentStatus.unresolved,
        observation: { ...prev, error: message } as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    console.error(`[pipeline] could not record failure for ${id}:`, e);
  }
  emitIncidentUpdate({
    incidentId: id,
    system: "error",
    status: "unresolved",
    payload: { error: message },
    timestamp: new Date().toISOString(),
  });
}

/** Engine 3 needs the live AIS buffer; 503 means "not ready yet", so retry briefly. */
async function attributeWithRetry(slick: SlickObservation, origin: ml.OriginField, id: string) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await ml.attribute(slick, origin, id);
    } catch (e) {
      lastErr = e;
      if (!(e instanceof ml.MlApiError) || e.status !== 503) throw e;
      await sleep(5_000);
    }
  }
  throw lastErr;
}

/** Run engines 2 -> 3 -> 4 for one Engine-1 detection and persist every stage. */
async function processSlick(id: string, slick: SlickObservation, baseWarnings: string[]) {
  try {
    // ── Engine 1 result ──
    await advanceIncident(id, "system1", IncidentStatus.system2_pending, slick, {
      slick_id: slick.slick_id,
      scene_id: slick.scene_id,
      observation_time: slick.t_sat_utc,
      latitude: slick.centroid[1],
      longitude: slick.centroid[0],
      crs: "EPSG:4326",
      checkpointLoaded: baseWarnings.length === 0,
      warnings: baseWarnings,
    });

    // ── Engine 2 ──
    const origin = await ml.hindcast(slick);
    await advanceIncident(id, "system2", IncidentStatus.system3_pending, origin);

    // ── Engine 3 (may be legitimately unavailable — live-AIS only) ──
    const extraWarnings: string[] = [];
    let attributionUnavailable = false;
    let attribution: ml.Attribution;
    try {
      attribution = await attributeWithRetry(slick, origin, id);
    } catch (e) {
      if (!(e instanceof ml.MlApiError) || e.status !== 503) throw e;
      attributionUnavailable = true;
      extraWarnings.push(`Engine 3 (AIS attribution) unavailable: ${e.detail}`);
      attribution = {
        contract_version: "C.1",
        incident_id: id,
        suspects: [],
        dark_vessel_alerts: [],
        coverage_note: `AIS attribution unavailable — ${e.detail}`,
      };
    }

    // ── Engine 4 (non-fatal). Keep only the summary: the full dossier re-embeds A+B+C. ──
    let dossier: Record<string, unknown> | null = null;
    try {
      const full = await ml.dossier(slick, origin, attribution);
      dossier = {
        incident_id: full.incident_id,
        generated_at_utc: full.generated_at_utc,
        model_versions: full.model_versions,
        summary: full.summary,
      };
    } catch (e) {
      extraWarnings.push(`Engine 4 (dossier) failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    await advanceIncident(
      id,
      "system3",
      attributionUnavailable ? IncidentStatus.unresolved : IncidentStatus.completed,
      attribution,
      { dossier, attributionUnavailable, warnings: extraWarnings }
    );
  } catch (err) {
    await fail(id, err);
  }
}

/**
 * Full chain for one uploaded SAR scene. NEVER rejects — every failure is
 * written onto the incident (status "unresolved" + observation.error).
 */
export async function runPipeline(incidentId: string, scan: UploadedScan): Promise<void> {
  try {
    const { slicks, warning } = await ml.detect(scan);
    const warnings = warning ? [warning] : [];

    if (slicks.length === 0) {
      const prev = await readObservation(incidentId);
      await prisma.incident.update({
        where: { id: incidentId },
        data: {
          status: IncidentStatus.completed,
          observation: { ...prev, noDetections: true, warnings } as Prisma.InputJsonValue,
        },
      });
      emitIncidentUpdate({
        incidentId,
        system: "system1",
        status: "completed",
        payload: { noDetections: true },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const [primary, ...extras] = slicks;
    await processSlick(incidentId, primary, warnings);

    // One incident per additional spill region found in the same scene.
    for (const extra of extras) {
      const id = await generateIncidentId();
      await prisma.incident.create({
        data: {
          id,
          status: IncidentStatus.system1_pending,
          observation: {
            scene_id: scan.name,
            source: "upload",
            parent_incident: incidentId,
            observation_time: new Date().toISOString(),
            warnings: [],
          },
        },
      });
      await processSlick(id, extra, warnings);
    }
  } catch (err) {
    await fail(incidentId, err);
  }
}
