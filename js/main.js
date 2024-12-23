window.$ = document.querySelector.bind(document);
Node.prototype.on = window.on = function(name, fn) {
  this.addEventListener(name, fn);
};

const Format = {
  /**
   * Format to bytes.
   * @param {number} bytes
   */
  toByte: function(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1000 * 1000) return (bytes / 1000).toFixed() + " KB";
    if (bytes < 1000 * 1000 * 10)
      return (bytes / 1000 / 1000).toFixed(1) + " MB";
    if (bytes < 1000 * 1000 * 1000)
      return (bytes / 1000 / 1000).toFixed() + " MB";
    if (bytes < 1000 * 1000 * 1000 * 1000)
      return (bytes / 1000 / 1000 / 1000).toFixed(1) + " GB";
    return bytes + " B";
  },
  /**
   * Format to time.
   * @param {number} sec
   */
  toTime: function(sec) {
    if (sec < 60) return Math.ceil(sec) + " secs";
    if (sec < 60 * 5)
      return Math.floor(sec / 60) + " mins " + Math.ceil(sec % 60) + " secs";
    if (sec < 60 * 60) return Math.ceil(sec / 60) + " mins";
    if (sec < 60 * 60 * 5)
      return (
        Math.floor(sec / 60 / 60) +
        " hours " +
        (Math.ceil(sec / 60) % 60) +
        " mins"
      );
    if (sec < 60 * 60 * 24) return Math.ceil(sec / 60 / 60) + " hours";
    return Math.ceil(sec / 60 / 60 / 24) + " days";
  }
};

const Template = {
  /**
   * Button for download item.
   * @param {*} type
   * @param {*} action
   * @param {*} text
   */
  button: function(type, action, text) {
    return `<button class="button button--${type}" data-action="${action}">${text}</button>`;
  },
  /**
   * Button to show more items.
   */
  buttonShowMore: function() {
    return `<button class="button button--secondary button--block" data-action="more">Show more</button>`;
  }
};

const App = {
  timers: [],
  resultsLength: 0,
  resultsLimit: 10,
  init: function() {
    this.bindEvents();
    this.render();
  },
  bindEvents: function() {
    // Send a message to background.js that the pop up is open.
    window.on("DOMContentLoaded", () => {
      chrome.runtime.sendMessage("popup_open");
    });

    // When new download is created.
    chrome.downloads.onCreated.addListener(event => {
      const $target = $("#downloads");

      // Check if empty state exists and remove it.
      const $state = $target.querySelector(".state");
      if ($state) $target.removeChild($state);

      const $newEl = this.elementFromHtml(this.getDownloadView(event));
      $target.insertBefore($newEl, $target.firstChild);
      if ($target.children.length > this.resultsLimit) {
        $target.removeChild($target.children[this.resultsLimit - 1]);
      }
    });

    // When download has changed.
    chrome.downloads.onChanged.addListener(delta => {
      if (delta.filename) this.refreshDownloadView(delta.id);
      if (delta.danger && delta.danger.current === "accepted")
        $(`#download-${delta.id}`).classList.remove("danger");
    });

    // Display a shadow under the toolbar when the page scolls down.
    $("#main").on("scroll", () => {
      if ($("#main").scrollTop > 0) {
        $(".toolbar").classList.add("toolbar--fixed");
      } else {
        $(".toolbar").classList.remove("toolbar--fixed");
      }
    });

    // Show all downloads.
    $("#action-show-all").on("click", () => this.openUrl("chrome://downloads"));

    // Clear all downloads.
    $("#action-clear-all").on("click", () => {
      this.clearAllDownloadsExceptRunning(running => {
        if (running.length) {
          this.render();
        } else {
          $("#downloads").innerHTML = $("#tmpl__state-empty").innerHTML;
        }
      });
    });

    // Click on download item.
    $("#downloads").on("click", this.handleClick.bind(this));
  },
  render: function() {
    // We need this 'empty' search to force refresh the downloads list (find files that were removed).
    chrome.downloads.search({ limit: 0 }, () => {
      // Search downloads for above limit.
      chrome.downloads.search(
        {
          limit: this.resultsLimit + 1,
          filenameRegex: ".+",
          orderBy: ["-startTime"]
        },
        data => {
          this.resultsLength = data.length;
          chrome.downloads.search(
            {
              limit: this.resultsLimit,
              filenameRegex: ".+",
              orderBy: ["-startTime"]
            },
            this.getDownloadsView
          );
        }
      );
    });
  },
  /**
   * Get downloads view.
   * @param {*} results
   */
  getDownloadsView: function(results) {
    let _this = App;
    let html = "";

    results.forEach(item => {
      // if the new download is dangerous prompt the user.
      if (_this.isDangerous(item)) {
        // Need a slight delay to get meaningful dialog box.
        setTimeout(() => chrome.downloads.acceptDanger(item.id), 100);
      }

      if (item.state === "in_progress" && !item.paused) {
        _this.startTimer(item.id);
      }

      html += _this.getDownloadView(item);
    });

    const $target = $("#downloads");
    if (html) {
      $target.innerHTML = html;
      if (_this.resultsLength > _this.resultsLimit) {
        $target.innerHTML += Template.buttonShowMore();
      }
    } else {
      $target.innerHTML = $("#tmpl__state-empty").innerHTML;
    }
  },
  /**
   * Get download view.
   * @param {*} event
   */
  getDownloadView: function(event) {
    let buttons = "";
    let status = "";
    let progressClass = "";
    let progressWidth = 0;

    // Download is complete.
    if (event.state === "complete") {
      status = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
      buttons = Template.button("secondary", "show", "Show in folder");
      // Check if downloaded file still exists.
      if (!event.exists) {
        status = "Deleted";
        buttons = Template.button("primary", "retry", "Retry");
      }
      // Download is canceled.
    } else if (event.state === "interrupted") {
      if (event.error === "NETWORK_FAILED") {
        status = "Failed - Network error";
      } else {
        status = "Canceled";
      }
      buttons = Template.button("primary", "retry", "Retry");
    } else {
      // Download is paused.
      if (event.paused) {
        status = "Paused";
        progressClass = "paused";
        buttons = Template.button("primary", "resume", "Resume");
        buttons += Template.button("secondary", "cancel", "Cancel");
      } else {
        // Download is in progress.
        // Example: 100 KB/s - 1.0 MB of 10.0 MB, 0 secs left
        status = "";
        progressClass = "in-progress";
        buttons = Template.button("primary", "pause", "Pause");
        buttons += Template.button("secondary", "cancel", "Cancel");
      }
      progressWidth =
        ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
    }

    const canceledClass = event.state === "interrupted" ? "canceled" : "";
    const removedClass = !event.exists ? "removed" : "";
    let extraClass = ["download", removedClass, canceledClass, progressClass];

    // Dangerous, not yet accepted download needs to be marked.
    if (this.isDangerous(event)) {
      extraClass.push("danger");
    }

    // Get proper file name.
    const fileName = this.getProperFilename(event.filename);
    const fileUrl = event.finalUrl;

    // Set file icon.
    const defaultFileIcon = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3TZPgdjRNQ0QEIgIA6D4A6DHd1WME0n1mjPQAZvPZn79vb/ffnp5+TiY/nU4kpWRba7e2a5d+a21bUkpR0zT06/WVXl6+/z4cDl9yOT5wO4znlFJQSkGaJk2TXbP7Eq21NU0pBQD4fHuL3e6hXq4+nXMhWUAtNgMy5doLIVDXNR7u7+qb5TILMuFB8gbHAroGUkoQEdbrNe6223rx8ea8T0BGAMdzGRtiDGQXbiJCVVXYft3Uq8XivN/zkJEQkwtHw31jZeeqUgpVVWGz2dTL1eLM2cxYvIs7AvsuPdG7S+gdIoJ/PB7DEPN5PR6QHU95jwAhnJ9tK7F7fIRS1A/qD+azGX6cTuxsLOAwkXw013tO/gkdAZuzqtbuRViAsZSJhFibhT0mnAsgO1E7Ks+Jw/m9c3Hiq5gD8+DMUiecs/L5e3GdA1jgwR5CBMYsTlMY5OWei5pQSYjNV+jq/OJ14NLeG2R3SYgHVia64OH8pSl7gS8tEiflBmnXPX5ZcMJaBIenDHuPOTgD0ExoectAETow0R8dh4trQpH0hEMob62LwkW8ByoMMQBADCrThpoOZxXjaMBL4nn3D5s3+cQTh+ujUxTivHF+6jQc9V1W8SKJEMQLIQHn25cUiV1Z+VXZX1QUzgMqDvEwA9Ng1oajY81DSoc4qpF3DgrPWrQOhm3CZZu+FIoWQsyeD3FfY8FZsvOS8Zp/DKd4kVDUNq0cOJR68D+A9YcX3eoKCEeC2XacRhZJ8MjkupcxA6uMIgkDpSYeownLDJWH7UqK/qvLv5NM06R/dfN5JAuupOIQPz8/60f87tmwf7WL7jWwKZDuTmGP2a+EDYTd77YxuHddQ/8A2tZqP3RSuPIAAAAASUVORK5CYII=`;
    if (fileName) {
      chrome.downloads.getFileIcon(event.id, { size: 32 }, iconURL =>
        iconURL ? ($(`#icon-${event.id}`).src = iconURL) : false
      );
    }

    return `<div id="download-${event.id}" class="list__item ${extraClass
      .join(" ")
      .replace(/\s\s+/g, " ")
      .trim()}" data-id="${event.id}">
      <div class="list__item__icon">
        <img id="icon-${event.id}" src="${defaultFileIcon}">
      </div>
      <div class="list__item__content">
      ${
        event.state != "complete" || !event.exists
          ? `<p class="list__item__filename" title="${fileName}">${fileName}</p>`
          : `<a href="file://${event.filename}" class="list__item__filename" data-action="open" title="${fileName}">${fileName}</a>`
      }
      <a href="${fileUrl}" class="list__item__source" data-action="url" title="${fileUrl}">${fileUrl}</a>
      ${
        extraClass.includes("in-progress")
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
  /**
   * Refresh the download view.
   * @param {number} id
   */
  refreshDownloadView: function(id) {
    chrome.downloads.search({ id: id }, results => {
      const $el = document.createElement("div");
      $el.innerHTML = this.getDownloadView(results[0]);
      $("#downloads").replaceChild($el.firstChild, $(`#download-${id}`));
    });
  },
  /**
   * Clear all downloads except those who are running.
   * @param {*} callback
   */
  clearAllDownloadsExceptRunning: function(callback) {
    chrome.downloads.search({}, results => {
      const running = results.map(item => {
        // Collect downloads in progress.
        if (item.state == "in_progress") return true;
        // Erase the rest.
        chrome.downloads.erase({
          id: item.id
        });
      });
      callback && callback(running);
    });
  },
  /**
   * Handle click.
   * @param {*} event
   */
  handleClick: function(event) {
    const action = event.target.dataset.action;

    if (!action) return;

    event.preventDefault();

    if (/url/.test(action)) {
      this.openUrl(event.target.href);
      return;
    }

    if (/more/.test(action)) {
      this.openUrl("chrome://downloads");
      return;
    }

    const $el = event.target.closest(".download");
    const id = +$el.dataset.id;

    if (/resume|cancel|pause/.test(action)) {
      chrome.downloads[action](id);
      this.refreshDownloadView(id);

      if (/resume/.test(action)) {
        this.startTimer(id);
      } else {
        this.stopTimer(id);
      }
    } else if (/retry/.test(action)) {
      chrome.downloads.search({ id: id }, results => {
        chrome.downloads.download({ url: results[0].url }, new_id => {
          this.startTimer(new_id);
        });
      });
    } else if (/erase/.test(action)) {
      chrome.downloads.search(
        {
          limit: this.resultsLimit,
          filenameRegex: ".+",
          orderBy: ["-startTime"]
        },
        results => {
          // Remove selected element from the UI first.
          const $list = $el.parentNode;
          $list.removeChild($el);

          // Bring up a new element to the end of the list.
          const new_item = results[this.resultsLimit];
          if (!new_item) return;
          const $newEl = this.elementFromHtml(this.getDownloadView(new_item));
          $list.appendChild($newEl);
        }
      );
      chrome.downloads.erase({ id: id }, this.render.bind(this));
    } else if (/show/.test(action)) {
      chrome.downloads.show(id);
    } else if (/open/.test(action)) {
      chrome.downloads.open(id);
      return;
    }
  },
  /**
   * Start the timer.
   * @param {number} id
   */
  startTimer: function(id) {
    clearInterval(this.timers[id]);

    let progressLastValue = 0;
    let progressCurrentValue = 0;
    let progressNextValue = 0;
    let progressRemainingTime = 0;
    let progressLastFrame = +new Date();

    const timer = () => {
      const $el = $(`#download-${id}`);
      const $status = $el.querySelector(".status");

      chrome.downloads.search({ id: id }, results => {
        const event = results[0];

        // Download not found (probably deleted or canceled on danger).
        if (!event) {
          this.stopTimer(id);
          this.render();
          return;
        }

        // Show progress metrics (speed, size, progress bar).
        if (event.state != "complete") {
          let speed = 0;
          let left_text = "";
          const remainingBytes = event.totalBytes - event.bytesReceived;
          const remainingSeconds =
            (new Date(event.estimatedEndTime) - new Date()) / 1000;

          speed = remainingBytes / remainingSeconds;

          if (speed) {
            left_text = `, ${Format.toTime(remainingSeconds)} left`;
          }

          if (progressCurrentValue === 0) {
            if (speed) {
              progressCurrentValue = event.bytesReceived / event.totalBytes;
              progressNextValue =
                (event.bytesReceived + speed) / event.totalBytes;
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

          $status.innerHTML = `${Format.toByte(speed)}/s - ${Format.toByte(
            event.bytesReceived
          )} of ${Format.toByte(event.totalBytes)}${left_text}`;

          if (event.bytesReceived && event.bytesReceived === event.totalBytes) {
            $status.innerHTML = Format.toByte(event.totalBytes);
          }
        } else {
          $status.innerHTML = "";
          clearInterval(this.timers[id]);
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

      const now = +new Date();
      const elapsed = now - progressLastFrame;
      const remainingProgress = progressNextValue - progressCurrentValue;
      progressLastFrame = now;

      // Check if there's a need to update.
      if (progressRemainingTime > 0 && remainingProgress > 0) {
        progressCurrentValue +=
          (elapsed / progressRemainingTime) * remainingProgress;
        progressRemainingTime -= elapsed;

        // Update the UI.
        if ($progress) {
          $progress.style.width = (100 * progressCurrentValue).toFixed(1) + "%";
        }
      }

      // Go on as long as the download is refreshing.
      if (this.timers[id]) {
        window.requestAnimationFrame(progressAnimationFrame);
      }
    };

    // Start the animation.
    window.requestAnimationFrame(progressAnimationFrame);
  },
  /**
   * Stop the timer.
   * @param {number} id
   */
  stopTimer: function(id) {
    clearInterval(this.timers[id]);
    this.timers[id] = null;
  },
  /**
   * Create HTML element.
   * @param {*} html
   */
  elementFromHtml: function(html) {
    const $el = document.createElement("div");
    $el.innerHTML = html;
    return $el.firstChild;
  },
  /**
   * Get proper file name.
   * @param {string} filename
   */
  getProperFilename: function(filename) {
    const backArray = filename.split("\\");
    const forwardArray = filename.split("/");
    const array =
      backArray.length > forwardArray.length ? backArray : forwardArray;
    return array.pop().replace(/.crdownload$/, "");
  },
  /**
   * Check if file is dangerous.
   * @param {*} event
   * @returns boolean
   */
  isDangerous: function(event) {
    return !/safe|accepted/.test(event.danger) && event.state === "in_progress";
  },
  /**
   * Open URL.
   */
  openUrl: function(url) {
    chrome.tabs.create({
      url: url,
      selected: true
    });
  }
};

App.init();
