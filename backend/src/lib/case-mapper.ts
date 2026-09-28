/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Incident } from "@prisma/client";

/**
 * Translates what the ML engines stored in an Incident row (Contract A/B/C)
 * into the `CaseRecord` shape the frontend already renders
 * (frontend/src/types/maritime.ts). Every access is defensive: half-finished
 * pipelines, failed runs and legacy seed rows must never throw.
 *
 * Fields the ML API does NOT provide are filled with neutral placeholders
 * (0 / "—") and are listed in INTEGRATION_README.md.
 */

type J = Record<string, any>;

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: unknown) => r1(num(v) * 100);

/** True for rows produced by the ML pipeline (hides legacy mock/seed rows). */
export function isMlIncident(incident: Incident): boolean {
  const obs = (incident.observation ?? {}) as J;
  const s1 = incident.system1 as J | null;
  const s2 = incident.system2 as J | null;
  return obs.source === "upload" || !!s1?.contract_version || !!s2?.contract_version;
}

function collectPoints(node: any, out: [number, number][] = []): [number, number][] {
  if (!Array.isArray(node)) return out;
  if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
    out.push([node[0], node[1]]);
    return out;
  }
  node.forEach((n) => collectPoints(n, out));
  return out;
}

/** Normalise ML geometry (flat ring | Polygon | MultiPolygon) to GeoJSON Polygon. */
function toPolygon(geom: J | null | undefined): { type: "Polygon"; coordinates: number[][][] } {
  const c = geom?.coordinates;
  if (!Array.isArray(c) || c.length === 0) return { type: "Polygon", coordinates: [] };
  if (geom?.type === "MultiPolygon") {
    const biggest = [...c].sort((a, b) => (b?.[0]?.length ?? 0) - (a?.[0]?.length ?? 0))[0];
    return { type: "Polygon", coordinates: biggest };
  }
  if (typeof c[0]?.[0] === "number") return { type: "Polygon", coordinates: [c] }; // flat ring
  return { type: "Polygon", coordinates: c };
}

function bbox(geom: J | null | undefined) {
  const pts = collectPoints(geom?.coordinates);
  if (pts.length === 0) return null;
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return {
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
}

function bboxRing(geom: J | null | undefined): number[][] {
  const b = bbox(geom);
  if (!b) return [];
  return [
    [b.minLon, b.minLat],
    [b.maxLon, b.minLat],
    [b.maxLon, b.maxLat],
    [b.minLon, b.maxLat],
    [b.minLon, b.minLat],
  ];
}

/** Half the bounding-box diagonal of the 90% credible region, in km. */
function regionRadiusKm(geom: J | null | undefined): number {
  const b = bbox(geom);
  if (!b) return 0;
  const midLat = (b.minLat + b.maxLat) / 2;
  const dx = (b.maxLon - b.minLon) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  const dy = (b.maxLat - b.minLat) * 110.574;
  return r1(Math.hypot(dx, dy) / 2);
}

/** Same fixed thresholds as engines/e3_attribution/scoring.py (placeholders, not validated). */
export const tierFor = (score: number) =>
  score >= 0.7 ? "priority_suspect" : score >= 0.4 ? "possible" : "low";

function mapVessel(s: J) {
  const ev = s.evidence ?? {};
  const score = num(s.score);
  const tier = tierFor(score);
  const flags: string[] = Array.isArray(s.flags) ? s.flags : [];
  const cpa = num(s.cpa_km);
  return {
    rank: num(s.rank, 1),
    name: `MMSI ${s.mmsi}`, // API returns no vessel name
    mmsi: String(s.mmsi),
    imo: s.imo || "—",
    callSign: "—",
    flag: "—",
    flagCode: "—",
    vesselType: s.vessel_type ?? "Unknown",
    lengthMeters: 0,
    beamMeters: 0,
    deadweightTonnage: 0,
    // Evidence INDEX x100 — indicative ranking, not a calibrated probability.
    overallAttributionConfidence: r1(score * 100),
    evidence: {
      originProximity: pct(ev.f_origin),
      temporalCompatibility: pct(ev.f_time),
      trajectoryMatch: pct(ev.f_alignment),
      aisContinuity: pct(ev.f_dark),
      vesselTypeRelevance: pct(ev.f_type),
    },
    aisTrack: [], // Contract C carries no waypoint history
    hasDarkPeriod: num(ev.f_dark) >= 0.5 || flags.some((f) => /DARK/i.test(f)),
    isCulpritSuspect: tier === "priority_suspect",
    summaryRationale:
      `Closest approach to the estimated origin: ${cpa} km. ` +
      (flags.length ? `Flags: ${flags.join(", ")}. ` : "") +
      `Evidence index ${score.toFixed(2)} (${tier.replace("_", " ")}) — an indicative ranking, not a probability.`,
    // extras (optional in the frontend type)
    cpaKm: cpa,
    mlScore: score,
    mlTier: tier,
    flags,
    mlEvidence: ev,
  };
}

const NO_SUSPECT = {
  rank: 0,
  name: "No candidate identified",
  mmsi: "—",
  imo: "—",
  callSign: "—",
  flag: "—",
  flagCode: "—",
  vesselType: "—",
  lengthMeters: 0,
  beamMeters: 0,
  deadweightTonnage: 0,
  overallAttributionConfidence: 0,
  evidence: {
    originProximity: 0,
    temporalCompatibility: 0,
    trajectoryMatch: 0,
    aisContinuity: 0,
    vesselTypeRelevance: 0,
  },
  aisTrack: [],
  hasDarkPeriod: false,
  isCulpritSuspect: false,
  summaryRationale: "No AIS candidates available for this incident (yet).",
};

export function toCaseRecord(incident: Incident) {
  const obs = (incident.observation ?? {}) as J;
  const s1 = incident.system1 as J | null;
  const s2 = incident.system2 as J | null;
  const s3 = incident.system3 as J | null;

  const stagesDone = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (s3 ? 1 : 0);
  const finished = incident.status === "completed" || incident.status === "unresolved";

  const c = s1?.centroid;
  const [lng, lat]: [number, number] = Array.isArray(c)
    ? [num(c[0]), num(c[1])]
    : [num(obs.longitude), num(obs.latitude)];
  const tSat: string = s1?.t_sat_utc ?? obs.observation_time ?? incident.createdAt.toISOString();

  // ── System 1 ──
  const area = num(s1?.area_km2);
  const hint = typeof s1?.age_hint_hours === "number" ? s1.age_hint_hours : null;
  const prior = Array.isArray(s2?.age_prior_hours) ? s2!.age_prior_hours : null;
  const ageMin = prior ? num(prior[0]) : 0;
  const ageMax = prior ? num(prior[1]) : num(hint);
  const ageBest = hint ?? (ageMin + ageMax) / 2;
  const tMs = Date.parse(tSat);
  const isoMinus = (h: number) => new Date((Number.isFinite(tMs) ? tMs : Date.now()) - h * 3.6e6).toISOString();

  // ── System 2 ──
  const originLat = num(s2?.map_origin?.lat, lat);
  const originLng = num(s2?.map_origin?.lon, lng);
  const win: [string, string] = Array.isArray(s2?.time_window_90) ? s2!.time_window_90 : [tSat, tSat];
  const spanH = (Date.parse(win[1]) - Date.parse(win[0])) / 3.6e6;
  const ring = bboxRing(s2?.credible_region_90);

  // ── System 3 ──
  const ranked = (Array.isArray(s3?.suspects) ? s3!.suspects : [])
    .map(mapVessel)
    .sort((a: J, b: J) => a.rank - b.rank);
  const top = ranked[0] ?? null;

  // ── Case-level status ──
  let status: "analyzing" | "resolved" | "flagged" | "failed";
  let statusLabel: string;
  if (obs.error) {
    status = "failed";
    statusLabel = "Pipeline Failed";
  } else if (!finished) {
    status = "analyzing";
    statusLabel = "Live Pipeline Ingestion";
  } else if (obs.noDetections) {
    status = "resolved";
    statusLabel = "No Spill Detected";
  } else if (obs.attributionUnavailable) {
    status = "resolved";
    statusLabel = "Attribution Unavailable";
  } else if (top?.isCulpritSuspect) {
    status = "flagged";
    statusLabel = "Priority Suspect Flagged";
  } else if (ranked.length) {
    status = "resolved";
    statusLabel = "Ranked Suspects (Indicative)";
  } else {
    status = "resolved";
    statusLabel = "No AIS Candidates Found";
  }

  const severity = area > 25 ? "critical" : area > 15 ? "high" : area > 5 ? "moderate" : "minor";
  const risk = { critical: "Extreme", high: "High", moderate: "Moderate", minor: "Guarded" }[severity];

  return {
    id: incident.id,
    caseNumber: incident.id,
    title: obs.noDetections ? `No spill detected — ${obs.scene_id ?? incident.id}` : `SAR Detection — ${s1?.scene_id ?? obs.scene_id ?? incident.id}`,
    region: `${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`,
    locationName: s1 ? `Detected slick (${s1.morphology_class ?? "OTHER"})` : "Awaiting detection",
    coordinates: { lat, lng },
    status,
    statusLabel,
    timestamp: tSat,
    severity,
    estimatedSpillVolumeBarrels: 0, // not produced by the ML API
    marineEcosystemRisk: risk, // heuristic from area only
    nearestShoreDistanceKm: 0,
    nearestMarineProtectedArea: "—",
    sarPreviewUrl: "/sar/palsar-grayscale.jpg",

    system1: {
      sceneId: s1?.scene_id ?? obs.scene_id ?? "—",
      satellite: "Sentinel-1 (SAR)",
      sensor: "—",
      polarization: "VV+VH",
      resolutionMeters: 10,
      acquisitionTimestamp: tSat,
      slickPolygon: {
        type: "Feature",
        geometry: toPolygon(s1?.polygon_wgs84),
        properties: {
          slickType: s1?.morphology_class ?? "OTHER",
          reflectanceDampingRatioDb: s1?.mean_damping_ratio_db ?? undefined,
          slickId: s1?.slick_id,
        },
      },
      areaKm2: r1(area),
      perimeterKm: r1(num(s1?.perimeter_km)),
      elongation: r1(num(s1?.elongation)),
      orientationDegrees: r1(num(s1?.major_axis_deg)),
      sarTextureEntropy: 0,
      oilLookalikeConfidence: pct(s1?.p_oil),
      estimatedSpillAgeHours: { min: r1(ageMin), max: r1(ageMax), bestEstimate: r1(ageBest) },
      ageConfidence: 0,
      candidateSpillTimeWindow: { start: isoMinus(ageMax), end: isoMinus(ageMin) },
    },

    system2: {
      originCoordinates: { lat: originLat, lng: originLng },
      mostProbableTimeWindow: { start: win[0], end: win[1] },
      spatialUncertaintyKm: regionRadiusKm(s2?.credible_region_90),
      temporalUncertaintyHours: Number.isFinite(spanH) ? r1(Math.max(0, spanH) / 2) : 0,
      // The API reports forcing PROVENANCE only, not the sampled current/wind values.
      oceanCurrent: { uVelocity: 0, vVelocity: 0, speedKnots: 0, headingDegrees: 0 },
      wind: {
        speedKnots: 0,
        directionDegrees: 0,
        uComponent: 0,
        vComponent: 0,
        windageCoefficient: num(s2?.forcing?.windage_pct) / 100,
      },
      particleCount: 0,
      particles: [],
      originProbabilityEllipse: {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: ring.length ? [ring] : [] },
        properties: { probabilityDensity: 0.9, radiusKm: regionRadiusKm(s2?.credible_region_90) },
      },
      driftPath: [
        [originLng, originLat],
        [lng, lat],
      ],
    },

    system3: {
      candidateVesselsEvaluated: ranked.length,
      temporalSearchWindowHours: 0,
      spatialSearchRadiusKm: 0,
      rankedVessels: ranked,
      primarySuspect: top ?? NO_SUSPECT,
    },

    pipeline: {
      status: incident.status,
      stagesDone,
      finished,
      error: obs.error ?? null,
    },

    ml: {
      warnings: Array.isArray(obs.warnings) ? obs.warnings : [],
      checkpointLoaded: typeof obs.checkpointLoaded === "boolean" ? obs.checkpointLoaded : null,
      coverageNote: s3?.coverage_note ?? null,
      forcing: s2?.forcing ?? null,
      modelVersions: obs.dossier?.model_versions ?? null,
      dossierSummary: obs.dossier?.summary ?? null,
      error: obs.error ?? null,
    },
  };
}
