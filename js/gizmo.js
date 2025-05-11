// Firefox WebExtension/Chrome-compatible gizmo.js

let x = 0;
let y = 0;

const ext = typeof browser !== "undefined" ? browser : chrome;

ext.runtime.onMessage.addListener((message) => {
  if (message === 'show_gizmo') showGizmo();

  if (message === 'invalidate_gizmo') {
    x = 0;
    y = 0;
  }
});

document.onmousedown = document.oncontextmenu = (event) => {
  if (isDownloadable(event.target)) {
    x = event.clientX;
    y = event.clientY;
  }
};

function showGizmo() {
  if (!x && !y) return;

  const $img = document.createElement('img');
  $img.src = ext.runtime.getURL('img/icons/icon-48x48.png');
  $img.style.cssText = 'width:48px;height:48px;position:fixed;opacity:1;z-index:999999;';
  $img.style.left = x - 24 + 'px';
  $img.style.top = y - 48 + 'px';
  document.body.appendChild($img);

  setTimeout(() => {
    const duration = calcDuration(distance(x - 48, y - 48, window.innerWidth - 48, -48));
    $img.style.transition = 'all ' + duration + 's';
    $img.style.left = window.innerWidth - 60 + 'px';
    $img.style.top = -48 + 'px';
    $img.style.opacity = 0.5;
    $img.style.width = 32 + 'px';
    $img.style.height = 32 + 'px';
    setTimeout(() => document.body.removeChild($img), duration * 1000 + 200);
  }, 100);
}

function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
}

function calcDuration(distance, speed) {
  speed = speed || 800; // px/sec
  return distance / speed;
}

function isDownloadable(el) {
  return el.nodeName === 'IMG' || isLinkOrDescendantOfLink(el);
}

function isLinkOrDescendantOfLink(el) {
  do {
    if (el.nodeName === 'A' && el.href) {
      return true;
    }
  } while ((el = el.parentNode));
  return false;
}