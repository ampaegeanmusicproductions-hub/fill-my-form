import { useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Loader2, Upload, Download, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recreateAsHtml } from "@/lib/recreate-html";

type Phase = "idle" | "recreating" | "ready" | "exporting";

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp";

export function PdfEditor() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("document");
  const previewRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setHtml(null);
    setPhase("recreating");
    setFileName(file.name.replace(/\.[^.]+$/, "") || "document");
    try {
      const raw = await recreateAsHtml(file);
      const clean = DOMPurify.sanitize(raw, {
        ADD_TAGS: ["input", "textarea", "style"],
        ADD_ATTR: ["style", "value", "type", "placeholder", "rows", "cols", "name"],
      });
      setHtml(clean);
      setPhase("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase("idle");
      toast.error("Αποτυχία αναδημιουργίας", { description: msg });
    }
  };

  const reset = () => {
    setPhase("idle");
    setHtml(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const exportPdf = async () => {
    if (!previewRef.current) return;
    setPhase("exporting");
    try {
      // Sync input/textarea DOM state into attributes so html2canvas sees them
      previewRef.current.querySelectorAll("input").forEach((el) => {
        el.setAttribute("value", (el as HTMLInputElement).value);
      });
      previewRef.current.querySelectorAll("textarea").forEach((el) => {
        el.textContent = (el as HTMLTextAreaElement).value;
      });

      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .from(previewRef.current)
        .set({
          margin: 10,
          filename: `${fileName}-filled.pdf`,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .save();
      toast.success("Το PDF κατέβηκε");
    } catch (e) {
      toast.error("Αποτυχία εξαγωγής", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPhase("ready");
    }
  };

  // ─── UI ─────────────────────────────────────────────────────────────────────
  if (phase === "recreating") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <div className="text-lg font-medium flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> Αναδημιουργία εγγράφου…
        </div>
        <div className="text-sm text-muted-foreground">Αυτό μπορεί να πάρει 10–30 δευτερόλεπτα</div>
      </div>
    );
  }

  if (phase === "ready" || phase === "exporting") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button variant="outline" onClick={reset}>
            <RefreshCw className="w-4 h-4 mr-1" /> Νέο
          </Button>
          <Button onClick={exportPdf} disabled={phase === "exporting"}>
            {phase === "exporting" ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-1" />
            )}
            Εξαγωγή PDF
          </Button>
        </div>
        <div
          ref={previewRef}
          className="bg-white shadow-lg rounded p-8 max-w-[800px] mx-auto text-black"
          dangerouslySetInnerHTML={{ __html: html ?? "" }}
        />
      </div>
    );
  }

  // idle
  return (
    <div className="space-y-4">
      <label
        htmlFor="file-input"
        className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg py-16 px-6 cursor-pointer hover:bg-accent/40 transition-colors text-center"
      >
        <Upload className="w-10 h-10 mb-3 text-muted-foreground" />
        <div className="font-medium">Σύρε ένα αρχείο ή πάτα για επιλογή</div>
        <div className="text-sm text-muted-foreground mt-1">PDF, JPG, PNG, WebP</div>
        <input
          ref={inputRef}
          id="file-input"
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </label>
      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
