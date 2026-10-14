import { expect, test as setup } from "@playwright/test";
import { DEMO_USERS, resetDemoPermissions, sessionFile } from "./demo-users";

// Signs each demo user in once per run and saves the session, so the
// signed-in tests don't each sign in again (Supabase limits sign-ins to
// roughly 30 per 5 minutes per address).

const password = process.env.DEMO_USER_PASSWORD;
const enabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && password) && process.env.COAST_ENV !== "production";

setup("reset demo permissions to defaults", async () => {
  setup.skip(!enabled, "Dev database or DEMO_USER_PASSWORD not configured");
  await resetDemoPermissions();
});

for (const email of DEMO_USERS) {
  setup(`sign in ${email}`, async ({ page }) => {
    setup.skip(!enabled, "Dev database or DEMO_USER_PASSWORD not configured");
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in to the app" }).click();
    await expect(page).toHaveURL(/\/app\/home/, { timeout: 20_000 });
    await page.context().storageState({ path: sessionFile(email) });
  });
}
