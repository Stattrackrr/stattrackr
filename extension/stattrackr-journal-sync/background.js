const DEFAULTS = {
  appOrigin: 'https://stattrackr.com',
  autoAdd: false,
  autoCapture: false,
};

function encodePayload(value) {
  const json = JSON.stringify(value);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'OPEN_STATTRACKR_IMPORT') {
    return false;
  }

  chrome.storage.sync.get(DEFAULTS, (settings) => {
    try {
      const appOrigin = (settings.appOrigin || DEFAULTS.appOrigin).replace(/\/$/, '');
      const payload = {
        import: message.payload,
        auto_add: Boolean(settings.autoAdd),
      };
      const encoded = encodePayload(payload);
      const targetUrl = `${appOrigin}/journal/import?payload=${encodeURIComponent(encoded)}`;
      chrome.tabs.create({ url: targetUrl, active: true }, () => {
        sendResponse({ ok: true });
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : 'Failed to open StatTrackr import page',
      });
    }
  });

  return true;
});
