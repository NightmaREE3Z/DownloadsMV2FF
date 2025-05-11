// main.js: fixes for icon always showing, no strikethrough, download URL always shown

const ext = typeof browser !== "undefined" ? browser : chrome;

window.$ = typeof document !== "undefined" && document.querySelector
  ? document.querySelector.bind(document)
  : function () { return null; };

Node.prototype.on = window.on = function (name, fn) {
  if (this) this.addEventListener(name, fn);
};

const Format = {
  toByte(bytes) {
    if (bytes == null || isNaN(bytes)) return "0 B";
    if (bytes < 1000 * 1000) return (bytes / 1000).toFixed() + " KB";
    if (bytes < 1000 * 1000 * 10) return (bytes / 1000 / 1000).toFixed(1) + " MB";
    if (bytes < 1000 * 1000 * 1000) return (bytes / 1000 / 1000).toFixed() + " MB";
    if (bytes < 1000 * 1000 * 1000 * 1000) return (bytes / 1000 / 1000 / 1000).toFixed(1) + " GB";
    return bytes + " B";
  },
  toTime(sec) {
    if (isNaN(sec) || sec == null) return "";
    if (sec < 60) return Math.ceil(sec) + " " + (t("secs") || "sec");
    if (sec < 60 * 5) return Math.floor(sec / 60) + " " + (t("mins") || "min") + " " + Math.ceil(sec % 60) + " " + (t("secs") || "sec");
    if (sec < 60 * 60) return Math.ceil(sec / 60) + " " + (t("mins") || "min");
    if (sec < 60 * 60 * 5) return Math.floor(sec / 60 / 60) + " " + (t("hours") || "hr") + " " + (Math.ceil(sec % 60) % 60) + " " + (t("mins") || "min");
    if (sec < 60 * 60 * 24) return Math.ceil(sec / 60 / 60) + " " + (t("hours") || "hr");
    return Math.ceil(sec / 60 / 60 / 24) + " " + (t("days") || "d");
  }
};

const Template = {
  button(type, action, text) {
    return `<button class="button button--${type}" data-action="${action}">${text || ""}</button>`;
  },
  buttonShowMore() {
    return `<button class="button button--secondary button--block" data-action="more">${t("show_more") || "Show more"}</button>`;
  }
};

let popupReady = false;
const iconCache = {};

const App = {
  timers: {},
  resultsLength: 0,
  resultsLimit: 10,
  devicePixelRatio: typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1,
  prefersColorSchemeDark: typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false,
  renderPending: false,
  pollInterval: null,
  prevDownloadIds: [],
  prevHtmlMap: {},
  lastRetried: null,

  init() {
    window.addEventListener("DOMContentLoaded", () => {
      ext.runtime.sendMessage('popup_open');
      popupReady = true;
      this.bindEvents();
      this.render();
      this.pollInterval = setInterval(() => {
        if (popupReady) this.render();
      }, 500);
      ext.downloads.onCreated && ext.downloads.onCreated.addListener((item) => {
        if (App.lastRetried && App.lastRetried.url === item.url) {
          App.lastRetried.newId = item.id;
          App.lastRetried.startTime = item.startTime;
        }
        if (popupReady) this.render();
      });
    });
    window.addEventListener("unload", () => {
      popupReady = false;
      ext.runtime.sendMessage('popup_closed');
      Object.values(this.timers).forEach(clearInterval);
      this.timers = {};
      if (this.pollInterval) clearInterval(this.pollInterval);
    });
  },

  bindEvents() {
    ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!popupReady) return;
      if (message.type === "download_created" || message.type === "download_changed") {
        this.scheduleRender();
      }
      if (sendResponse) sendResponse({ status: "Message received in popup" });
    });

    $("#main")?.on("scroll", () => {
      const toolbar = $(".toolbar");
      if (toolbar) toolbar.classList.toggle("toolbar--fixed", $("#main").scrollTop > 0);
    });

    $("#action-show-all")?.on("click", () => this.openUrl(ext === browser ? "about:downloads" : "chrome://downloads"));

    $("#action-clear-all")?.on("click", () => {
      this.clearAllDownloadsExceptRunning((running) => {
        if (running.length) {
          this.render();
        } else {
          const emptyTmpl = $("#tmpl__state-empty");
          if (emptyTmpl) $("#downloads").innerHTML = emptyTmpl.innerHTML;
          if (emptyTmpl && typeof localize === "function") {
            localize();
          }
        }
      });
    });

    $("#downloads")?.on("click", this.handleClick.bind(this));
  },

  scheduleRender() {
    if (this.renderPending) return;
    this.renderPending = true;
    setTimeout(() => {
      this.renderPending = false;
      this.render();
    }, 400);
  },

  render() {
    ext.downloads.search(
      {
        limit: this.resultsLimit + 10,
        filenameRegex: ".+",
        orderBy: ["-startTime"]
      },
      (data) => {
        if ((ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError)) {
          const err = (ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
          console.error(err.message);
          return;
        }
        data.sort((a, b) => {
          if (a.filename === b.filename) {
            if (a.state === "in_progress" && b.state === "interrupted") return -1;
            if (a.state === "interrupted" && b.state === "in_progress") return 1;
            if (a.state === "complete" && b.state === "interrupted") return -1;
            if (a.state === "interrupted" && b.state === "complete") return 1;
            return new Date(b.startTime) - new Date(a.startTime);
          }
          return new Date(b.startTime) - new Date(a.startTime);
        });

        this.resultsLength = data.length;
        this.updateDownloadsView(data.slice(0, this.resultsLimit));
      }
    );
  },

  updateDownloadsView(results) {
    const downloadsEl = $("#downloads");
    const emptyTmpl = $("#tmpl__state-empty");
    if (!results || results.length === 0) {
      downloadsEl.innerHTML = emptyTmpl ? emptyTmpl.innerHTML : "";
      if (emptyTmpl && typeof localize === "function") {
        localize();
      }
      this.prevDownloadIds = [];
      this.prevHtmlMap = {};
      return;
    }
    const ids = results.map(item => item.id);
    let htmlMap = {};

    results.forEach((item, idx) => {
      if (!item) return;
      let node = $(`#download-${item.id}`);
      let newHtml = this.getDownloadView(item);

      if (!node) {
        const el = document.createElement("div");
        el.innerHTML = newHtml;
        let prevNode = null;
        for (let i = idx - 1; i >= 0; --i) {
          let prev = $(`#download-${results[i].id}`);
          if (prev) {
            prevNode = prev;
            break;
          }
        }
        if (prevNode && prevNode.nextSibling) {
          downloadsEl.insertBefore(el.firstChild, prevNode.nextSibling);
        } else if (prevNode) {
          downloadsEl.appendChild(el.firstChild);
        } else if (downloadsEl.firstChild) {
          downloadsEl.insertBefore(el.firstChild, downloadsEl.firstChild);
        } else {
          downloadsEl.appendChild(el.firstChild);
        }
      } else if (this.prevHtmlMap[item.id] !== newHtml) {
        const el = document.createElement("div");
        el.innerHTML = newHtml;
        node.replaceWith(el.firstChild);
      }
      htmlMap[item.id] = newHtml;
    });

    if (this.prevDownloadIds.length) {
      this.prevDownloadIds.forEach(oldId => {
        if (!ids.includes(oldId)) {
          const oldNode = $(`#download-${oldId}`);
          if (oldNode) downloadsEl.removeChild(oldNode);
        }
      });
    }

    if (!downloadsEl.hasChildNodes() || downloadsEl.childElementCount === 0) {
      let html = "";
      results.forEach(item => {
        if (!item) return;
        html += htmlMap[item.id];
      });
      downloadsEl.innerHTML = html;
    }

    if (this.resultsLength > this.resultsLimit && !$("#downloads .button--block")) {
      downloadsEl.insertAdjacentHTML("beforeend", Template.buttonShowMore());
    }

    results.forEach(item => {
      if (!item) return;
      const $el = $(`#download-${item.id}`);
      if (!$el) return;

      const $progress = $el.querySelector(".progress__bar");
      if ($progress) {
        let progressWidth = "0%";
        if (item.totalBytes > 0) {
          progressWidth = ((100 * item.bytesReceived) / item.totalBytes).toFixed(1) + "%";
        }
        $progress.style.width = progressWidth;
      }

      const $status = $el.querySelector(".status");
      if ($status && item.state === "in_progress") {
        let speed = 0;
        let left_text = "";
        const remainingBytes = item.totalBytes - item.bytesReceived;
        let remainingSeconds = 0;
        if (item.estimatedEndTime) {
          remainingSeconds = (new Date(item.estimatedEndTime) - new Date()) / 1000;
        }
        if (remainingSeconds > 0) {
          speed = remainingBytes / remainingSeconds;
        }
        if (speed) {
          left_text = `, ${Format.toTime(remainingSeconds)} ${t("left") || ""}`;
        }
        $status.textContent = `${Format.toByte(speed)}/s - ${Format.toByte(item.bytesReceived)} of ${Format.toByte(item.totalBytes)}${left_text}`;
        if (item.bytesReceived && item.bytesReceived === item.totalBytes) {
          $status.textContent = Format.toByte(item.totalBytes);
        }
      }

      // Icon handling - always show icon, also during download
      const $icon = $el.querySelector(`#icon-${item.id}`);
      if ($icon) {
        if (!iconCache[item.id]) iconCache[item.id] = "";
        if (ext.downloads.getFileIcon) {
          ext.downloads.getFileIcon(item.id, { size: 32 }, (iconURL) => {
            if (iconURL && $icon.src !== iconURL) {
              iconCache[item.id] = iconURL;
              $icon.src = iconURL;
            }
          });
        }
      }

      // URL handling - always show url if present
      const $url = $el.querySelector(".list__item__source");
      if ($url) {
        let shownUrl = item.finalUrl || item.url || "";
        $url.textContent = shownUrl;
        $url.setAttribute("href", shownUrl || "#");
        $url.setAttribute("title", shownUrl);
        $url.style.display = shownUrl ? "" : "none";
      }
    });

    this.prevDownloadIds = ids;
    this.prevHtmlMap = htmlMap;
  },

  getDownloadView(event) {
    let buttons = "";
    let status = "";
    let progressClass = "";
    let progressWidth = "0%";
    if (!event) return "";

    const fileName = this.getProperFilename(event.filename) || "";
    const fileUrl = event.finalUrl || event.url || "";
    const exists = event.exists !== false;

    if (event.state === "complete") {
      status = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
      buttons = Template.button("secondary", "show", t("show_in_folder") || "Show in folder");
      return `<div id="download-${event.id}" class="list__item download${!exists ? " removed" : ""}" data-id="${event.id}">
        <div class="list__item__icon">
          <img id="icon-${event.id}" data-default="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T" src="${iconCache[event.id] || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T'}">
        </div>
        <div class="list__item__content">
          <p class="list__item__filename" title="${fileName}" data-action="open">${fileName}</p>
          <a href="${fileUrl || "#"}" class="list__item__source" data-action="url" title="${fileUrl}">${fileUrl || ""}</a>
          <div class="list__item__row">
            ${buttons}
            <span class="list__item__canceled">${status}</span>
          </div>
        </div>
      </div>`;
    }

    if (event.state === "interrupted") {
      status = event.error === "NETWORK_FAILED" ? (t("failed_network") || "Failed - Network error") : (t("canceled") || "Canceled");
      buttons = Template.button("primary", "retry", t("retry") || "Retry");
      return `<div id="download-${event.id}" class="list__item download canceled" data-id="${event.id}">
        <div class="list__item__icon">
          <img id="icon-${event.id}" data-default="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T" src="${iconCache[event.id] || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T'}">
        </div>
        <div class="list__item__content">
          <p class="list__item__filename" title="${fileName}" data-action="open">${fileName}</p>
          <a href="${fileUrl || "#"}" class="list__item__source" data-action="url" title="${fileUrl}">${fileUrl || ""}</a>
          <div class="list__item__row">
            ${buttons}
            <span class="list__item__canceled">${status}</span>
          </div>
        </div>
      </div>`;
    }

    if (event.paused) {
      status = t("paused") || "Paused";
      progressClass = "paused";
      buttons = Template.button("primary", "resume", t("resume") || "Resume") + Template.button("secondary", "cancel", t("cancel") || "Cancel");
    } else {
      status = "";
      progressClass = "in-progress";
      buttons = Template.button("primary", "pause", t("pause") || "Pause") + Template.button("secondary", "cancel", t("cancel") || "Cancel");
    }
    if (event.totalBytes > 0) {
      progressWidth = ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
    }

    const extraClass = [
      "download",
      !exists ? "removed" : "",
      event.state === "interrupted" ? "canceled" : "",
      progressClass,
      this.isDangerous(event) ? "danger" : ""
    ].join(" ").trim();

    const defaultFileIcon = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T`;

    return `<div id="download-${event.id}" class="list__item ${extraClass}" data-id="${event.id}">
      <div class="list__item__icon">
        <img id="icon-${event.id}" data-default="${defaultFileIcon}" src="${iconCache[event.id] || defaultFileIcon}">
      </div>
      <div class="list__item__content">
        <p class="list__item__filename" title="${fileName}" data-action="open">${fileName}</p>
        <a href="${fileUrl || "#"}" class="list__item__source" data-action="url" title="${fileUrl}">${fileUrl || ""}</a>
        ${
          progressClass === "in-progress"
            ? `<div class="progress"><div class="progress__bar" style="width: ${progressWidth};"></div></div>`
            : ""
        }
        <div class="list__item__controls">
          <div class="list__item__buttons">${buttons}</div>
          <div class="list__item__status status"></div>
        </div>
      </div>
    </div>`;
  },

  refreshDownloadView(id) {
    ext.downloads.search({ id: id }, (results) => {
      if ((ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError)) {
        const err = (ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
        console.error(err.message);
        return;
      }
      if (results[0]) {
        const $el = document.createElement("div");
        $el.innerHTML = this.getDownloadView(results[0]);
        const downloadEl = $(`#download-${id}`);
        if (downloadEl) {
          $("#downloads").replaceChild($el.firstChild, downloadEl);
        }
      }
    });
  },

  clearAllDownloadsExceptRunning(callback) {
    ext.downloads.search({}, (results) => {
      if ((ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError)) {
        const err = (ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
        console.error(err.message);
        return;
      }
      const running = results.filter((item) => item.state === "in_progress");
      results.forEach((item) => {
        if (item.state !== "in_progress" && item.id) {
          ext.downloads.erase({ id: item.id });
          this.stopTimer(item.id);
        }
      });
      if (callback) callback(running);
    });
  },

  handleClick(event) {
    const action = event.target.dataset.action;
    if (!action) return;

    event.preventDefault();

    if (action === "url") {
      this.openUrl(event.target.href);
      return;
    }

    if (action === "more") {
      this.openUrl(ext === browser ? "about:downloads" : "chrome://downloads");
      return;
    }

    const $el = event.target.closest(".download");
    if (!$el) return;

    const id = +$el.dataset.id;

    if (["resume", "cancel", "pause"].includes(action)) {
      ext.downloads[action](id);
      this.refreshDownloadView(id);
      if (action === "resume") {
        this.startTimer(id);
      } else {
        this.stopTimer(id);
      }
    } else if (action === "retry") {
      ext.downloads.search({ id: id }, (results) => {
        if ((ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError)) {
          const err = (ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
          console.error(err.message);
          return;
        }
        if (results[0]) {
          App.lastRetried = {
            url: results[0].url,
            filename: results[0].filename,
            canceledId: id
          };
          ext.downloads.download({ url: results[0].url }, (new_id) => {
            if ((ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError)) {
              const err = (ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
              console.error(err.message);
              return;
            }
            this.startTimer(new_id);
            this.render();
            setTimeout(() => this.render(), 400);
          });
        }
      });
    } else if (action === "erase") {
      ext.downloads.erase({ id: id }, () => {
        const $list = $el.parentNode;
        if ($list) {
          $list.removeChild($el);
          this.stopTimer(id);
          this.render();
        }
      });
    } else if (action === "show") {
      ext.downloads.show(id);
    } else if (action === "open") {
      ext.downloads.open(id);
    }
  },

  startTimer(id) {
    this.stopTimer(id);

    let progressLastValue = 0;
    let progressCurrentValue = 0;
    let progressNextValue = 0;
    let progressRemainingTime = 0;
    let progressLastFrame = Date.now();

    const timer = () => {
      const $el = $(`#download-${id}`);
      if (!$el) return;

      const $status = $el.querySelector(".status");

      ext.downloads.search({ id: id }, (results) => {
        if ((ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError)) {
          const err = (ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
          console.error(err.message);
          this.stopTimer(id);
          return;
        }

        const event = results[0];
        if (!event) {
          this.stopTimer(id);
          this.render();
          return;
        }

        if (event.state !== "complete") {
          let speed = 0;
          let left_text = "";
          const remainingBytes = event.totalBytes - event.bytesReceived;
          let remainingSeconds = 0;
          if (event.estimatedEndTime) {
            remainingSeconds = (new Date(event.estimatedEndTime) - new Date()) / 1000;
          }
          if (remainingSeconds > 0) {
            speed = remainingBytes / remainingSeconds;
          }
          if (speed) {
            left_text = `, ${Format.toTime(remainingSeconds)} ${t("left") || ""}`;
          }
          if ($status) {
            $status.textContent = `${Format.toByte(speed)}/s - ${Format.toByte(event.bytesReceived)} of ${Format.toByte(
              event.totalBytes
            )}${left_text}`;
            if (event.bytesReceived && event.bytesReceived === event.totalBytes) {
              $status.textContent = Format.toByte(event.totalBytes);
            }
          }
        } else {
          if ($status) $status.textContent = "";
          this.stopTimer(id);
          this.refreshDownloadView(event.id);
        }
      });
    };

    this.timers[id] = setInterval(timer, 1000);
    setTimeout(timer, 1);

    const progressAnimationFrame = () => {
      const $el = $(`#download-${id}`);
      if (!$el) return;

      const $progress = $el.querySelector(".progress__bar");

      const now = Date.now();
      const elapsed = now - progressLastFrame;
      const remainingProgress = progressNextValue - progressCurrentValue;
      progressLastFrame = now;

      if (progressRemainingTime > 0 && remainingProgress > 0) {
        progressCurrentValue += (elapsed / progressRemainingTime) * remainingProgress;
        progressRemainingTime -= elapsed;

        if ($progress) {
          $progress.style.width = (100 * progressCurrentValue).toFixed(1) + "%";
        }
      }

      if (this.timers[id]) {
        requestAnimationFrame(progressAnimationFrame);
      }
    };

    requestAnimationFrame(progressAnimationFrame);
  },

  stopTimer(id) {
    clearInterval(this.timers[id]);
    delete this.timers[id];
  },

  elementFromHtml(html) {
    const $el = document.createElement("div");
    $el.innerHTML = html;
    return $el.firstChild;
  },

  getProperFilename(filename) {
    if (!filename) return "";
    const backArray = filename.split("\\");
    const forwardArray = filename.split("/");
    const array = backArray.length > forwardArray.length ? backArray : forwardArray;
    return (array.pop() || "").replace(/.crdownload$/, "");
  },

  isDangerous(event) {
    return !/safe|accepted/.test(event.danger) && event.state === "in_progress";
  },

  openUrl(url) {
    ext.tabs.create({
      url: url,
      active: true
    });
  }
};

App.init();