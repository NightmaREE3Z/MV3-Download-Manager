window.$ = typeof document !== "undefined" && document.querySelector
  ? document.querySelector.bind(document)
  : function () { return null; };

Node.prototype.on = window.on = function (name, fn) {
  if (this) this.addEventListener(name, fn);
};

const Format = {
  toByte(bytes) {
    if (!bytes == null) return "0 B";
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

const Template = {
  button(type, action, text) {
    return `<button class="button button--${type}" data-action="${action}">${text}</button>`;
  },
  buttonShowMore() {
    return `<button class="button button--secondary button--block" data-action="more">Show more</button>`;
  }
};

let popupReady = false;

const App = {
  timers: {},
  resultsLength: 0,
  resultsLimit: 10,
  devicePixelRatio: typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1,
  prefersColorSchemeDark: typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false,
  renderPending: false,
  pollInterval: null,
  prevDownloadIds: [],
  prevHtmlMap: {},
  lastRetried: null,

  init() {
    window.addEventListener("DOMContentLoaded", () => {
      popupReady = true;
      this.bindEvents();
      this.render();
      this.pollInterval = setInterval(() => {
        if (popupReady) this.render();
      }, 500);
      chrome.downloads.onCreated.addListener((item) => {
        // Store info for the last retried download
        if (App.lastRetried && App.lastRetried.url === item.url) {
          App.lastRetried.newId = item.id;
          App.lastRetried.startTime = item.startTime;
        }
        if (popupReady) this.render();
      });
    });
    window.addEventListener("unload", () => {
      popupReady = false;
      Object.values(this.timers).forEach(clearInterval);
      this.timers = {};
      if (this.pollInterval) clearInterval(this.pollInterval);
    });
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
          if (emptyTmpl) $("#downloads").innerHTML = emptyTmpl.innerHTML;
          if (emptyTmpl) {
            localize();
          }
        }
      });
    });

    $("#downloads")?.on("click", this.handleClick.bind(this));
  },

  scheduleRender() {
    if (this.renderPending) return;
    this.renderPending = true;
    setTimeout(() => {
      this.renderPending = false;
      this.render();
    }, 400);
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
        // Custom sorting: group by filename, put in-progress or most recent above canceled
        data.sort((a, b) => {
          // If one is retried and the other is canceled with same filename, retried is above
          if (a.filename === b.filename) {
            if (a.state === "in_progress" && b.state === "interrupted") return -1;
            if (a.state === "interrupted" && b.state === "in_progress") return 1;
            if (a.state === "complete" && b.state === "interrupted") return -1;
            if (a.state === "interrupted" && b.state === "complete") return 1;
            // If both canceled, show most recent above
            return new Date(b.startTime) - new Date(a.startTime);
          }
          // Otherwise, sort by startTime descending
          return new Date(b.startTime) - new Date(a.startTime);
        });

        this.resultsLength = data.length;
        this.updateDownloadsView(data.slice(0, this.resultsLimit));
      }
    );
  },

  updateDownloadsView(results) {
    const downloadsEl = $("#downloads");
    const emptyTmpl = $("#tmpl__state-empty");
    if (!results || results.length === 0) {
      downloadsEl.innerHTML = emptyTmpl ? emptyTmpl.innerHTML : "";
      if (emptyTmpl) {
        localize();
      }
      this.prevDownloadIds = [];
      this.prevHtmlMap = {};
      return;
    }
    const ids = results.map(item => item.id);
    let htmlMap = {};

    // Only add/remove/replace nodes as needed
    results.forEach((item, idx) => {
      if (!item) return;
      if (item.state === "in_progress" && !item.paused) this.startTimer(item.id);
      let newHtml = this.getDownloadView(item);
      htmlMap[item.id] = newHtml;

      // If it's a new node
      let node = $(`#download-${item.id}`);
      if (!node) {
        const el = document.createElement("div");
        el.innerHTML = newHtml;
        // Insert at correct position (preserve order)
        let prevNode = null;
        for (let i = idx - 1; i >= 0; --i) {
          let prev = $(`#download-${results[i].id}`);
          if (prev) {
            prevNode = prev;
            break;
          }
        }
        if (prevNode && prevNode.nextSibling) {
          downloadsEl.insertBefore(el.firstChild, prevNode.nextSibling);
        } else if (prevNode) {
          downloadsEl.appendChild(el.firstChild);
        } else if (downloadsEl.firstChild) {
          downloadsEl.insertBefore(el.firstChild, downloadsEl.firstChild);
        } else {
          downloadsEl.appendChild(el.firstChild);
        }
      } else if (this.prevHtmlMap[item.id] !== newHtml) {
        // Only replace if html changed, to minimize flicker
        const el = document.createElement("div");
        el.innerHTML = newHtml;
        node.replaceWith(el.firstChild);
      }
    });

    // Remove any download nodes that no longer exist
    if (this.prevDownloadIds.length) {
      this.prevDownloadIds.forEach(oldId => {
        if (!ids.includes(oldId)) {
          const oldNode = $(`#download-${oldId}`);
          if (oldNode) downloadsEl.removeChild(oldNode);
        }
      });
    }

    if (!downloadsEl.hasChildNodes() || downloadsEl.childElementCount === 0) {
      let html = "";
      results.forEach(item => {
        if (!item) return;
        html += htmlMap[item.id];
      });
      downloadsEl.innerHTML = html;
    }

    // Show "Show more" if needed
    if (this.resultsLength > this.resultsLimit && !$("#downloads .button--block")) {
      downloadsEl.insertAdjacentHTML("beforeend", Template.buttonShowMore());
    }

    this.prevDownloadIds = ids;
    this.prevHtmlMap = htmlMap;
  },

  getDownloadView(event) {
    let buttons = "";
    let status = "";
    let progressClass = "";
    let progressWidth = "0%";
    if (!event) return "";

    if (event.state === "complete") {
      status = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
      buttons = Template.button("secondary", "show", t("show_in_folder"));
      return `<div id="download-${event.id}" class="list__item download${!event.exists ? " removed" : ""}" data-id="${event.id}">
        <div class="list__item__icon">
          <img id="icon-${event.id}" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T">
        </div>
        <div class="list__item__content">
          <p class="list__item__filename" title="${this.getProperFilename(event.filename)}" data-action="open">${this.getProperFilename(event.filename)}</p>
          <a href="${event.finalUrl}" class="list__item__source" data-action="url" title="${event.finalUrl}">${event.finalUrl}</a>
          <div class="list__item__row">
            ${Template.button("secondary", "show", t("show_in_folder"))}
            <span class="list__item__canceled">${status}</span>
          </div>
        </div>
      </div>`;
    }

    if (event.state === "interrupted") {
      status = event.error === "NETWORK_FAILED" ? "Failed - Network error" : t("canceled");
      buttons = Template.button("primary", "retry", t("retry"));
      return `<div id="download-${event.id}" class="list__item download canceled" data-id="${event.id}">
        <div class="list__item__icon">
          <img id="icon-${event.id}" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T">
        </div>
        <div class="list__item__content">
          <p class="list__item__filename" title="${this.getProperFilename(event.filename)}" data-action="open">${this.getProperFilename(event.filename)}</p>
          <a href="${event.finalUrl}" class="list__item__source" data-action="url" title="${event.finalUrl}">${event.finalUrl}</a>
          <div class="list__item__row">
            ${Template.button("primary", "retry", t("retry"))}
            <span class="list__item__canceled">${status}</span>
          </div>
        </div>
      </div>`;
    }

    if (event.paused) {
      status = t("paused");
      progressClass = "paused";
      buttons = Template.button("primary", "resume", t("resume")) + Template.button("secondary", "cancel", t("cancel"));
    } else {
      status = "";
      progressClass = "in-progress";
      buttons = Template.button("primary", "pause", t("pause")) + Template.button("secondary", "cancel", t("cancel"));
    }
    if (event.totalBytes > 0) {
      progressWidth = ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
    }

    const extraClass = [
      "download",
      !event.exists ? "removed" : "",
      event.state === "interrupted" ? "canceled" : "",
      progressClass,
      this.isDangerous(event) ? "danger" : ""
    ].join(" ").trim();

    const fileName = this.getProperFilename(event.filename);
    const fileUrl = event.finalUrl;

    const defaultFileIcon = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T`;

    if (fileName) {
      chrome.downloads.getFileIcon(event.id, { size: 32 }, (iconURL) => {
        const iconImg = $(`#icon-${event.id}`);
        if (iconURL && iconImg) iconImg.src = iconURL;
      });
    }

    return `<div id="download-${event.id}" class="list__item ${extraClass}" data-id="${event.id}">
      <div class="list__item__icon">
        <img id="icon-${event.id}" src="${defaultFileIcon}">
      </div>
      <div class="list__item__content">
        <p class="list__item__filename" title="${fileName}" data-action="open">${fileName}</p>
        <a href="${fileUrl}" class="list__item__source" data-action="url" title="${fileUrl}">${fileUrl}</a>
        ${
          progressClass === "in-progress"
            ? `<div class="progress"><div class="progress__bar" style="width: ${progressWidth};"></div></div>`
            : ""
        }
        <div class="list__item__controls">
          <div class="list__item__buttons">${buttons}</div>
          <div class="list__item__status status">${status}</div>
        </div>
      </div>
    </div>`;
  },

  refreshDownloadView(id) {
    chrome.downloads.search({ id: id }, (results) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        return;
      }
      if (results[0]) {
        const $el = document.createElement("div");
        $el.innerHTML = this.getDownloadView(results[0]);
        const downloadEl = $(`#download-${id}`);
        if (downloadEl) {
          $("#downloads").replaceChild($el.firstChild, downloadEl);
        }
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

        if (event.state !== "complete") {
          let speed = 0;
          let left_text = "";
          const remainingBytes = event.totalBytes - event.bytesReceived;
          const remainingSeconds = (new Date(event.estimatedEndTime) - new Date()) / 1000;

          if (remainingSeconds > 0) {
            speed = remainingBytes / remainingSeconds;
          }

          if (speed) {
            left_text = `, ${Format.toTime(remainingSeconds)} ${t("left")}`;
          }

          if (progressCurrentValue === 0) {
            if (event.totalBytes > 0 && speed) {
              progressCurrentValue = event.bytesReceived / event.totalBytes;
              progressNextValue = (event.bytesReceived + speed) / event.totalBytes;
              progressLastValue = progressCurrentValue;
              progressRemainingTime += 1000;
            }
          } else {
            if (event.totalBytes > 0) {
              const currentProgress = event.bytesReceived / event.totalBytes;
              const progressDelta = currentProgress - progressLastValue;
              progressNextValue = currentProgress + progressDelta;
              progressLastValue = currentProgress;
              progressRemainingTime += 1000;
            }
          }

          if ($status) {
            $status.innerHTML = `${Format.toByte(speed)}/s - ${Format.toByte(event.bytesReceived)} of ${Format.toByte(
              event.totalBytes
            )}${left_text}`;
            if (event.bytesReceived && event.bytesReceived === event.totalBytes) {
              $status.innerHTML = Format.toByte(event.totalBytes);
            }
          }
        } else {
          if ($status) $status.innerHTML = "";
          this.stopTimer(id);
          this.refreshDownloadView(event.id);
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

  elementFromHtml(html) {
    const $el = document.createElement("div");
    $el.innerHTML = html;
    return $el.firstChild;
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