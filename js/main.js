window.$ = document.querySelector.bind(document);

Node.prototype.on = window.on = function (name, fn) {
  this.addEventListener(name, fn);
};

const Format = {
  toByte: function (bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1000 * 1000) return (bytes / 1000).toFixed() + " KB";
    if (bytes < 1000 * 1000 * 10) return (bytes / 1000 / 1000).toFixed(1) + " MB";
    if (bytes < 1000 * 1000 * 1000) return (bytes / 1000 / 1000).toFixed() + " MB";
    if (bytes < 1000 * 1000 * 1000 * 1000) return (bytes / 1000 / 1000 / 1000).toFixed(1) + " GB";
    return bytes + " B";
  },
  toTime: function (sec) {
    if (sec < 60) return Math.ceil(sec) + " secs";
    if (sec < 60 * 5) return Math.floor(sec / 60) + " mins " + Math.ceil(sec % 60) + " secs";
    if (sec < 60 * 60) return Math.ceil(sec / 60) + " mins";
    if (sec < 60 * 60 * 5) return Math.floor(sec / 60 / 60) + " hours " + (Math.ceil(sec / 60) % 60) + " mins";
    if (sec < 60 * 60 * 24) return Math.ceil(sec / 60 / 60) + " hours";
    return Math.ceil(sec / 60 / 60 / 24) + " days";
  }
};

const Template = {
  button: function (type, action, text) {
    return `<button class="button button--${type}" data-action="${action}">${text}</button>`;
  },
  buttonShowMore: function () {
    return `<button class="button button--secondary button--block" data-action="more">Show more</button>`;
  }
};

const App = {
  timers: [],
  resultsLength: 0,
  resultsLimit: 10,
  init: function () {
    this.bindEvents();
    this.render();
  },
  bindEvents: function () {
    window.on("DOMContentLoaded", () => {
      chrome.runtime.sendMessage({ type: "popup_open" });
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "download_created") {
        // Handle download created message
      } else if (message.type === "download_changed") {
        // Handle download changed message
      } else {
        console.warn("Unhandled message type:", message.type);
      }
      sendResponse({ status: "Message received in popup" });
    });

    const mainEl = $("#main");
    if (mainEl) {
      mainEl.on("scroll", () => {
        if (mainEl.scrollTop > 0) {
          $(".toolbar").classList.add("toolbar--fixed");
        } else {
          $(".toolbar").classList.remove("toolbar--fixed");
        }
      });
    }

    const showAllEl = $("#action-show-all");
    if (showAllEl) {
      showAllEl.on("click", () => this.openUrl("chrome://downloads"));
    }

    const clearAllEl = $("#action-clear-all");
    if (clearAllEl) {
      clearAllEl.on("click", () => {
        this.clearAllDownloadsExceptRunning((running) => {
          if (running.length) {
            this.render();
          } else {
            $("#downloads").innerHTML = $("#tmpl__state-empty").innerHTML;
          }
        });
      });
    }

    const downloadsEl = $("#downloads");
    if (downloadsEl) {
      downloadsEl.on("click", this.handleClick.bind(this));
    }
  },
  render: function () {
    chrome.downloads.search({ limit: 0 }, () => {
      chrome.downloads.search(
        {
          limit: this.resultsLimit + 1,
          filenameRegex: ".+",
          orderBy: ["-startTime"]
        },
        (data) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            return;
          }
          this.resultsLength = data.length;
          chrome.downloads.search(
            {
              limit: this.resultsLimit,
              filenameRegex: ".+",
              orderBy: ["-startTime"]
            },
            this.getDownloadsView.bind(this)
          );
        }
      );
    });
  },
  getDownloadsView: function (results) {
    if (!results || results.length === 0) {
      $("#downloads").innerHTML = $("#tmpl__state-empty").innerHTML;
      return;
    }

    let html = "";

    results.forEach((item) => {
      if (!item) return;

      if (this.isDangerous(item)) {
        setTimeout(() => chrome.downloads.acceptDanger(item.id), 100);
      }

      if (item.state === "in_progress" && !item.paused) {
        this.startTimer(item.id);
      }

      html += this.getDownloadView(item);
    });

    const $target = $("#downloads");
    if (html) {
      $target.innerHTML = html;
      if (this.resultsLength > this.resultsLimit) {
        $target.innerHTML += Template.buttonShowMore();
      }
    } else {
      $target.innerHTML = $("#tmpl__state-empty").innerHTML;
    }
  },
  getDownloadView: function (event) {
    let buttons = "";
    let status = "";
    let progressClass = "";
    let progressWidth = 0;

    if (!event) return "";

    if (event.state === "complete") {
      status = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
      buttons = Template.button("secondary", "show", "Show in folder");
      if (!event.exists) {
        status = "Deleted";
        buttons = Template.button("primary", "retry", "Retry");
      }
    } else if (event.state === "interrupted") {
      status = event.error === "NETWORK_FAILED" ? "Failed - Network error" : "Canceled";
      buttons = Template.button("primary", "retry", "Retry");
    } else {
      if (event.paused) {
        status = "Paused";
        progressClass = "paused";
        buttons = Template.button("primary", "resume", "Resume") + Template.button("secondary", "cancel", "Cancel");
      } else {
        status = "";
        progressClass = "in-progress";
        buttons = Template.button("primary", "pause", "Pause") + Template.button("secondary", "cancel", "Cancel");
      }
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
        if (iconURL && $(`#icon-${event.id}`)) {
          $(`#icon-${event.id}`).src = iconURL;
        }
      });
    }

    return `<div id="download-${event.id}" class="list__item ${extraClass}" data-id="${event.id}">
      <div class="list__item__icon">
        <img id="icon-${event.id}" src="${defaultFileIcon}">
      </div>
      <div class="list__item__content">
      ${
        event.state !== "complete" || !event.exists
          ? `<p class="list__item__filename" title="${fileName}">${fileName}</p>`
          : `<a href="file://${event.filename}" class="list__item__filename" data-action="open" title="${fileName}">${fileName}</a>`
      }
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
      <div class="list__item__clear">
        <button class="button button--icon" title="Clear" data-action="erase">&times</button>
      </div>
    </div>`;
  },
  refreshDownloadView: function (id) {
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
  clearAllDownloadsExceptRunning: function (callback) {
    chrome.downloads.search({}, (results) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        return;
      }
      const running = results.filter((item) => item.state === "in_progress");
      results.forEach((item) => {
        if (item.state !== "in_progress" && item.id) {
          chrome.downloads.erase({ id: item.id });
        }
      });
      callback && callback(running);
    });
  },
  handleClick: function (event) {
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
          chrome.downloads.download({ url: results[0].url }, (new_id) => {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError.message);
              return;
            }
            this.startTimer(new_id);
          });
        }
      });
    } else if (action === "erase") {
      chrome.downloads.erase({ id: id }, () => {
        const $list = $el.parentNode;
        if ($list) {
          $list.removeChild($el);
          this.render();
        }
      });
    } else if (action === "show") {
      chrome.downloads.show(id);
    } else if (action === "open") {
      chrome.downloads.open(id);
    }
  },
  startTimer: function (id) {
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

          speed = remainingBytes / remainingSeconds;

          if (speed) {
            left_text = `, ${Format.toTime(remainingSeconds)} left`;
          }

          if (progressCurrentValue === 0) {
            if (speed) {
              progressCurrentValue = event.bytesReceived / event.totalBytes;
              progressNextValue = (event.bytesReceived + speed) / event.totalBytes;
              progressLastValue = progressCurrentValue;
              progressRemainingTime += 1000;
            }
          } else {
            const currentProgress = event.bytesReceived / event.totalBytes;
            const progressDelta = currentProgress - progressLastValue;
            progressNextValue = currentProgress + progressDelta;
            progressLastValue = currentProgress;
            progressRemainingTime += 1000;
          }

          $status.innerHTML = `${Format.toByte(speed)}/s - ${Format.toByte(event.bytesReceived)} of ${Format.toByte(
            event.totalBytes
          )}${left_text}`;

          if (event.bytesReceived && event.bytesReceived === event.totalBytes) {
            $status.innerHTML = Format.toByte(event.totalBytes);
          }
        } else {
          $status.innerHTML = "";
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
  stopTimer: function (id) {
    clearInterval(this.timers[id]);
    this.timers[id] = null;
  },
  elementFromHtml: function (html) {
    const $el = document.createElement("div");
    $el.innerHTML = html;
    return $el.firstChild;
  },
  getProperFilename: function (filename) {
    const backArray = filename.split("\\");
    const forwardArray = filename.split("/");
    const array = backArray.length > forwardArray.length ? backArray : forwardArray;
    return array.pop().replace(/.crdownload$/, "");
  },
  isDangerous: function (event) {
    return !/safe|accepted/.test(event.danger) && event.state === "in_progress";
  },
  openUrl: function (url) {
    chrome.tabs.create({
      url: url,
      selected: true
    });
  }
};

App.init();