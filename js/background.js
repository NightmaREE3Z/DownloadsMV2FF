// Firefox MV2-compatible Background.js (converted from Chrome extension)

// Use a regular canvas since OffscreenCanvas is not supported in Firefox background scripts
let canvas = typeof OffscreenCanvas !== 'undefined'
  ? new OffscreenCanvas(38, 38)
  : (() => {
      let c = document.createElement('canvas');
      c.width = 38;
      c.height = 38;
      return c;
    })();
let ctx = canvas.getContext('2d', { willReadFrequently: true });

// Remove downloads.setUiOptions - not supported in Firefox
// chrome.downloads.setUiOptions({ enabled: false }).catch(() => {})

let isPopupOpen = false;
let isUnsafe = false;
let unseen = [];
let timer = null;
let devicePixelRatio = 1;
let prefersColorSchemeDark = true;

const ext = typeof browser !== "undefined" ? browser : chrome;

// Firefox MV2 background scripts do not support onStartup, so use onInstalled (if needed)
if (ext.runtime.onStartup) {
  ext.runtime.onStartup.addListener(() => setDefaultBlueIcon());
}
setDefaultBlueIcon();

ext.runtime.onMessage.addListener((message) => {
  if (message === 'popup_open') {
    isPopupOpen = true;
    unseen = [];
    refresh();
    sendInvalidateGizmo();
  }
  if (message === 'popup_closed') {
    isPopupOpen = false;
    refresh();
  }
  if (typeof message === 'object' && 'window' in message) {
    devicePixelRatio = message.window.devicePixelRatio;
    prefersColorSchemeDark = message.window.prefersColorSchemeDark;
    refresh();
  }
});

ext.runtime.onConnect.addListener((externalPort) => {
  externalPort.onDisconnect.addListener(() => {
    isPopupOpen = false;
    refresh();
  });
});

ext.downloads.onCreated.addListener(refresh);
ext.downloads.onChanged.addListener((event) => {
  if (event.state && event.state.current === 'complete' && !isPopupOpen) {
    unseen.push(event);
  }
  if (event.state || event.paused) refresh();
  if (event.filename && event.filename.previous === '') sendShowGizmo();
  if (event.danger && event.danger.current != 'accepted') {
    isUnsafe = true;
    refresh();
  }
  if (event.danger && event.danger.current === 'accepted') {
    isUnsafe = false;
    refresh();
  }
});

ext.downloads.onErased.addListener(() => {
  ext.downloads.search({}, (allDownloads) => {
    if (allDownloads.length === 0) {
      unseen = [];
      setDefaultBlueIcon();
      refresh();
    }
  });
});

function refresh() {
  ext.downloads.search({}, (allDownloads) => {
    const inProgressItems = allDownloads.filter(
      d => d.state === "in_progress" && !d.paused && d.totalBytes > 0
    );
    if (inProgressItems.length) {
      if (timer) clearInterval(timer);
      timer = setInterval(refresh, 1000);

      let longestItem = { estimatedEndTime: 0 };
      inProgressItems.forEach((item) => {
        const estimatedEndTime = new Date(item.estimatedEndTime);
        const longestEndTime = new Date(longestItem.estimatedEndTime);
        if (estimatedEndTime > longestEndTime) longestItem = item;
      });
      const progress =
        longestItem.totalBytes > 0
          ? longestItem.bytesReceived / longestItem.totalBytes
          : 0;
      if (progress > 0 && progress < 1) {
        drawToolbarProgressIcon(progress);
        return;
      }
    } else {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    const someComplete = allDownloads.some(item => item.state === "complete" && item.exists !== false);
    if (someComplete) {
      drawToolbarIcon(unseen, "#00CC00");
      return;
    }
    setDefaultBlueIcon();
  });
}

function setDefaultBlueIcon() {
  drawToolbarIcon([], "#00286A");
}

function sendShowGizmo() {
  sendMessageToActiveTab('show_gizmo');
}
function sendInvalidateGizmo() {
  sendMessageToActiveTab('invalidate_gizmo');
}
function sendMessageToActiveTab(message) {
  const current = {
    active: true,
    currentWindow: true,
    windowType: 'normal',
  };
  ext.tabs.query(current, (tabs) => {
    if (!tabs || !tabs.length) return;
    tabs.forEach((tab) => {
      if (tab && tab.url && tab.url.startsWith('http')) {
        try {
          ext.tabs.sendMessage(tab.id, message, () => {
            // Ignore errors
          });
        } catch (e) {}
      }
    });
  });
}

function getScale() {
  return devicePixelRatio < 2 ? 0.5 : 1;
}
function getIconColor(state) {
  if (state === "inProgress") return "#FFBB00";
  if (state === "finished") return "#00CC00";
  return "#00286A";
}
function drawToolbarIcon(unseen, forceColor) {
  let iconColor = forceColor || getIconColor((unseen && unseen.length > 0) ? "finished" : "default");
  const scale = getScale();
  const size = 38 * scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 38, 38);
  ctx.save();
  ctx.scale(scale, scale);
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
  ctx.restore();
  const icon = { imageData: {} };
  icon.imageData[size] = ctx.getImageData(0, 0, size, size);
  if (ext.browserAction && ext.browserAction.setIcon) {
    ext.browserAction.setIcon(icon);
  } else if (ext.action && ext.action.setIcon) {
    ext.action.setIcon(icon);
  }
}
function drawToolbarProgressIcon(progress) {
  const iconColor = getIconColor("inProgress");
  const scale = getScale();
  const size = 38 * scale;
  const width = progress * 38;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 38, 38);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.lineWidth = 2;
  ctx.fillStyle = iconColor + '40';
  ctx.fillRect(0, 28, 38, 12);
  ctx.fillStyle = iconColor;
  ctx.fillRect(0, 28, width, 12);
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
  ctx.restore();
  const icon = { imageData: {} };
  icon.imageData[size] = ctx.getImageData(0, 0, size, size);
  if (ext.browserAction && ext.browserAction.setIcon) {
    ext.browserAction.setIcon(icon);
  } else if (ext.action && ext.action.setIcon) {
    ext.action.setIcon(icon);
  }
}