// Keep state for the last clicked position
let lastX = 0;
let lastY = 0;

// When message is received
browser.runtime.onMessage.addListener(message => {
  if (message === "show_gizmo") showGizmo();
  if (message === "invalidate_gizmo") {
    lastX = 0;
    lastY = 0;
  }
});

// Detect download click position
document.addEventListener('mousedown', handleMouseEvent);
document.addEventListener('contextmenu', handleMouseEvent);

function handleMouseEvent(event) {
  if (isDownloadable(event.target)) {
    lastX = event.clientX;
    lastY = event.clientY;
  }
}

/**
 * Show gizmo
 */
function showGizmo() {
  if (!lastX || !lastY) return;

  const gizmo = document.createElement("img");
  gizmo.src = browser.runtime.getURL("icons/iconblue.png");
  gizmo.style.cssText = "width:48px;height:48px;position:fixed;opacity:1;z-index:999999;";
  gizmo.style.left = `${lastX - 24}px`;
  gizmo.style.top = `${lastY - 48}px`;
  document.body.appendChild(gizmo);

  setTimeout(() => {
    const duration = calcDuration(distance(lastX - 48, lastY - 48, window.innerWidth - 48, -48));
    gizmo.style.transition = `all ${duration}s`;
    gizmo.style.left = `${window.innerWidth - 60}px`;
    gizmo.style.top = `-48px`;
    gizmo.style.opacity = 0.5;
    gizmo.style.width = "32px";
    gizmo.style.height = "32px";

    setTimeout(() => {
      document.body.removeChild(gizmo);
    }, duration * 1000 + 200);
  }, 100);
}

/**
 * Get the distance
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number} Distance between two points
 */
function distance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
}

/**
 * Calculate the duration
 * @param {number} distance
 * @param {number} speed
 * @returns {number} Duration in seconds
 */
function calcDuration(distance, speed = 800) {
  return distance / speed; // speed in px/sec
}

/**
 * Check if element is downloadable
 * @param {Element} el
 * @returns {boolean} True if element is downloadable
 */
function isDownloadable(el) {
  return el.nodeName === "IMG" || isLinkOrDescendantOfLink(el);
}

/**
 * Check if element is a link
 * @param {Element} el
 * @returns {boolean} True if element or its descendant is a link
 */
function isLinkOrDescendantOfLink(el) {
  while (el) {
    if (el.nodeName === "A" && el.href) {
      return true;
    }
    el = el.parentNode;
  }
  return false;
}