chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background script running.");
  chrome.downloads.setShelfEnabled(false);
});

chrome.downloads.setShelfEnabled(false);

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

  // Keep service worker alive until `sendResponse` is called
  return true;
});

function sendInvalidateGizmo() {
  // Make sure the popup exists before sending a message
  if (isPopupOpen) {
    try {
      chrome.runtime.sendMessage({ type: "invalidate_gizmo" }, response => {
        if (chrome.runtime.lastError) {
          console.warn("Error sending message:", chrome.runtime.lastError.message);
        }
      });
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  } else {
    console.log("Popup is not open. Skipping message send.");
  }
}

