// js/localize.js

const AVAILABLE_LOCALES = [
  { value: "en", label: "🇬🇧 English" },
  { value: "fi", label: "🇫🇮 Suomi" }
];

let currentLocale = "en";
let messages = {};

function getLocaleFromStorage() {
  let locale = localStorage.getItem("popupLang");
  if (!locale) {
    locale = navigator.language ? navigator.language.substring(0, 2).toLowerCase() : "en";
  }
  if (!AVAILABLE_LOCALES.some(l => l.value === locale)) {
    locale = "en";
  }
  return locale;
}

async function fetchMessages(locale) {
  const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Locale file not found: ${locale}`);
  return resp.json();
}

async function setLocale(locale) {
  currentLocale = locale;
  localStorage.setItem("popupLang", locale);

  try {
    const json = await fetchMessages(locale);
    messages = {};
    for (const key in json) {
      messages[key] = json[key].message;
    }
    updateLanguageSwitcher(locale);
    localizeAll();
    if (typeof window.render === 'function') window.render();
  } catch (err) {
    if (locale !== "en") {
      await setLocale("en");
    } else {
      showLocaleError(err);
    }
  }
}

function t(key) {
  return messages[key] || key;
}

function updateLanguageSwitcher(selectedValue) {
  const langSwitch = document.getElementById("language-switch");
  if (!langSwitch) return;
  langSwitch.innerHTML = "";
  for (const l of AVAILABLE_LOCALES) {
    const opt = document.createElement("option");
    opt.value = l.value;
    opt.textContent = l.label;
    langSwitch.appendChild(opt);
  }
  langSwitch.value = selectedValue;
}

function localizeAll() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const msg = t(el.getAttribute("data-i18n"));
    const attr = el.getAttribute("data-i18n-attr");
    if (msg) {
      if (attr) {
        el.setAttribute(attr, msg);
      } else {
        el.textContent = msg;
      }
    }
  });
  document.title = t("downloads_title");
}

function showLocaleError(err) {
  let box = document.getElementById("popup-error-msg");
  if (!box) {
    box = document.createElement("div");
    box.id = "popup-error-msg";
    box.style.cssText = "color:#fff;background:#c00;padding:8px;font-size:13px;font-family:monospace;z-index:9999;position:fixed;top:0;left:0;width:100%;text-align:left;";
    document.body.appendChild(box);
  }
  box.textContent = "Localization error: " + (err && err.message ? err.message : err);
  console.error(err);
}

// Expose for popup/main.js
window.t = t;
window.setLocale = setLocale;
window.getLocaleFromStorage = getLocaleFromStorage;
window.localizeAll = localizeAll;
window.AVAILABLE_LOCALES = AVAILABLE_LOCALES;