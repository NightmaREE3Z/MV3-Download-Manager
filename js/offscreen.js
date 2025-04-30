const devicePixelRatio = window.devicePixelRatio;
const prefersColorSchemeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

chrome.runtime.sendMessage({
  window: {
    devicePixelRatio,
    prefersColorSchemeDark,
  },
});
