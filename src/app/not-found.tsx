import "./globals.css";

/**
 * Rendered for paths outside any `[locale]` segment — which after the
 * middleware means genuinely unroutable URLs. It carries its own document
 * because there is no root layout above it any more.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
          <h1 className="text-2xl font-semibold">Page not found</h1>
          <p className="text-muted-foreground">
            The page you are looking for does not exist.
          </p>
          <a className="underline" href="/en">
            Go home
          </a>
        </main>
      </body>
    </html>
  );
}
