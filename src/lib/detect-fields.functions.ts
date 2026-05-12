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
    if (!apiKey) {
      console.error("[detectFields] ANTHROPIC_API_KEY not set");
      return { fields: [] };
    }

    try {
      const client = new Anthropic({ apiKey });
      const mediaType = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(data.mimeType)
        ? data.mimeType
        : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

      const response = await client.messages.create({
        model: "claude-opus-4-5",
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
      const text = block && block.type === "text" ? block.text : "";
      const clean = text.replace(/```json|```/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) return { fields: [] };
      const parsed = JSON.parse(match[0]) as { fields?: DetectedField[] };
      return { fields: Array.isArray(parsed.fields) ? parsed.fields : [] };
    } catch (e) {
      console.error("[detectFields] failed:", e);
      return { fields: [] };
    }
  });
