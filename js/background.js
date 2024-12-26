browser.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background script running.");
  // Removed downloads.setShelfEnabled as it is not supported in Firefox

  // Set the initial default icon (only for desktop Firefox, not Android)
  if (browser.browserAction) {
    browser.browserAction.setIcon({ path: browser.runtime.getURL("icons/iconblue.png") });
  }
});

browser.runtime.onStartup.addListener(() => {
  // Removed downloads.setShelfEnabled as it is not supported in Firefox
  if (browser.browserAction) {
    browser.browserAction.setIcon({ path: browser.runtime.getURL("icons/iconblue.png") });
  }
});

let animationTimer;

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background script:", message);

  if (message.type === "icon_update") {
    if (message.state === "inProgress") {
      flashIcon("inProgress");
    } else if (message.state === "default") {
      flashIcon("default");
    }
  } else if (message === "popup_open") {
    sendResponse({ status: "Popup opened successfully!" });
  } else if (message === "popup_close") {
    sendResponse({ status: "Popup closed" });
  } else {
    console.warn("Unhandled message:", message);
  }

  // Keeps the service worker alive until `sendResponse` is called
  return true;
});

browser.downloads.onCreated.addListener(downloadItem => {
  console.log("Download created:", downloadItem);
  flashIcon("inProgress");
});

browser.downloads.onChanged.addListener(delta => {
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
    console.log(`Progress: ${progress * 100}%`);
    drawToolbarProgressIcon(progress);
  }
});

browser.downloads.onErased.addListener(downloadId => {
  console.log("Download erased:", downloadId);
  checkAndResetIcon();
});

function flashIcon(state) {
  let iconPath = "";

  if (state === "inProgress") {
    iconPath = "icons/iconyellow.png";
  } else if (state === "finished") {
    iconPath = "icons/icongreen.png";
  } else {
    iconPath = "icons/iconblue.png";
  }

  console.log(`Setting icon to ${iconPath}`);
  if (browser.browserAction) {
    browser.browserAction.setIcon({ path: browser.runtime.getURL(iconPath) });
  }

  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
}

function drawToolbarProgressIcon(progress) {
  const canvas = document.createElement('canvas');
  const size = 38;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const img = new Image();
  img.src = browser.runtime.getURL('icons/iconyellow.png');
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);

    ctx.fillStyle = 'green';
    ctx.fillRect(0, size - 4, size * progress, 4);

    const imageData = ctx.getImageData(0, 0, size, size);
    if (browser.browserAction) {
      browser.browserAction.setIcon({ imageData: imageData });
    }
  };

  img.onerror = (err) => {
    console.error('Failed to load icon image', err);
  };
}

function checkAndResetIcon() {
  browser.downloads.search({}, results => {
    const inProgress = results.some(item => item.state === "in_progress");

    if (!inProgress && results.length === 0) {
      flashIcon("default");
    }
  });
}