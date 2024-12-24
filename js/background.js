let port = null;
let isPopupOpen = false;

// Set up initial background behaviors
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background script running.");
  chrome.downloads.setShelfEnabled(false);
  chrome.action.setIcon({ path: chrome.runtime.getURL("icons/iconblue.png") });
});

// Ensure downloads shelf is disabled on startup
chrome.runtime.onStartup.addListener(() => {
  chrome.downloads.setShelfEnabled(false); // Ensure this runs on every browser startup
});

// Handle connection from popup
chrome.runtime.onConnect.addListener((connectedPort) => {
  console.log("Connected to popup:", connectedPort);
  port = connectedPort;

  // Listen for messages from the popup
  port.onMessage.addListener((message) => {
    console.log("Message received from popup:", message);

    if (message.type === "popup_open") {
      isPopupOpen = true;
      console.log("Popup opened");
      port.postMessage({ status: "Popup opened successfully!" });
    } else if (message.type === "popup_close") {
      isPopupOpen = false;
      console.log("Popup closed");
      port.postMessage({ status: "Popup closed" });
    }
  });

  // Handle disconnection from the popup
  port.onDisconnect.addListener(() => {
    console.log("Popup disconnected");
    isPopupOpen = false;
    port = null;
  });
});

// Listen for changes in downloads
chrome.downloads.onCreated.addListener(downloadItem => {
  console.log("Download created:", downloadItem);
  chrome.downloads.setShelfEnabled(false); // Disable the native shelf for new downloads
  flashIcon("inProgress"); // Set the icon to yellow for download in progress

  // Optionally, notify popup about the new download
  if (isPopupOpen && port) {
    port.postMessage({ type: "download_created", data: downloadItem });
  }
});

chrome.downloads.onChanged.addListener(delta => {
  console.log("Download changed:", delta);

  if (delta.state) {
    if (delta.state.current === "complete") {
      flashIcon("finished"); // Change icon to green when download finishes
    } else if (delta.state.current === "interrupted" || delta.state.current === "cancelled") {
      flashIcon("default"); // Change icon to blue when download is interrupted or cancelled
    }
  }

  // Optionally, send update to the popup if it's open
  if (isPopupOpen && port) {
    port.postMessage({ type: "download_changed", data: delta });
  }
});

chrome.downloads.onErased.addListener(downloadId => {
  console.log("Download erased:", downloadId);
  flashIcon("default"); // Reset icon to blue when the download is erased
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
}

