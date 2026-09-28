import React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { CaseRecord } from "@/types/maritime";

interface Props {
  ml?: CaseRecord["ml"];
}

/**
 * Surfaces the ML service's own honesty signals (untrained weights, AIS
 * coverage gaps, pipeline errors) so nobody mistakes a structural test run
 * for a real forensic result. Renders nothing for the bundled demo cases.
 */
export default function MlProvenanceBanner({ ml }: Props) {
  if (!ml) return null;

  return (
    <div className="space-y-2">
      {ml.error && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Pipeline error</div>
            <p className="leading-relaxed">{ml.error}</p>
          </div>
        </div>
      )}

      {ml.warnings.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">Model provenance warnings</div>
            {ml.warnings.map((w, i) => (
              <p key={i} className="leading-relaxed">
                {w}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="p-3 rounded-2xl bg-[#e9f2f7] border border-[#B7D4E6]/60 text-[11px] text-slate-600 flex items-start gap-2.5">
        <Info className="w-3.5 h-3.5 text-[#1E5A6E] shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Suspect scores are an <strong>evidence index (0–1)</strong>, not a calibrated probability — read them
          together with the evidence breakdown, not as “% chance”.
          {ml.coverageNote ? ` ${ml.coverageNote}` : ""}
        </p>
      </div>
    </div>
  );
}
