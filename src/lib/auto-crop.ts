// Client-side document auto-crop using OpenCV.js (lazy loaded from CDN).

type CV = any;
let cvPromise: Promise<CV> | null = null;

const OPENCV_URL = "https://docs.opencv.org/4.10.0/opencv.js";

export function loadOpenCV(): Promise<CV> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as any;
  if (w.cv && w.cv.Mat) return Promise.resolve(w.cv);
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-opencv]`) as HTMLScriptElement | null;
    const handle = () => {
      const tryResolve = () => {
        if (w.cv && w.cv.Mat) resolve(w.cv);
        else if (w.cv && typeof w.cv.then === "function") w.cv.then(resolve);
        else if (w.cv) {
          w.cv.onRuntimeInitialized = () => resolve(w.cv);
        } else setTimeout(tryResolve, 50);
      };
      tryResolve();
    };
    if (existing) {
      handle();
      return;
    }
    const s = document.createElement("script");
    s.src = OPENCV_URL;
    s.async = true;
    s.dataset.opencv = "1";
    s.onload = handle;
    s.onerror = () => {
      cvPromise = null;
      reject(new Error("Αδυναμία φόρτωσης OpenCV"));
    };
    document.head.appendChild(s);
  });
  return cvPromise;
}

export type Pt = { x: number; y: number };

export type DetectResult = {
  corners: [Pt, Pt, Pt, Pt]; // tl, tr, br, bl in image coords
  imageW: number;
  imageH: number;
};

function orderCorners(pts: Pt[]): [Pt, Pt, Pt, Pt] {
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bot = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bot[1], bot[0]];
}

/** Try to find the largest 4-point contour (the document). Returns null if none. */
export async function detectDocumentCorners(dataUrl: string): Promise<DetectResult | null> {
  const cv = await loadOpenCV();
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  c.getContext("2d")!.drawImage(img, 0, 0);

  const src = cv.imread(c);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    // Dilate to close gaps
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, kernel);
    kernel.delete();

    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imgArea = W * H;
    let best: { pts: Pt[]; area: number } | null = null;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      if (approx.rows === 4) {
        const area = Math.abs(cv.contourArea(approx));
        if (area > imgArea * 0.2 && (!best || area > best.area)) {
          const pts: Pt[] = [];
          for (let j = 0; j < 4; j++) {
            pts.push({ x: approx.intPtr(j, 0)[0], y: approx.intPtr(j, 0)[1] });
          }
          best = { pts, area };
        }
      }
      approx.delete();
      cnt.delete();
    }

    if (!best) return null;
    return { corners: orderCorners(best.pts), imageW: W, imageH: H };
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/** Apply 4-point perspective warp; returns dataUrl of the rectified document. */
export async function warpPerspective(
  dataUrl: string,
  corners: [Pt, Pt, Pt, Pt],
): Promise<{ dataUrl: string; w: number; h: number }> {
  const cv = await loadOpenCV();
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);

  const [tl, tr, br, bl] = corners;
  const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
  const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
  const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  const maxW = Math.max(1, Math.round(Math.max(widthA, widthB)));
  const maxH = Math.max(1, Math.round(Math.max(heightA, heightB)));

  const src = cv.imread(c);
  const dst = new cv.Mat();
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, maxW, 0, maxW, maxH, 0, maxH]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  cv.warpPerspective(src, dst, M, new cv.Size(maxW, maxH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

  const out = document.createElement("canvas");
  out.width = maxW;
  out.height = maxH;
  cv.imshow(out, dst);

  src.delete();
  dst.delete();
  srcTri.delete();
  dstTri.delete();
  M.delete();

  return { dataUrl: out.toDataURL("image/jpeg", 0.92), w: maxW, h: maxH };
}
