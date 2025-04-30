// Keep state for last clicked place.
// May become the starting position for gizmo.
let x = 0;
let y = 0;

// When message is received.
browser.runtime.onMessage.addListener((message) => {
  if (message === 'show_gizmo') showGizmo();

  if (message === 'invalidate_gizmo') {
    x = 0;
    y = 0;
  }
  
  // Firefox requires a Promise return value for future compatibility
  return Promise.resolve();
});

// Detect download click position.
document.onmousedown = document.oncontextmenu = (event) => {
  if (isDownloadable(event.target)) {
    x = event.clientX;
    y = event.clientY;
  }
};

/**
 * Show gizmo
 */
function showGizmo() {
  if (!x && !y) return;

  const $img = document.createElement('img');
  $img.src = browser.runtime.getURL('img/icons/icon-48x48.png');
  $img.style.cssText = 'width:48px;height:48px;position:fixed;opacity:1;z-index:999999;';
  $img.style.left = x - 24 + 'px';
  $img.style.top = y - 48 + 'px';
  document.body.appendChild($img);

  setTimeout(() => {
    const duration = calcDuration(distance(x - 48, y - 48, window.innerWidth - 48, -48));
    $img.style.transition = 'all ' + duration + 's'; // Firefox standard property (no webkit prefix needed)
    $img.style.left = window.innerWidth - 60 + 'px';
    $img.style.top = -48 + 'px';
    $img.style.opacity = 0.5;
    $img.style.width = 32 + 'px';
    $img.style.height = 32 + 'px';
    setTimeout(() => document.body.removeChild($img), duration * 1000 + 200);
  }, 100);
}

/**
 * Get the distance.
 * @param {*} x1
 * @param {*} y1
 * @param {*} x2
 * @param {*} y2
 */
function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
}

/**
 * Calculate the duration.
 * @param {*} distance
 * @param {*} speed
 */
function calcDuration(distance, speed) {
  speed = speed || 800; // px/sec
  return distance / speed;
}

/**
 * Check if element is downloadable.
 * @param {*} el
 */
function isDownloadable(el) {
  return el.nodeName === 'IMG' || isLinkOrDescendantOfLink(el);
}

/**
 * Check if element is a link.
 * @param {*} el
 */
function isLinkOrDescendantOfLink(el) {
  do {
    if (el.nodeName === 'A' && el.href) {
      return true;
    }
  } while ((el = el.parentNode));
  return false;
}