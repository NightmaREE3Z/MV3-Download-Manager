// MV3 Download Manager main.js/popup script

window.onerror = function(message, source, lineno, colno, error) {
  let errBox = document.getElementById("popup-error-msg");
  if (!errBox) {
    errBox = document.createElement("div");
    errBox.id = "popup-error-msg";
    errBox.style.cssText = "color:#fff;background:#c00;padding:8px;font-size:13px;font-family:monospace;z-index:9999;position:fixed;top:0;left:0;width:100%;text-align:left;";
    document.body.appendChild(errBox);
  }
  errBox.textContent = "Popup Error: " + message;
  return false;
};

function $(selector) {
  return document.querySelector(selector);
}

function on(el, event, fn) {
  if (el) el.addEventListener(event, fn);
}

const Format = {
  toByte(bytes) {
    if (!bytes && bytes !== 0) return "0 B";
    if (bytes < 1000) return bytes + " B";
    if (bytes < 1000 * 1000) return (bytes / 1000).toFixed() + " KB";
    if (bytes < 1000 * 1000 * 10) return (bytes / 1000 / 1000).toFixed(1) + " MB";
    if (bytes < 1000 * 1000 * 1000) return (bytes / 1000 / 1000).toFixed() + " MB";
    if (bytes < 1000 * 1000 * 1000 * 1000) return (bytes / 1000 / 1000 / 1000).toFixed(1) + " GB";
    return bytes + " B";
  },
  toTime(sec) {
    if (sec < 60) return Math.ceil(sec) + " " + t("secs");
    if (sec < 60 * 5) return Math.floor(sec / 60) + " " + t("mins") + " " + Math.ceil(sec % 60) + " " + t("secs");
    if (sec < 60 * 60) return Math.ceil(sec / 60) + " " + t("mins");
    if (sec < 60 * 60 * 5) return Math.floor(sec / 60 / 60) + " " + t("hours") + " " + (Math.ceil(sec % 60) % 60) + " " + t("mins");
    if (sec < 60 * 60 * 24) return Math.ceil(sec / 60 / 60) + " " + t("hours");
    return Math.ceil(sec / 60 / 60 / 24) + " " + t("days");
  }
};

const DEFAULT_DOWNLOAD_ICON =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><g fill='none' stroke='%230b57d0' stroke-width='2'><path d='M12 3v13'/><path d='M7 13l5 5 5-5'/><rect x='3' y='21' width='18' height='2' rx='1' fill='%230b57d0'/></g></svg>";

const Template = {
  button(type, action, text) {
    const btn = document.createElement("button");
    btn.className = `button button--${type}`;
    btn.setAttribute("data-action", action);
    btn.textContent = text;
    return btn;
  },
  buttonShowMore() {
    const btn = document.createElement("button");
    btn.className = "button button--secondary button--block";
    btn.setAttribute("data-action", "more");
    btn.textContent = "Show more";
    return btn;
  },
  tinyXButton() {
    const btn = document.createElement("button");
    btn.className = "tiny-x";
    btn.setAttribute("data-action", "erase");
    btn.setAttribute("title", t("remove") || "Remove");
    btn.setAttribute("aria-label", t("remove") || "Remove");
    btn.type = "button";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "11");
    svg.setAttribute("height", "11");
    svg.setAttribute("viewBox", "0 0 11 11");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M2 2L9 9M9 2L2 9");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "square");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    btn.appendChild(svg);
    return btn;
  },
  downloadItem(event) {
    const container = document.createElement("div");
    container.id = `download-${event.id}`;
    container.className = `list__item download${!event.exists ? " removed" : ""} ${event.state === "complete" ? "complete" : ""} ${event.state === "interrupted" ? "canceled" : ""} ${event.paused ? "paused" : ""}`;
    container.setAttribute("data-id", event.id);
    if (event.state === "complete" || event.state === "interrupted") {
      const xWrap = document.createElement("div");
      xWrap.className = "tiny-x-wrap";
      xWrap.appendChild(this.tinyXButton());
      container.appendChild(xWrap);
    }
    const iconDiv = document.createElement("div");
    iconDiv.className = "list__item__icon";
    const iconImg = document.createElement("img");
    iconImg.id = `icon-${event.id}`;
    iconDiv.appendChild(iconImg);
    container.appendChild(iconDiv);

    const content = document.createElement("div");
    content.className = "list__item__content";
    const filename = document.createElement("p");
    filename.className = "list__item__filename";
    filename.title = App.getProperFilename(event.filename);
    filename.setAttribute("data-action", "open");
    filename.textContent = App.getProperFilename(event.filename);
    content.appendChild(filename);

    const source = document.createElement("a");
    source.className = "list__item__source";
    source.href = event.finalUrl;
    source.setAttribute("data-action", "url");
    source.title = event.finalUrl;
    source.textContent = event.finalUrl;
    content.appendChild(source);

    if (event.state === "in_progress" && !event.paused) {
      const progress = document.createElement("div");
      progress.className = "progress";
      const progressBar = document.createElement("div");
      progressBar.className = "progress__bar";
      if (event.totalBytes > 0) {
        progressBar.style.width = ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
      }
      progress.appendChild(progressBar);
      content.appendChild(progress);
    }

    const controls = document.createElement("div");
    controls.className = "list__item__controls";
    const buttons = document.createElement("div");
    buttons.className = "list__item__buttons";
    if (event.state === "complete") {
      buttons.appendChild(this.button("secondary", "show", t("show_in_folder")));
    } else if (event.state === "interrupted") {
      buttons.appendChild(this.button("primary", "retry", t("retry")));
    } else if (event.paused) {
      buttons.appendChild(this.button("primary", "resume", t("resume")));
      buttons.appendChild(this.button("secondary", "cancel", t("cancel")));
    } else {
      buttons.appendChild(this.button("primary", "pause", t("pause")));
      buttons.appendChild(this.button("secondary", "cancel", t("cancel")));
    }
    controls.appendChild(buttons);
    const status = document.createElement("div");
    status.className = "list__item__status status";
    if (event.state === "complete") {
      status.textContent = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
    } else if (event.state === "interrupted") {
      status.textContent = event.error === "NETWORK_FAILED" ? "Failed - Network error" : t("canceled");
    } else if (event.paused) {
      status.textContent = t("paused");
    } else if (event.state === "in_progress") {
      status.textContent = "";
    }
    controls.appendChild(status);
    content.appendChild(controls);
    container.appendChild(content);
    return container;
  }
};

document.addEventListener("DOMContentLoaded", function() {
  let debounceTimeout = null;
  let pollInterval = null;
  let pollingFast = false;
  let timers = {};
  let resultsLength = 0;
  let resultsLimit = 10;

  function scheduleRender() {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(render, 200);
  }

  function setAdaptivePolling(inProgress = false) {
    if (pollInterval) clearInterval(pollInterval);
    pollingFast = inProgress;
    // Defensive: never poll faster than 1200ms
    pollInterval = setInterval(scheduleRender, inProgress ? 1200 : 3500);
  }

  function updateDownloadsView(results) {
    const downloadsEl = $("#downloads");
    if (!downloadsEl) return;
    const emptyTmpl = $("#tmpl__state-empty");
    if (!results || results.length === 0) {
      if (emptyTmpl) {
        const clone = document.importNode(emptyTmpl.content, true);
        while (downloadsEl.firstChild) downloadsEl.removeChild(downloadsEl.firstChild);
        downloadsEl.appendChild(clone);
        if (typeof localize === "function") localize();
      }
      return;
    }
    while (downloadsEl.firstChild) downloadsEl.removeChild(downloadsEl.firstChild);
    results.forEach((item) => {
      const node = Template.downloadItem(item);
      downloadsEl.appendChild(node);
      const iconImg = node.querySelector(`#icon-${item.id}`);
      if (iconImg) {
        if (item.state === "in_progress" || item.paused) {
          iconImg.src = DEFAULT_DOWNLOAD_ICON;
        } else if (chrome?.downloads?.getFileIcon) {
          chrome.downloads.getFileIcon(item.id, { size: 32 }, (iconURL) => {
            if (iconURL && iconImg.src !== iconURL) iconImg.src = iconURL;
          });
        }
      }
      if (item.state === "in_progress" && !item.paused) {
        startTimer(item.id);
      } else {
        stopTimer(item.id);
      }
    });
    if (resultsLength > resultsLimit) {
      downloadsEl.appendChild(Template.buttonShowMore());
    }
  }

  function render() {
    if (!chrome?.downloads?.search) return;
    chrome.downloads.search(
      {
        limit: resultsLimit + 10,
        filenameRegex: ".+",
        orderBy: ["-startTime"]
      },
      (data) => {
        if (chrome.runtime.lastError) {
          window.onerror(chrome.runtime.lastError.message, "main.js", 0, 0, chrome.runtime.lastError);
          return;
        }
        data = data.filter(item => {
          if (
            item.state === "interrupted" &&
            (
              item.error === "USER_CANCELED" ||
              item.error === "USER_CANCELLED" ||
              item.error === "CANCELED"
            ) &&
            item.exists === false
          ) {
            try { chrome.downloads.erase({ id: item.id }); } catch (e) {}
            return false;
          }
          return true;
        });

        data.sort((a, b) => {
          if (a.filename === b.filename) {
            if (a.state === "in_progress" && b.state === "interrupted") return -1;
            if (a.state === "interrupted" && b.state === "in_progress") return 1;
            if (a.state === "complete" && b.state === "interrupted") return -1;
            if (a.state === "interrupted" && b.state === "complete") return 1;
            return new Date(b.startTime) - new Date(a.startTime);
          }
          return new Date(b.startTime) - new Date(a.startTime);
        });

        resultsLength = data.length;
        updateDownloadsView(data.slice(0, resultsLimit));
        const anyInProgress = data.some(d => d.state === "in_progress" && !d.paused);
        if (anyInProgress !== pollingFast) setAdaptivePolling(anyInProgress);
      }
    );
  }

  function handleClick(event) {
    try {
      const action = event.target.dataset.action;
      if (!action) return;
      event.preventDefault();
      if (action === "url") {
        if (chrome?.tabs?.create) chrome.tabs.create({ url: event.target.href, selected: true });
        return;
      }
      if (action === "more") {
        if (chrome?.tabs?.create) chrome.tabs.create({ url: "chrome://downloads", selected: true });
        return;
      }
      const $el = event.target.closest(".download");
      if (!$el) return;
      const id = +$el.dataset.id;
      if (["resume", "cancel", "pause"].includes(action)) {
        chrome.downloads[action](id);
        refreshDownloadView(id);
        if (action === "resume") startTimer(id); else stopTimer(id);
      } else if (action === "retry") {
        chrome.downloads.search({ id: id }, (results) => {
          if (chrome.runtime.lastError) {
            window.onerror(chrome.runtime.lastError.message, "main.js", 0, 0, chrome.runtime.lastError);
            return;
          }
          if (results[0]) {
            chrome.downloads.download({ url: results[0].url }, (new_id) => {
              if (chrome.runtime.lastError) {
                window.onerror(chrome.runtime.lastError.message, "main.js", 0, 0, chrome.runtime.lastError);
                return;
              }
              startTimer(new_id);
              render();
              setTimeout(render, 400);
            });
          }
        });
      } else if (action === "erase") {
        chrome.downloads.erase({ id: id }, () => {
          const $list = $el.parentNode;
          if ($list) {
            $list.removeChild($el);
            stopTimer(id);
            render();
          }
        });
      } else if (action === "show") {
        chrome.downloads.show(id);
      } else if (action === "open") {
        chrome.downloads.open(id);
      }
    } catch (e) {
      window.onerror(e.message, "main.js", 0, 0, e);
    }
  }

  function refreshDownloadView(id) {
    chrome.downloads.search({ id: id }, (results) => {
      if (chrome.runtime.lastError) {
        window.onerror(chrome.runtime.lastError.message, "main.js", 0, 0, chrome.runtime.lastError);
        return;
      }
      if (results[0]) render();
    });
  }

  function clearAllDownloadsExceptRunning(callback) {
    chrome.downloads.search({}, (results) => {
      if (chrome.runtime.lastError) {
        window.onerror(chrome.runtime.lastError.message, "main.js", 0, 0, chrome.runtime.lastError);
        return;
      }
      const running = results.filter((item) => item.state === "in_progress");
      results.forEach((item) => {
        if (item.state !== "in_progress" && item.id) {
          chrome.downloads.erase({ id: item.id });
          stopTimer(item.id);
        }
      });
      if (callback) callback(running);
    });
  }

  function startTimer(id) {
    stopTimer(id);
    const timer = () => {
      try {
        const $el = $(`#download-${id}`);
        if (!$el) return;
        const $status = $el.querySelector(".status");
        chrome.downloads.search({ id: id }, (results) => {
          if (chrome.runtime.lastError) {
            stopTimer(id);
            return;
          }
          const event = results[0];
          if (!event) {
            stopTimer(id);
            render();
            return;
          }
          if (event.state === "in_progress" && !event.paused) {
            let speed = 0, bytesReceived = event.bytesReceived || 0, totalBytes = event.totalBytes || 0;
            let speedText = "0 B/s", transferred = Format.toByte(bytesReceived), total = Format.toByte(totalBytes);
            let left = "";
            if (event.estimatedEndTime) {
              const remainingSeconds = (new Date(event.estimatedEndTime) - new Date()) / 1000;
              if (remainingSeconds > 0 && totalBytes > 0) {
                speed = (totalBytes - bytesReceived) / remainingSeconds;
                speedText = Format.toByte(speed) + "/s";
                left = `, ${Format.toTime(remainingSeconds)} ${t("left")}`;
              }
            }
            if ($status) $status.textContent = `${speedText} - ${transferred} of ${total}${left}`;
          } else if (event.state === "complete") {
            if ($status) $status.textContent = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
            stopTimer(id);
          } else if (event.paused) {
            if ($status) $status.textContent = t("paused");
            stopTimer(id);
          } else if (event.state === "interrupted") {
            if ($status) $status.textContent = event.error === "NETWORK_FAILED" ? "Failed - Network error" : t("canceled");
            stopTimer(id);
          }
        });
      } catch (e) {
        window.onerror(e.message, "main.js", 0, 0, e);
        stopTimer(id);
      }
    };
    timers[id] = setInterval(timer, 1000);
    setTimeout(timer, 1);
  }

  function stopTimer(id) {
    if (timers[id]) {
      clearInterval(timers[id]);
      delete timers[id];
    }
  }

  function getProperFilename(filename) {
    const backArray = filename.split("\\");
    const forwardArray = filename.split("/");
    const array = backArray.length > forwardArray.length ? backArray : forwardArray;
    return array.pop().replace(/.crdownload$/, "");
  }
  window.App = { getProperFilename };

  on($("#main"), "scroll", () => {
    try {
      const toolbar = $(".toolbar");
      if (toolbar) toolbar.classList.toggle("toolbar--fixed", $("#main").scrollTop > 0);
    } catch (e) {
      window.onerror(e.message, "main.js", 0, 0, e);
    }
  });

  on($("#action-show-all"), "click", () => {
    try {
      if (chrome?.tabs?.create) chrome.tabs.create({ url: "chrome://downloads", selected: true });
    } catch (e) {
      window.onerror(e.message, "main.js", 0, 0, e);
    }
  });

  on($("#action-clear-all"), "click", () => {
    try {
      clearAllDownloadsExceptRunning((running) => {
        if (running.length) {
          render();
        } else {
          const emptyTmpl = $("#tmpl__state-empty");
          const downloads = $("#downloads");
          if (emptyTmpl && downloads) {
            const clone = document.importNode(emptyTmpl.content, true);
            while (downloads.firstChild) downloads.removeChild(downloads.firstChild);
            downloads.appendChild(clone);
          }
          if (typeof localize === "function") localize();
        }
      });
    } catch (e) {
      window.onerror(e.message, "main.js", 0, 0, e);
    }
  });

  on($("#downloads"), "click", handleClick);

  const langSwitch = document.getElementById('language-switch');
  if (langSwitch) on(langSwitch, 'change', function() {
    try {
      setTimeout(function() {
        if (typeof App !== "undefined" && App.render) App.render();
      }, 10);
      setTimeout(function() {
        if (typeof localize === "function") localize();
      }, 20);
    } catch (e) {
      window.onerror(e.message, "main.js", 0, 0, e);
    }
  });

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message.type === "download_created" || message.type === "download_changed") {
          scheduleRender();
        }
        if (sendResponse) sendResponse({ status: "Message received in popup" });
      } catch (e) {
        window.onerror(e.message, "main.js", 0, 0, e);
      }
    });
  }
  if (chrome?.downloads?.onCreated) {
    chrome.downloads.onCreated.addListener(scheduleRender);
  }

  render();
  setAdaptivePolling();
  window.addEventListener('unload', function() {
    try {
      Object.values(timers).forEach(clearInterval);
      timers = {};
      if (pollInterval) clearInterval(pollInterval);
      if (chrome?.runtime?.sendMessage) chrome.runtime.sendMessage('popup_closed');
    } catch (e) {}
  });
  if (chrome?.runtime?.sendMessage) chrome.runtime.sendMessage('popup_open');
});