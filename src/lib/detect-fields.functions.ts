import { createServerFn } from "@tanstack/react-start";

export type DetectedField = {
  id: string;
  label: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  type: "text" | "date" | "multiline";
};

const PROMPT = `Αυτό είναι ένα ελληνικό έγγραφο προς συμπλήρωση. Βρες όλα τα κενά πεδία (γραμμές, κουτάκια, κενά) που πρέπει να συμπληρωθούν.

Επίστρεψε ΜΟΝΟ JSON, χωρίς άλλο κείμενο:
{
  "fields": [
    {
      "id": "field_1",
      "label": "Ετικέτα πεδίου (π.χ. Ονοματεπώνυμο)",
      "xPct": 0.35,
      "yPct": 0.12,
      "widthPct": 0.55,
      "heightPct": 0.03,
      "type": "text"
    }
  ]
}

xPct, yPct = θέση top-left ως ποσοστό (0..1) του πλάτους/ύψους εικόνας
widthPct, heightPct = διαστάσεις ως ποσοστό
type = "text", "date", ή "multiline"

Να συμπεριλάβεις ΟΛΑ τα κενά συμπεριλαμβανομένων των γραμμών στο κυρίως κείμενο.`;

export const detectFields = createServerFn({ method: "POST" })
  .inputValidator((input: { imageBase64: string; mimeType: string }) => input)
  .handler(async ({ data }): Promise<{ fields: DetectedField[]; raw?: string; error?: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    console.log("[detectFields] LOVABLE_API_KEY exists:", !!apiKey);

    if (!apiKey) {
      return { fields: [], error: "LOVABLE_API_KEY not set" };
    }

    const dataUrl = `data:${data.mimeType};base64,${data.imageBase64}`;
    let text = "";

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl } },
                { type: "text", text: PROMPT },
              ],
            },
          ],
        }),
      });

      console.log("[detectFields] gateway status:", resp.status);

      if (!resp.ok) {
        const errBody = await resp.text();
        console.error("[detectFields] gateway error:", resp.status, errBody);
        return { fields: [], raw: errBody, error: `Gateway HTTP ${resp.status}` };
      }

      const json = await resp.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      text = json.choices?.[0]?.message?.content ?? "";
      console.log("[detectFields] AI response:", text);

      const cleaned = text.replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      const jsonStr = match ? match[0] : cleaned;

      try {
        const parsed = JSON.parse(jsonStr);
        if (!parsed.fields || parsed.fields.length === 0) {
          return { fields: [], raw: text, error: "NO_FIELDS" };
        }
        return { fields: parsed.fields as DetectedField[], raw: text };
      } catch (e) {
        console.error("[detectFields] Parse error:", e, "Raw text:", text);
        return { fields: [], raw: text, error: `Parse error: ${e instanceof Error ? e.message : String(e)}` };
      }
    } catch (e) {
      console.error("[detectFields] failed:", e);
      return { fields: [], raw: text, error: e instanceof Error ? e.message : String(e) };
    }
  });
