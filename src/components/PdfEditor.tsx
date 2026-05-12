import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import DOMPurify from "dompurify";
import { Loader2, Upload, Download, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recreateAsHtml } from "@/lib/recreate-html";
import { supabase } from "@/integrations/supabase/client";
import { saveDocument } from "@/lib/quota.functions";
import { unwrapServerFn } from "@/lib/server-fn-client";

type Phase = "idle" | "recreating" | "ready" | "exporting";

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp";

const uid = () => Math.random().toString(36).slice(2, 10);

export function PdfEditor() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("document");
  const [originalPath, setOriginalPath] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveDocFn = useServerFn(saveDocument);

  const handleFile = async (file: File) => {
    setError(null);
    setHtml(null);
    setOriginalPath(null);
    setPhase("recreating");
    setFileName(file.name.replace(/\.[^.]+$/, "") || "document");
    try {
      // Upload original to storage in parallel with AI call
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      let uploadedPath: string | null = null;
      if (userId) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        const path = `${userId}/${uid()}-original.${ext}`;
        const upPromise = supabase.storage
          .from("originals")
          .upload(path, file, { contentType: file.type, upsert: false });
        // Run upload + AI concurrently
        const [upRes, raw] = await Promise.all([upPromise, recreateAsHtml(file)]);
        if (upRes.error) console.warn("upload original failed:", upRes.error.message);
        else uploadedPath = path;
        const clean = DOMPurify.sanitize(raw, {
          ADD_TAGS: ["input", "textarea", "style"],
          ADD_ATTR: ["style", "value", "type", "placeholder", "rows", "cols", "name"],
        });
        setHtml(clean);
      } else {
        const raw = await recreateAsHtml(file);
        const clean = DOMPurify.sanitize(raw, {
          ADD_TAGS: ["input", "textarea", "style"],
          ADD_ATTR: ["style", "value", "type", "placeholder", "rows", "cols", "name"],
        });
        setHtml(clean);
      }
      setOriginalPath(uploadedPath);
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
    setOriginalPath(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const exportPdf = async () => {
    if (!previewRef.current) return;
    setPhase("exporting");
    try {
      previewRef.current.querySelectorAll("input").forEach((el) => {
        el.setAttribute("value", (el as HTMLInputElement).value);
      });
      previewRef.current.querySelectorAll("textarea").forEach((el) => {
        el.textContent = (el as HTMLTextAreaElement).value;
      });

      const html2pdf = (await import("html2pdf.js")).default;
      const worker = html2pdf()
        .from(previewRef.current)
        .set({
          margin: 10,
          filename: `${fileName}-filled.pdf`,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        });

      // Generate as blob, save locally + upload + record in DB
      const pdfBlob: Blob = await worker.outputPdf("blob");

      // Trigger local download
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}-filled.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Save to history
      try {
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth.user?.id;
        if (userId && originalPath) {
          const filledPath = `${userId}/${uid()}-filled.pdf`;
          const upRes = await supabase.storage
            .from("filled")
            .upload(filledPath, pdfBlob, { contentType: "application/pdf", upsert: false });
          if (upRes.error) throw new Error(upRes.error.message);
          const saved = await saveDocFn({
            data: {
              name: fileName,
              originalFilePath: originalPath,
              filledFilePath: filledPath,
              fields: [],
            },
          });
          unwrapServerFn(saved);
          toast.success("Το PDF αποθηκεύτηκε στο ιστορικό σου");
        } else {
          toast.success("Το PDF κατέβηκε");
        }
      } catch (e) {
        console.warn("save history failed:", e);
        toast.success("Το PDF κατέβηκε", {
          description: "Δεν αποθηκεύτηκε στο ιστορικό",
        });
      }
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
