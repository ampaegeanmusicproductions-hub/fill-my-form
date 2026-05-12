import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";

export type DetectedField = {
  id: string;
  label: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  type: "text" | "date" | "multiline";
};

export const detectFields = createServerFn({ method: "POST" })
  .inputValidator((input: { imageBase64: string; mimeType: string }) => input)
  .handler(async ({ data }): Promise<{ fields: DetectedField[] }> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    console.log("[detectFields] API Key exists:", !!apiKey);

    if (!apiKey) {
      console.error("[detectFields] ANTHROPIC_API_KEY not set");
      return { fields: [] };
    }

    const mediaType = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(data.mimeType)
      ? data.mimeType
      : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

    let text = "";
    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: "claude-sonnet-4-5-20251022",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: data.imageBase64 },
              },
              {
                type: "text",
                text: `Αυτό είναι ένα ελληνικό έγγραφο προς συμπλήρωση. Βρες όλα τα κενά πεδία (γραμμές, κουτάκια, κενά) που πρέπει να συμπληρωθούν.

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

Να συμπεριλάβεις ΟΛΑ τα κενά συμπεριλαμβανομένων των γραμμών στο κυρίως κείμενο.`,
              },
            ],
          },
        ],
      });

      const block = response.content[0];
      text = block && block.type === "text" ? block.text : "";
      console.log("[detectFields] Claude response:", text);

      const cleaned = text.replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      const jsonStr = match ? match[0] : cleaned;

      try {
        const parsed = JSON.parse(jsonStr);
        if (!parsed.fields || parsed.fields.length === 0) {
          throw new Error("NO_FIELDS");
        }
        return parsed as { fields: DetectedField[] };
      } catch (e) {
        console.error("[detectFields] Parse error:", e, "Raw text:", text);
        return { fields: [] };
      }
    } catch (e) {
      console.error("[detectFields] failed:", e);
      return { fields: [] };
    }
  });
