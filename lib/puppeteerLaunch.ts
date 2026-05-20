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

/** @sparticuz/chromium unpacks to a shared path — concurrent calls cause spawn ETXTBSY on Vercel. */
let serverlessExecutablePathPromise: Promise<string> | null = null;
let serverlessLaunchGate: Promise<void> = Promise.resolve();

async function getServerlessChromiumExecutablePath(): Promise<string> {
  if (!serverlessExecutablePathPromise) {
    serverlessExecutablePathPromise = (async () => {
      const chromium = (await import('@sparticuz/chromium')).default;
      chromium.setGraphicsMode = false;
      return chromium.executablePath();
    })();
  }
  return serverlessExecutablePathPromise;
}

function withServerlessLaunchLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = serverlessLaunchGate.then(fn, fn);
  serverlessLaunchGate = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function launchServerlessBrowser(): Promise<Browser> {
  return withServerlessLaunchLock(async () => {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteerCore = await import('puppeteer-core');
    const executablePath = await getServerlessChromiumExecutablePath();
    return puppeteerCore.default.launch({
      args: [...chromium.args, ...SERVERLESS_ARGS],
      executablePath,
      headless: true,
    });
  });
}

/**
 * Launch headless Chrome for Soccerway scrapes.
 * - Local: `puppeteer-core` + Chrome from the `puppeteer` package install
 * - Vercel serverless: `puppeteer-core` + `@sparticuz/chromium` binary
 */
export async function launchHeadlessBrowser(): Promise<Browser> {
  if (isServerlessPuppeteerRuntime()) {
    return launchServerlessBrowser();
  }

  const puppeteerCore = await import('puppeteer-core');
  const puppeteer = await import('puppeteer');
  return puppeteerCore.default.launch({
    executablePath: puppeteer.default.executablePath(),
    headless: true,
    args: SERVERLESS_ARGS,
  });
}
