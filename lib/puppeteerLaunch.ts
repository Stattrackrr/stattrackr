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
 * - Local / GitHub Actions dev: full `puppeteer` with downloaded Chrome
 * - Vercel serverless: `puppeteer-core` + `@sparticuz/chromium` binary
 */
export async function launchHeadlessBrowser(): Promise<Browser> {
  if (isServerlessPuppeteerRuntime()) {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteerCore = await import('puppeteer-core');
    if ('setGraphicsMode' in chromium && typeof chromium.setGraphicsMode === 'function') {
      chromium.setGraphicsMode(false);
    }
    return puppeteerCore.default.launch({
      args: [...chromium.args, ...SERVERLESS_ARGS],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  const puppeteer = await import('puppeteer');
  return puppeteer.default.launch({
    headless: true,
    args: SERVERLESS_ARGS,
  });
}
