// Client-side document → HTML recreation via Claude Vision API.
// SECURITY NOTE: VITE_ANTHROPIC_API_KEY is exposed in the browser bundle.
// Acceptable only for prototype/demo. Move to server proxy before production.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-5-20251101";

const PROMPT = `Αυτό είναι ένα ελληνικό έγγραφο. Αναδημιούργησέ το ΑΚΡΙΒΩΣ ως HTML με inline CSS.

ΚΑΝΟΝΕΣ:
- Διατήρησε ΟΛΟΚΛΗΡΟ το κείμενο, τη διάταξη, τους τίτλους, τα λογότυπα (ως text)
- Τα κενά πεδία (γραμμές, κουτάκια) να γίνουν <input type="text"> ή <textarea>
- Inputs: border: none; border-bottom: 2px solid #333; background: transparent; font-size: inherit; width: 100%;
- Η σελίδα να μοιάζει ΑΚΡΙΒΩΣ με το πρωτότυπο
- Χρησιμοποίησε table layout για να διατηρήσεις τη δομή
- Επίστρεψε ΜΟΝΟ το HTML, χωρίς markdown backticks`;

async function fileToJpegBase64(file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    // Render first page of PDF to canvas via pdfjs
    const pdfjs = await import("pdfjs-dist");
    // Use bundled worker
    const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  }

  // Image path
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Failed to load image"));
    i.src = dataUrl;
  });
  const maxDim = 2000;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

function stripMarkdownFences(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "");
  return t.trim();
}

export async function recreateAsHtml(file: File): Promise<string> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
  if (!apiKey) throw new Error("Λείπει το VITE_ANTHROPIC_API_KEY");

  const base64 = await fileToJpegBase64(file);

  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const json = (await resp.json()) as { content?: Array<{ text?: string }> };
  const text = json.content?.[0]?.text ?? "";
  const html = stripMarkdownFences(text);
  if (!html) throw new Error("Κενή απάντηση από το AI");
  return html;
}
