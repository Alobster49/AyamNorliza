/**
 * Resolves a dynamic `errors.*` messageKey returned by a Server Action
 * against a root-namespace `next-intl` translator.
 *
 * next-intl's typed `t()` only accepts literal keys known at compile time,
 * but `messageKey` is a runtime string (e.g. "errors.identity.roles.notEditable")
 * built by the server action. Every call site would otherwise need its own
 * `as never` cast, and casting alone loses the ability to pass ICU params
 * (`t(key as never, params)` fails to typecheck because the `never` cast
 * collapses the overload to the no-params signature). This centralizes both.
 */
export function resolveMessageKey(
  // Deliberately untyped `t`: every next-intl `useTranslations()`/`getTranslations()`
  // call site returns a differently-narrowed `Translator<...>`, and this helper
  // exists precisely to bypass its literal-key typing for a runtime key.
  t: unknown,
  key: string,
  values?: Record<string, string | number>,
): string {
  return (t as (key: string, values?: Record<string, string | number>) => string)(key, values);
}
