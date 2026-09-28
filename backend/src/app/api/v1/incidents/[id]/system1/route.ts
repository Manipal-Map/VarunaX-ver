import { IncidentStatus } from "@prisma/client";
import { systemPushHandler, SlickObservationSchema } from "@/lib/system-route";

// Body = ML Contract A (SlickObservation) — the output of POST /v1/engine1/detect
export const POST = systemPushHandler(
  "system1",
  IncidentStatus.system2_pending,
  SlickObservationSchema,
  (p) => ({
    slick_id: p.slick_id,
    scene_id: p.scene_id,
    observation_time: p.t_sat_utc,
    latitude: p.centroid[1],
    longitude: p.centroid[0],
    crs: "EPSG:4326",
  })
);
