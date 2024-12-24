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
  flashIcon();

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
    flashIcon(); // Flash icon when download completes
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

function flashIcon() {
  console.log("Attempting to set icon to icons/icon_download_in_progress.png");

  chrome.action.setIcon({ path: "icons/icon_download_in_progress.png" }, () => {
    if (chrome.runtime.lastError) {
      console.error("Failed to set icon:", chrome.runtime.lastError.message);
      return;
    }

    console.log("Icon set to icons/icon_download_in_progress.png successfully");

    setTimeout(() => {
      console.log("Attempting to set icon to icons/icon_download_finished.png");
      chrome.action.setIcon({ path: "icons/icon_download_finished.png" }, () => {
        if (chrome.runtime.lastError) {
          console.error("Failed to set icon:", chrome.runtime.lastError.message);
          return;
        }

        console.log("Icon set to icons/icon_download_finished.png successfully");
      });
    }, 2000); // Change icon after 2 seconds (adjust as needed)
  });
}
