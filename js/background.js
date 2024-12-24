chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background script running.");
  chrome.downloads.setShelfEnabled(false);

  // Set the initial default icon
  chrome.action.setIcon({ path: chrome.runtime.getURL("icons/iconblue.png") });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.downloads.setShelfEnabled(false); // Ensure this runs on every browser startup
});

let animationTimer;
let isPopupOpen = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background script:", message);

  if (message.type === "popup_open") {
    isPopupOpen = true;
    sendResponse({ status: "Popup opened successfully!" });
  } else if (message.type === "popup_close") {
    isPopupOpen = false;
    sendResponse({ status: "Popup closed" });
  } else {
    console.warn("Unhandled message type:", message.type);
  }

  // Keeps the service worker alive until `sendResponse` is called
  return true;
});

chrome.downloads.onCreated.addListener(downloadItem => {
  console.log("Download created:", downloadItem);

  // Block the native shelf for new downloads
  chrome.downloads.setShelfEnabled(false);

  flashIcon("inProgress"); // Immediately set the icon to yellow for download in progress

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

  if (delta.state) {
    if (delta.state.current === "complete") {
      flashIcon("finished");
    } else if (delta.state.current === "interrupted" || delta.state.current === "cancelled") {
      flashIcon("default");
    }
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

chrome.downloads.onErased.addListener(downloadId => {
  console.log("Download erased:", downloadId);
  flashIcon("default");
});

function flashIcon(state) {
  let iconPath = "";

  if (state === "inProgress") {
    iconPath = "icons/iconyellow.png"; // Icon for download in progress
  } else if (state === "finished") {
    iconPath = "icons/icongreen.png"; // Icon for download finished
  } else {
    iconPath = "icons/iconblue.png"; // Default icon
  }

  console.log(`Setting icon to ${iconPath}`);
  chrome.action.setIcon({ path: chrome.runtime.getURL(iconPath) });

  // Clear animation if any
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
}
