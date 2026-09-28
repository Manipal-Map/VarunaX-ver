import { IncidentStatus } from "@prisma/client";
import { systemPushHandler, OriginFieldSchema } from "@/lib/system-route";

// Body = ML Contract B (OriginField) — the output of POST /v1/engine2/hindcast
export const POST = systemPushHandler("system2", IncidentStatus.system3_pending, OriginFieldSchema);
