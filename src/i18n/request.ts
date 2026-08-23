import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  // Corresponds to the `[locale]` segment. It can be undefined for requests
  // that never went through the middleware, so it is validated, not trusted.
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Malaysia has no DST and the whole business runs in one zone. Setting it
    // explicitly stops server and client from formatting dates differently.
    timeZone: "Asia/Kuala_Lumpur",
  };
});
