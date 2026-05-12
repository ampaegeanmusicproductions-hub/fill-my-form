# Plan: HTML Recreation Editor

Νέα προσέγγιση που αντικαθιστά το overlay-on-canvas pipeline. Το Claude διαβάζει το έγγραφο και επιστρέφει **πλήρες HTML με inline CSS**, όπου τα κενά πεδία είναι ήδη `<input>`/`<textarea>`. Ο χρήστης γράφει κατευθείαν μέσα στο HTML και το εξάγουμε σε PDF με `html2pdf.js`.

## ⚠️ Προειδοποίηση ασφαλείας (πρέπει να ξέρεις)

Το `VITE_ANTHROPIC_API_KEY` υπάρχει ήδη στο `.env` και είναι **εκτεθειμένο στο browser bundle**. Οποιοσδήποτε επισκέπτης του site μπορεί να το διαβάσει από το DevTools και να το χρησιμοποιήσει για δικά του Anthropic calls — με χρέωση στον δικό σου λογαριασμό. Είναι ΟΚ για prototype/demo αλλά **μη το δημοσιεύσεις** σε production χωρίς proxy. Αργότερα προτείνω να το γυρίσουμε πίσω στο Lovable AI Gateway server-side.

Προχωράμε με την client-side προσέγγιση όπως ζήτησες.

## Τι αλλάζει

### 1. Νέα εξάρτηση
- `bun add html2pdf.js`

### 2. Νέο module `src/lib/recreate-html.ts` (client-side)
- Function `recreateAsHtml(file: File): Promise<string>`
- Βήματα:
  1. Αν είναι PDF → render 1ης σελίδας σε canvas με `pdfjs-dist` → `toDataURL("image/jpeg", 0.85)` → base64
  2. Αν είναι εικόνα → load σε `<img>` → canvas → base64
  3. POST στο `https://api.anthropic.com/v1/messages` με τα headers που έδωσες (`x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access: true`)
  4. Model: `claude-opus-4-5-20251101`, `max_tokens: 4000`
  5. Prompt: ο ελληνικός prompt που έδωσες (αναδημιούργησε ως HTML με inline CSS, κενά → inputs με `border-bottom: 2px solid #333`, table layout)
  6. Επιστρέφει `response.content[0].text` καθαρισμένο από τυχόν ```` ```html ```` backticks

### 3. Refactor `src/components/PdfEditor.tsx`
Αντικαθιστούμε όλο το tap/overlay/canvas pipeline με:

- **State:** `phase: "idle" | "uploading" | "recreating" | "ready"`, `html: string | null`, `error: string | null`
- **Upload zone:** ίδιο dropzone, accept PDF + images
- **On file selected:**
  - `setPhase("recreating")`
  - Loading UI: spinner + κείμενο "Αναδημιουργία εγγράφου…"
  - `const html = await recreateAsHtml(file)`
  - `setHtml(html); setPhase("ready")`
- **Render:**
  - Container `<div ref={previewRef} className="bg-white shadow rounded p-8 max-w-[800px] mx-auto" dangerouslySetInnerHTML={{ __html: html }} />`
  - Χρησιμοποιούμε `div` αντί για iframe ώστε το `html2pdf.js` να βλέπει τα τρέχοντα input values κατευθείαν από το DOM (στο iframe χρειάζεται sandbox messaging).
  - Sanitization: τρέχουμε το HTML μέσα από `DOMPurify` πριν το ενθέσουμε, με allowlist που περιλαμβάνει `input`, `textarea`, `style` attributes.
- **Toolbar (πάνω από το preview):**
  - Κουμπί "Νέο" → reset state
  - Κουμπί "Εξαγωγή PDF" → καλεί `html2pdf().from(previewRef.current).set({...A4 opts}).save("document.pdf")`
- **Error state:** αν το API αποτύχει ή επιστρέψει κενό HTML → εμφάνιση error message + κουμπί "Δοκίμασε ξανά"

### 4. Αφαιρούνται από τον editor
- Tap-to-place overlay logic
- `detectFields` server function calls (κρατάμε το αρχείο για τώρα, δεν το διαγράφουμε)
- Debug panel για raw AI response
- Manual text/signature items (replaced by HTML inputs)

### 5. PDF export config
`html2pdf` options:
```
{ margin: 10, filename: "document.pdf",
  image: { type: "jpeg", quality: 0.95 },
  html2canvas: { scale: 2, useCORS: true },
  jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } }
```
Πριν το export, βεβαιωνόμαστε ότι τα `<input>` δείχνουν τα τρέχοντα τους `value` ως attribute (`html2canvas` ζωγραφίζει attributes, όχι DOM state) — θα κάνουμε ένα μικρό walk: `previewRef.current.querySelectorAll("input,textarea").forEach(el => el.setAttribute("value", el.value))` (για textareas χρειάζεται `el.textContent = el.value`).

## Files affected

| Αρχείο | Δράση |
|---|---|
| `package.json` / `bun.lock` | + `html2pdf.js`, + `dompurify`, + `@types/dompurify` |
| `src/lib/recreate-html.ts` | **νέο** — Claude API call + base64 helpers |
| `src/components/PdfEditor.tsx` | **rewrite** — νέο HTML-based flow |
| `src/lib/detect-fields.functions.ts` | μένει ως έχει (unused, για πιθανή μελλοντική χρήση) |
| `.env` | ήδη έχει `VITE_ANTHROPIC_API_KEY` ✓ |

## Acceptance

1. Upload PDF/εικόνας → loading "Αναδημιουργία εγγράφου…" → εμφανίζεται HTML αντίγραφο με editable inputs στις θέσεις των κενών.
2. Ο χρήστης πληκτρολογεί στα inputs χωρίς overlay misalignment.
3. "Εξαγωγή PDF" κατεβάζει `document.pdf` με τα συμπληρωμένα κείμενα.
4. "Νέο" καθαρίζει το state και επιστρέφει στο upload zone.

## Open questions πριν το build

Καμία blocker. Αν συμφωνείς με την προσέγγιση + αποδέχεσαι το security trade-off του exposed key για prototype, πάτα **Implement plan**.
