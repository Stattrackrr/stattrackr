(function () {
  const params = new URLSearchParams(window.location.search);
  const importKey = params.get('importKey');
  if (!importKey || !window.location.pathname.includes('/journal/import')) {
    return;
  }

  const storageKey = `stattrackr-import:${importKey}`;

  chrome.storage.local.get([storageKey], (result) => {
    if (chrome.runtime.lastError) {
      console.error('[StatTrackr] Import bridge:', chrome.runtime.lastError.message);
      return;
    }

    const payload = result[storageKey];
    if (!payload) {
      return;
    }

    try {
      sessionStorage.setItem('stattrackr-extension-import', JSON.stringify(payload));
    } catch (error) {
      console.error('[StatTrackr] Import bridge failed to stage payload:', error);
      return;
    }

    chrome.storage.local.remove(storageKey);
  });
})();
