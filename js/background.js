(function(window) {
  // Enable or disable the shelf at the bottom of every
  // window associated with the current browser profile.
  // https://developer.chrome.com/extensions/downloads#method-setShelfEnabled
  chrome.downloads.setShelfEnabled(false);

  let isPopupOpen = false;
  let isUnsafe = false;
  let unseen = [];
  let timer;

  // When pop up is open.
  chrome.runtime.onMessage.addListener(message => {
    if (message === "popup_open") {
      isPopupOpen = true;
      unseen = [];
      refresh();
      sendInvalidateGizmo();
    }
  });

  // When port is disconnected.
  chrome.runtime.onConnect.addListener(externalPort => {
    externalPort.onDisconnect.addListener(() => (isPopupOpen = false));
  });

  // When new download is created.
  chrome.downloads.onCreated.addListener(refresh);

  // When download has changed.
  chrome.downloads.onChanged.addListener(event => {
    // Download finished with popup closed -> unseen.
    if (event.state && event.state.current === "complete" && !isPopupOpen) {
      unseen.push(event);
    }

    // Refresh when download is paused.
    if (event.state || event.paused) {
      refresh();
    }

    // File name chosen from the file picker (right click).
    if (event.filename && event.filename.previous === "") {
      sendShowGizmo();
    }

    // Download turns out to be not safe.
    if (event.danger && event.danger.current != "accepted") {
      isUnsafe = true;
      refresh();
    }

    // User accepted the danger.
    if (event.danger && event.danger.current === "accepted") {
      isUnsafe = false;
      refresh();
    }
  });

  /**
   * Refresh download item.
   */
  function refresh() {
    chrome.downloads.search(
      {
        state: "in_progress",
        paused: false
      },
      refreshToolbarIcon
    );
  }
  refresh();

  /**
   * Refresh toolbar icon.
   * @param {*} items
   */
  function refreshToolbarIcon(items) {
    if (!items.length) {
      clearInterval(timer);
      timer = null;
      drawToolbarIcon(unseen);
      return;
    }

    if (!timer) {
      timer = setInterval(refresh, 500);
    }

    let longestItem = {
      estimatedEndTime: 0
    };
    items.forEach(item => {
      estimatedEndTime = new Date(item.estimatedEndTime);
      longestEndTime = new Date(longestItem.estimatedEndTime);
      if (estimatedEndTime > longestEndTime) {
        longestItem = item;
      }
    });

    const progress = longestItem.bytesReceived / longestItem.totalBytes;
    drawToolbarProgressIcon(progress);
  }

  /**
   * Send show gizmo message to active tab.
   */
  function sendShowGizmo() {
    sendMessageToActiveTab("show_gizmo");
  }

  /**
   * Send invalidate gizmo message to active tab.
   */
  function sendInvalidateGizmo() {
    sendMessageToActiveTab("invalidate_gizmo");
  }

  /**
   *  Send message to active tab.
   * @param {string} message
   */
  function sendMessageToActiveTab(message) {
    const current = {
      active: true,
      currentWindow: true,
      windowType: "normal"
    };
    chrome.tabs.query(current, tabs => {
      tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, message));
    });
  }

  // Toolbar icon
  let canvas = document.createElement("canvas");
  canvas.width = 38;
  canvas.height = 38;
  let ctx = canvas.getContext("2d");
  const scale = window.devicePixelRatio < 2 ? 0.5 : 1;
  const size = 38 * scale;
  ctx.scale(scale, scale);

  /**
   * Get color for icon.
   * @param {string} name
   * @return string
   */
  function getColor(state) {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    let colorLight = "#dddddd";
    let colorDark = "#666666";

    // Return the default color.
    if (state === "default") {
      return isDark ? colorLight : colorDark;
    }

    if (isUnsafe) {
      colorLight = "#d15353";
      colorDark = "#c62828";
    } else {
      colorLight = "#63ace5";
      colorDark = "#1198ff";
    }

    if (state === "active") {
      return isDark ? colorLight : colorDark;
    } else if (state === "in_progress") {
      // Decrease the color opacity.
      return isDark ? colorLight + "80" : colorDark + "40";
    }
  }

  /**
   * Draw toolbar icon.
   * @param {number} unseen
   */
  function drawToolbarIcon(unseen) {
    const color = unseen.length > 0 ? getColor("active") : getColor("default");

    // Create the icon.
    ctx.clearRect(0, 0, 38, 38);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(20, 2);
    ctx.lineTo(20, 18);
    ctx.stroke();
    ctx.moveTo(0, 18);
    ctx.lineTo(38, 18);
    ctx.lineTo(20, 38);
    ctx.fill();

    // Apply the drawing to browser.
    const icon = { imageData: {} };
    icon.imageData[size] = ctx.getImageData(0, 0, size, size);
    chrome.browserAction.setIcon(icon);
  }

  /**
   * Draw toolbar icon with progress bar.
   * @param {number} progress
   */
  function drawToolbarProgressIcon(progress) {
    const width = progress * 38;

    ctx.clearRect(0, 0, 38, 38);
    // Bar placeholder
    ctx.lineWidth = 2;
    ctx.fillStyle = getColor("in_progress");
    ctx.fillRect(0, 28, 38, 12);
    // Bar fill
    ctx.fillStyle = getColor("active");
    ctx.fillRect(0, 28, width, 12);
    // Icon
    ctx.strokeStyle = getColor("active");
    ctx.fillStyle = getColor("active");
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(20, 14);
    ctx.stroke();
    ctx.moveTo(6, 10);
    ctx.lineTo(34, 10);
    ctx.lineTo(20, 24);
    ctx.fill();

    // Apply the drawing to browser.
    const icon = { imageData: {} };
    icon.imageData[size] = ctx.getImageData(0, 0, size, size);
    chrome.browserAction.setIcon(icon);
  }
})(window);
