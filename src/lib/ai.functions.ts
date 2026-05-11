import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DetectFieldsSchema = z.object({
  // Data URL: "data:image/png;base64,...."
  imageDataUrl: z.string().min(50).max(15_000_000),
});

export type DetectedField = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const SYSTEM_PROMPT = `Είσαι ειδικός στην ανάλυση ελληνικών επίσημων εγγράφων (υπεύθυνες δηλώσεις, αιτήσεις δημοσίου, σχολικές αιτήσεις, εφορία).
Σου δίνεται η εικόνα ενός εγγράφου και πρέπει να εντοπίσεις ΚΑΘΕ κενό πεδίο όπου ο χρήστης αναμένεται να γράψει πληροφορία:
- Παρακείμενες κενές γραμμές μετά από ετικέτες όπως "Όνομα:", "ΟΔΟΣ:", "Α.Φ.Μ.:", "ΑΔΤ:", κ.λπ.
- Κενά πλαίσια / διακεκομμένες γραμμές
- Κενοί χώροι σε φόρμες
Επέστρεψε ΜΟΝΟ τα ευρήματα μέσω της συνάρτησης return_fields. Συντεταγμένες σε pixels της εικόνας που σου δόθηκε. Origin: πάνω αριστερά. Μην επιστρέφεις πεδία ήδη συμπληρωμένα.`;

export const detectFields = createServerFn({ method: "POST" })
  .inputValidator((input) => DetectFieldsSchema.parse(input))
  .handler(async ({ data }): Promise<DetectedField[]> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY δεν έχει ρυθμιστεί.");

    console.log("[detectFields] received imageDataUrl, length:", data.imageDataUrl.length);
    console.log("[detectFields] sending to Lovable AI Gateway...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Εντόπισε όλα τα κενά πεδία στο παρακάτω έγγραφο.",
              },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_fields",
              description: "Επιστρέφει λίστα κενών πεδίων με pixel coordinates.",
              parameters: {
                type: "object",
                properties: {
                  fields: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string", description: "Ελληνική ετικέτα του πεδίου" },
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

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Πάρα πολλά αιτήματα. Δοκίμασε ξανά σε λίγο.");
      }
      if (response.status === 402) {
        throw new Error("Έληξαν τα διαθέσιμα AI credits. Επικοινώνησε με τον διαχειριστή.");
      }
      const text = await response.text().catch(() => "");
      console.error("AI gateway error:", response.status, text);
      throw new Error("Σφάλμα κατά την ανάλυση του εγγράφου.");
    }

    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };

    console.log("[detectFields] AI response received. Keys:", Object.keys(json));
    const message = json.choices?.[0]?.message;
    const argsStr = message?.tool_calls?.[0]?.function?.arguments;
    console.log("[detectFields] tool_calls present:", !!argsStr, "content fallback:", !!message?.content);

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
      if (f) {
        console.log("[detectFields] parsed fields from tool_call:", f.length);
        return f;
      }
      console.error("[detectFields] failed to parse tool args:", argsStr.slice(0, 500));
    }
    if (message?.content) {
      // Fallback: try to extract JSON from content
      const m = message.content.match(/\{[\s\S]*\}/);
      if (m) {
        const f = tryParse(m[0]);
        if (f) {
          console.log("[detectFields] parsed fields from content fallback:", f.length);
          return f;
        }
      }
      console.error("[detectFields] content (no JSON parse):", message.content.slice(0, 500));
    }
    console.error("[detectFields] Unexpected AI response shape:", JSON.stringify(json).slice(0, 800));
    return [];
  });
