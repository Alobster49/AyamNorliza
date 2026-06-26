import "server-only";

import bwipjs from "bwip-js/node";
import { buildIdentifierPayload } from "../domain";
import type { QrIdentifier } from "../types";

export function renderIdentifierSvg(input: {
  identifier: QrIdentifier;
  organizationSlug: string;
  baseUrl: string;
}): string {
  const text =
    input.identifier.symbology === "qr"
      ? buildIdentifierPayload({
          baseUrl: input.baseUrl,
          organizationSlug: input.organizationSlug,
          printableCode: input.identifier.printableCode,
        })
      : input.identifier.printableCode;

  const options = {
    bcid: input.identifier.symbology === "qr" ? "qrcode" : "code128",
    text,
    scale: input.identifier.symbology === "qr" ? 3 : 2,
    includetext: input.identifier.symbology === "code128",
    textxalign: "center" as const,
  };

  return bwipjs.toSVG(
    input.identifier.symbology === "qr"
      ? options
      : {
          ...options,
          height: 18,
        },
  );
}
