"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, AlertTriangle, Activity } from "lucide-react";
import { API_URL } from "@/lib/api";

type Health = {
  status: "online" | "offline";
  ais_listener_connected?: boolean;
  ais_pings_buffered?: number;
} | null;

export default function ScanUploadCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/ml/health`, { cache: "no-store" });
        if (alive) setHealth(res.ok ? await res.json() : { status: "offline" });
      } catch {
        if (alive) setHealth({ status: "offline" });
      }
    };
    check();
    const t = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function handleRun() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/scan", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.incidentId) throw new Error(data.error ?? `Upload failed (${res.status})`);
      router.push(`/live?caseId=${data.incidentId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const online = health?.status === "online";

  return (
    <div className="bg-white p-5 rounded-3xl border border-[#B7D4E6]/60 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live ML Pipeline</div>
          <h3 className="font-bold text-slate-900 text-base">Analyze a new SAR scene</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Runs detection → drift hindcast → AIS attribution → dossier on the ML engines.
          </p>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
            health === null
              ? "bg-slate-50 text-slate-500 border-slate-200"
              : online
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-rose-50 text-rose-700 border-rose-200"
          }`}
        >
          <Activity className="w-3 h-3" />
          {health === null
            ? "Checking ML engine…"
            : online
            ? `ML engine online · AIS ${health.ais_listener_connected ? `live (${health.ais_pings_buffered ?? 0} pings)` : "not connected"}`
            : "ML engine offline"}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".tif,.tiff,.png,.jpg,.jpeg"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <button
          onClick={() => inputRef.current?.click()}
          className="flex-1 px-4 py-2.5 rounded-xl bg-[#e9f2f7] hover:bg-[#B7D4E6]/30 border border-dashed border-[#1E5A6E]/40 text-xs font-medium text-slate-700 flex items-center justify-center gap-2 transition-colors truncate"
        >
          <Upload className="w-4 h-4 text-[#1E5A6E] shrink-0" />
          <span className="truncate">{file ? file.name : "Choose a SAR image (.tif / .tiff / .png / .jpg)"}</span>
        </button>

        <button
          onClick={handleRun}
          disabled={!file || busy}
          className="px-5 py-2.5 rounded-xl bg-[#0D2B45] hover:bg-[#1E5A6E] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          <span>{busy ? "Uploading…" : "Run Live Pipeline"}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
