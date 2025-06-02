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
    locale = navigator.language ? navigator.language.substring(0, 2) : "en";
  }
  if (!AVAILABLE_LOCALES.some(l => l.value === locale)) {
    locale = "en";
  }
  return locale;
}

function setLocale(locale) {
  currentLocale = locale;
  localStorage.setItem("popupLang", locale);
  return fetch(`/_locales/${locale}/messages.json`)
    .then(resp => {
      if (!resp.ok) throw new Error("Locale not found");
      return resp.json();
    })
    .then(json => {
      messages = {};
      for (const key in json) {
        messages[key] = json[key].message;
      }
      updateLanguageSwitcher(locale);
      localizeAll();
      if (typeof window.render === 'function') {
        window.render();
      }
    })
    .catch(err => {
      if (window.onerror) window.onerror(err.message, "localize.js", 0, 0, err);
    });
}

function t(key) {
  return messages[key] || key;
}

function updateLanguageSwitcher(selectedValue) {
  const langSwitch = document.getElementById("language-switch");
  if (!langSwitch) return;
  langSwitch.innerHTML = "";
  AVAILABLE_LOCALES.forEach(l => {
    const opt = document.createElement("option");
    opt.value = l.value;
    opt.textContent = l.label;
    langSwitch.appendChild(opt);
  });
  langSwitch.value = selectedValue;
}

function localizeAll() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const msg = t(el.getAttribute("data-i18n"));
    if (msg) el.textContent = msg;
  });
  document.title = t("downloads_title");
}

// Expose for main.js
window.t = t;
window.setLocale = setLocale;
window.getLocaleFromStorage = getLocaleFromStorage;
window.localizeAll = localizeAll;
window.AVAILABLE_LOCALES = AVAILABLE_LOCALES;