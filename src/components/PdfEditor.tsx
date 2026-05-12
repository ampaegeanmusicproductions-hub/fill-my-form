import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useBlocker } from "@tanstack/react-router";
import * as fabric from "fabric";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Loader2, Upload, FileText, Download, Type, Trash2, Undo2, Redo2, Crop, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { consumeQuota, saveDocument } from "@/lib/quota.functions";
import { unwrapServerFn } from "@/lib/server-fn-client";
import { UpgradeModal } from "@/components/UpgradeModal";
import { CropPreview } from "@/components/CropPreview";

type Phase = "idle" | "preparing" | "cropping" | "ready" | "exporting";

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";
const MAX_W = 1400;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderToImage(file: File): Promise<{ dataUrl: string; w: number; h: number }> {
  const lower = file.name.toLowerCase();
  let working: Blob = file;
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) {
    const heic2any = (await import("heic2any")).default;
    working = (await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 })) as Blob;
  }

  if (lower.endsWith(".pdf") || file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_W / base.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), w: canvas.width, h: canvas.height };
  }

  const url = URL.createObjectURL(working);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_W / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL("image/jpeg", 0.92), w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sanitize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "file";

export function PdfEditor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const historyRef = useRef<{ stack: string[]; idx: number; suspend: boolean }>({ stack: [], idx: -1, suspend: false });
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [bg, setBg] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [originalBg, setOriginalBg] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [scale, setScale] = useState(1);
  const [fontSize, setFontSize] = useState(20);
  const [color, setColor] = useState("#000000");
  const [removeTextBg, setRemoveTextBg] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const consume = useServerFn(consumeQuota);
  const save = useServerFn(saveDocument);
  const [chips, setChips] = useState<{ label: string; value: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadProfileFor = async (userId: string) => {
      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle();
        if (error || !profile || cancelled) return;
        const prof = profile as unknown as Record<string, string | null>;
        const fullAddress = [prof.address_street, prof.address_number].filter(Boolean).join(" ").trim();
        const fullCity = [prof.address_postal, prof.address_city].filter(Boolean).join(" ").trim();
        const items: { label: string; value: string }[] = [
          { label: "Ονοματεπώνυμο", value: prof.full_name ?? "" },
          { label: "Πατρός", value: prof.father_name ?? "" },
          { label: "Μητρός", value: prof.mother_name ?? "" },
          { label: "ΑΦΜ", value: prof.afm ?? "" },
          { label: "ΑΜΚΑ", value: prof.amka ?? "" },
          { label: "Ταυτότητα", value: prof.id_number ?? "" },
          { label: "Τηλέφωνο", value: prof.phone ?? "" },
          { label: "Διεύθυνση", value: fullAddress },
          { label: "Πόλη", value: fullCity },
          { label: "Νομός", value: prof.address_region ?? "" },
          { label: "Ημ. Γέννησης", value: prof.birth_date ?? "" },
          { label: "Τόπος Γέννησης", value: prof.birth_place ?? "" },
        ].filter((c) => c.value.trim().length > 0);
        setChips(items);
      } catch {
        /* ignore */
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session?.user) loadProfileFor(data.session.user.id);
    }).catch(() => { /* guest mode */ });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      if (session?.user) loadProfileFor(session.user.id);
      else setChips([]);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  // Init / reinit fabric when bg changes
  useEffect(() => {
    if (!bg || !canvasElRef.current) return;
    const c = new fabric.Canvas(canvasElRef.current, {
      width: bg.w,
      height: bg.h,
      backgroundColor: "rgba(0,0,0,0)",
      selection: true,
      preserveObjectStacking: true,
    });
    fabricRef.current = c;

    const pushHistory = () => {
      const h = historyRef.current;
      if (h.suspend) return;
      const json = JSON.stringify(c.toJSON());
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(json);
      h.idx = h.stack.length - 1;
      if (h.stack.length > 50) {
        h.stack.shift();
        h.idx--;
      }
    };
    pushHistory();
    c.on("object:added", pushHistory);
    c.on("object:modified", pushHistory);
    c.on("object:removed", pushHistory);

    // Restore from localStorage if present
    try {
      const key = `autodilosi:draft:${bg.dataUrl.slice(-32)}`;
      const draft = localStorage.getItem(key);
      if (draft) {
        historyRef.current.suspend = true;
        c.loadFromJSON(JSON.parse(draft), () => {
          c.renderAll();
          historyRef.current.suspend = false;
          pushHistory();
        });
      }
    } catch {}

    return () => {
      c.dispose();
      fabricRef.current = null;
      historyRef.current = { stack: [], idx: -1, suspend: false };
    };
  }, [bg]);

  // Responsive scale
  useEffect(() => {
    if (!bg) return;
    const update = () => {
      const w = wrapperRef.current?.clientWidth ?? bg.w;
      const maxH = Math.max(360, window.innerHeight - 240);
      setScale(Math.min(1, w / bg.w, maxH / bg.h));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [bg]);

  // Keyboard: undo / delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!fabricRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const obj = fabricRef.current.getActiveObject();
        if (obj && !(obj as fabric.IText).isEditing) {
          fabricRef.current.remove(obj);
          fabricRef.current.discardActiveObject();
          fabricRef.current.requestRenderAll();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-save every 30s to localStorage
  useEffect(() => {
    if (!bg) return;
    autoSaveTimerRef.current = setInterval(() => {
      if (!fabricRef.current) return;
      try {
        const key = `autodilosi:draft:${bg.dataUrl.slice(-32)}`;
        localStorage.setItem(key, JSON.stringify(fabricRef.current.toJSON()));
      } catch {}
    }, 30_000);
    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [bg]);

  const undo = () => {
    const c = fabricRef.current;
    const h = historyRef.current;
    if (!c || h.idx <= 0) return;
    h.idx--;
    h.suspend = true;
    c.loadFromJSON(JSON.parse(h.stack[h.idx]), () => {
      c.renderAll();
      h.suspend = false;
    });
  };
  const redo = () => {
    const c = fabricRef.current;
    const h = historyRef.current;
    if (!c || h.idx >= h.stack.length - 1) return;
    h.idx++;
    h.suspend = true;
    c.loadFromJSON(JSON.parse(h.stack[h.idx]), () => {
      c.renderAll();
      h.suspend = false;
    });
  };

  const handleFile = useCallback(async (file: File) => {
    setOriginalFile(file);
    setBg(null);
    setOriginalBg(null);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
      toast.info("Word: σύντομα διαθέσιμο. Δοκίμασε PDF ή φωτογραφία προς το παρόν.");
      setOriginalFile(null);
      return;
    }
    setPhase("preparing");
    const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";
    try {
      const out = await renderToImage(file);
      setOriginalBg(out);
      if (isPdf) {
        // PDFs are already clean documents — skip crop UI entirely
        setBg(out);
        setPhase("ready");
      } else {
        setPhase("cropping");
      }
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Σφάλμα κατά τη φόρτωση.");
      setPhase("idle");
      setOriginalFile(null);
    }
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  const addTextWith = (initial: string, autoEdit = true) => {
    const c = fabricRef.current;
    if (!c) return;
    const t = new fabric.IText(initial, {
      left: c.getWidth() / 2 - 60,
      top: c.getHeight() / 2 - 12,
      fontSize,
      fill: color,
      fontFamily: "Manrope, Arial, sans-serif",
      editable: true,
      backgroundColor: "rgba(255,255,255,0.95)",
      padding: 4,
    });
    c.add(t);
    c.setActiveObject(t);
    if (autoEdit) {
      t.enterEditing();
      t.selectAll();
    }
    c.requestRenderAll();
  };

  const addTextAtCenter = () => addTextWith("Γράψε εδώ", true);

  const insertChip = (value: string) => {
    const c = fabricRef.current;
    if (!c) return;
    const a = c.getActiveObject();
    if (a && a.type === "i-text") {
      const t = a as fabric.IText;
      if (t.isEditing) {
        // Insert at caret
        const text = t.text ?? "";
        const start = t.selectionStart ?? text.length;
        const end = t.selectionEnd ?? start;
        const next = text.slice(0, start) + value + text.slice(end);
        t.set("text", next);
        t.selectionStart = start + value.length;
        t.selectionEnd = start + value.length;
      } else {
        t.set("text", value);
      }
      c.requestRenderAll();
      c.fire("object:modified", { target: t });
      return;
    }
    addTextWith(value, false);
  };

  const updateActive = (patch: Partial<{ fontSize: number; fill: string }>) => {
    const c = fabricRef.current;
    if (!c) return;
    const a = c.getActiveObject();
    if (a && a.type === "i-text") {
      a.set(patch);
      c.requestRenderAll();
      c.fire("object:modified", { target: a });
    }
  };

  const deleteSelected = () => {
    const c = fabricRef.current;
    if (!c) return;
    const a = c.getActiveObject();
    if (a) {
      c.remove(a);
      c.discardActiveObject();
      c.requestRenderAll();
    }
  };

  const exportPdf = async () => {
    if (!bg || !originalFile || !fabricRef.current) return;
    setPhase("exporting");
    let step = "init";
    try {
      step = "Έλεγχος ορίου χρήσης";
      console.log("[exportPdf]", step);
      const { data: authState } = await supabase.auth.getUser();
      const currentUser = authState.user;
      if (currentUser) {
        try {
          unwrapServerFn<{ source: "premium" | "credit" | "free" }>(await consume());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("όριο") || msg.includes("QUOTA_EXCEEDED")) {
            setUpgradeOpen(true);
            setPhase("ready");
            return;
          }
          throw e;
        }
      }

      const c = fabricRef.current;
      c.discardActiveObject();

      step = "Προετοιμασία overlay κειμένου";
      console.log("[exportPdf]", step);
      const textObjs = c.getObjects().filter((o) => o.type === "i-text") as fabric.IText[];
      const savedBgs = textObjs.map((o) => o.backgroundColor);
      if (removeTextBg) {
        textObjs.forEach((o) => o.set({ backgroundColor: "" }));
      }
      c.requestRenderAll();
      const overlay = c.toDataURL({ format: "png", multiplier: 1 });
      if (removeTextBg) {
        textObjs.forEach((o, i) => o.set({ backgroundColor: savedBgs[i] }));
        c.requestRenderAll();
      }

      step = "Φόρτωση εικόνας υποβάθρου";
      console.log("[exportPdf]", step);
      const baseImg = await loadImage(bg.dataUrl);

      step = "Σύνθεση εικόνας + κειμένου";
      console.log("[exportPdf]", step, { w: bg.w, h: bg.h, textObjects: textObjs.length });
      const out = document.createElement("canvas");
      out.width = bg.w;
      out.height = bg.h;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("Αδυναμία επεξεργασίας εικόνας (canvas 2D context).");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, bg.w, bg.h);
      octx.drawImage(baseImg, 0, 0, bg.w, bg.h);
      const overlayImg = await loadImage(overlay);
      octx.drawImage(overlayImg, 0, 0, bg.w, bg.h);
      const finalDataUrl = out.toDataURL("image/jpeg", 0.95);

      step = "Μετατροπή εικόνας σε bytes";
      console.log("[exportPdf]", step);
      const finalBytes = await (await fetch(finalDataUrl)).arrayBuffer();

      step = "Δημιουργία PDF (A4)";
      console.log("[exportPdf]", step);
      const A4 = { w: 595, h: 842 };
      const landscape = bg.w > bg.h;
      const pageW = landscape ? A4.h : A4.w;
      const pageH = landscape ? A4.w : A4.h;
      const margin = 18;
      const fit = Math.min((pageW - margin * 2) / bg.w, (pageH - margin * 2) / bg.h);
      const drawW = bg.w * fit;
      const drawH = bg.h * fit;
      const px = (pageW - drawW) / 2;
      const py = (pageH - drawH) / 2;

      const pdfDoc = await PDFDocument.create();
      const jpg = await pdfDoc.embedJpg(finalBytes);
      const page = pdfDoc.addPage([pageW, pageH]);
      page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(1, 1, 1) });
      page.drawImage(jpg, { x: px, y: py, width: drawW, height: drawH });

      step = "Αποθήκευση PDF";
      console.log("[exportPdf]", step);
      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });

      step = "Ανέβασμα στο cloud";
      console.log("[exportPdf]", step);
      try {
        const user = currentUser;
        if (user) {
          const ts = Date.now();
          const safeFull = sanitize(originalFile.name);
          const baseName = sanitize(originalFile.name.replace(/\.[^.]+$/, ""));
          const folder = `${user.id}/${ts}_${baseName}`;
          const originalPath = `${folder}/original_${safeFull}`;
          const filledPath = `${folder}/filled.pdf`;
          const normalizedPath = `${folder}/normalized.pdf`;

          const normDoc = await PDFDocument.create();
          const normBytes = await (await fetch(bg.dataUrl)).arrayBuffer();
          const normJpg = await normDoc.embedJpg(normBytes);
          const np = normDoc.addPage([bg.w, bg.h]);
          np.drawImage(normJpg, { x: 0, y: 0, width: bg.w, height: bg.h });
          const normalizedBlob = new Blob([new Uint8Array(await normDoc.save())], { type: "application/pdf" });

          await Promise.all([
            supabase.storage.from("originals").upload(originalPath, originalFile, { upsert: true }),
            supabase.storage.from("normalized").upload(normalizedPath, normalizedBlob, { upsert: true }),
            supabase.storage.from("filled").upload(filledPath, pdfBlob, { upsert: true }),
          ]);
          unwrapServerFn(await save({
            data: {
              name: baseName,
              originalFilePath: originalPath,
              normalizedPdfPath: normalizedPath,
              filledFilePath: filledPath,
              fields: (c.toJSON().objects ?? []) as unknown[],
            },
          }));
        }
      } catch (e) {
        console.warn("[exportPdf] upload/save failed (non-blocking):", e);
      }

      step = "Λήψη αρχείου";
      console.log("[exportPdf]", step);
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${originalFile.name.replace(/\.[^.]+$/, "")}-συμπληρωμένο.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Έτοιμο! Το αρχείο κατέβηκε.");
    } catch (e) {
      console.error(`[exportPdf] FAILED at step: ${step}`, e);
      const reason =
        e instanceof Error ? e.message :
        e instanceof Response ? `HTTP ${e.status}` :
        typeof e === "string" ? e : "άγνωστο σφάλμα";
      toast.error(`Σφάλμα στο βήμα “${step}”: ${reason}`);
    } finally {
      setPhase("ready");
    }
  };

  if (phase === "cropping" && originalBg) {
    return (
      <CropPreview
        dataUrl={originalBg.dataUrl}
        onConfirm={(out) => {
          setBg(out);
          setPhase("ready");
        }}
        onSkip={() => {
          setBg(originalBg);
          setPhase("ready");
        }}
      />
    );
  }

  if (!bg) {
    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="border-2 border-dashed rounded-2xl p-12 sm:p-20 text-center bg-card hover:border-primary transition cursor-pointer"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input ref={inputRef} type="file" accept={ACCEPTED} className="hidden" onChange={onPickFile} />
        {phase === "preparing" ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="font-medium">Επεξεργασία αρχείου…</div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Upload className="h-7 w-7" />
            </div>
            <div className="font-semibold text-lg">Σύρετε ή επιλέξτε αρχείο</div>
            <div className="text-sm text-muted-foreground max-w-md">
              PDF, εικόνα ή φωτογραφία από κινητό. Πάτα οπουδήποτε για να γράψεις.
            </div>
          </div>
        )}
      </div>
    );
  }

  const displayW = bg.w * scale;
  const displayH = bg.h * scale;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-xl border bg-card">
        <Button size="sm" onClick={addTextAtCenter}>
          <Type className="h-4 w-4 mr-1" /> Προσθήκη κειμένου
        </Button>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 max-w-full">
            <span className="text-xs text-muted-foreground pl-1">Γρήγορη συμπλήρωση:</span>
            {chips.map((ch) => (
              <button
                key={ch.label}
                type="button"
                onClick={() => insertChip(ch.value)}
                title={ch.value}
                className="inline-flex items-center rounded-full border bg-secondary/60 hover:bg-secondary text-secondary-foreground px-2 py-0.5 text-xs transition-colors"
              >
                {ch.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 px-2">
          <span className="text-xs text-muted-foreground w-10">{fontSize}px</span>
          <Slider
            value={[fontSize]}
            min={10}
            max={48}
            step={1}
            onValueChange={(v) => {
              setFontSize(v[0]);
              updateActive({ fontSize: v[0] });
            }}
            className="w-32"
          />
        </div>
        <input
          type="color"
          value={color}
          onChange={(e) => {
            setColor(e.target.value);
            updateActive({ fill: e.target.value });
          }}
          className="h-8 w-10 rounded border cursor-pointer"
          title="Χρώμα"
        />
        <Button size="sm" variant="outline" onClick={undo} title="Αναίρεση (Ctrl+Z)">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={redo} title="Επανάληψη (Ctrl+Y)">
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={deleteSelected}>
          <Trash2 className="h-4 w-4 mr-1" /> Διαγραφή
        </Button>
        {originalBg && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPhase("cropping")}
            title="Ρύθμιση περιοχής εγγράφου"
          >
            <Crop className="h-4 w-4 mr-1" /> Περικοπή
          </Button>
        )}
        {originalBg && bg && originalBg.dataUrl !== bg.dataUrl && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBg(originalBg)}
            title="Χρήση αρχικής εικόνας χωρίς περικοπή"
          >
            <RotateCcw className="h-4 w-4 mr-1" /> Επαναφορά εικόνας
          </Button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer pl-2">
          <Checkbox
            checked={removeTextBg}
            onCheckedChange={(v) => setRemoveTextBg(v === true)}
          />
          Χωρίς λευκό background στο PDF
        </label>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {originalFile?.name}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setBg(null);
            setOriginalBg(null);
            setOriginalFile(null);
            setPhase("idle");
          }}
        >
          Νέο αρχείο
        </Button>
        <Button size="sm" onClick={exportPdf} disabled={phase === "exporting"}>
          {phase === "exporting" ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Download className="h-4 w-4 mr-1" />
          )}
          Εξαγωγή PDF
        </Button>
      </div>

      <div
        ref={wrapperRef}
        className="relative mx-auto rounded-xl border bg-card shadow-sm overflow-hidden"
        style={{ width: "100%", maxWidth: bg.w }}
      >
        <div
          className="relative mx-auto"
          style={{
            width: displayW,
            height: displayH,
          }}
        >
          <img
            src={bg.dataUrl}
            alt="Έγγραφο"
            className="absolute inset-0 pointer-events-none select-none"
            style={{ width: displayW, height: displayH }}
          />
          <div
            style={{
              width: bg.w,
              height: bg.h,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            <canvas ref={canvasElRef} />
          </div>
        </div>
      </div>

      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} onResolved={exportPdf} />
    </>
  );
}
