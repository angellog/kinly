import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyLicense } from "../src/github/license.js";

describe("licence classes", () => {
  const cases: Array<[string | null, string | null, string]> = [
    ["MIT", null, "permissive"],
    ["Apache-2.0", null, "permissive"],
    ["BSD-3-Clause", null, "permissive"],
    ["MPL-2.0", null, "weak-copyleft"],
    ["LGPL-3.0", null, "weak-copyleft"],
    ["GPL-3.0", null, "strong-copyleft"],
    ["AGPL-3.0", null, "strong-copyleft"],
    ["BUSL-1.1", null, "source-available"],
    ["SSPL-1.0", null, "source-available"],
    [null, null, "none"],
    ["NOASSERTION", "This software is licensed under the Sustainable Use License… you may not use it for commercial purposes", "source-available"],
    ["NOASSERTION", "Functional Source License, Version 1.1", "source-available"],
    ["Other", "Licensed under the Commons Clause", "source-available"],
    ["NOASSERTION", "Permission is hereby granted, free of charge, to any person obtaining a copy", "permissive"],
    ["NOASSERTION", "GNU LESSER GENERAL PUBLIC LICENSE … the GNU General Public License", "weak-copyleft"],
    ["NOASSERTION", "GNU AFFERO GENERAL PUBLIC LICENSE Version 3", "strong-copyleft"],
    ["NOASSERTION", "All rights reserved, see terms", "unknown"],
  ];
  for (const [spdx, text, expected] of cases) {
    it(`${spdx ?? "none"}${text ? ` + "${text.slice(0, 30)}…"` : ""} → ${expected}`, () => {
      assert.equal(classifyLicense(spdx, text).license_class, expected);
    });
  }
});
