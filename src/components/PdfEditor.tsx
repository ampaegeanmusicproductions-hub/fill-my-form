import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText, Download, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { detectFields, type DetectedField } from "@/lib/ai.functions";
import { consumeQuota, saveDocument } from "@/lib/quota.functions";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PDFDocument } from "pdf-lib";

type Phase = "idle" | "preparing" | "detecting" | "ready" | "exporting";

const ACCEPTED = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".docx",
  ".doc",
].join(",");

function compressCanvas(canvas: HTMLCanvasElement): string {
  // Iteratively reduce quality to target ~100KB (base64 inflated ~33%)
  const targetBytes = 130_000; // base64 length ≈ ~100KB binary
  for (const q of [0.75, 0.6, 0.5, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= targetBytes) return url;
  }
  return canvas.toDataURL("image/jpeg", 0.4);
}

async function fileToImageDataUrl(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  // HEIC/HEIF → JPEG
  let working: Blob = file;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) {
    const heic2any = (await import("heic2any")).default;
    working = (await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 })) as Blob;
  }

  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    return await renderPdfFirstPage(file);
  }

  // Image (or converted HEIC): draw to canvas, max width 1500px
  const url = URL.createObjectURL(working);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    const maxW = 1500;
    const scale = Math.min(1, maxW / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = compressCanvas(canvas);
    console.log("[PdfEditor] image prepared:", canvas.width, "x", canvas.height, "size:", Math.round(dataUrl.length / 1024), "KB");
    return { dataUrl, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderPdfFirstPage(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const targetWidth = Math.min(1500, baseViewport.width * 1.5);
  const scale = targetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const dataUrl = compressCanvas(canvas);
  console.log("[PdfEditor] pdf prepared:", canvas.width, "x", canvas.height, "size:", Math.round(dataUrl.length / 1024), "KB");
  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
  };
}

export function PdfEditor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [fields, setFields] = useState<DetectedField[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [renderedScale, setRenderedScale] = useState(1);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const detect = useServerFn(detectFields);
  const consume = useServerFn(consumeQuota);
  const save = useServerFn(saveDocument);

  // Recompute display scale on resize so overlay inputs follow the displayed image
  useEffect(() => {
    if (!imgSize) return;
    const update = () => {
      const w = containerRef.current?.clientWidth ?? imgSize.w;
      setRenderedScale(Math.min(1, w / imgSize.w));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [imgSize]);

  const handleFile = useCallback(
    async (file: File) => {
      setOriginalFile(file);
      setFields([]);
      setValues({});
      setImageDataUrl(null);
      setImgSize(null);

      const lower = file.name.toLowerCase();
      if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
        toast.info("Word: σύντομα διαθέσιμο. Δοκίμασε PDF ή φωτογραφία προς το παρόν.");
        setOriginalFile(null);
        return;
      }

      try {
        setPhase("preparing");
        const { dataUrl, width, height } = await fileToImageDataUrl(file);
        setImageDataUrl(dataUrl);
        setImgSize({ w: width, h: height });

        setPhase("detecting");
        console.log("[PdfEditor] calling detectFields, dataUrl length:", dataUrl.length);
        const detected = await detect({ data: { imageDataUrl: dataUrl } });
        console.log("[PdfEditor] detectFields returned:", detected);
        const safe = Array.isArray(detected) ? detected : [];
        console.log("[PdfEditor] Detected fields:", safe.length);
        setFields(safe);
        setPhase("ready");
        if (safe.length === 0) {
          toast.error("Δεν εντοπίστηκαν πεδία. Δοκίμασε καθαρότερη εικόνα.");
        } else {
          toast.success(`Βρέθηκαν ${safe.length} πεδία.`);
        }
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : "Σφάλμα κατά την ανίχνευση. Πρόσθεσε πεδία χειροκίνητα.");
        // Keep image visible so user can add fields manually
        setFields([]);
        setPhase("ready");
      }
    },
    [detect],
  );

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  const exportPdf = async () => {
    if (!imageDataUrl || !imgSize || !originalFile) return;
    setPhase("exporting");
    try {
      // 1) Quota gate
      try {
        await consume();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("QUOTA_EXCEEDED")) {
          setUpgradeOpen(true);
          setPhase("ready");
          return;
        }
        throw e;
      }

      // 2) Composite: original page + user text on top → single image → PDF page
      const baseImg = await loadImage(imageDataUrl);
      const c = document.createElement("canvas");
      c.width = imgSize.w;
      c.height = imgSize.h;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(baseImg, 0, 0, c.width, c.height);
      ctx.fillStyle = "#0a1f44";
      for (const [idx, field] of fields.entries()) {
        const text = values[idx];
        if (!text) continue;
        const fontPx = Math.max(12, Math.round(field.height * 0.7));
        ctx.font = `${fontPx}px Manrope, "Segoe UI", Arial, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(text, field.x + 4, field.y + field.height / 2);
      }
      const finalDataUrl = c.toDataURL("image/jpeg", 0.92);
      const finalBytes = await (await fetch(finalDataUrl)).arrayBuffer();

      // 3) Build PDF
      const pdfDoc = await PDFDocument.create();
      const jpg = await pdfDoc.embedJpg(finalBytes);
      const page = pdfDoc.addPage([imgSize.w, imgSize.h]);
      page.drawImage(jpg, { x: 0, y: 0, width: imgSize.w, height: imgSize.h });
      const pdfBytes = await pdfDoc.save();
      // Convert Uint8Array to Blob explicitly to satisfy BlobPart typing
      const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });

      // 4) Upload all three files to storage
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Πρέπει να είσαι συνδεδεμένος.");
      const ts = Date.now();
      const sanitize = (s: string) =>
        s
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9._-]+/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 80) || "file";
      const safeFullName = sanitize(originalFile.name);
      const baseName = sanitize(originalFile.name.replace(/\.[^.]+$/, ""));
      const folder = `${user.id}/${ts}_${baseName}`;

      const originalPath = `${folder}/original_${safeFullName}`;
      const normalizedPath = `${folder}/normalized.pdf`;
      const filledPath = `${folder}/filled.pdf`;

      const normalizedDoc = await PDFDocument.create();
      const normJpg = await normalizedDoc.embedJpg(
        await (await fetch(imageDataUrl)).arrayBuffer(),
      );
      const np = normalizedDoc.addPage([imgSize.w, imgSize.h]);
      np.drawImage(normJpg, { x: 0, y: 0, width: imgSize.w, height: imgSize.h });
      const normalizedBytes = await normalizedDoc.save();
      const normalizedBlob = new Blob([new Uint8Array(normalizedBytes)], {
        type: "application/pdf",
      });

      const ups = await Promise.all([
        supabase.storage.from("originals").upload(originalPath, originalFile, { upsert: true }),
        supabase.storage.from("normalized").upload(normalizedPath, normalizedBlob, { upsert: true }),
        supabase.storage.from("filled").upload(filledPath, pdfBlob, { upsert: true }),
      ]);
      for (const u of ups) if (u.error) throw new Error(u.error.message);

      // 5) DB record
      await save({
        data: {
          name: baseName,
          originalFilePath: originalPath,
          normalizedPdfPath: normalizedPath,
          filledFilePath: filledPath,
          fields: fields.map((f, i) => ({ ...f, value: values[i] ?? "" })),
        },
      });

      // 6) Trigger download
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${originalFile.name.replace(/\.[^.]+$/, "")}-συμπληρωμένο.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Έτοιμο! Το αρχείο κατέβηκε και αποθηκεύτηκε στο ιστορικό σου.");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Σφάλμα κατά την εξαγωγή.");
    } finally {
      setPhase("ready");
    }
  };

  // === RENDER ===
  if (!imageDataUrl) {
    return (
      <>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="border-2 border-dashed rounded-2xl p-12 sm:p-20 text-center bg-card hover:border-primary transition cursor-pointer"
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={onPickFile}
          />
          {phase === "preparing" || phase === "detecting" ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div className="font-medium">
                {phase === "preparing" ? "Επεξεργασία αρχείου…" : "Το AI εντοπίζει πεδία…"}
              </div>
              {phase === "detecting" && (
                <div className="text-xs text-muted-foreground">Μπορεί να πάρει 20–30 δευτερόλεπτα</div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Upload className="h-7 w-7" />
              </div>
              <div className="font-semibold text-lg">Σύρετε ή επιλέξτε αρχείο</div>
              <div className="text-sm text-muted-foreground max-w-md">
                PDF, εικόνα ή φωτογραφία από κινητό. Όλα τα κοινά formats υποστηρίζονται.
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  const displayW = (imgSize?.w ?? 0) * renderedScale;
  const displayH = (imgSize?.h ?? 0) * renderedScale;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          {originalFile?.name}
          <span>·</span>
          <Sparkles className="h-4 w-4 text-gold" />
          {fields.length} πεδία
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setImageDataUrl(null); setOriginalFile(null); setFields([]); setValues({}); setPhase("idle"); }}>
            Νέο αρχείο
          </Button>
          <Button onClick={exportPdf} disabled={phase === "exporting"}>
            {phase === "exporting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Εξαγωγή PDF
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="relative mx-auto bg-card rounded-xl shadow-sm border overflow-hidden" style={{ width: displayW, height: displayH }}>
        <img src={imageDataUrl} alt="Έγγραφο" style={{ width: displayW, height: displayH, display: "block" }} />
        {fields.map((f, i) => (
          <input
            key={i}
            value={values[i] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [i]: e.target.value }))}
            placeholder={f.label}
            title={f.label}
            className="absolute z-10 bg-primary/5 hover:bg-primary/10 focus:bg-background border border-primary/40 focus:border-primary rounded-sm px-1 outline-none text-foreground"
            style={{
              left: f.x * renderedScale,
              top: f.y * renderedScale,
              width: f.width * renderedScale,
              height: f.height * renderedScale,
              fontSize: Math.max(10, f.height * renderedScale * 0.6),
            }}
          />
        ))}
      </div>

      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} onResolved={exportPdf} />
    </>
  );
}
