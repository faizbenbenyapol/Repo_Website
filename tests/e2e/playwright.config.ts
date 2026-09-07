import { defineConfig, devices } from '@playwright/test';

/** ยิงใส่อิมเมจจริงที่ compose ยกขึ้น ไม่ใช่เซิร์ฟเวอร์พัฒนา */
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://web:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
