chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background script running.");
  chrome.downloads.setShelfEnabled(false);
});

let isPopupOpen = false;
let unseen = [];
let timer;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background script:", message);

  if (message.type === "popup_open") {
    isPopupOpen = true;
    unseen = [];
    refresh();  // Added the refresh function to avoid errors
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

  if (state === "inProgress") {
    iconPath = "icons/icon_download_in_progress.png"; // Fixed file path
  } else if (state === "finished") {
    iconPath = "icons/icon_download_finished.png"; // Fixed file path
  }

  console.log(`Attempting to set icon to ${iconPath}`);

  chrome.action.setIcon({ path: iconPath }, () => {
    if (chrome.runtime.lastError) {
      console.error("Failed to set icon:", chrome.runtime.lastError.message);
    }
  });
}

function refresh() {
  // Add functionality for refreshing UI if needed.
  console.log("Refreshing UI or resetting state");
}
