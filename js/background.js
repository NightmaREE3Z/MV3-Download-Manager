(function () {
  // Enable or disable the shelf at the bottom of every
  // window associated with the current browser profile.
  chrome.downloads.setUiOptions({ enabled: false }).catch(() => {});

  let isPopupOpen = false;
  let isUnsafe = false;
  let unseen = [];
  let timer;
  let devicePixelRatio = 1;
  let prefersColorSchemeDark = true;

  chrome.offscreen
    .createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['DOM_SCRAPING', 'MATCH_MEDIA'],
      justification: 'For device pixel ratio and dark mode detection.',
    })
    .catch(() => {});

  // When pop up is open.
  chrome.runtime.onMessage.addListener((message) => {
    if (message === 'popup_open') {
      isPopupOpen = true;
      unseen = [];
      refresh();
      sendInvalidateGizmo();
    }

    if (typeof message === 'object' && 'window' in message) {
      devicePixelRatio = message.window.devicePixelRatio;
      prefersColorSchemeDark = message.window.prefersColorSchemeDark;
      refresh();
    }
  });

  // When port is disconnected.
  chrome.runtime.onConnect.addListener((externalPort) => {
    externalPort.onDisconnect.addListener(() => {
      isPopupOpen = false;
      refresh(); // Refresh when popup closes to update icon state
    });
  });

  // When new download is created.
  chrome.downloads.onCreated.addListener(refresh);

  // When download has changed.
  chrome.downloads.onChanged.addListener((event) => {
    // Download finished with popup closed -> unseen.
    if (event.state && event.state.current === 'complete' && !isPopupOpen) {
      unseen.push(event);
    }

    // Refresh when download is paused.
    if (event.state || event.paused) {
      refresh();
    }

    // File name chosen from the file picker (right click).
    if (event.filename && event.filename.previous === '') {
      sendShowGizmo();
    }

    // Download turns out to be not safe.
    if (event.danger && event.danger.current != 'accepted') {
      isUnsafe = true;
      refresh();
    }

    // User accepted the danger.
    if (event.danger && event.danger.current === 'accepted') {
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
        state: 'in_progress',
        paused: false,
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
      
      // Check if there are any downloads in the history
      chrome.downloads.search({}, (allDownloads) => {
        const hasDownloads = allDownloads.length > 0;
        
        // If no unseen downloads or empty history, make sure we revert to blue
        if (unseen.length === 0 && !hasDownloads) {
          // Clear unseen array to ensure blue icon
          unseen = [];
        }
        
        drawToolbarIcon(unseen);
      });
      return;
    }

    if (!timer) {
      timer = setInterval(refresh, 500);
    }

    let longestItem = {
      estimatedEndTime: 0,
    };
    items.forEach((item) => {
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
    sendMessageToActiveTab('show_gizmo');
  }

  /**
   * Send invalidate gizmo message to active tab.
   */
  function sendInvalidateGizmo() {
    sendMessageToActiveTab('invalidate_gizmo');
  }

  /**
   *  Send message to active tab.
   * @param {string} message
   */
  function sendMessageToActiveTab(message) {
    const current = {
      active: true,
      currentWindow: true,
      windowType: 'normal',
    };
    chrome.tabs.query(current, (tabs) => {
      if (!tabs || !tabs.length) return;
      
      tabs.forEach((tab) => {
        if (tab && tab.url && tab.url.startsWith('http')) {
          try {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {
              // Ignore errors from tabs that can't receive messages
            });
          } catch (e) {
            // Ignore errors
          }
        }
      });
    });
  }

  // Toolbar icon
  let canvas = new OffscreenCanvas(38, 38);
  let ctx = canvas.getContext('2d', { willReadFrequently: true });
  const scale = devicePixelRatio < 2 ? 0.5 : 1;
  const size = 38 * scale;
  ctx.scale(scale, scale);

  /**
   * Get color for icon based on download state.
   * @param {string} state - download state ('default', 'inProgress', 'finished')
   * @return {string} color value
   */
  function getIconColor(state) {
    if (state === "inProgress") {
      return "#FFBB00"; // Yellow for in progress
    } else if (state === "finished") {
      return "#00CC00"; // Green for finished
    } else {
      // Default icon color - blue
      return "#0b57d0"; 
    }
  }

  /**
   * Draw toolbar icon.
   * @param {number} unseen
   */
  function drawToolbarIcon(unseen) {
    // Choose icon color based on state
    let iconColor;
    
    // Check for downloads
    chrome.downloads.search({ state: 'in_progress' }, (inProgressDownloads) => {
      if (inProgressDownloads.length > 0) {
        // In progress downloads exist
        iconColor = getIconColor("inProgress");
      } else if (unseen && unseen.length > 0) {
        // Finished but unseen downloads
        iconColor = getIconColor("finished");
      } else {
        // No downloads or all seen - revert to blue
        iconColor = getIconColor("default");
      }
      
      // Create the icon using canvas
      ctx.clearRect(0, 0, 38, 38);
      ctx.strokeStyle = iconColor;
      ctx.fillStyle = iconColor;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(20, 2);
      ctx.lineTo(20, 18);
      ctx.stroke();
      ctx.moveTo(0, 18);
      ctx.lineTo(38, 18);
      ctx.lineTo(20, 38);
      ctx.fill();

      // Apply the drawing to browser
      const icon = { imageData: {} };
      icon.imageData[size] = ctx.getImageData(0, 0, size, size);
      chrome.action.setIcon(icon);
    });
  }

  /**
   * Draw toolbar icon with progress bar.
   * @param {number} progress
   */
  function drawToolbarProgressIcon(progress) {
    const width = progress * 38;
    const iconColor = getIconColor("inProgress"); // Yellow for in progress
    
    ctx.clearRect(0, 0, 38, 38);
    // Bar placeholder
    ctx.lineWidth = 2;
    ctx.fillStyle = iconColor + '40'; // Semi-transparent version for background
    ctx.fillRect(0, 28, 38, 12);
    // Bar fill
    ctx.fillStyle = iconColor;
    ctx.fillRect(0, 28, width, 12);
    // Icon
    ctx.strokeStyle = iconColor;
    ctx.fillStyle = iconColor;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(20, 14);
    ctx.stroke();
    ctx.moveTo(6, 10);
    ctx.lineTo(34, 10);
    ctx.lineTo(20, 24);
    ctx.fill();

    // Apply the drawing to browser
    const icon = { imageData: {} };
    icon.imageData[size] = ctx.getImageData(0, 0, size, size);
    chrome.action.setIcon(icon);
  }

  // Add listener for when downloads are removed
  chrome.downloads.onErased.addListener(() => {
    chrome.downloads.search({}, (allDownloads) => {
      if (allDownloads.length === 0) {
        // All downloads have been removed
        unseen = [];
        refresh();
      }
    });
  });
})();