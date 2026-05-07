import Link from "next/link";
import { VercelIcon } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4">
      <Link href="/" aria-label="Inicio">
        <VercelIcon className="size-6 text-foreground" />
      </Link>

      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-5xl font-semibold tracking-tight">404</h1>
        <p className="text-sm text-muted-foreground">
          No se encontró esta página.
        </p>
      </div>

      <Link
        href="/"
        className="flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
