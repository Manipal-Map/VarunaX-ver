/**
 * Typed client for the VarunaX ML service (FastAPI, engines 1-4).
 * Contract reference: API_INTEGRATION_GUIDE.md
 *
 *   Contract A (SlickObservation) = Engine 1 output  -> Engine 2 input
 *   Contract B (OriginField)      = Engine 2 output
 *   Contract C (Attribution)      = Engine 3 output
 */

const ML_URL = (process.env.ML_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type GeoJSONGeometry = { type: string; coordinates: unknown };

export interface SlickObservation {
  contract_version: string;
  slick_id: string;
  scene_id: string;
  t_sat_utc: string;
  polygon_wgs84: GeoJSONGeometry;
  centroid: [number, number]; // [lon, lat]
  area_km2: number;
  perimeter_km: number;
  major_axis_deg: number;
  elongation: number;
  skeleton_wgs84?: GeoJSONGeometry;
  mean_damping_ratio_db?: number | null;
  morphology_class: string;
  p_oil: number;
  p_lookalike: number;
  sar_ship_detections?: unknown[];
  age_hint_hours?: number | null;
  [k: string]: unknown;
}

export interface OriginField {
  contract_version: string;
  slick_id: string;
  age_prior_hours: [number, number];
  origin_field: { t_utc: string; h3: string; p: number }[];
  map_origin: { lon: number; lat: number; t_utc: string };
  credible_region_90: GeoJSONGeometry;
  time_window_90: [string, string];
  forcing: { currents: string; wind: string; windage_pct: number };
  [k: string]: unknown;
}

export interface Suspect {
  rank: number;
  mmsi: number;
  imo: string;
  vessel_type: string;
  score: number;
  score_type: string;
  evidence: Record<string, number>;
  cpa_km: number;
  reconstructed_state_at_t0?: { sog_kn: number; cog_deg: number };
  flags: string[];
  [k: string]: unknown;
}

export interface Attribution {
  contract_version: string;
  incident_id: string;
  suspects: Suspect[];
  dark_vessel_alerts: unknown[];
  coverage_note: string;
  [k: string]: unknown;
}

export interface UploadedScan {
  buffer: Buffer;
  name: string;
  type: string;
}

export class MlApiError extends Error {
  constructor(
    public engine: string,
    public status: number, // 0 = network error / timeout
    public detail: string
  ) {
    super(`[${engine}] ${status || "network"}: ${detail}`);
    this.name = "MlApiError";
  }
}

async function request(
  engine: string,
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${ML_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new MlApiError(
      engine,
      0,
      `ML service unreachable at ${ML_URL} (${e instanceof Error ? e.message : String(e)})`
    );
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
    } catch {
      /* non-JSON error body */
    }
    throw new MlApiError(engine, res.status, detail);
  }
  return res;
}

const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** GET /health — never throws; reports "offline" if the ML service is down. */
export async function mlHealth(): Promise<Record<string, unknown>> {
  try {
    const res = await request("health", "/health", { method: "GET" }, 4_000);
    return { status: "online", ...(await res.json()) };
  } catch (e) {
    return { status: "offline", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Engine 1 — returns one SlickObservation per detected spill region. */
export async function detect(file: UploadedScan) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file.buffer)], { type: file.type || "application/octet-stream" }),
    file.name
  );
  const res = await request("engine1", "/v1/engine1/detect", { method: "POST", body: form }, 90_000);
  return {
    slicks: (await res.json()) as SlickObservation[],
    // Present whenever the segmentation net is running on random (untrained) weights.
    warning: res.headers.get("x-model-checkpoint-warning"),
  };
}

/** Engine 2 — backward-drift ensemble on real Open-Meteo forcing (seconds, not instant). */
export async function hindcast(observation: SlickObservation): Promise<OriginField> {
  const res = await request("engine2", "/v1/engine2/hindcast", jsonInit(observation), 120_000);
  return res.json();
}

/** Engine 3 — live-AIS suspect ranking. 503 = AIS listener not ready (retryable). */
export async function attribute(
  observation: SlickObservation,
  originField: OriginField,
  incidentId: string
): Promise<Attribution> {
  const res = await request(
    "engine3",
    "/v1/engine3/attribute",
    jsonInit({ observation, origin_field: originField, incident_id: incidentId }),
    60_000
  );
  return res.json();
}

/** Engine 4 — final evidence dossier (JSON). */
export async function dossier(
  observation: SlickObservation,
  originField: OriginField,
  attribution: Attribution
): Promise<Record<string, any>> {
  const res = await request(
    "engine4",
    "/v1/engine4/dossier?format=json",
    jsonInit({ observation, origin_field: originField, attribution }),
    30_000
  );
  return res.json();
}
