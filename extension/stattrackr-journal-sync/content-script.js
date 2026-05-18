(function () {
  const SYNC_KEY = '__STATTRACKR_JOURNAL_SYNC__';
  const SYNC = globalThis[SYNC_KEY];
  const ROOT_ID = 'stattrackr-import-root';
  const STORAGE_KEY = 'stattrackr:last-import-signature';

  if (!SYNC) {
    console.warn('[StatTrackr] Parser bundle failed to load.');
    return;
  }

  let observerStopped = false;

  function isExtensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function formatExtensionError(error) {
    const message = String(error?.message || error || 'Extension error');
    if (/extension context invalidated/i.test(message)) {
      return 'Extension was reloaded. Refresh this Sportsbet page (F5), then try again.';
    }
    return message;
  }

  function readSettings() {
    return new Promise((resolve) => {
      if (!isExtensionAlive()) {
        resolve({
          appOrigin: 'https://stattrackr.co',
          autoAdd: false,
          autoCapture: false,
        });
        return;
      }

      try {
        chrome.storage.sync.get(
          {
            appOrigin: 'https://stattrackr.co',
            autoAdd: false,
            autoCapture: false,
          },
          (settings) => {
            if (chrome.runtime.lastError) {
              resolve({
                appOrigin: 'https://stattrackr.co',
                autoAdd: false,
                autoCapture: false,
              });
              return;
            }
            resolve(settings);
          }
        );
      } catch {
        resolve({
          appOrigin: 'https://stattrackr.co',
          autoAdd: false,
          autoCapture: false,
        });
      }
    });
  }

  function isSportsbetHistoryPage() {
    try {
      if (!SYNC?.getBookKey || !SYNC?.normalizeText) return false;
      const book = SYNC.getBookKey();
      if (book !== 'sportsbet') return false;
      const path = window.location.pathname.toLowerCase();
      const href = window.location.href.toLowerCase();
      if (/(bet|history|my-?bets?|statement|account)/i.test(`${path} ${href}`)) {
        return true;
      }
      const sample = SYNC.normalizeText(document.body?.innerText || '').slice(0, 6000);
      return /\bmy bets\b/i.test(sample);
    } catch {
      return false;
    }
  }

  function isValidImportPayload(payload) {
    return Boolean(
      payload &&
        payload.bet &&
        payload.bet.selection &&
        payload.bet.stake != null &&
        payload.bet.odds != null
    );
  }

  function filterValidPayloads(payloads) {
    return payloads.filter(isValidImportPayload);
  }

  function getSignature(payload) {
    if (!isValidImportPayload(payload)) return '';
    return [
      payload.source_book,
      payload.source_external_id || '',
      payload.bet.selection,
      payload.bet.stake,
      payload.bet.odds,
      payload.bet.date,
    ].join('|');
  }

  function getBatchSignature(payloads) {
    return filterValidPayloads(payloads)
      .map((payload) => getSignature(payload))
      .filter(Boolean)
      .join('||');
  }

  function setStatus(root, message, tone) {
    const status = root.querySelector('[data-stattrackr-status]');
    if (!status) return;
    status.textContent = message;
    status.style.color =
      tone === 'error' ? '#fecaca' : tone === 'success' ? '#bbf7d0' : '#e9d5ff';
  }

  function openImport(message, root, successMessage) {
    if (!isExtensionAlive()) {
      setStatus(
        root,
        'Extension was reloaded. Refresh this Sportsbet page (F5), then try again.',
        'error'
      );
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          setStatus(root, formatExtensionError(chrome.runtime.lastError), 'error');
          return;
        }
        if (!response || !response.ok) {
          setStatus(root, response?.error || 'Could not open StatTrackr import page.', 'error');
          return;
        }
        setStatus(root, successMessage, 'success');
      });
    } catch (error) {
      setStatus(root, formatExtensionError(error), 'error');
    }
  }

  function parsePayloads(options) {
    const payloads = SYNC.buildImportPayloads(options);
    return filterValidPayloads(SYNC.dedupePayloads(payloads));
  }

  async function sendSingleBet(root) {
    try {
      setStatus(root, 'Parsing bet...', 'info');
      const payloads = parsePayloads({ parseAll: false });
      const payload = payloads[0];
      if (!payload) {
        throw new Error('Could not identify a bet on this page.');
      }

      openImport(
        { type: 'OPEN_STATTRACKR_IMPORT', payload },
        root,
        'Opened StatTrackr import page.'
      );
      window.sessionStorage.setItem(STORAGE_KEY, getSignature(payload));
    } catch (error) {
      setStatus(root, error && error.message ? error.message : 'Failed to parse bet.', 'error');
    }
  }

  function findScrollableContainers(scope) {
    const root = scope || document.querySelector('main') || document.body;
    const matches = [];

    root.querySelectorAll('div, section, ul').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      if (element.scrollHeight <= element.clientHeight + 80) return;
      const style = window.getComputedStyle(element);
      if (!/(auto|scroll)/i.test(style.overflowY)) return;
      matches.push(element);
    });

    return matches.sort((a, b) => b.scrollHeight - a.scrollHeight).slice(0, 4);
  }

  function countVisibleBetNodes() {
    return document.querySelectorAll('[data-automation-id*="bet"], [data-automation-id*="Bet"]').length;
  }

  async function collectResultedPayloadsWhileScrolling() {
    const scrollTargets = findScrollableContainers();
    const targets = scrollTargets.length > 0 ? scrollTargets : [null];
    const collected = [];
    const parseVisible = () => {
      try {
        const batch = parsePayloads({
          parseAll: true,
          requireResulted: true,
          minConfidence: 'low',
        });
        if (Array.isArray(batch) && batch.length > 0) {
          collected.push(...batch);
        }
      } catch {
        // Keep scrolling even if one pass finds nothing.
      }
    };

    parseVisible();

    for (const target of targets) {
      if (target) target.scrollTop = 0;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    await new Promise((resolve) => window.setTimeout(resolve, 250));

    let stagnantPasses = 0;
    let lastBetNodes = countVisibleBetNodes();
    const startedAt = Date.now();

    while (Date.now() - startedAt < 35000 && stagnantPasses < 8) {
      for (const target of targets) {
        if (target) {
          target.scrollTop = target.scrollHeight;
        }
      }
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
      await new Promise((resolve) => window.setTimeout(resolve, 450));

      parseVisible();

      const betNodes = countVisibleBetNodes();
      if (betNodes <= lastBetNodes) {
        stagnantPasses += 1;
      } else {
        stagnantPasses = 0;
        lastBetNodes = betNodes;
      }
    }

    for (const target of targets) {
      if (target) target.scrollTop = 0;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });

    return SYNC.dedupePayloads(collected);
  }

  async function sendAllResultedBets(root) {
    try {
      setStatus(root, 'Loading resulted bets (scrolling)...', 'info');
      setStatus(root, 'Scanning resulted bets...', 'info');
      let payloads = [];
      try {
        payloads = await collectResultedPayloadsWhileScrolling();
      } catch (parseError) {
        throw new Error(
          parseError?.message ||
            'Failed to parse resulted bets. Reload the extension (v0.2.2) and try again.'
        );
      }

      if (payloads.length === 0) {
        throw new Error(
          'No resulted bets found. Open My Bets, select the Resulted tab, then try again.'
        );
      }

      openImport(
        {
          type: 'OPEN_STATTRACKR_IMPORT',
          imports: payloads,
          import_batch_id: crypto.randomUUID(),
        },
        root,
        `Sending ${payloads.length} bet${payloads.length === 1 ? '' : 's'} to StatTrackr...`
      );
      const signature = getBatchSignature(payloads);
      if (signature) {
        window.sessionStorage.setItem(STORAGE_KEY, signature);
      }
    } catch (error) {
      let hint = '';
      try {
        const scope = document.querySelector('main') || document.body;
        const betNodes = document.querySelectorAll(
          '[data-automation-id*="bet"], [data-automation-id*="Bet"]'
        ).length;
        hint = ` (${betNodes} bet nodes visible — scroll Resulted to load more, reload extension v0.3.6, then retry)`;
      } catch {
        // ignore
      }
      setStatus(
        root,
        (error && error.message ? error.message : 'Failed to parse resulted bets.') + hint,
        'error'
      );
    }
  }

  async function maybeAutoCapture(root) {
    const settings = await readSettings();
    if (!settings.autoCapture || isSportsbetHistoryPage()) return;

    try {
      const payloads = parsePayloads({ autoCapture: true, parseAll: false });
      const payload = payloads[0];
      if (!payload) return;
      const signature = getSignature(payload);
      if (window.sessionStorage.getItem(STORAGE_KEY) === signature) return;

      openImport(
        { type: 'OPEN_STATTRACKR_IMPORT', payload },
        root,
        'Auto-captured bet and opened StatTrackr.'
      );
      window.sessionStorage.setItem(STORAGE_KEY, signature);
    } catch {
      // Ignore parse failures during passive auto-detection.
    }
  }

  function injectUi() {
    if (document.getElementById(ROOT_ID) || !document.body) return;

    if (!isExtensionAlive()) {
      const stale = document.getElementById(ROOT_ID);
      if (stale) {
        setStatus(
          stale,
          'Extension was reloaded. Refresh this Sportsbet page (F5), then import again.',
          'error'
        );
      }
      return;
    }

    const bookKey = SYNC.getBookKey();
    const bookLabel = SYNC.getBookLabel(bookKey);
    const historyPage = isSportsbetHistoryPage();

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.style.position = 'fixed';
    root.style.right = '16px';
    root.style.bottom = '16px';
    root.style.zIndex = '2147483647';
    root.style.fontFamily = 'Arial, sans-serif';

    const card = document.createElement('div');
    card.style.background = 'rgba(8,18,32,0.96)';
    card.style.color = '#ffffff';
    card.style.border = '1px solid rgba(168,85,247,0.4)';
    card.style.borderRadius = '14px';
    card.style.padding = '12px';
    card.style.width = historyPage ? '300px' : '280px';
    card.style.boxShadow = '0 12px 30px rgba(15,23,42,0.45)';

    const title = document.createElement('div');
    title.textContent = 'StatTrackr Journal Sync';
    title.style.fontWeight = '700';
    title.style.fontSize = '14px';

    const sub = document.createElement('div');
    sub.textContent = historyPage
      ? `${bookLabel} · Resulted import`
      : `${bookLabel} parser`;
    sub.style.fontSize = '12px';
    sub.style.color = '#d8b4fe';
    sub.style.marginTop = '4px';

    const primaryButton = document.createElement('button');
    primaryButton.textContent = historyPage
      ? 'Import all resulted bets'
      : 'Send bet to StatTrackr';
    primaryButton.style.marginTop = '10px';
    primaryButton.style.width = '100%';
    primaryButton.style.border = '0';
    primaryButton.style.borderRadius = '10px';
    primaryButton.style.padding = '10px 12px';
    primaryButton.style.background = '#9333ea';
    primaryButton.style.color = '#fff';
    primaryButton.style.fontWeight = '700';
    primaryButton.style.cursor = 'pointer';
    primaryButton.addEventListener('click', () => {
      if (historyPage) {
        sendAllResultedBets(root);
      } else {
        sendSingleBet(root);
      }
    });

    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(primaryButton);

    if (historyPage) {
      const secondaryButton = document.createElement('button');
      secondaryButton.textContent = 'Import visible bet only';
      secondaryButton.style.marginTop = '8px';
      secondaryButton.style.width = '100%';
      secondaryButton.style.border = '1px solid rgba(168,85,247,0.35)';
      secondaryButton.style.borderRadius = '10px';
      secondaryButton.style.padding = '9px 12px';
      secondaryButton.style.background = 'transparent';
      secondaryButton.style.color = '#e9d5ff';
      secondaryButton.style.fontWeight = '600';
      secondaryButton.style.cursor = 'pointer';
      secondaryButton.addEventListener('click', () => sendSingleBet(root));
      card.appendChild(secondaryButton);
    }

    const status = document.createElement('div');
    status.setAttribute('data-stattrackr-status', 'true');
    status.textContent = historyPage
      ? 'Open the Resulted tab, scroll to load bets, then import all.'
      : 'Ready. Use on bet confirmation or receipt pages.';
    status.style.marginTop = '8px';
    status.style.fontSize = '12px';
    status.style.lineHeight = '1.4';
    status.style.color = '#e9d5ff';

    card.appendChild(status);
    root.appendChild(card);
    document.body.appendChild(root);

    maybeAutoCapture(root);
  }

  let injectTimer = null;
  let observer = null;

  const scheduleInject = () => {
    if (!isExtensionAlive()) {
      if (!observerStopped) {
        observerStopped = true;
        observer?.disconnect();
      }
      const root = document.getElementById(ROOT_ID);
      if (root) {
        setStatus(
          root,
          'Extension was reloaded. Refresh this Sportsbet page (F5), then import again.',
          'error'
        );
      }
      return;
    }

    if (injectTimer) {
      window.clearTimeout(injectTimer);
    }
    injectTimer = window.setTimeout(() => {
      injectUi();
      const root = document.getElementById(ROOT_ID);
      if (root) {
        maybeAutoCapture(root);
      }
    }, 350);
  };

  injectUi();
  observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
