import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="border-t mt-20">
      <div className="mx-auto max-w-6xl px-4 py-10 grid sm:grid-cols-3 gap-6 text-sm">
        <div>
          <div className="font-bold text-base">FormFill<span className="text-primary">.gr</span></div>
          <p className="text-muted-foreground mt-2">Συμπλήρωσε ελληνικά έγγραφα ψηφιακά. Έτοιμα για gov.gr.</p>
        </div>
        <div>
          <div className="font-semibold mb-2">Πλοήγηση</div>
          <ul className="space-y-1 text-muted-foreground">
            <li><Link to="/">Αρχική</Link></li>
            <li><Link to="/pricing">Τιμές</Link></li>
            <li><Link to="/login">Σύνδεση</Link></li>
          </ul>
        </div>
        <div className="text-muted-foreground">
          © {new Date().getFullYear()} FormFill.gr · Φτιαγμένο στην Ελλάδα
        </div>
      </div>
    </footer>
  );
}
