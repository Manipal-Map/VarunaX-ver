export type CaseStatus = "analyzing" | "resolved" | "flagged" | "failed";
export type SeverityLevel = "critical" | "high" | "moderate" | "minor";

export interface GeoCoordinate {
  lng: number;
  lat: number;
}

export interface DriftParticle {
  id: string;
  history: [number, number][]; // [lng, lat] array from detection to origin
  current: [number, number];
  originEstimate: [number, number];
  weight: number;
}

export interface System1Data {
  sceneId: string;
  satellite: string;
  sensor: string;
  polarization: "VV" | "VH" | "VV+VH";
  resolutionMeters: number;
  acquisitionTimestamp: string;
  slickPolygon: {
    type: "Feature";
    geometry: {
      type: "Polygon";
      coordinates: [number, number][][];
    };
    properties: Record<string, unknown>;
  };
  areaKm2: number;
  perimeterKm: number;
  elongation: number;
  orientationDegrees: number;
  sarTextureEntropy: number;
  oilLookalikeConfidence: number; // probability it is genuine mineral oil vs biogenic sheen (0-100%)
  estimatedSpillAgeHours: {
    min: number;
    max: number;
    bestEstimate: number;
  };
  ageConfidence: number; // 0-100%
  candidateSpillTimeWindow: {
    start: string;
    end: string;
  };
}

export interface System2Data {
  originCoordinates: {
    lat: number;
    lng: number;
  };
  mostProbableTimeWindow: {
    start: string;
    end: string;
  };
  spatialUncertaintyKm: number;
  temporalUncertaintyHours: number;
  oceanCurrent: {
    uVelocity: number; // m/s eastward
    vVelocity: number; // m/s northward
    speedKnots: number;
    headingDegrees: number;
  };
  wind: {
    speedKnots: number;
    directionDegrees: number;
    uComponent: number;
    vComponent: number;
    windageCoefficient: number;
  };
  particleCount: number;
  particles: DriftParticle[];
  originProbabilityEllipse: {
    type: "Feature";
    geometry: {
      type: "Polygon";
      coordinates: [number, number][][];
    };
    properties: {
      probabilityDensity: number;
      radiusKm: number;
    };
  };
  driftPath: [number, number][]; // [lng, lat] from origin to observation
}

export interface AISWaypoint {
  timestamp: string;
  lat: number;
  lng: number;
  sogKnots: number;
  cogDegrees: number;
  headingDegrees: number;
  navStatus: string;
  distanceToOriginKm: number;
  isAnomaly?: boolean;
  anomalyDescription?: string;
}

export interface EvidenceFeatures {
  originProximity: number; // 0-100%
  temporalCompatibility: number; // 0-100%
  trajectoryMatch: number; // 0-100%
  aisContinuity: number; // 0-100% (high score means suspicious dark period/gap identified)
  vesselTypeRelevance: number; // 0-100%
}

export interface RankedVessel {
  rank: number;
  name: string;
  mmsi: string;
  imo: string;
  callSign: string;
  flag: string;
  flagCode: string; // ISO 2-letter country code for flags
  vesselType: string;
  lengthMeters: number;
  beamMeters: number;
  deadweightTonnage: number;
  overallAttributionConfidence: number; // 0-100%
  evidence: EvidenceFeatures;
  aisTrack: AISWaypoint[];
  hasDarkPeriod: boolean;
  darkPeriodDurationHours?: number;
  darkPeriodLocation?: {
    lat: number;
    lng: number;
  };
  isCulpritSuspect: boolean;
  summaryRationale: string;

  /* ── Populated only for cases produced by the ML pipeline ── */
  cpaKm?: number; // closest point of approach to the estimated origin
  mlScore?: number; // raw 0-1 evidence index (NOT a calibrated probability)
  mlTier?: "priority_suspect" | "possible" | "low";
  flags?: string[];
  mlEvidence?: Record<string, number>; // all 8 raw f_* features
}

export interface System3Data {
  candidateVesselsEvaluated: number;
  temporalSearchWindowHours: number;
  spatialSearchRadiusKm: number;
  rankedVessels: RankedVessel[];
  primarySuspect: RankedVessel;
}

/** Live progress of a backend pipeline run (ML cases only). */
export interface PipelineProgress {
  status: string; // system1_pending | system2_pending | system3_pending | completed | unresolved
  stagesDone: number; // 0-3 engines that have written results
  finished: boolean;
  error: string | null;
}

/** Provenance + honesty metadata from the ML service (ML cases only). */
export interface MlMeta {
  warnings: string[]; // e.g. "no trained checkpoint loaded", "AIS unavailable"
  checkpointLoaded: boolean | null;
  coverageNote: string | null;
  forcing: { currents?: string; wind?: string; windage_pct?: number } | null;
  modelVersions: Record<string, string> | null;
  dossierSummary: Record<string, unknown> | null;
  error: string | null;
}

export interface CaseRecord {
  id: string;
  caseNumber: string;
  title: string;
  region: string;
  locationName: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  status: CaseStatus;
  statusLabel: string;
  timestamp: string;
  severity: SeverityLevel;
  estimatedSpillVolumeBarrels: number;
  marineEcosystemRisk: "Extreme" | "High" | "Moderate" | "Guarded";
  nearestShoreDistanceKm: number;
  nearestMarineProtectedArea: string;
  sarPreviewUrl: string;
  system1: System1Data;
  system2: System2Data;
  system3: System3Data;
  pipeline?: PipelineProgress;
  ml?: MlMeta;
}

export type PipelineStage = "idle" | "system1_detection" | "system2_drift" | "system3_attribution" | "completed";
