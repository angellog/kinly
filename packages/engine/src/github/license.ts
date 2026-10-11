import type { LicenseClass } from "../types.js";

/**
 * Licence classification. SPDX ids first; when GitHub reports "NOASSERTION"
 * or "Other", the licence text is inspected for the source-available
 * families that matter commercially (SUL, BSL, Elastic, FSL, Commons Clause,
 * PolyForm, SSPL).
 */

const PERMISSIVE = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSD-3-Clause-Clear",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "Zlib",
  "BSL-1.0", // Boost Software License (not Business Source License)
  "PostgreSQL",
  "WTFPL",
  "MIT-0",
  "Python-2.0",
  "NCSA",
  "Artistic-2.0",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
]);

const WEAK_COPYLEFT = new Set(["MPL-2.0", "LGPL-2.1", "LGPL-3.0", "LGPL-2.1-only", "LGPL-3.0-only", "LGPL-2.1-or-later", "LGPL-3.0-or-later", "EPL-1.0", "EPL-2.0", "CDDL-1.0", "OSL-3.0", "CC-BY-SA-4.0", "EUPL-1.2", "MS-RL"]);

const STRONG_COPYLEFT = new Set(["GPL-2.0", "GPL-3.0", "GPL-2.0-only", "GPL-3.0-only", "GPL-2.0-or-later", "GPL-3.0-or-later", "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later"]);

const SOURCE_AVAILABLE_SPDX = new Set(["BUSL-1.1", "SSPL-1.0", "Elastic-2.0", "PolyForm-Noncommercial-1.0.0", "PolyForm-Shield-1.0.0", "FSL-1.1-MIT", "FSL-1.1-Apache-2.0", "LicenseRef-SUL", "Commons-Clause", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "CC-BY-NC-ND-4.0"]);

const SOURCE_AVAILABLE_TEXT: Array<[RegExp, string]> = [
  [/sustainable use licen[cs]e/i, "Sustainable Use License"],
  [/business source licen[cs]e/i, "BUSL"],
  [/server side public licen[cs]e/i, "SSPL"],
  [/elastic licen[cs]e/i, "Elastic License"],
  [/functional source licen[cs]e/i, "FSL"],
  [/commons clause/i, "Commons Clause"],
  [/polyform/i, "PolyForm"],
  [/fair[- ]?core licen[cs]e/i, "Fair Core License"],
  [/non-?commercial/i, "non-commercial clause"],
  [/may not (be )?use[d]? (this software |it )?(for|in) (any )?commercial/i, "non-commercial clause"],
];

export function classifyLicense(spdx: string | null | undefined, licenseText?: string | null): { license_class: LicenseClass; note: string | null } {
  const id = (spdx ?? "").trim();
  if (id && PERMISSIVE.has(id)) return { license_class: "permissive", note: null };
  if (id && WEAK_COPYLEFT.has(id)) return { license_class: "weak-copyleft", note: null };
  if (id && STRONG_COPYLEFT.has(id)) return { license_class: "strong-copyleft", note: null };
  if (id && SOURCE_AVAILABLE_SPDX.has(id)) return { license_class: "source-available", note: id };
  if (licenseText) {
    for (const [re, label] of SOURCE_AVAILABLE_TEXT) {
      if (re.test(licenseText)) return { license_class: "source-available", note: label };
    }
    if (/apache license/i.test(licenseText) && /version 2\.0/i.test(licenseText)) return { license_class: "permissive", note: "Apache-2.0 (from text)" };
    if (/permission is hereby granted, free of charge/i.test(licenseText)) return { license_class: "permissive", note: "MIT-style (from text)" };
    if (/gnu lesser general public license/i.test(licenseText)) return { license_class: "weak-copyleft", note: "LGPL (from text)" };
    if (/gnu affero general public license/i.test(licenseText)) return { license_class: "strong-copyleft", note: "AGPL (from text)" };
    if (/gnu general public license/i.test(licenseText)) return { license_class: "strong-copyleft", note: "GPL (from text)" };
  }
  if (!id || id === "NOASSERTION" || id === "Other") return { license_class: licenseText ? "unknown" : "none", note: id || null };
  return { license_class: "unknown", note: id };
}

/** Human label for a class, used in reports. */
export const LICENSE_CLASS_LABEL: Record<LicenseClass, string> = {
  permissive: "permissive",
  "weak-copyleft": "weak copyleft",
  "strong-copyleft": "strong copyleft",
  "source-available": "source-available (restricted)",
  none: "no licence",
  unknown: "unknown",
};
