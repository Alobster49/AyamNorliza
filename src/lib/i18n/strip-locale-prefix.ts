import { SUPPORTED_LOCALES } from "./locales";

/**
 * Drops a leading `/en` or `/ms` so path comparisons can be written once
 * against unprefixed paths. Returns "/" for a bare locale root.
 *
 * The query/hash is split off before checking the first segment and
 * reattached after - without this, `stripLocalePrefix("/en?foo=1")` would
 * see the first segment as the string `"en?foo=1"`, match nothing, and
 * return the value unchanged (producing a doubled-up "/en/en?foo=1" once a
 * caller re-prefixes it).
 */
export function stripLocalePrefix(path: string): string {
  const match = /^([^?#]*)([?#].*)?$/.exec(path);
  const pathname = match?.[1] ?? path;
  const suffix = match?.[2] ?? "";

  const [, first, ...rest] = pathname.split("/");
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(first ?? "")) {
    return path;
  }
  const remainder = rest.join("/");
  const strippedPathname = remainder ? `/${remainder}` : "/";
  return `${strippedPathname}${suffix}`;
}
