import { CaseRecord } from "@/types/maritime";
import { MOCK_CASES } from "@/data/mockCases";

/** Base URL of the Next.js backend (which in turn talks to the ML service). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** Incidents created by the backend look like INCIDENT_2026_001; demo cases don't. */
export const isLiveIncidentId = (id?: string | null): boolean => !!id && id.startsWith("INCIDENT_");

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // backend offline -> callers fall back to demo data
  }
}

/** Real (ML-produced) cases first, then the bundled demo cases. */
export async function fetchCases(): Promise<CaseRecord[]> {
  const live = await getJson<CaseRecord[]>("/api/v1/cases?limit=100");
  return [...(Array.isArray(live) ? live : []), ...MOCK_CASES];
}

export async function fetchCase(id: string): Promise<CaseRecord | null> {
  const mock = MOCK_CASES.find((c) => c.id === id);
  if (mock) return mock;
  return getJson<CaseRecord>(`/api/v1/cases/${encodeURIComponent(id)}`);
}
