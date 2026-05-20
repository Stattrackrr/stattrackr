import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'puppeteer-core';

const SERVERLESS_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

function resolveChromiumBinDir(): string | undefined {
  const candidates = [
    join(process.cwd(), 'node_modules', '@sparticuz', 'chromium', 'bin'),
    '/var/task/node_modules/@sparticuz/chromium/bin',
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'chromium.br'))) return dir;
  }
  return undefined;
}

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
      const binDir = resolveChromiumBinDir();
      if (!binDir) {
        throw new Error(
          '@sparticuz/chromium bin/*.br missing in deployment (expected node_modules/@sparticuz/chromium/bin). ' +
            'Check next.config outputFileTracingIncludes for this API route.'
        );
      }
      return chromium.executablePath(binDir);
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
      args: puppeteerCore.default.defaultArgs({
        args: [...chromium.args, ...SERVERLESS_ARGS],
        headless: 'shell',
      }),
      executablePath,
      headless: 'shell',
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
