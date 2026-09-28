import { IncidentStatus } from "@prisma/client";
import { systemPushHandler, AttributionSchema } from "@/lib/system-route";

// Body = ML Contract C (Attribution) — the output of POST /v1/engine3/attribute
export const POST = systemPushHandler("system3", IncidentStatus.completed, AttributionSchema);
