const DEFAULTS = {
  appOrigin: 'https://stattrackr.com',
  autoAdd: false,
  autoCapture: false,
};

const appOriginInput = document.getElementById('appOrigin');
const autoAddInput = document.getElementById('autoAdd');
const autoCaptureInput = document.getElementById('autoCapture');
const saveButton = document.getElementById('saveButton');
const statusEl = document.getElementById('status');

function setStatus(message) {
  statusEl.textContent = message;
}

chrome.storage.sync.get(DEFAULTS, (settings) => {
  appOriginInput.value = settings.appOrigin || DEFAULTS.appOrigin;
  autoAddInput.checked = Boolean(settings.autoAdd);
  autoCaptureInput.checked = Boolean(settings.autoCapture);
});

saveButton.addEventListener('click', () => {
  const appOrigin = (appOriginInput.value || DEFAULTS.appOrigin).trim().replace(/\/$/, '');
  chrome.storage.sync.set(
    {
      appOrigin,
      autoAdd: autoAddInput.checked,
      autoCapture: autoCaptureInput.checked,
    },
    () => {
      setStatus('Saved. Capture buttons on supported sportsbook pages now use these settings.');
      window.setTimeout(() => setStatus(''), 2200);
    }
  );
});
