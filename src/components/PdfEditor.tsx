import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useBlocker } from "@tanstack/react-router";
import * as fabric from "fabric";
import { PDFDocument, rgb } from "pdf-lib";
import { Loader2, Upload, FileText, Download, Type, Trash2, Undo2, Redo2, Crop, RotateCcw, User, PenLine, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { consumeQuota, saveDocument } from "@/lib/quota.functions";
import { unwrapServerFn } from "@/lib/server-fn-client";
import { UpgradeModal } from "@/components/UpgradeModal";
import { CropPreview } from "@/components/CropPreview";
import { SignaturePad } from "@/components/SignaturePad";

type Phase = "idle" | "preparing" | "cropping" | "ready" | "exporting";

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";
const MAX_W = 1400;

const QUICK_LABELS = ["Ονοματεπώνυμο", "ΑΦΜ", "ΑΔΤ", "Διεύθυνση", "Τηλέφωνο", "Ημερομηνία"] as const;

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

const todayGr = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

export function PdfEditor() {
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const historyRef = useRef<{ stack: string[]; idx: number; suspend: boolean }>({ stack: [], idx: -1, suspend: false });
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tapModeRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [bg, setBg] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [originalBg, setOriginalBg] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [scale, setScale] = useState(1);
  const [fontSize, setFontSize] = useState(20);
  const [color, setColor] = useState("#000000");
  const [removeTextBg, setRemoveTextBg] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Mobile UI state
  const [textSheet, setTextSheet] = useState<{ open: boolean; value: string; pos: { x: number; y: number } | null; editing: fabric.IText | null }>({ open: false, value: "", pos: null, editing: null });
  const [quickSheet, setQuickSheet] = useState(false);
  const [sigSheet, setSigSheet] = useState(false);
  const [editSheet, setEditSheet] = useState<{ open: boolean; target: fabric.Object | null }>({ open: false, target: null });
  const [selectedObj, setSelectedObj] = useState<fabric.Object | null>(null);
  const [pinching, setPinching] = useState(false);

  const consume = useServerFn(consumeQuota);
  const save = useServerFn(saveDocument);
  const [chips, setChips] = useState<{ label: string; value: string }[]>([]);

  useBlocker({
    shouldBlockFn: () => {
      if (phase === "idle") return false;
      if (typeof window === "undefined") return false;
      return !window.confirm("Έχεις έγγραφο σε επεξεργασία. Έξοδος χωρίς εξαγωγή PDF;");
    },
    enableBeforeUnload: () => phase !== "idle" && phase !== "exporting",
  });

  // Profile chips (only when logged in)
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
          { label: "ΑΔΤ", value: prof.id_number ?? "" },
          { label: "Τηλέφωνο", value: prof.phone ?? "" },
          { label: "Διεύθυνση", value: fullAddress },
          { label: "Πόλη", value: fullCity },
          { label: "Νομός", value: prof.address_region ?? "" },
          { label: "Ημ. Γέννησης", value: prof.birth_date ?? "" },
          { label: "Τόπος Γέννησης", value: prof.birth_place ?? "" },
        ].filter((c) => c.value.trim().length > 0);
        setChips(items);
      } catch { /* ignore */ }
    };
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session?.user) loadProfileFor(data.session.user.id);
    }).catch(() => { /* guest */ });
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

    // Bigger touch targets on mobile + no resize/rotate handles on mobile
    fabric.InteractiveFabricObject.ownDefaults = {
      ...fabric.InteractiveFabricObject.ownDefaults,
      cornerSize: isMobile ? 0 : 12,
      touchCornerSize: isMobile ? 0 : 24,
      transparentCorners: false,
      cornerColor: "#1f4cff",
      cornerStrokeColor: "#fff",
      borderColor: "#1f4cff",
      hasControls: !isMobile,
    };

    const pushHistory = () => {
      const h = historyRef.current;
      if (h.suspend) return;
      const json = JSON.stringify(c.toJSON());
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(json);
      h.idx = h.stack.length - 1;
      if (h.stack.length > 50) { h.stack.shift(); h.idx--; }
    };
    pushHistory();
    c.on("object:added", pushHistory);
    c.on("object:modified", pushHistory);
    c.on("object:removed", pushHistory);

    // Mobile: tap empty area → text sheet; tap object → selection (no auto edit sheet, use floating bar)
    c.on("mouse:down", (opt) => {
      if (!isMobile) return;
      if (opt.target) return;
      const o = opt as unknown as { absolutePointer?: { x: number; y: number }; pointer?: { x: number; y: number } };
      const p = o.absolutePointer ?? o.pointer;
      if (!p) return;
      setTextSheet({ open: true, value: "", pos: { x: p.x, y: p.y }, editing: null });
    });

    // Track selection for floating action bar
    const onSel = () => setSelectedObj(c.getActiveObject() ?? null);
    const onClr = () => setSelectedObj(null);
    c.on("selection:created", onSel);
    c.on("selection:updated", onSel);
    c.on("selection:cleared", onClr);

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
  }, [bg, isMobile]);

  // Responsive scale
  useEffect(() => {
    if (!bg) return;
    const update = () => {
      const w = wrapperRef.current?.clientWidth ?? bg.w;
      const reserved = isMobile ? 200 : 240;
      const maxH = Math.max(360, window.innerHeight - reserved);
      setScale(Math.min(1, w / bg.w, maxH / bg.h));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [bg, isMobile]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!fabricRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault(); e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redo();
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

  // Auto-save
  useEffect(() => {
    if (!bg) return;
    autoSaveTimerRef.current = setInterval(() => {
      if (!fabricRef.current) return;
      try {
        const key = `autodilosi:draft:${bg.dataUrl.slice(-32)}`;
        localStorage.setItem(key, JSON.stringify(fabricRef.current.toJSON()));
      } catch {}
    }, 30_000);
    return () => { if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current); };
  }, [bg]);

  const undo = () => {
    const c = fabricRef.current; const h = historyRef.current;
    if (!c || h.idx <= 0) return;
    h.idx--; h.suspend = true;
    c.loadFromJSON(JSON.parse(h.stack[h.idx]), () => { c.renderAll(); h.suspend = false; });
  };
  const redo = () => {
    const c = fabricRef.current; const h = historyRef.current;
    if (!c || h.idx >= h.stack.length - 1) return;
    h.idx++; h.suspend = true;
    c.loadFromJSON(JSON.parse(h.stack[h.idx]), () => { c.renderAll(); h.suspend = false; });
  };

  const handleFile = useCallback(async (file: File) => {
    setOriginalFile(file); setBg(null); setOriginalBg(null);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
      toast.info("Word: σύντομα διαθέσιμο. Δοκίμασε PDF ή φωτογραφία προς το παρόν.");
      setOriginalFile(null); return;
    }
    setPhase("preparing");
    const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";
    try {
      const out = await renderToImage(file);
      setOriginalBg(out);
      if (isPdf) { setBg(out); setPhase("ready"); }
      else { setPhase("cropping"); }
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Σφάλμα κατά τη φόρτωση.");
      setPhase("idle"); setOriginalFile(null);
    }
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) void handleFile(f);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f);
  };

  const placeTextAt = (text: string, pos: { x: number; y: number } | null, size = fontSize) => {
    const c = fabricRef.current; if (!c) return;
    const x = pos?.x ?? c.getWidth() / 2;
    const y = pos?.y ?? c.getHeight() / 2;
    const t = new fabric.IText(text || "Γράψε εδώ", {
      left: x, top: y - size / 2, originX: "left", originY: "top",
      fontSize: size, fill: color,
      fontFamily: "Manrope, Arial, sans-serif",
      editable: true,
      backgroundColor: "rgba(255,255,255,0.95)",
      padding: 4,
    });
    c.add(t); c.setActiveObject(t); c.requestRenderAll();
  };

  const placeImageAt = async (dataUrl: string, pos: { x: number; y: number } | null, maxW = 220) => {
    const c = fabricRef.current; if (!c) return;
    const img = await loadImage(dataUrl);
    const scaleF = Math.min(1, maxW / img.naturalWidth);
    const fImg = new fabric.FabricImage(img, {
      left: pos?.x ?? c.getWidth() / 2 - (img.naturalWidth * scaleF) / 2,
      top: pos?.y ?? c.getHeight() / 2 - (img.naturalHeight * scaleF) / 2,
      scaleX: scaleF, scaleY: scaleF,
    });
    c.add(fImg); c.setActiveObject(fImg); c.requestRenderAll();
  };

  // Desktop chip insert (insert at caret if editing)
  const insertChip = (value: string) => {
    const c = fabricRef.current; if (!c) return;
    const a = c.getActiveObject();
    if (a && a.type === "i-text") {
      const t = a as fabric.IText;
      if (t.isEditing) {
        const text = t.text ?? "";
        const start = t.selectionStart ?? text.length;
        const end = t.selectionEnd ?? start;
        const next = text.slice(0, start) + value + text.slice(end);
        t.set("text", next);
        t.selectionStart = start + value.length;
        t.selectionEnd = start + value.length;
      } else { t.set("text", value); }
      c.requestRenderAll();
      c.fire("object:modified", { target: t });
      return;
    }
    placeTextAt(value, null);
  };

  const updateActive = (patch: Partial<{ fontSize: number; fill: string }>) => {
    const c = fabricRef.current; if (!c) return;
    const a = c.getActiveObject();
    if (a && a.type === "i-text") {
      a.set(patch); c.requestRenderAll();
      c.fire("object:modified", { target: a });
    }
  };

  const deleteSelected = () => {
    const c = fabricRef.current; if (!c) return;
    const a = c.getActiveObject();
    if (a) { c.remove(a); c.discardActiveObject(); c.requestRenderAll(); }
  };

  const startTapMode = () => {
    tapModeRef.current = true;
    setTapMode(true);
    toast.message("Πάτα στο σημείο του εγγράφου για να γράψεις.");
  };

  const handleQuickInsert = (label: string, value: string) => {
    setQuickSheet(false);
    if (label === "Ημερομηνία" && !value) value = todayGr();
    setTextSheet({ open: true, value, pos: null, editing: null });
  };

  const exportPdf = async () => {
    if (!bg || !originalFile || !fabricRef.current) return;
    setPhase("exporting");
    let step = "init";
    try {
      step = "Έλεγχος ορίου χρήσης";
      const { data: authState } = await supabase.auth.getUser();
      const currentUser = authState.user;
      if (currentUser) {
        try {
          unwrapServerFn<{ source: "premium" | "credit" | "free" }>(await consume());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("όριο") || msg.includes("QUOTA_EXCEEDED")) {
            setUpgradeOpen(true); setPhase("ready"); return;
          }
          throw e;
        }
      }
      const c = fabricRef.current;
      c.discardActiveObject();
      step = "Προετοιμασία overlay κειμένου";
      const textObjs = c.getObjects().filter((o) => o.type === "i-text") as fabric.IText[];
      const savedBgs = textObjs.map((o) => o.backgroundColor);
      if (removeTextBg) textObjs.forEach((o) => o.set({ backgroundColor: "" }));
      c.requestRenderAll();
      const overlay = c.toDataURL({ format: "png", multiplier: 1 });
      if (removeTextBg) {
        textObjs.forEach((o, i) => o.set({ backgroundColor: savedBgs[i] }));
        c.requestRenderAll();
      }
      step = "Φόρτωση εικόνας υποβάθρου";
      const baseImg = await loadImage(bg.dataUrl);
      step = "Σύνθεση εικόνας + κειμένου";
      const out = document.createElement("canvas");
      out.width = bg.w; out.height = bg.h;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("Αδυναμία επεξεργασίας εικόνας (canvas 2D context).");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, bg.w, bg.h);
      octx.drawImage(baseImg, 0, 0, bg.w, bg.h);
      const overlayImg = await loadImage(overlay);
      octx.drawImage(overlayImg, 0, 0, bg.w, bg.h);
      const finalDataUrl = out.toDataURL("image/jpeg", 0.95);
      step = "Μετατροπή εικόνας σε bytes";
      const finalBytes = await (await fetch(finalDataUrl)).arrayBuffer();
      step = "Δημιουργία PDF (A4)";
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
      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      step = "Ανέβασμα στο cloud";
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
              name: baseName, originalFilePath: originalPath,
              normalizedPdfPath: normalizedPath, filledFilePath: filledPath,
              fields: (c.toJSON().objects ?? []) as unknown[],
            },
          }));
        }
      } catch (e) { console.warn("[exportPdf] upload/save failed (non-blocking):", e); }
      step = "Λήψη αρχείου";
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
    } finally { setPhase("ready"); }
  };

  if (phase === "cropping" && originalBg) {
    return (
      <CropPreview
        dataUrl={originalBg.dataUrl}
        onConfirm={(out) => { setBg(out); setPhase("ready"); }}
        onSkip={() => { setBg(originalBg); setPhase("ready"); }}
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

  // Quick chips list (logged-in profile values OR empty placeholders)
  const profileMap = new Map(chips.map((c) => [c.label, c.value]));
  const quickItems = QUICK_LABELS.map((label) => ({ label, value: profileMap.get(label) ?? "" }));

  return (
    <>
      {/* Desktop toolbar */}
      {!isMobile && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-xl border bg-card">
          <Button size="sm" onClick={() => placeTextAt("Γράψε εδώ", null)}>
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
              value={[fontSize]} min={10} max={48} step={1}
              onValueChange={(v) => { setFontSize(v[0]); updateActive({ fontSize: v[0] }); }}
              className="w-32"
            />
          </div>
          <input
            type="color" value={color}
            onChange={(e) => { setColor(e.target.value); updateActive({ fill: e.target.value }); }}
            className="h-8 w-10 rounded border cursor-pointer" title="Χρώμα"
          />
          <Button size="sm" variant="outline" onClick={undo}><Undo2 className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={redo}><Redo2 className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={deleteSelected}>
            <Trash2 className="h-4 w-4 mr-1" /> Διαγραφή
          </Button>
          {originalBg && (
            <Button size="sm" variant="outline" onClick={() => setPhase("cropping")}>
              <Crop className="h-4 w-4 mr-1" /> Περικοπή
            </Button>
          )}
          {originalBg && bg && originalBg.dataUrl !== bg.dataUrl && (
            <Button size="sm" variant="outline" onClick={() => setBg(originalBg)}>
              <RotateCcw className="h-4 w-4 mr-1" /> Επαναφορά
            </Button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer pl-2">
            <Checkbox checked={removeTextBg} onCheckedChange={(v) => setRemoveTextBg(v === true)} />
            Χωρίς λευκό background
          </label>
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> {originalFile?.name}
          </div>
          <Button size="sm" variant="outline" onClick={() => {
            setBg(null); setOriginalBg(null); setOriginalFile(null); setPhase("idle");
          }}>Νέο αρχείο</Button>
          <Button size="sm" onClick={exportPdf} disabled={phase === "exporting"}>
            {phase === "exporting" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
            Εξαγωγή PDF
          </Button>
        </div>
      )}

      {/* Mobile tap-mode banner */}
      {isMobile && tapMode && (
        <div className="mb-2 rounded-lg bg-primary/10 text-primary text-sm font-medium px-3 py-2 text-center">
          Πάτα στο σημείο του εγγράφου για να γράψεις
          <button className="ml-3 underline" onClick={() => { tapModeRef.current = false; setTapMode(false); }}>Άκυρο</button>
        </div>
      )}

      <div
        ref={wrapperRef}
        className="relative mx-auto rounded-xl border bg-card shadow-sm overflow-hidden"
        style={{ width: "100%", maxWidth: bg.w, paddingBottom: isMobile ? 88 : 0 }}
      >
        <div
          className="relative mx-auto"
          style={{ width: displayW, height: displayH, cursor: tapMode ? "crosshair" : "default" }}
        >
          <img
            src={bg.dataUrl} alt="Έγγραφο"
            className="absolute inset-0 pointer-events-none select-none"
            style={{ width: displayW, height: displayH }}
          />
          <div
            style={{
              width: bg.w, height: bg.h,
              transform: `scale(${scale})`, transformOrigin: "top left",
              position: "absolute", top: 0, left: 0,
            }}
          >
            <canvas ref={canvasElRef} />
          </div>
        </div>
      </div>

      {/* Mobile sticky bottom bar */}
      {isMobile && (
        <>
          <div className="fixed bottom-0 inset-x-0 z-40 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-4 gap-1">
              <BottomBtn icon={<Type className="h-5 w-5" />} label="Κείμενο" active={tapMode} onClick={startTapMode} />
              <BottomBtn icon={<User className="h-5 w-5" />} label="Στοιχεία" onClick={() => setQuickSheet(true)} />
              <BottomBtn icon={<PenLine className="h-5 w-5" />} label="Υπογραφή" onClick={() => setSigSheet(true)} />
              <BottomBtn icon={<Undo2 className="h-5 w-5" />} label="Αναίρεση" onClick={undo} />
            </div>
          </div>

          {/* Floating Export CTA */}
          <button
            onClick={exportPdf}
            disabled={phase === "exporting"}
            className="fixed right-4 z-50 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center gap-2 px-5 h-14 font-semibold disabled:opacity-60"
            style={{ bottom: "calc(80px + env(safe-area-inset-bottom))" }}
          >
            {phase === "exporting" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            Εξαγωγή PDF
          </button>
        </>
      )}

      {/* Text input bottom sheet */}
      <Sheet open={textSheet.open} onOpenChange={(o) => setTextSheet((s) => ({ ...s, open: o }))}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>{textSheet.editing ? "Επεξεργασία κειμένου" : "Νέο κείμενο"}</SheetTitle></SheetHeader>
          <div className="mt-4 flex flex-col gap-3">
            <Input
              autoFocus
              value={textSheet.value}
              onChange={(e) => setTextSheet((s) => ({ ...s, value: e.target.value }))}
              placeholder="Γράψε εδώ…"
              className="h-12 text-base"
            />
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground w-16">Μέγεθος</span>
              <Slider value={[fontSize]} min={10} max={64} step={1} onValueChange={(v) => setFontSize(v[0])} className="flex-1" />
              <span className="text-sm w-10 text-right">{fontSize}px</span>
            </div>
            <Button
              size="lg"
              className="h-12 text-base"
              onClick={() => {
                const v = textSheet.value.trim();
                if (!v) { setTextSheet({ open: false, value: "", pos: null, editing: null }); return; }
                if (textSheet.editing) {
                  const t = textSheet.editing;
                  t.set({ text: v, fontSize });
                  fabricRef.current?.requestRenderAll();
                  fabricRef.current?.fire("object:modified", { target: t });
                } else {
                  placeTextAt(v, textSheet.pos, fontSize);
                }
                setTextSheet({ open: false, value: "", pos: null, editing: null });
              }}
            >
              Τοποθέτηση
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Quick inserts sheet */}
      <Sheet open={quickSheet} onOpenChange={setQuickSheet}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>Στοιχεία μου</SheetTitle></SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {quickItems.map((it) => (
              <button
                key={it.label}
                onClick={() => handleQuickInsert(it.label, it.value)}
                className="text-left rounded-lg border bg-card hover:bg-accent active:bg-accent/80 px-3 py-3"
              >
                <div className="text-xs text-muted-foreground">{it.label}</div>
                <div className="text-sm font-medium truncate">
                  {it.label === "Ημερομηνία" ? todayGr() : (it.value || "Συμπλήρωσε…")}
                </div>
              </button>
            ))}
          </div>
          {chips.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Σύνδεση & συμπλήρωση προφίλ για αυτόματα στοιχεία.
            </p>
          )}
          <Button variant="outline" className="mt-4 w-full" onClick={() => { setQuickSheet(false); startTapMode(); }}>
            <Plus className="h-4 w-4 mr-1" /> Άλλο πεδίο (κενό)
          </Button>
        </SheetContent>
      </Sheet>

      {/* Signature sheet */}
      <Sheet open={sigSheet} onOpenChange={setSigSheet}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>Υπογραφή</SheetTitle></SheetHeader>
          <div className="mt-4">
            <SignaturePad
              onCancel={() => setSigSheet(false)}
              onSave={async (dataUrl) => {
                setSigSheet(false);
                await placeImageAt(dataUrl, null, 240);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit existing object sheet (mobile) */}
      <Sheet open={editSheet.open} onOpenChange={(o) => setEditSheet((s) => ({ ...s, open: o }))}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>Επεξεργασία στοιχείου</SheetTitle></SheetHeader>
          <div className="mt-4 flex flex-col gap-3">
            {editSheet.target?.type === "i-text" && (
              <>
                <Button
                  className="h-12 justify-start"
                  variant="outline"
                  onClick={() => {
                    const t = editSheet.target as fabric.IText;
                    setEditSheet({ open: false, target: null });
                    setTextSheet({ open: true, value: t.text ?? "", pos: null, editing: t });
                    setFontSize(Math.round((t.fontSize ?? fontSize)));
                  }}
                >
                  <Type className="h-4 w-4 mr-2" /> Επεξεργασία κειμένου
                </Button>
                <div className="flex items-center gap-3 px-1">
                  <span className="text-sm text-muted-foreground w-16">Μέγεθος</span>
                  <Slider
                    value={[Math.round((editSheet.target as fabric.IText).fontSize ?? fontSize)]}
                    min={10} max={64} step={1}
                    onValueChange={(v) => {
                      const t = editSheet.target as fabric.IText;
                      t.set({ fontSize: v[0] });
                      fabricRef.current?.requestRenderAll();
                    }}
                    className="flex-1"
                  />
                </div>
              </>
            )}
            <p className="text-xs text-muted-foreground">Σύρε το στοιχείο με το δάχτυλο για μετακίνηση.</p>
            <Button
              variant="destructive"
              className="h-12"
              onClick={() => {
                const c = fabricRef.current;
                if (c && editSheet.target) {
                  c.remove(editSheet.target);
                  c.discardActiveObject();
                  c.requestRenderAll();
                }
                setEditSheet({ open: false, target: null });
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Διαγραφή
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} onResolved={exportPdf} />
    </>
  );
}

function BottomBtn({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent active:bg-accent/80"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
