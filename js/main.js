// MV3 Download Manager main.js/popup script

window.$ = function(selector) {
  return document.querySelector(selector);
};

Node.prototype.on = window.on = function(name, fn) {
  if (this) this.addEventListener(name, fn);
  return this;
};

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
    container.className = `list__item download${!event.exists ? " removed" : ""} ${event.state === "complete" ? "complete" : ""} ${event.state === "interrupted" ? "canceled" : ""} ${event.paused ? "paused" : ""} ${event.state === "in_progress" ? "in-progress" : ""}`;
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

let popupReady = false;
let debounceTimeout = null;
let pollInterval = null;
let pollingFast = false;

const App = {
  timers: {},
  resultsLength: 0,
  resultsLimit: 10,
  devicePixelRatio: typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1,
  prefersColorSchemeDark: typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false,
  renderPending: false,
  lastRetried: null,

  init() {
    window.addEventListener("DOMContentLoaded", () => {
      chrome.runtime.sendMessage('popup_open');
      popupReady = true;
      this.bindEvents();
      this.render();
      this.setAdaptivePolling();
      chrome.downloads.onCreated.addListener(() => {
        this.scheduleRender();
      });
    });
    window.addEventListener("unload", () => {
      popupReady = false;
      chrome.runtime.sendMessage('popup_closed');
      Object.values(this.timers).forEach(clearInterval);
      this.timers = {};
      if (pollInterval) clearInterval(pollInterval);
    });
  },

  setAdaptivePolling(inProgress = false) {
    if (pollInterval) clearInterval(pollInterval);
    pollingFast = inProgress;
    pollInterval = setInterval(() => {
      if (popupReady) this.scheduleRender();
    }, inProgress ? 1200 : 3500);
  },

  bindEvents() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!popupReady) return;
      if (message.type === "download_created" || message.type === "download_changed") {
        this.scheduleRender();
      }
      if (sendResponse) sendResponse({ status: "Message received in popup" });
    });

    $("#main")?.on("scroll", () => {
      const toolbar = $(".toolbar");
      if (toolbar) toolbar.classList.toggle("toolbar--fixed", $("#main").scrollTop > 0);
    });

    $("#action-show-all")?.on("click", () => this.openUrl("chrome://downloads"));

    $("#action-clear-all")?.on("click", () => {
      this.clearAllDownloadsExceptRunning((running) => {
        if (running.length) {
          this.render();
        } else {
          const emptyTmpl = $("#tmpl__state-empty");
          const downloads = $("#downloads");
          if (emptyTmpl && downloads) {
            const clone = document.importNode(emptyTmpl.content, true);
            while (downloads.firstChild) downloads.removeChild(downloads.firstChild);
            downloads.appendChild(clone);
          }
          if (emptyTmpl) {
            localize();
          }
        }
      });
    });

    $("#downloads")?.on("click", this.handleClick.bind(this));

    document.getElementById('language-switch')?.addEventListener('change', (e) => {
      setTimeout(() => {
        if (typeof App !== "undefined" && App.render) App.render();
      }, 10);
      setTimeout(localize, 20);
    });
  },

  scheduleRender() {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      this.render();
    }, 200);
  },

  render() {
    chrome.downloads.search(
      {
        limit: this.resultsLimit + 10,
        filenameRegex: ".+",
        orderBy: ["-startTime"]
      },
      (data) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
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

        this.resultsLength = data.length;
        this.updateDownloadsView(data.slice(0, this.resultsLimit));

        const anyInProgress = data.some(d => d.state === "in_progress" && !d.paused);
        if (anyInProgress !== pollingFast) {
          this.setAdaptivePolling(anyInProgress);
        }
      }
    );
  },

  updateDownloadsView(results) {
    const downloadsEl = $("#downloads");
    if (!downloadsEl) return;

    const emptyTmpl = $("#tmpl__state-empty");
    if (!results || results.length === 0) {
      if (emptyTmpl) {
        const clone = document.importNode(emptyTmpl.content, true);
        while (downloadsEl.firstChild) downloadsEl.removeChild(downloadsEl.firstChild);
        downloadsEl.appendChild(clone);
        localize();
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
          if (iconImg.src !== DEFAULT_DOWNLOAD_ICON) {
            iconImg.src = DEFAULT_DOWNLOAD_ICON;
          }
        } else {
          chrome.downloads.getFileIcon(item.id, {size: 32}, (iconURL) => {
            if (iconURL && iconImg.src !== iconURL) {
              iconImg.src = iconURL;
            }
          });
        }
      }

      if (item.state === "in_progress" && !item.paused) {
        this.startTimer(item.id);
      } else {
        this.stopTimer(item.id);
      }
    });

    if (this.resultsLength > this.resultsLimit) {
      downloadsEl.appendChild(Template.buttonShowMore());
    }
  },

  refreshDownloadView(id) {
    chrome.downloads.search({ id: id }, (results) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        return;
      }
      if (results[0]) {
        this.render();
      }
    });
  },

  clearAllDownloadsExceptRunning(callback) {
    chrome.downloads.search({}, (results) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        return;
      }
      const running = results.filter((item) => item.state === "in_progress");
      results.forEach((item) => {
        if (item.state !== "in_progress" && item.id) {
          chrome.downloads.erase({ id: item.id });
          this.stopTimer(item.id);
        }
      });
      if (callback) callback(running);
    });
  },

  handleClick(event) {
    const action = event.target.dataset.action;
    if (!action) return;

    event.preventDefault();

    if (action === "url") {
      this.openUrl(event.target.href);
      return;
    }

    if (action === "more") {
      this.openUrl("chrome://downloads");
      return;
    }

    const $el = event.target.closest(".download");
    if (!$el) return;

    const id = +$el.dataset.id;

    if (["resume", "cancel", "pause"].includes(action)) {
      chrome.downloads[action](id);
      this.refreshDownloadView(id);
      if (action === "resume") {
        this.startTimer(id);
      } else {
        this.stopTimer(id);
      }
    } else if (action === "retry") {
      chrome.downloads.search({ id: id }, (results) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          return;
        }
        if (results[0]) {
          App.lastRetried = {
            url: results[0].url,
            filename: results[0].filename,
            canceledId: id
          };
          chrome.downloads.download({ url: results[0].url }, (new_id) => {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError.message);
              return;
            }
            this.startTimer(new_id);
            this.render();
            setTimeout(() => this.render(), 400);
          });
        }
      });
    } else if (action === "erase") {
      chrome.downloads.erase({ id: id }, () => {
        const $list = $el.parentNode;
        if ($list) {
          $list.removeChild($el);
          this.stopTimer(id);
          this.render();
        }
      });
    } else if (action === "show") {
      chrome.downloads.show(id);
    } else if (action === "open") {
      chrome.downloads.open(id);
    }
  },

  startTimer(id) {
    this.stopTimer(id);

    let progressLastValue = 0;
    let progressCurrentValue = 0;
    let progressNextValue = 0;
    let progressRemainingTime = 0;
    let progressLastFrame = Date.now();

    const timer = () => {
      const $el = $(`#download-${id}`);
      if (!$el) return;

      const $status = $el.querySelector(".status");

      chrome.downloads.search({ id: id }, (results) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          this.stopTimer(id);
          return;
        }

        const event = results[0];
        if (!event) {
          this.stopTimer(id);
          this.render();
          return;
        }

        if (event.state === "in_progress" && !event.paused) {
          let speed = 0;
          let left_text = "";
          let bytesReceived = event.bytesReceived || 0;
          let totalBytes = event.totalBytes || 0;
          let speedText = "0 B/s";
          let transferred = Format.toByte(bytesReceived);
          let total = Format.toByte(totalBytes);
          let left = "";
          let timeLeft = "";

          if (event.estimatedEndTime) {
            const remainingSeconds = (new Date(event.estimatedEndTime) - new Date()) / 1000;
            if (remainingSeconds > 0 && totalBytes > 0) {
              speed = (totalBytes - bytesReceived) / remainingSeconds;
              speedText = Format.toByte(speed) + "/s";
              timeLeft = Format.toTime(remainingSeconds);
              left = `, ${timeLeft} ${t("left")}`;
            }
          }

          if ($status) {
            $status.textContent = `${speedText} - ${transferred} of ${total}${left}`;
          }
        } else if (event.state === "complete") {
          if ($status) $status.textContent = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
          this.stopTimer(id);
        } else if (event.paused) {
          if ($status) $status.textContent = t("paused");
          this.stopTimer(id);
        } else if (event.state === "interrupted") {
          if ($status) $status.textContent = event.error === "NETWORK_FAILED" ? "Failed - Network error" : t("canceled");
          this.stopTimer(id);
        }
      });
    };

    this.timers[id] = setInterval(timer, 1000);
    setTimeout(timer, 1);

    const progressAnimationFrame = () => {
      const $el = $(`#download-${id}`);
      if (!$el) return;

      const $progress = $el.querySelector(".progress__bar");

      const now = Date.now();
      const elapsed = now - progressLastFrame;
      const remainingProgress = progressNextValue - progressCurrentValue;
      progressLastFrame = now;

      if (progressRemainingTime > 0 && remainingProgress > 0) {
        progressCurrentValue += (elapsed / progressRemainingTime) * remainingProgress;
        progressRemainingTime -= elapsed;

        if ($progress) {
          $progress.style.width = (100 * progressCurrentValue).toFixed(1) + "%";
        }
      }

      if (this.timers[id]) {
        requestAnimationFrame(progressAnimationFrame);
      }
    };

    requestAnimationFrame(progressAnimationFrame);
  },

  stopTimer(id) {
    clearInterval(this.timers[id]);
    delete this.timers[id];
  },

  getProperFilename(filename) {
    const backArray = filename.split("\\");
    const forwardArray = filename.split("/");
    const array = backArray.length > forwardArray.length ? backArray : forwardArray;
    return array.pop().replace(/.crdownload$/, "");
  },

  isDangerous(event) {
    return !/safe|accepted/.test(event.danger) && event.state === "in_progress";
  },

  openUrl(url) {
    chrome.tabs.create({
      url: url,
      selected: true
    });
  }
};

App.init();