chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background script running.");
  chrome.downloads.setShelfEnabled(false);

  // Set the initial default icon (iconblue.png)
  chrome.action.setIcon({ path: chrome.runtime.getURL("icons/iconblue.png") });
});

let animationTimer;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background script:", message);

  if (message.type === "popup_open") {
    isPopupOpen = true;
    unseen = [];
    refresh();
    sendInvalidateGizmo();
    sendResponse({ status: "Popup opened" });
  }

  // Keeps the service worker alive until `sendResponse` is called
  return true;
});

chrome.downloads.onCreated.addListener(downloadItem => {
  console.log("Download created:", downloadItem);

  chrome.downloads.search({ url: downloadItem.url }, results => {
    if (results.length > 1) {
      console.log("Download already being handled:", downloadItem.url);
      return;
    }

    chrome.downloads.cancel(downloadItem.id, () => {
      handleDownload(downloadItem);
    });
  });
});

function handleDownload(downloadItem) {
  flashIcon("inProgress");

  chrome.downloads.download({ url: downloadItem.url }, newDownloadId => {
    if (chrome.runtime.lastError) {
      console.warn("Error initiating download:", chrome.runtime.lastError.message);
    } else {
      console.log("Download initiated with ID:", newDownloadId);
    }
  });

  try {
    chrome.runtime.sendMessage({ type: "download_created", data: downloadItem }, response => {
      if (chrome.runtime.lastError) {
        console.warn("Error sending message:", chrome.runtime.lastError.message);
      }
    });
  } catch (error) {
    console.error("Failed to send message:", error);
  }
}

chrome.downloads.onChanged.addListener(delta => {
  console.log("Download changed:", delta);

  if (delta.state && delta.state.current === "complete") {
    flashIcon("finished");
  }

  try {
    if (delta.filename || delta.danger) {
      chrome.runtime.sendMessage({ type: "download_changed", data: delta }, response => {
        if (chrome.runtime.lastError) {
          console.warn("Error sending message:", chrome.runtime.lastError.message);
        }
      });
    }
  } catch (error) {
    console.error("Failed to send message:", error);
  }
});

function flashIcon(state) {
  let iconPath = "";
  let iconFrames = [];

  if (state === "inProgress") {
    iconFrames = [
      "icons/iconyellow.png" // Updated icon for download in progress
    ];
  } else if (state === "finished") {
    iconPath = "icons/icongreen.png"; // Updated icon for download finished
  }

  console.log(`Attempting to set icon to ${iconPath}`);

  if (iconFrames.length > 0) {
    let currentFrame = 0;

    // Clear any previous animation
    clearInterval(animationTimer);

    // Set the initial icon
    chrome.action.setIcon({ path: chrome.runtime.getURL(iconFrames[currentFrame]) });

    // Cycle through the frames every 200ms (or adjust the speed as necessary)
    animationTimer = setInterval(() => {
      currentFrame = (currentFrame + 1) % iconFrames.length;
      chrome.action.setIcon({ path: chrome.runtime.getURL(iconFrames[currentFrame]) });
    }, 200); // Adjust the timing to control animation speed
  } else if (iconPath) {
    // If no animation, just set the final icon
    chrome.action.setIcon({ path: chrome.runtime.getURL(iconPath) });
  }
}

function refresh() {
  console.log("Refreshing UI or resetting state");
}

function sendInvalidateGizmo() {
  console.log("Invalidate gizmo");
}
