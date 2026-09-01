import { expect, test as base } from "@playwright/test";

import { collectConsoleErrors } from "./helpers.mjs";

export const test = base.extend({
  consoleErrors: async ({ page }, use) => {
    const errors = collectConsoleErrors(page);
    await use(errors);
  },
});

export { expect };