import React, { Suspense } from "react";
import Link from "next/link";
import { MOCK_CASES } from "@/data/mockCases";
import { fetchCase, isLiveIncidentId } from "@/lib/api";
import LivePipelineView from "@/components/live/LivePipelineView";
import FloatingNavbar from "@/components/common/FloatingNavbar";
import Footer from "@/components/common/Footer";
import { ArrowLeft, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

interface LivePageProps {
  searchParams: Promise<{ caseId?: string }>;
}

async function LiveContent({ searchParams }: LivePageProps) {
  const params = await searchParams;
  const targetId = params.caseId || "case-northsea-live-2026";
  const isReal = isLiveIncidentId(targetId);
  const record = await fetchCase(targetId);

  // A real incident that can't be loaded must NOT silently fall back to a demo case.
  if (!record && isReal) {
    return (
      <div className="p-8 bg-white rounded-3xl border border-rose-200 text-sm text-rose-800 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        <div>
          <div className="font-bold mb-1">Could not load incident {targetId}</div>
          <p className="text-xs leading-relaxed">
            The backend did not return this incident. Check that it is running and that NEXT_PUBLIC_API_URL points to it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <LivePipelineView
      key={targetId}
      caseRecord={record ?? MOCK_CASES[2]}
      realRun={isReal}
    />
  );
}

export default function LivePage({ searchParams }: LivePageProps) {
  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <FloatingNavbar />

      <div className="pt-28 pb-16 flex-1">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-6">
            <Link href="/dashboard" className="hover:text-teal-700 flex items-center gap-1 font-medium">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Surveillance Dashboard</span>
            </Link>
            <span>/</span>
            <span className="text-slate-800 font-semibold">Live Staged Pipeline Reveal</span>
          </div>

          <Suspense fallback={<div className="p-12 text-center text-xs text-slate-500">Initializing Live Stream...</div>}>
            <LiveContent searchParams={searchParams} />
          </Suspense>
        </div>
      </div>

      <Footer />
    </main>
  );
}
