const DEFAULTS = {

  appOrigin: 'https://stattrackr.co',

  autoAdd: false,

  autoCapture: false,

};



const MAX_URL_PAYLOAD_CHARS = 6000;

const IMPORT_STORAGE_PREFIX = 'stattrackr-import:';



function encodePayload(value) {

  const json = JSON.stringify(value);

  return btoa(unescape(encodeURIComponent(json)))

    .replace(/\+/g, '-')

    .replace(/\//g, '_')

    .replace(/=+$/g, '');

}



function createImportKey() {

  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

}



function openImportTab(appOrigin, envelope, sendResponse) {

  const encoded = encodePayload(envelope);

  const useStorage = encoded.length > MAX_URL_PAYLOAD_CHARS;



  const finish = (errorMessage) => {

    if (errorMessage) {

      sendResponse({ ok: false, error: errorMessage });

      return;

    }

    sendResponse({ ok: true });

  };



  if (!useStorage) {

    const targetUrl = `${appOrigin}/journal/import?payload=${encodeURIComponent(encoded)}`;

    chrome.tabs.create({ url: targetUrl, active: true }, () => {

      finish(chrome.runtime.lastError?.message || null);

    });

    return;

  }



  const importKey = createImportKey();

  const storageKey = `${IMPORT_STORAGE_PREFIX}${importKey}`;

  chrome.storage.local.set({ [storageKey]: envelope }, () => {

    if (chrome.runtime.lastError) {

      finish(chrome.runtime.lastError.message);

      return;

    }



    const targetUrl = `${appOrigin}/journal/import?importKey=${encodeURIComponent(importKey)}`;

    chrome.tabs.create({ url: targetUrl, active: true }, () => {

      finish(chrome.runtime.lastError?.message || null);

    });

  });

}



chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message?.type !== 'OPEN_STATTRACKR_IMPORT') {

    return false;

  }



  chrome.storage.sync.get(DEFAULTS, (settings) => {

    try {

      const appOrigin = (settings.appOrigin || DEFAULTS.appOrigin).replace(/\/$/, '');

      const envelope = Array.isArray(message.imports) && message.imports.length > 0

        ? {

            imports: message.imports,

            import_batch_id: message.import_batch_id || null,

            auto_add: Boolean(settings.autoAdd),

          }

        : {

            import: message.payload,

            auto_add: Boolean(settings.autoAdd),

          };



      openImportTab(appOrigin, envelope, sendResponse);

    } catch (error) {

      sendResponse({

        ok: false,

        error: error && error.message ? error.message : 'Failed to open StatTrackr import page',

      });

    }

  });



  return true;

});

