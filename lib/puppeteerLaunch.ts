import type { Browser } from 'puppeteer-core';

const SERVERLESS_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

/** True when Puppeteer must use @sparticuz/chromium (Vercel/AWS), not bundled Chrome. */
export function isServerlessPuppeteerRuntime(): boolean {
  return (
    process.env.VERCEL === '1' ||
    Boolean(process.env.AWS_REGION) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.LAMBDA_TASK_ROOT)
  );
}

/**
 * Launch headless Chrome for Soccerway scrapes.
 * - Local: `puppeteer-core` + Chrome from the `puppeteer` package install
 * - Vercel serverless: `puppeteer-core` + `@sparticuz/chromium` binary
 */
export async function launchHeadlessBrowser(): Promise<Browser> {
  const puppeteerCore = await import('puppeteer-core');

  if (isServerlessPuppeteerRuntime()) {
    const chromium = (await import('@sparticuz/chromium')).default;
    chromium.setGraphicsMode = false;
    return puppeteerCore.default.launch({
      args: [...chromium.args, ...SERVERLESS_ARGS],
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const puppeteer = await import('puppeteer');
  return puppeteerCore.default.launch({
    executablePath: puppeteer.default.executablePath(),
    headless: true,
    args: SERVERLESS_ARGS,
  });
}
