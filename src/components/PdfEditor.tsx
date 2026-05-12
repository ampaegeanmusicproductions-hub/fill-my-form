import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useBlocker } from "@tanstack/react-router";
import { PDFDocument, rgb } from "pdf-lib";
import { Loader2, Upload, Download, Type, Trash2, Plus, Minus, X, User, PenLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { consumeQuota, saveDocument } from "@/lib/quota.functions";
import { unwrapServerFn } from "@/lib/server-fn-client";
import { UpgradeModal } from "@/components/UpgradeModal";
import { SignaturePad } from "@/components/SignaturePad";

type Phase = "idle" | "preparing" | "cropping" | "ready" | "exporting";
type TextItem = {
  id: string;
  xPercent: number; // 0..1 (top-left of text box, in document coords)
  yPercent: number;
  text: string;
  fontSize: number; // px relative to natural document width
  color: string;
};
type SigItem = {
  id: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number; // width relative to document width
  dataUrl: string;
};

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
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "file";

const todayGr = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

const uid = () => Math.random().toString(36).slice(2, 10);

const FONT_FAMILY = "Manrope, Arial, sans-serif";

export function PdfEditor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [bg, setBg] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [originalBg, setOriginalBg] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [scale, setScale] = useState(1);

  const [items, setItems] = useState<TextItem[]>([]);
  const [sigs, setSigs] = useState<SigItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultFontSize, setDefaultFontSize] = useState(20);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [quickSheet, setQuickSheet] = useState(false);
  const [sigSheet, setSigSheet] = useState(false);
  const [crop, setCrop] = useState({ top: 0, right: 0, bottom: 0, left: 0 });

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

  // Profile chips (logged in)
  useEffect(() => {
    let cancelled = false;
    const loadProfileFor = async (userId: string) => {
      try {
        const { data: profile, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
        if (error || !profile || cancelled) return;
        const prof = profile as unknown as Record<string, string | null>;
        const fullAddress = [prof.address_street, prof.address_number].filter(Boolean).join(" ").trim();
        const items: { label: string; value: string }[] = [
          { label: "Ονοματεπώνυμο", value: prof.full_name ?? "" },
          { label: "ΑΦΜ", value: prof.afm ?? "" },
          { label: "ΑΔΤ", value: prof.id_number ?? "" },
          { label: "Τηλέφωνο", value: prof.phone ?? "" },
          { label: "Διεύθυνση", value: fullAddress },
        ].filter((c) => c.value.trim().length > 0);
        setChips(items);
      } catch { /* ignore */ }
    };
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session?.user) loadProfileFor(data.session.user.id);
    }).catch(() => {});
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      if (session?.user) loadProfileFor(session.user.id);
      else setChips([]);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  // Responsive scale
  useEffect(() => {
    if (!bg) return;
    const update = () => {
      const w = wrapperRef.current?.clientWidth ?? bg.w;
      const reserved = 220;
      const maxH = Math.max(360, window.innerHeight - reserved);
      setScale(Math.min(1, w / bg.w, maxH / bg.h));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [bg]);

  // Detect mobile keyboard via visualViewport (hide bottom toolbar when open)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const diff = window.innerHeight - vv.height;
      setKeyboardOpen(diff > 150);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // Focus the inline edit input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleFile = useCallback(async (file: File) => {
    setOriginalFile(file); setBg(null); setOriginalBg(null); setItems([]); setSigs([]);
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
      else { setCrop({ top: 0, right: 0, bottom: 0, left: 0 }); setPhase("cropping"); }
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

  const applyCrop = async () => {
    if (!originalBg) return;
    const { top, right, bottom, left } = crop;
    if (top + bottom + left + right === 0) {
      setBg(originalBg); setPhase("ready"); return;
    }
    try {
      const img = await loadImage(originalBg.dataUrl);
      const w = Math.max(1, originalBg.w - left - right);
      const h = Math.max(1, originalBg.h - top - bottom);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, left, top, w, h, 0, 0, w, h);
      setBg({ dataUrl: c.toDataURL("image/jpeg", 0.92), w, h });
      setPhase("ready");
    } catch {
      setBg(originalBg); setPhase("ready");
    }
  };

  // Place text at click position on overlay
  const onOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editingId) return; // currently editing → ignore
    const target = e.target as HTMLElement;
    if (target.closest("[data-text-item]") || target.closest("[data-sig-item]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const id = uid();
    const newItem: TextItem = {
      id, xPercent: Math.max(0, Math.min(1, x)), yPercent: Math.max(0, Math.min(1, y)),
      text: "", fontSize: defaultFontSize, color: "#000000",
    };
    setItems((prev) => [...prev, newItem]);
    setSelectedId(id);
    setEditingId(id);
  };

  const commitEdit = (id: string, text: string) => {
    setItems((prev) => {
      const next = prev.map((it) => (it.id === id ? { ...it, text } : it));
      // remove if empty
      return next.filter((it) => it.id !== id || it.text.trim().length > 0);
    });
    setEditingId(null);
  };

  const beginEdit = (id: string) => {
    setSelectedId(id);
    setEditingId(id);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  };
  const removeSig = (id: string) => {
    setSigs((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const adjustSize = (delta: number) => {
    if (!selectedId) {
      setDefaultFontSize((s) => Math.max(8, Math.min(80, s + delta)));
      return;
    }
    setItems((prev) => prev.map((it) => it.id === selectedId ? { ...it, fontSize: Math.max(8, Math.min(80, it.fontSize + delta)) } : it));
  };

  // Long-press handling for delete shortcut
  const longPressRef = useRef<{ id: string; timer: number } | null>(null);
  const startLongPress = (id: string) => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
    const timer = window.setTimeout(() => {
      setSelectedId(id);
      // Triggering removal directly might be too aggressive; just select & user uses bottom Delete
      // But user asked: long press → emit delete button. We'll just mark selected.
    }, 500);
    longPressRef.current = { id, timer };
  };
  const cancelLongPress = () => {
    if (longPressRef.current) { window.clearTimeout(longPressRef.current.timer); longPressRef.current = null; }
  };

  const insertQuick = (label: string, value: string) => {
    setQuickSheet(false);
    const text = label === "Ημερομηνία" && !value ? todayGr() : value;
    if (!text) return;
    const id = uid();
    setItems((prev) => [...prev, { id, xPercent: 0.1, yPercent: 0.1, text, fontSize: defaultFontSize, color: "#000000" }]);
    setSelectedId(id);
  };

  const addSignature = (dataUrl: string) => {
    setSigSheet(false);
    const id = uid();
    setSigs((prev) => [...prev, { id, xPercent: 0.1, yPercent: 0.7, widthPercent: 0.3, dataUrl }]);
    setSelectedId(id);
  };

  // Build composite image (bg + text + sigs) and embed in PDF
  const exportPdf = async () => {
    if (!bg || !originalFile) return;
    setPhase("exporting");
    let step = "init";
    try {
      step = "Έλεγχος ορίου";
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

      step = "Σύνθεση εικόνας";
      const baseImg = await loadImage(bg.dataUrl);
      const out = document.createElement("canvas");
      out.width = bg.w; out.height = bg.h;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("Αδυναμία επεξεργασίας εικόνας.");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, bg.w, bg.h);
      octx.drawImage(baseImg, 0, 0, bg.w, bg.h);

      // Draw text items
      octx.textBaseline = "top";
      for (const it of items) {
        const text = it.text.trim();
        if (!text) continue;
        octx.font = `${it.fontSize}px ${FONT_FAMILY}`;
        octx.fillStyle = it.color;
        octx.fillText(text, it.xPercent * bg.w, it.yPercent * bg.h);
      }

      // Draw signatures
      for (const s of sigs) {
        try {
          const sigImg = await loadImage(s.dataUrl);
          const w = s.widthPercent * bg.w;
          const h = (sigImg.naturalHeight / sigImg.naturalWidth) * w;
          octx.drawImage(sigImg, s.xPercent * bg.w, s.yPercent * bg.h, w, h);
        } catch {}
      }

      step = "Δημιουργία PDF";
      const finalDataUrl = out.toDataURL("image/jpeg", 0.95);
      const finalBytes = await (await fetch(finalDataUrl)).arrayBuffer();
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
      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });

      step = "Ανέβασμα";
      try {
        if (currentUser) {
          const ts = Date.now();
          const safeFull = sanitize(originalFile.name);
          const baseName = sanitize(originalFile.name.replace(/\.[^.]+$/, ""));
          const folder = `${currentUser.id}/${ts}_${baseName}`;
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
              fields: [...items, ...sigs] as unknown[],
            },
          }));
        }
      } catch (e) { console.warn("[exportPdf] upload/save failed (non-blocking):", e); }

      step = "Λήψη";
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${originalFile.name.replace(/\.[^.]+$/, "")}-συμπληρωμένο.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Έτοιμο! Το αρχείο κατέβηκε.");
    } catch (e) {
      console.error(`[exportPdf] FAILED at step: ${step}`, e);
      const reason = e instanceof Error ? e.message : typeof e === "string" ? e : "άγνωστο σφάλμα";
      toast.error(`Σφάλμα στο βήμα “${step}”: ${reason}`);
    } finally { setPhase("ready"); }
  };

  const quickItems = useMemo(() => {
    const map = new Map(chips.map((c) => [c.label, c.value]));
    return QUICK_LABELS.map((label) => ({ label, value: map.get(label) ?? "" }));
  }, [chips]);

  // ============= RENDER =============
  if (phase === "cropping" && originalBg) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-3">
          <p className="text-sm font-medium mb-1">Περικοπή (προαιρετικά)</p>
          <p className="text-xs text-muted-foreground mb-3">Ορίσε πόσα pixel να αφαιρεθούν από κάθε πλευρά. Άφησε στο 0 για παράλειψη.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(["top", "right", "bottom", "left"] as const).map((side) => (
              <label key={side} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  {side === "top" ? "Πάνω" : side === "right" ? "Δεξιά" : side === "bottom" ? "Κάτω" : "Αριστερά"}
                </span>
                <input
                  type="number" min={0} value={crop[side]}
                  onChange={(e) => setCrop((c) => ({ ...c, [side]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="h-10 rounded-md border px-3 text-sm"
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <Button variant="outline" onClick={() => { setBg(originalBg); setPhase("ready"); }}>Παράλειψη</Button>
            <Button onClick={applyCrop}>Εφαρμογή & Συνέχεια</Button>
          </div>
        </div>
        <img src={originalBg.dataUrl} alt="" className="mx-auto rounded-xl border max-w-full" />
      </div>
    );
  }

  if (!bg) {
    return (
      <div
        onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
        className="border-2 border-dashed rounded-2xl p-12 sm:p-20 text-center bg-card hover:border-primary transition cursor-pointer"
        onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
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
              PDF, εικόνα ή φωτογραφία από κινητό. Πάτα οπουδήποτε στο έγγραφο για να γράψεις.
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
      <div ref={wrapperRef} className="relative mx-auto" style={{ width: "100%", maxWidth: bg.w, paddingBottom: 96 }}>
        <div
          className="relative mx-auto rounded-xl border bg-white shadow-sm overflow-hidden select-none"
          style={{ width: displayW, height: displayH }}
        >
          <img src={bg.dataUrl} alt="Έγγραφο" draggable={false} className="absolute inset-0 pointer-events-none" style={{ width: displayW, height: displayH }} />

          {/* Tap overlay */}
          <div
            className="absolute inset-0"
            style={{ touchAction: "manipulation" }}
            onPointerDown={onOverlayPointerDown}
          >
            {items.map((it) => {
              const isEditing = editingId === it.id;
              const isSelected = selectedId === it.id;
              const left = it.xPercent * displayW;
              const top = it.yPercent * displayH;
              const fontPx = it.fontSize * scale;
              return (
                <div
                  key={it.id}
                  data-text-item
                  className={`absolute ${isSelected && !isEditing ? "ring-2 ring-primary ring-offset-1" : ""}`}
                  style={{ left, top, fontSize: fontPx, fontFamily: FONT_FAMILY, color: it.color, lineHeight: 1.1 }}
                  onPointerDown={(e) => { e.stopPropagation(); startLongPress(it.id); setSelectedId(it.id); }}
                  onPointerUp={(e) => { e.stopPropagation(); cancelLongPress(); if (!isEditing) beginEdit(it.id); }}
                  onPointerCancel={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                >
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={it.text}
                      onChange={(e) => setItems((prev) => prev.map((p) => p.id === it.id ? { ...p, text: e.target.value } : p))}
                      onBlur={(e) => commitEdit(it.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                        if (e.key === "Escape") { (e.target as HTMLInputElement).blur(); }
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: fontPx, fontFamily: FONT_FAMILY, color: it.color,
                        background: "rgba(255,255,255,0.95)", border: "1px solid hsl(var(--primary))",
                        outline: "none", padding: "2px 6px", borderRadius: 4, minWidth: 80,
                        lineHeight: 1.1,
                      }}
                    />
                  ) : (
                    <span style={{ background: "rgba(255,255,255,0.6)", padding: "0 2px", whiteSpace: "pre" }}>
                      {it.text || " "}
                    </span>
                  )}
                  {isSelected && !isEditing && (
                    <button
                      onPointerDown={(e) => { e.stopPropagation(); }}
                      onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}
                      className="absolute -top-3 -right-3 h-7 w-7 rounded-full bg-destructive text-destructive-foreground shadow-md flex items-center justify-center"
                      aria-label="Διαγραφή"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}

            {sigs.map((s) => {
              const isSelected = selectedId === s.id;
              const left = s.xPercent * displayW;
              const top = s.yPercent * displayH;
              const w = s.widthPercent * displayW;
              return (
                <div
                  key={s.id} data-sig-item
                  className={`absolute ${isSelected ? "ring-2 ring-primary ring-offset-1" : ""}`}
                  style={{ left, top, width: w }}
                  onPointerDown={(e) => { e.stopPropagation(); setSelectedId(s.id); }}
                >
                  <img src={s.dataUrl} alt="" draggable={false} style={{ width: "100%", display: "block" }} />
                  {isSelected && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); removeSig(s.id); }}
                      className="absolute -top-3 -right-3 h-7 w-7 rounded-full bg-destructive text-destructive-foreground shadow-md flex items-center justify-center"
                      aria-label="Διαγραφή"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Hint */}
        {items.length === 0 && sigs.length === 0 && (
          <div className="mt-3 text-center text-xs text-muted-foreground">
            Πάτα οπουδήποτε στο έγγραφο για να γράψεις.
          </div>
        )}

        {/* Profile chips (desktop helper) */}
        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">Γρήγορη συμπλήρωση:</span>
            {chips.map((ch) => (
              <button
                key={ch.label} type="button"
                onClick={() => insertQuick(ch.label, ch.value)}
                className="inline-flex items-center rounded-full border bg-secondary/60 hover:bg-secondary text-secondary-foreground px-2.5 py-1 text-xs"
              >
                {ch.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sticky bottom toolbar */}
      {!keyboardOpen && (
        <div
          className="fixed left-0 right-0 z-40 border-t bg-card shadow-[0_-4px_12px_rgba(0,0,0,0.06)]"
          style={{ bottom: 0, paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto max-w-3xl px-3 py-2 flex items-center gap-2">
            <button
              onClick={() => {
                // Add a centered text and immediately edit
                const id = uid();
                setItems((prev) => [...prev, { id, xPercent: 0.1, yPercent: 0.1, text: "", fontSize: defaultFontSize, color: "#000000" }]);
                setSelectedId(id); setEditingId(id);
              }}
              className="flex-1 min-w-0 h-[52px] rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-1.5"
            >
              <Plus className="h-5 w-5" /> <span className="truncate">Κείμενο</span>
            </button>
            <button
              onClick={() => setQuickSheet(true)}
              className="h-[52px] px-3 rounded-xl border bg-background flex items-center justify-center"
              aria-label="Στοιχεία"
            >
              <User className="h-5 w-5" />
            </button>
            <button
              onClick={() => setSigSheet(true)}
              className="h-[52px] px-3 rounded-xl border bg-background flex items-center justify-center"
              aria-label="Υπογραφή"
            >
              <PenLine className="h-5 w-5" />
            </button>
            <div className="h-[52px] flex items-center rounded-xl border bg-background overflow-hidden">
              <button onClick={() => adjustSize(-2)} className="h-full w-10 flex items-center justify-center" aria-label="Μικρότερο">
                <Minus className="h-4 w-4" />
              </button>
              <span className="px-1 text-xs tabular-nums">
                {selectedId ? items.find((i) => i.id === selectedId)?.fontSize ?? defaultFontSize : defaultFontSize}
              </span>
              <button onClick={() => adjustSize(+2)} className="h-full w-10 flex items-center justify-center" aria-label="Μεγαλύτερο">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => {
                if (selectedId) {
                  if (items.find((i) => i.id === selectedId)) removeItem(selectedId);
                  else if (sigs.find((s) => s.id === selectedId)) removeSig(selectedId);
                }
              }}
              disabled={!selectedId}
              className="h-[52px] px-3 rounded-xl border bg-background text-destructive disabled:opacity-40 flex items-center justify-center"
              aria-label="Διαγραφή"
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <button
              onClick={exportPdf}
              disabled={phase === "exporting"}
              className="h-[52px] px-4 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {phase === "exporting" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
              <span className="hidden sm:inline">PDF</span>
            </button>
          </div>
        </div>
      )}

      {/* Full-screen export overlay */}
      {phase === "exporting" && (
        <div className="fixed inset-0 z-[60] bg-background/95 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <div className="text-base font-semibold">Δημιουργία PDF…</div>
          <div className="text-xs text-muted-foreground">Λίγα δευτερόλεπτα</div>
        </div>
      )}

      {/* Quick inserts sheet */}
      <Sheet open={quickSheet} onOpenChange={setQuickSheet}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>Στοιχεία μου</SheetTitle></SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {quickItems.map((it) => (
              <button
                key={it.label}
                onClick={() => insertQuick(it.label, it.value)}
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
            <p className="mt-3 text-xs text-muted-foreground">Σύνδεση & συμπλήρωση προφίλ για αυτόματα στοιχεία.</p>
          )}
        </SheetContent>
      </Sheet>

      {/* Signature sheet */}
      <Sheet open={sigSheet} onOpenChange={setSigSheet}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader><SheetTitle>Υπογραφή</SheetTitle></SheetHeader>
          <div className="mt-4">
            <SignaturePad onCancel={() => setSigSheet(false)} onSave={addSignature} />
          </div>
        </SheetContent>
      </Sheet>

      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} onResolved={exportPdf} />
    </>
  );
}
