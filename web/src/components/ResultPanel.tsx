import { useEffect, useState } from "react";
import { marked } from "marked";
import { listRunFiles, readRunFile } from "../lib/api.js";
import type { GeneratedFile, RunRecord } from "../lib/types.js";

marked.setOptions({ breaks: true });

function FileViewer({ runId, file }: { runId: string; file: GeneratedFile }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && content === null) {
      setLoading(true);
      try {
        setContent(await readRunFile(runId, file.path));
      } catch {
        setContent("(could not load file)");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="rounded-lg border border-white/10">
      <button onClick={toggle} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs">
        <span className="font-mono text-white/75">{file.path}</span>
        <span className="text-white/30">{file.bytes}B</span>
      </button>
      {open && (
        <div className="border-t border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/65">
          {loading ? <span className="text-white/30">Loading…</span> : <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">{content}</pre>}
        </div>
      )}
    </div>
  );
}

export function ResultPanel({ run }: { run: RunRecord }) {
  const [files, setFiles] = useState<GeneratedFile[] | null>(null);

  useEffect(() => {
    if (run.status !== "completed" && run.status !== "failed") return;
    listRunFiles(run.id)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [run.id, run.status]);

  if (run.status === "planning" || run.status === "running") return null;

  return (
    <div className="glass rounded-xl border border-white/10 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/90">
          {run.status === "completed" ? "Final result" : "Run failed"}
        </h3>
      </div>
      {run.status === "failed" && (
        <div className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/[0.07] px-3 py-2 text-sm text-rose-200">
          {run.error ?? "The run failed."}
        </div>
      )}
      {run.finalResult && (
        <div className="prose-result" dangerouslySetInnerHTML={{ __html: marked.parse(run.finalResult, { async: false }) as string }} />
      )}
      {files && files.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-white/35">Files produced</div>
          <div className="space-y-1.5">
            {files.map((f) => (
              <FileViewer key={f.path} runId={run.id} file={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
