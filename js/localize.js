const translations = {
  en: {
    downloads_title: "Downloads",
    show_all: "Download history",
    clear_all: "Clear downloads",
    files_appear: "Files you download appear here",
    pause: "Pause",
    cancel: "Cancel",
    resume: "Resume",
    retry: "Retry",
    paused: "Paused",
    canceled: "Canceled",
    show_in_folder: "Show in folder",
    deleted: "Deleted",
    left: "left",
    secs: "secs",
    mins: "mins",
    hours: "hours",
    days: "days"
  },
  fi: {
    downloads_title: "Lataukset",
    show_all: "Lataushistoria",
    clear_all: "Tyhjennä lataukset",
    files_appear: "Lataamasi tiedostot ilmestyvät tähän",
    pause: "Tauko",
    cancel: "Peruuta",
    resume: "Jatka",
    retry: "Yritä uudelleen",
    paused: "Tauotettu",
    canceled: "Peruutettu",
    show_in_folder: "Näytä kansiossa",
    deleted: "Poistettu",
    left: "jäljellä",
    secs: "sek",
    mins: "min",
    hours: "tun",
    days: "päiv"
  }
}

function getBrowserLang() {
  let navLang = (navigator.language || navigator.userLanguage || "en").toLowerCase();
  if (navLang.startsWith("fi")) return "fi";
  return "en";
}

function getAvailableLang(lang) {
  if (translations[lang]) return lang;
  return "en";
}

function getSavedLang() {
  try { return localStorage.getItem("popup_lang"); } catch (e) {}
  return null;
}

function saveLang(lang) {
  try { localStorage.setItem("popup_lang", lang); } catch (e) {}
}

function getCurrentLang() {
  const langSel = document.getElementById("language-switch");
  return getAvailableLang(
    (langSel && langSel.value) ||
    getSavedLang() ||
    getBrowserLang() ||
    "en"
  );
}

function t(key) {
  const lang = getCurrentLang();
  return (translations[lang] && translations[lang][key]) || translations["en"][key] || key;
}

function localize(lang) {
  lang = getAvailableLang(lang || getCurrentLang());
  let el;
  el = document.querySelector(".toolbar__title");
  if (el) el.textContent = translations[lang].downloads_title;
  el = document.getElementById("action-show-all");
  if (el) el.textContent = translations[lang].show_all;
  el = document.getElementById("action-clear-all");
  if (el) el.textContent = translations[lang].clear_all;
  document.querySelectorAll("#files-appear").forEach(e => {
    e.textContent = translations[lang].files_appear;
  });
}

document.addEventListener("DOMContentLoaded", function() {
  const langSel = document.getElementById("language-switch");
  let lang = getSavedLang() || getBrowserLang() || (langSel ? langSel.value : "en");
  lang = getAvailableLang(lang);
  if (langSel) langSel.value = lang;
  localize(lang);

  if (langSel) {
    langSel.addEventListener("change", e => {
      localize(e.target.value);
      saveLang(e.target.value);
      if (typeof App !== "undefined" && App.render) App.render();
    });
  }
});