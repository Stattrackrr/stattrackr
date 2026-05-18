(function () {
  const SYNC_KEY = '__STATTRACKR_JOURNAL_SYNC__';
  const SYNC = globalThis[SYNC_KEY];
  if (!SYNC) {
    return;
  }

  const SPORTSBET_IGNORE = [
    /gamblinghelponline\.org\.au/i,
    /1800\s*858\s*858/i,
    /for free and confidential support/i,
    /set a deposit limit/i,
    /quick links/i,
    /account overview/i,
    /see tracker/i,
    /tracker\s*&\s*more/i,
  ];

  const RECEIPT_SELECTORS = [
    '[data-automation-id*="bet"]',
    '[data-automation-id*="Bet"]',
    '[data-automation-id*="receipt"]',
    '[data-automation-id*="Receipt"]',
    'article',
    '[role="listitem"]',
    'li',
  ];

  function normalizeText(value) {
    return SYNC.normalizeText(value);
  }

  function isBetHistoryPage() {
    const path = window.location.pathname.toLowerCase();
    const href = window.location.href.toLowerCase();
    if (/(bet|history|my-?bets?|statement|account)/i.test(`${path} ${href}`)) {
      return true;
    }
    const sample = normalizeText(document.body?.innerText || '').slice(0, 8000);
    return /\bmy bets\b/i.test(sample);
  }

  function findResultedTab() {
    return Array.from(document.querySelectorAll('[role="tab"], button, a, span')).find((element) => {
      if (!/^resulted$/i.test(normalizeText(element.textContent))) return false;
      return (
        element.getAttribute('aria-selected') === 'true' ||
        element.getAttribute('aria-current') === 'true' ||
        /\b(active|selected|isActive|is-selected)\b/i.test(element.className || '')
      );
    });
  }

  function clickResultedTabIfNeeded() {
    if (findResultedTab()) return;
    const tab = Array.from(document.querySelectorAll('[role="tab"], button, a')).find((element) =>
      /^resulted$/i.test(normalizeText(element.textContent))
    );
    if (tab instanceof HTMLElement) tab.click();
  }

  function resolveResultedRoot() {
    clickResultedTabIfNeeded();

    const activeTab = findResultedTab();
    if (activeTab) {
      const panelId = activeTab.getAttribute('aria-controls');
      if (panelId) {
        const panel = document.getElementById(panelId);
        if (panel) return panel;
      }
    }

    return document.querySelector('main') || document.body;
  }

  function sportsbetCardConfig() {
    return {
      bookKey: 'sportsbet',
      parserName: 'resulted history',
      receiptSelectors: RECEIPT_SELECTORS,
      ignoreLinePatterns: SPORTSBET_IGNORE,
      requiredTextPatterns: [],
      requireResulted: true,
      relaxedResulted: true,
      strictAggregation: false,
      inheritDateFromAncestors: true,
      maxCardChars: 4500,
      maxClimbChars: 6500,
      maxOdds: 25000,
    };
  }

  function rankPayloads(payloads, context) {
    const ranked = payloads.sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 };
      return rank[b.parse_confidence] - rank[a.parse_confidence];
    });

    if (context.parseAll === true) {
      const minConfidence = context.minConfidence || 'low';
      const rank = { high: 3, medium: 2, low: 1 };
      const minRank = rank[minConfidence] || 1;
      return ranked.filter((payload) => rank[payload.parse_confidence] >= minRank);
    }

    if (context.autoCapture) {
      return ranked.filter((payload) => payload.parse_confidence === 'high');
    }

    const strongCandidates = ranked.filter((payload) => payload.parse_confidence !== 'low');
    return strongCandidates.length > 0 ? strongCandidates : ranked.slice(0, 1);
  }

  SYNC.registerParser('sportsbet', {
    parsePage(context) {
      const config = sportsbetCardConfig();
      const root = context?.requireResulted || isBetHistoryPage() ? resolveResultedRoot() : document.body;
      const scopes = [root, document.querySelector('main'), document.body].filter(Boolean);

      let payloads = SYNC.findParseableBetElements(scopes, config);

      if (payloads.length === 0) {
        payloads = SYNC.createBookParser(config).parsePage({
          ...context,
          minConfidence: context?.minConfidence || 'low',
        });
      }

      return rankPayloads(payloads, context);
    },
  });
})();
