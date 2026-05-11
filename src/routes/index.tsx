import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Upload, Sparkles, Download, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FormFill.gr — Συμπλήρωσε ελληνικά έγγραφα ψηφιακά" },
      { name: "description", content: "Ανέβασε οποιοδήποτε έγγραφο. Η AI εντοπίζει τα πεδία. Συμπλήρωσε και κατέβασε PDF έτοιμο για gov.gr." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div>
      <Header />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
          <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28 text-center relative">
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground mb-6">
              <Sparkles className="h-3.5 w-3.5 text-gold" /> Φτιαγμένο για ελληνική γραφειοκρατία
            </div>
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight max-w-3xl mx-auto">
              Συμπλήρωσε <span className="text-primary">υπεύθυνες δηλώσεις</span> ψηφιακά. Σε ένα λεπτό.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
              Ανέβασε φωτογραφία ή PDF του εγγράφου σου. Η AI εντοπίζει αυτόματα τα κενά πεδία. Πληκτρολογείς και κατεβάζεις καθαρό PDF — έτοιμο για ψηφιακή υπογραφή στο gov.gr.
            </p>
            <div className="mt-8 flex justify-center gap-3 flex-wrap">
              <Link to="/signup"><Button size="lg" className="h-12 px-7">Δοκίμασε δωρεάν</Button></Link>
              <Link to="/pricing"><Button size="lg" variant="outline" className="h-12 px-7">Δες τις τιμές</Button></Link>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">1 έγγραφο δωρεάν · χωρίς πιστωτική</div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-3xl font-bold text-center mb-12">Πώς λειτουργεί</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Upload, title: "1. Ανέβασε", text: "Σύρε ένα PDF ή φωτογράφισε το έγγραφο. Όλα τα formats δεκτά." },
              { icon: Sparkles, title: "2. Συμπλήρωσε", text: "Η AI βρίσκει τα κενά πεδία. Εσύ απλώς πληκτρολογείς." },
              { icon: Download, title: "3. Κατέβασε", text: "Καθαρό PDF, ίδιο με το πρωτότυπο. Έτοιμο για gov.gr." },
            ].map((s) => (
              <div key={s.title} className="rounded-2xl border bg-card p-6">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <s.icon className="h-5 w-5" />
                </div>
                <div className="font-semibold text-lg">{s.title}</div>
                <p className="text-sm text-muted-foreground mt-2">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section className="mx-auto max-w-6xl px-4 py-12">
          <div className="rounded-2xl bg-primary text-primary-foreground p-8 sm:p-12 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <ShieldCheck className="h-10 w-10 text-gold shrink-0" />
              <div>
                <div className="font-semibold text-lg">Δεν αλλοιώνουμε ποτέ το έγγραφό σου</div>
                <div className="text-sm opacity-90 mt-1">Γράφουμε μόνο πάνω στο πρωτότυπο. Ίδιο logo, ίδια διάταξη, μηδενική παραμόρφωση.</div>
              </div>
            </div>
            <Link to="/signup"><Button size="lg" variant="secondary">Ξεκίνα τώρα</Button></Link>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-16">
          <h2 className="text-3xl font-bold text-center mb-10">Συχνές ερωτήσεις</h2>
          <div className="space-y-4">
            {[
              ["Ποια αρχεία υποστηρίζονται;", "PDF, JPG, PNG, WebP, HEIC από iPhone. Σύντομα και Word."],
              ["Πόσο κοστίζει;", "1 έγγραφο δωρεάν για δοκιμή. Μετά €1 ανά έγγραφο ή €4.99/μήνα για απεριόριστα."],
              ["Είναι ασφαλές;", "Τα αρχεία αποθηκεύονται ιδιωτικά στον λογαριασμό σου. Μόνο εσύ έχεις πρόσβαση."],
              ["Δουλεύει με gov.gr;", "Ναι. Το PDF είναι έτοιμο για ανέβασμα και ψηφιακή υπογραφή."],
            ].map(([q, a]) => (
              <details key={q} className="rounded-xl border bg-card p-5">
                <summary className="font-semibold cursor-pointer">{q}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
