import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DetectFieldsSchema = z.object({
  // Data URL: "data:image/jpeg;base64,...."
  imageDataUrl: z.string().min(50).max(15_000_000),
});

export type DetectedField = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const SYSTEM_PROMPT = `Εντοπίζεις κενά πεδία σε ελληνικά έγγραφα (υπεύθυνες δηλώσεις, αιτήσεις, φόρμες). Επέστρεψε ΜΟΝΟ μέσω της return_fields. Συντεταγμένες σε pixels (origin πάνω αριστερά). Αγνόησε ήδη συμπληρωμένα πεδία.`;

async function callGateway(apiKey: string, imageDataUrl: string, signal: AbortSignal) {
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Εντόπισε όλα τα κενά πεδία." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_fields",
            description: "Επιστρέφει λίστα κενών πεδίων.",
            parameters: {
              type: "object",
              properties: {
                fields: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      x: { type: "number" },
                      y: { type: "number" },
                      width: { type: "number" },
                      height: { type: "number" },
                    },
                    required: ["label", "x", "y", "width", "height"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["fields"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_fields" } },
    }),
  });
}

async function attempt(apiKey: string, imageDataUrl: string, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await callGateway(apiKey, imageDataUrl, controller.signal);
  } finally {
    clearTimeout(t);
  }
}

export const detectFields = createServerFn({ method: "POST" })
  .inputValidator((input) => DetectFieldsSchema.parse(input))
  .handler(async ({ data }): Promise<DetectedField[]> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY δεν έχει ρυθμιστεί.");

    console.log("[detectFields] dataUrl length:", data.imageDataUrl.length);

    let response: Response | null = null;
    let lastErr: unknown = null;
    for (let i = 0; i < 2; i++) {
      try {
        console.log(`[detectFields] attempt ${i + 1}...`);
        response = await attempt(apiKey, data.imageDataUrl, 25_000);
        if (response.ok) break;
        if (response.status === 429) {
          throw new Error("Πάρα πολλά αιτήματα. Δοκίμασε ξανά σε λίγο.");
        }
        if (response.status === 402) {
          throw new Error("Έληξαν τα διαθέσιμα AI credits.");
        }
        const text = await response.text().catch(() => "");
        console.error(`[detectFields] gateway ${response.status}:`, text.slice(0, 300));
        lastErr = new Error(`Gateway ${response.status}`);
        response = null;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[detectFields] attempt ${i + 1} failed:`, msg);
        if (msg.includes("Πάρα πολλά") || msg.includes("AI credits")) throw e;
      }
    }

    if (!response) {
      console.error("[detectFields] both attempts failed:", lastErr);
      throw new Error("Η ανίχνευση πεδίων καθυστερεί. Δοκίμασε ξανά σε λίγο.");
    }

    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };

    const message = json.choices?.[0]?.message;
    const argsStr = message?.tool_calls?.[0]?.function?.arguments;

    const tryParse = (s: string): DetectedField[] | null => {
      try {
        const p = JSON.parse(s) as { fields?: DetectedField[] };
        return Array.isArray(p.fields) ? p.fields : null;
      } catch {
        return null;
      }
    };

    if (argsStr) {
      const f = tryParse(argsStr);
      if (f) return f;
    }
    if (message?.content) {
      const m = message.content.match(/\{[\s\S]*\}/);
      if (m) {
        const f = tryParse(m[0]);
        if (f) return f;
      }
    }
    console.error("[detectFields] empty/unparseable response");
    return [];
  });
