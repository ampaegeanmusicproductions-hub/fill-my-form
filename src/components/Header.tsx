import { Link } from "@tanstack/react-router";
import { useAuth, signOut } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

export function Header() {
  const { user, loading } = useAuth();
  return (
    <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-4 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <FileText className="h-6 w-6" />
          </span>
          <span className="font-extrabold tracking-tight text-2xl sm:text-3xl leading-none">
            Autodilosi<span className="text-primary">.gr</span>
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          <Link to="/" className="text-muted-foreground hover:text-foreground">Αρχική</Link>
          <Link to="/pricing" className="text-muted-foreground hover:text-foreground">Τιμές</Link>
          {user && <Link to="/dashboard" className="text-muted-foreground hover:text-foreground">Πίνακας</Link>}
        </nav>
        <div className="flex items-center gap-2">
          {!loading && (user ? (
            <>
              <Link to="/account"><Button variant="ghost" size="sm">Λογαριασμός</Button></Link>
              <Button size="sm" variant="outline" onClick={() => signOut().then(() => window.location.assign("/"))}>Αποσύνδεση</Button>
            </>
          ) : (
            <>
              <Link to="/login"><Button variant="ghost" size="sm">Σύνδεση</Button></Link>
              <Link to="/signup"><Button size="sm">Εγγραφή</Button></Link>
            </>
          ))}
        </div>
      </div>
    </header>
  );
}
