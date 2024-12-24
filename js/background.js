chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background script running.");
  chrome.downloads.setShelfEnabled(false);

  // Set the initial default icon
  chrome.action.setIcon({ path: chrome.runtime.getURL("icons/iconblue.png") });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.downloads.setShelfEnabled(false); // Ensure this runs on every browser startup
});

chrome.downloads.onCreated.addListener(downloadItem => {
  console.log("Download created:", downloadItem);
  chrome.downloads.setShelfEnabled(false);
  flashIcon("inProgress"); // Set the icon to yellow for download in progress
});

chrome.downloads.onChanged.addListener(delta => {
  console.log("Download changed:", delta);
  if (delta.state) {
    if (delta.state.current === "complete") {
      flashIcon("finished");
    } else if (delta.state.current === "interrupted" || delta.state.current === "cancelled") {
      flashIcon("default");
    }
  }

  if (delta.bytesReceived && delta.totalBytes) {
    const progress = delta.bytesReceived.current / delta.totalBytes.current;
    console.log(`Progress: ${progress * 100}%`); // Log the progress
    drawToolbarProgressIcon(progress);
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
  chrome.action.setIcon({ path: chrome.runtime.getURL(iconPath) });
}

function drawToolbarProgressIcon(progress) {
  const canvas = document.createElement('canvas');
  const size = 38;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const img = new Image();
  img.src = chrome.runtime.getURL('icons/iconyellow.png');
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);

    ctx.fillStyle = 'green';
    ctx.fillRect(0, size - 4, size * progress, 4);

    const imageData = ctx.getImageData(0, 0, size, size);
    chrome.action.setIcon({ imageData: imageData });
  };

  img.onerror = (err) => {
    console.error('Failed to load icon image', err);
  };
}