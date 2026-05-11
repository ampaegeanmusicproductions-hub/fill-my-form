import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="border-t mt-12">
      <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>© {new Date().getFullYear()} Autodilosi.gr</div>
        <div className="flex gap-5">
          <Link to="/">Όροι</Link>
          <Link to="/">Privacy</Link>
          <a href="mailto:hello@autodilosi.gr">Επικοινωνία</a>
        </div>
      </div>
    </footer>
  );
}
