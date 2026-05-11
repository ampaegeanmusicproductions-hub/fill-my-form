
# FormFill.gr — MVP Plan (v2)

## Στόχος
Ελληνική web app: ο χρήστης ανεβάζει **οποιοδήποτε** αρχείο εγγράφου, η AI εντοπίζει τα κενά πεδία, ο χρήστης τα συμπληρώνει on-screen, και κατεβάζει συμπληρωμένο PDF — χωρίς να αλλοιωθεί το πρωτότυπο.

## Tech Stack
- **Frontend**: TanStack Start + React + Tailwind + shadcn/ui
- **Backend**: Lovable Cloud (Auth + Postgres + Storage)
- **AI**: Lovable AI Gateway, μοντέλο `google/gemini-2.5-pro` (vision) μέσω TanStack `createServerFn` — **χωρίς** δικό σου API key
- **PDF render** (client): `pdfjs-dist`
- **PDF write** (client): `pdf-lib`

## ⚠️ Σημαντικός περιορισμός runtime (πρέπει να ξέρεις)
Ο server τρέχει σε **Cloudflare Workers** (όχι Node σε VM). Αυτό σημαίνει:
- ❌ `sharp` δεν δουλεύει (native binary)
- ❌ LibreOffice / `docx-to-pdf` headless δεν δουλεύει (απαιτεί subprocess)
- ❌ HEIC decoding βιβλιοθήκες που χρειάζονται native code (libheif) δεν δουλεύουν

### Πρακτική λύση για κάθε format (όλα server-side εκτός HEIC)
| Format | Αντιμετώπιση |
|---|---|
| **PDF** | Δουλεύει direct με `pdfjs-dist` (render) + `pdf-lib` (write) |
| **JPG/PNG/WebP** | Embed σε νέο PDF μέσω `pdf-lib` (server fn). EXIF rotation: γίνεται client-side με `<canvas>` πριν το upload (απλό, χωρίς sharp) |
| **DOCX** | Conversion μέσω εξωτερικού API (CloudConvert / ConvertAPI) που καλείται από το `createServerFn`. Χρειάζεται 1 API key (mock placeholder στο MVP, με toast «Word: σύντομα διαθέσιμο» μέχρι να βάλεις key) |
| **DOC (legacy)** | Ίδιο μονοπάτι μέσω external API |
| **HEIC/HEIF** | Conversion **client-side** με `heic2any` (WASM, δουλεύει στον browser). Ο χρήστης δεν βλέπει τίποτα — απλά ανεβαίνει σαν JPEG |

> Το upload zone **παραμένει ένα**: «Σύρετε ή επιλέξτε αρχείο». Όλη η λογική κρύβεται από τον χρήστη. Αν λείπει το external API key, τα Word αρχεία δείχνουν φιλικό μήνυμα «Word conversion σύντομα — δοκίμασε PDF ή φωτογραφία προς το παρόν». Εικόνες & PDF δουλεύουν εξ αρχής.

## Pricing Model
| Tier | Τιμή | Όριο |
|---|---|---|
| Free | €0 | **1 έγγραφο lifetime** |
| Pay-per-use | €1/έγγραφο | one-time, +1 credit |
| Premium | €4.99/μήνα | unlimited |

**Mocked στο MVP (επιλογή β)**: τα κουμπιά «Αγορά €1» και «Premium €4.99» καλούν server functions που **πραγματικά** ενημερώνουν τη βάση (+1 credit ή `subscription_status='premium'`) ώστε να δοκιμάζεται το flow. Σε production απλά αντικαθίστανται με Stripe webhook.

## Database (Lovable Cloud)

```sql
profiles (
  id uuid PK → auth.users,
  email text,
  full_name text,
  subscription_status text default 'free',  -- 'free' | 'premium'
  total_documents_used int default 0,        -- lifetime
  pay_per_use_credits int default 0,
  created_at timestamptz default now()
)

documents (
  id uuid PK,
  user_id uuid → profiles,
  name text,
  original_file_path text,   -- Storage (το αρχικό upload, ό,τι format)
  normalized_pdf_path text,  -- Storage (το PDF μετά τη μετατροπή)
  filled_file_path text,     -- Storage (συμπληρωμένο)
  fields_json jsonb,
  created_at timestamptz default now()
)
```
- RLS: κάθε χρήστης βλέπει μόνο τα δικά του
- Trigger: auto-create profile στο signup

## Storage Buckets (private)
- `originals` — ό,τι ανέβασε
- `normalized` — το PDF μετά conversion
- `filled` — το τελικό

## Server Functions (TanStack createServerFn)

1. **`normalizeUpload({ filePath, mimeType })`**
   - PDF → pass-through
   - Image (jpg/png/webp) → embed σε PDF με `pdf-lib`
   - DOCX/DOC → external conversion API (αν λείπει key → throw user-friendly error)
   - Επιστρέφει path του normalized PDF
2. **`detectFields({ pdfPath })`**
   - Render 1ης σελίδας → base64 image (μέσω `pdfjs-dist` σε worker)
   - Στέλνει στο Lovable AI Gateway με prompt:
     > «Είσαι ειδικός σε ελληνικά επίσημα έγγραφα. Εντόπισε ΚΑΘΕ κενό πεδίο. Επέστρεψε JSON: `[{label, x, y, width, height}]` σε pixels.»
   - Επιστρέφει JSON
3. **`consumeQuota()`**
   - `premium` → ok
   - `credits > 0` → credits--
   - `total_documents_used < 1` → ++used
   - Αλλιώς → throw `QUOTA_EXCEEDED`
4. **`mockBuyCredit()`** → +1 credit (placeholder για Stripe)
5. **`mockSubscribe()`** → `subscription_status = 'premium'` (placeholder)

## Σελίδες (TanStack routes)

1. **`/`** — Landing: hero, 3 βήματα, pricing teaser, FAQ
2. **`/login`** + **`/signup`** — email/password
3. **`/dashboard`** — λίστα + «Νέο Έγγραφο», δείκτης χρήσης
4. **`/editor`** — upload zone (ένα, απλό) → loader («Επεξεργασία αρχείου…») → render PDF → AI → overlay inputs → «Εξαγωγή PDF»
5. **`/pricing`** — 3 cards (mock κουμπιά)
6. **`/account`** — status, credits, logout

## Editor Flow

1. User upload (drag/drop ή click)
2. Client: αν HEIC → `heic2any` σε JPEG
3. Upload στο `originals` bucket
4. `normalizeUpload` → επιστρέφει normalized PDF path
5. Client render με `pdfjs-dist` σε `<canvas>` (1η σελίδα, full-res)
6. `detectFields` → coords array
7. Overlay διαφανών `<input>` absolutely positioned πάνω από το canvas
8. User πληκτρολογεί → values state
9. «Εξαγωγή PDF»:
   - `consumeQuota()` (block + upgrade modal αν εξαντλημένο)
   - `pdf-lib` ανοίγει το normalized PDF, γράφει text overlay στις ίδιες coords
   - Upload στο `filled` bucket, save record
   - Download

> **Ποτέ δεν αναπαράγεται** το έγγραφο — γράφουμε μόνο πάνω στο πρωτότυπο/normalized PDF.

## Upgrade Modal (όταν `consumeQuota` αποτυγχάνει)
Δύο κουμπιά:
- «Αγορά για €1» → `mockBuyCredit` → toast «+1 credit (mock)» → ο χρήστης ξαναπατά Εξαγωγή
- «Premium €4.99/μήνα» → `mockSubscribe` → toast «Premium ενεργό (mock)»

## Design
- Παλέτα: Mediterranean blue primary, cream backgrounds, gold accents
- Font: `Manrope` (Greek support)
- Mobile-first (375px)
- Ελληνικά παντού (UI, errors, placeholders)

## MVP Scope
✅ Όλα τα παραπάνω
❌ Multi-page (μόνο 1η σελίδα στο MVP), real Stripe, OCR templates, admin

## Σημείωση εφαρμογής
Όταν προστεθεί Stripe σε επόμενη φάση, αρκεί να αντικατασταθούν οι `mockBuyCredit` / `mockSubscribe` με webhook handlers σε `/api/public/stripe-webhook` — η υπόλοιπη logic (consumeQuota, credits, status) μένει ίδια.
