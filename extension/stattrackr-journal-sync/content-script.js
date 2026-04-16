(function () {
  const BOOK_LABELS = {
    sportsbet: 'Sportsbet',
    tab: 'TAB',
    neds: 'Neds',
    ladbrokes: 'Ladbrokes',
    bet365_au: 'bet365 AU',
    unknown: 'Unknown',
  };

  const STORAGE_KEY = 'stattrackr:last-import-signature';
  const ROOT_ID = 'stattrackr-import-root';

  function getBookKey() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('sportsbet')) return 'sportsbet';
    if (host.includes('tab')) return 'tab';
    if (host.includes('neds')) return 'neds';
    if (host.includes('ladbrokes')) return 'ladbrokes';
    if (host.includes('bet365')) return 'bet365_au';
    return 'unknown';
  }

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function getVisibleText() {
    return normalizeText(document.body ? document.body.innerText : '');
  }

  function getLines() {
    return (document.body ? document.body.innerText : '')
      .split('\n')
      .map((line) => normalizeText(line))
      .filter((line) => line.length >= 3 && line.length <= 180);
  }

  function readSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          appOrigin: 'https://stattrackr.com',
          autoAdd: false,
          autoCapture: false,
        },
        resolve
      );
    });
  }

  function parseAmount(raw) {
    if (!raw) return null;
    const cleaned = String(raw).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : null;
  }

  function extractByPatterns(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return normalizeText(match[1]);
      }
    }
    return null;
  }

  function extractStake(text) {
    const raw = extractByPatterns(text, [
      /(?:stake|outlay|wager|bet amount)\s*[:\-]?\s*(\$?\s*[\d.,]+)/i,
      /(\$[\d.,]+)\s*(?:stake|outlay|wager)/i,
    ]);
    return parseAmount(raw);
  }

  function extractOdds(text) {
    const raw = extractByPatterns(text, [
      /(?:decimal odds|odds|price)\s*[:@\-]?\s*([\d.]+)/i,
      /@\s*([\d.]+)/i,
    ]);
    const value = parseAmount(raw);
    return value && value > 1 ? value : null;
  }

  function extractTicketId(text) {
    return extractByPatterns(text, [
      /(?:receipt|bet id|ticket|transaction|reference)(?:\s*(?:number|no|id))?\s*[:#-]?\s*([a-z0-9-]{5,})/i,
    ]);
  }

  function extractPlacedDate(text) {
    const direct = extractByPatterns(text, [
      /(\d{4}-\d{2}-\d{2})/,
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/,
    ]);
    if (!direct) {
      return new Date().toISOString().slice(0, 10);
    }

    const parsed = new Date(direct);
    if (Number.isNaN(parsed.getTime())) {
      return new Date().toISOString().slice(0, 10);
    }
    return parsed.toISOString().slice(0, 10);
  }

  function detectSport(text) {
    const upper = text.toUpperCase();
    if (upper.includes('AFL') || upper.includes('DISPOSALS') || upper.includes('BEHINDS')) return 'AFL';
    if (upper.includes('NBA') || upper.includes('REBOUNDS') || upper.includes('ASSISTS')) return 'NBA';
    if (upper.includes('NRL')) return 'NRL';
    if (upper.includes('NFL')) return 'NFL';
    if (upper.includes('MLB')) return 'MLB';
    if (upper.includes('NHL')) return 'NHL';
    return 'OTHER';
  }

  function isIgnoredLine(line) {
    return /^(stake|outlay|wager|odds|price|bet id|receipt|ticket|transaction|reference|cash out|collect|return|bonus|promotions?|same game multi available|available on|my bets|bet history)$/i.test(
      line
    );
  }

  function chooseSelection(lines) {
    const preferred = lines.find((line) => /.+\s+(over|under)\s+\d+(\.\d+)?\s+.+/i.test(line));
    if (preferred) return preferred;

    const secondary = lines.find(
      (line) =>
        !isIgnoredLine(line) &&
        /(to win|moneyline|head to head|spread|total|line|goals|disposals|points|rebounds|assists|marks|tackles)/i.test(line)
    );
    if (secondary) return secondary;

    return lines.find((line) => !isIgnoredLine(line)) || null;
  }

  function extractPlayerProp(selection) {
    const match = selection.match(/^(.+?)\s+(over|under)\s+([\d.]+)\s+(.+)$/i);
    if (!match) return null;
    return {
      player_name: normalizeText(match[1]),
      over_under: match[2].toLowerCase(),
      line: Number(match[3]),
      stat_type: normalizeText(match[4]).toLowerCase(),
    };
  }

  function buildMarket(selection) {
    const prop = extractPlayerProp(selection);
    if (prop) return prop.stat_type;
    if (/same game/i.test(selection)) return 'same game multi';
    if (/moneyline|head to head|to win/i.test(selection)) return 'moneyline';
    if (/spread|line/i.test(selection)) return 'spread';
    if (/total/i.test(selection)) return 'total';
    return 'sportsbook import';
  }

  function looksLikeConfirmation(text) {
    return /(bet placed|receipt|successfully placed|my bet|bet confirmation|pending result|cash out available|ticket)/i.test(
      text
    );
  }

  function buildPayload() {
    const book = getBookKey();
    const bookLabel = BOOK_LABELS[book] || BOOK_LABELS.unknown;
    const text = getVisibleText();
    const lines = getLines();

    if (!text || lines.length === 0) {
      throw new Error('No readable bet content found on this page yet.');
    }

    const selection = chooseSelection(lines);
    const stake = extractStake(text);
    const odds = extractOdds(text);

    if (!selection) {
      throw new Error('Could not identify a selection on this page.');
    }
    if (!stake) {
      throw new Error('Could not identify a stake on this page.');
    }
    if (!odds) {
      throw new Error('Could not identify decimal odds on this page.');
    }

    const playerProp = extractPlayerProp(selection);
    const sport = detectSport(text);

    return {
      source: 'extension',
      source_book: book,
      source_external_id: extractTicketId(text),
      source_page_url: window.location.href,
      parse_notes: `${bookLabel} desktop parser`,
      raw_payload: {
        title: document.title,
        text_excerpt: text.slice(0, 2500),
      },
      bet: {
        date: extractPlacedDate(text),
        sport,
        market: buildMarket(selection),
        selection,
        stake,
        currency: 'AUD',
        odds,
        bookmaker: bookLabel,
        result: 'pending',
        status: 'pending',
        ...(playerProp || {}),
      },
    };
  }

  function getSignature(payload) {
    return [
      payload.source_book,
      payload.source_external_id || '',
      payload.bet.selection,
      payload.bet.stake,
      payload.bet.odds,
      payload.bet.date,
    ].join('|');
  }

  function setStatus(root, message, tone) {
    const status = root.querySelector('[data-stattrackr-status]');
    if (!status) return;
    status.textContent = message;
    status.style.color =
      tone === 'error' ? '#fecaca' : tone === 'success' ? '#bbf7d0' : '#e9d5ff';
  }

  async function sendCurrentPage(root) {
    try {
      setStatus(root, 'Parsing page...', 'info');
      const payload = buildPayload();
      const signature = getSignature(payload);

      chrome.runtime.sendMessage(
        {
          type: 'OPEN_STATTRACKR_IMPORT',
          payload,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            setStatus(root, chrome.runtime.lastError.message, 'error');
            return;
          }
          if (!response || !response.ok) {
            setStatus(root, response?.error || 'Could not open StatTrackr import page.', 'error');
            return;
          }

          window.sessionStorage.setItem(STORAGE_KEY, signature);
          setStatus(root, 'Opened StatTrackr import page.', 'success');
        }
      );
    } catch (error) {
      setStatus(root, error && error.message ? error.message : 'Failed to parse bet.', 'error');
    }
  }

  async function maybeAutoCapture(root) {
    const settings = await readSettings();
    if (!settings.autoCapture) return;

    const text = getVisibleText();
    if (!looksLikeConfirmation(text)) return;

    try {
      const payload = buildPayload();
      const signature = getSignature(payload);
      if (window.sessionStorage.getItem(STORAGE_KEY) === signature) return;
      sendCurrentPage(root);
    } catch {
      // Ignore parse failures during passive auto-detection.
    }
  }

  function injectUi() {
    if (document.getElementById(ROOT_ID) || !document.body) return;

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
    card.style.width = '280px';
    card.style.boxShadow = '0 12px 30px rgba(15,23,42,0.45)';

    const title = document.createElement('div');
    title.textContent = 'StatTrackr Journal Sync';
    title.style.fontWeight = '700';
    title.style.fontSize = '14px';

    const sub = document.createElement('div');
    sub.textContent = `${BOOK_LABELS[getBookKey()]} parser`;
    sub.style.fontSize = '12px';
    sub.style.color = '#d8b4fe';
    sub.style.marginTop = '4px';

    const button = document.createElement('button');
    button.textContent = 'Send bet to StatTrackr';
    button.style.marginTop = '10px';
    button.style.width = '100%';
    button.style.border = '0';
    button.style.borderRadius = '10px';
    button.style.padding = '10px 12px';
    button.style.background = '#9333ea';
    button.style.color = '#fff';
    button.style.fontWeight = '700';
    button.style.cursor = 'pointer';
    button.addEventListener('click', () => sendCurrentPage(root));

    const status = document.createElement('div');
    status.setAttribute('data-stattrackr-status', 'true');
    status.textContent = 'Ready. Use on bet confirmation or receipt pages.';
    status.style.marginTop = '8px';
    status.style.fontSize = '12px';
    status.style.lineHeight = '1.4';
    status.style.color = '#e9d5ff';

    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(button);
    card.appendChild(status);
    root.appendChild(card);
    document.body.appendChild(root);

    maybeAutoCapture(root);
  }

  let injectTimer = null;
  const scheduleInject = () => {
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
  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
