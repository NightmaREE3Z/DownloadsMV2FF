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
    const btn = document.createElement("button");
    btn.className = `button button--${type}`;
    btn.setAttribute("data-action", action);
    btn.textContent = text || "";
    return btn;
  },
  buttonShowMore() {
    const btn = document.createElement("button");
    btn.className = "button button--secondary button--block";
    btn.setAttribute("data-action", "more");
    btn.textContent = t("show_more") || "Show more";
    return btn;
  },
  tinyXButton() {
    // Just a minimal, tiny X (chrome tab size)
    const btn = document.createElement("button");
    btn.className = "tiny-x";
    btn.setAttribute("data-action", "erase");
    btn.setAttribute("title", t("remove") || "Remove");
    btn.setAttribute("aria-label", t("remove") || "Remove");
    btn.type = "button";
    // SVG: black X, 11x11, square caps, no fill, stroke only
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "11");
    svg.setAttribute("height", "11");
    svg.setAttribute("viewBox", "0 0 11 11");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M2 2L9 9M9 2L2 9");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "square");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    btn.appendChild(svg);
    return btn;
  }
};

let popupReady = false;
const iconCache = {};
const progressTimers = {};

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
  prevNodeMap: {},
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
      Object.values(progressTimers).forEach(clearInterval);
      if (this.pollInterval) clearInterval(this.pollInterval);
    });
  },

  bindEvents() {
    $("#downloads")?.addEventListener("mousedown", (event) => {
      let btn = event.target.closest("button[data-action],.tiny-x");
      if (btn) {
        this.handleClick(event, btn);
        event.preventDefault();
        return;
      }
      let downloadRow = event.target.closest(".download");
      if (!downloadRow) return;
      if (event.target.classList.contains("list__item__filename")) {
        this.handleClick({ ...event, target: downloadRow }, { dataset: { action: "open" } });
      }
      if (event.target.classList.contains("list__item__source")) {
        this.handleClick({ ...event, target: event.target }, { dataset: { action: "url" } });
      }
    });
    $("#downloads")?.addEventListener("keydown", (event) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target.classList.contains("tiny-x")
      ) {
        this.handleClick(event, event.target);
        event.preventDefault();
      }
    });

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
          const downloadsEl = $("#downloads");
          downloadsEl.textContent = "";
          if (emptyTmpl) {
            if (emptyTmpl.content) {
              downloadsEl.appendChild(emptyTmpl.content.cloneNode(true));
            } else {
              downloadsEl.appendChild(emptyTmpl.cloneNode(true));
            }
          }
          if (emptyTmpl && typeof localize === "function") {
            localize();
          }
        }
      });
    });
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
    while (downloadsEl.firstChild) {
      downloadsEl.removeChild(downloadsEl.firstChild);
    }

    Object.values(progressTimers).forEach(clearInterval);
    Object.keys(progressTimers).forEach(k => delete progressTimers[k]);

    if (!results || results.length === 0) {
      if (emptyTmpl) {
        if (emptyTmpl.content) {
          downloadsEl.appendChild(emptyTmpl.content.cloneNode(true));
        } else {
          downloadsEl.appendChild(emptyTmpl.cloneNode(true));
        }
      }
      if (emptyTmpl && typeof localize === "function") {
        localize();
      }
      this.prevDownloadIds = [];
      this.prevNodeMap = {};
      return;
    }
    const ids = results.map(item => item.id);
    let nodeMap = {};

    results.forEach((item) => {
      if (!item) return;
      let node = this.buildDownloadNode(item);
      downloadsEl.appendChild(node);
      nodeMap[item.id] = node;
      if (item.state === "in_progress" || item.paused) {
        this.startProgressInfoTimer(node, item.id);
      }
    });

    if (this.resultsLength > this.resultsLimit) {
      downloadsEl.appendChild(Template.buttonShowMore());
    }

    this.prevDownloadIds = ids;
    this.prevNodeMap = nodeMap;
  },

  buildDownloadNode(event) {
    const fileName = this.getProperFilename(event.filename) || "";
    const fileUrl = event.finalUrl || event.url || "";
    const exists = event.exists !== false;

    const div = document.createElement("div");
    div.className = "list__item download";
    if (!exists) div.classList.add("removed");
    if (event.state === "interrupted") div.classList.add("canceled");
    if (event.state === "complete") div.classList.add("complete");
    if (event.paused) div.classList.add("paused");
    if (event.state === "in_progress") div.classList.add("in-progress");
    if (this.isDangerous(event)) div.classList.add("danger");
    div.setAttribute("data-id", event.id);
    div.id = `download-${event.id}`;

    // Icon
    const iconDiv = document.createElement("div");
    iconDiv.className = "list__item__icon";
    const iconImg = document.createElement("img");
    iconImg.id = `icon-${event.id}`;
    iconImg.setAttribute("data-default", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T");
    iconImg.src = iconCache[event.id] || iconImg.getAttribute("data-default");
    iconImg.width = 24;
    iconImg.height = 24;
    iconDiv.appendChild(iconImg);

    // Content
    const contentDiv = document.createElement("div");
    contentDiv.className = "list__item__content";

    // Filename
    const filenameP = document.createElement("p");
    filenameP.className = "list__item__filename";
    filenameP.title = fileName;
    filenameP.setAttribute("data-action", "open");
    filenameP.textContent = fileName;
    contentDiv.appendChild(filenameP);

    // URL
    const urlA = document.createElement("a");
    urlA.className = "list__item__source";
    urlA.setAttribute("data-action", "url");
    urlA.title = fileUrl;
    urlA.href = fileUrl || "#";
    urlA.textContent = fileUrl || "";
    urlA.style.display = fileUrl ? "" : "none";
    contentDiv.appendChild(urlA);

    // Progress bar (in-progress only)
    let isInProgress = (event.state === "in_progress" || event.paused);
    if (isInProgress) {
      const progressDiv = document.createElement("div");
      progressDiv.className = "progress";
      const progressBar = document.createElement("div");
      progressBar.className = "progress__bar";
      let progressWidth = "0%";
      if (event.totalBytes > 0) {
        progressWidth = ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
      }
      progressBar.style.width = progressWidth;
      progressDiv.appendChild(progressBar);
      contentDiv.appendChild(progressDiv);
    }

    // Progress info (speed, MB, left)
    let progressInfoDiv = null;
    if (isInProgress) {
      progressInfoDiv = document.createElement("div");
      progressInfoDiv.className = "list__item__progressinfo";
      progressInfoDiv.textContent = this.getProgressInfoText(event);
      contentDiv.appendChild(progressInfoDiv);
    }

    // Controls/status
    const controlsDiv = document.createElement("div");
    controlsDiv.className = "list__item__controls";
    const buttonsDiv = document.createElement("div");
    buttonsDiv.className = "list__item__buttons";
    const statusDiv = document.createElement("div");
    statusDiv.className = "list__item__status status";

    // Buttons for state
    if (event.state === "complete") {
      buttonsDiv.appendChild(Template.button("secondary", "show", t("show_in_folder") || "Show in folder"));
      controlsDiv.appendChild(buttonsDiv);

      const canceledSpan = document.createElement("span");
      canceledSpan.className = "list__item__canceled";
      canceledSpan.textContent = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
      controlsDiv.appendChild(canceledSpan);

      controlsDiv.appendChild(statusDiv);
    } else if (event.state === "interrupted") {
      buttonsDiv.appendChild(Template.button("primary", "retry", t("retry") || "Retry"));
      controlsDiv.appendChild(buttonsDiv);

      const canceledSpan = document.createElement("span");
      canceledSpan.className = "list__item__canceled";
      canceledSpan.textContent = event.error === "NETWORK_FAILED"
        ? (t("failed_network") || "Failed - Network error")
        : (t("canceled") || "Canceled");
      controlsDiv.appendChild(canceledSpan);

      controlsDiv.appendChild(statusDiv);
    } else if (event.paused) {
      buttonsDiv.appendChild(Template.button("primary", "resume", t("resume") || "Resume"));
      buttonsDiv.appendChild(Template.button("secondary", "cancel", t("cancel") || "Cancel"));
      controlsDiv.appendChild(buttonsDiv);
      controlsDiv.appendChild(statusDiv);
    } else if (event.state === "in_progress") {
      buttonsDiv.appendChild(Template.button("primary", "pause", t("pause") || "Pause"));
      buttonsDiv.appendChild(Template.button("secondary", "cancel", t("cancel") || "Cancel"));
      controlsDiv.appendChild(buttonsDiv);
      controlsDiv.appendChild(statusDiv);
    }

    contentDiv.appendChild(controlsDiv);

    // Append icon, content, THEN tiny-x-wrap (not first!)
    div.appendChild(iconDiv);
    div.appendChild(contentDiv);

    // Tiny "X" erase button -- appended LAST so it overlays, not grid
    const xWrap = document.createElement("div");
    xWrap.className = "tiny-x-wrap";
    xWrap.appendChild(Template.tinyXButton());
    div.appendChild(xWrap);

    // Icon load/update
    if (ext.downloads.getFileIcon) {
      ext.downloads.getFileIcon(event.id, { size: 32 }, (iconURL) => {
        if (iconURL) {
          iconCache[event.id] = iconURL;
          iconImg.src = iconURL;
        }
      });
    }

    return div;
  },

  getProgressInfoText(event) {
    let speed = 0;
    let leftText = "";
    const received = event.bytesReceived || 0;
    const total = event.totalBytes || 0;
    const remaining = total - received;
    let secondsLeft = 0;
    if (event.estimatedEndTime) {
      secondsLeft = (new Date(event.estimatedEndTime) - new Date()) / 1000;
    }
    if (secondsLeft > 0) {
      speed = remaining / secondsLeft;
    }
    if (speed) {
      leftText = `, ${Format.toTime(secondsLeft)} ${t("left") || ""}`;
    }
    let mainText = "";
    if (speed) {
      mainText = `${Format.toByte(speed)}/s - ${Format.toByte(received)} of ${Format.toByte(total)}${leftText}`;
    } else if (total) {
      mainText = `${Format.toByte(received)} of ${Format.toByte(total)}`;
    } else if (received) {
      mainText = `${Format.toByte(received)}`;
    }
    return mainText;
  },

  startProgressInfoTimer(node, id) {
    if (progressTimers[id]) clearInterval(progressTimers[id]);
    const update = () => {
      ext.downloads.search({ id: id }, (results) => {
        if (!results || !results[0]) return;
        const event = results[0];
        const progressBar = node.querySelector(".progress__bar");
        if (progressBar && event.totalBytes > 0) {
          progressBar.style.width = ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
        }
        const infoDiv = node.querySelector(".list__item__progressinfo");
        if (infoDiv) {
          infoDiv.textContent = this.getProgressInfoText(event);
        }
        // Always re-enable all buttons on update
        const buttons = node.querySelectorAll("button[data-action],.tiny-x");
        buttons.forEach(b => b.disabled = false);
      });
    };
    progressTimers[id] = setInterval(update, 1000);
    update();
  },

  updateDownloadNode(node, event) {
    const fileName = this.getProperFilename(event.filename) || "";
    const fileUrl = event.finalUrl || event.url || "";

    const filenameP = node.querySelector(".list__item__filename");
    if (filenameP) {
      filenameP.title = fileName;
      filenameP.textContent = fileName;
    }

    const urlA = node.querySelector(".list__item__source");
    if (urlA) {
      urlA.title = fileUrl;
      urlA.href = fileUrl || "#";
      urlA.textContent = fileUrl || "";
      urlA.style.display = fileUrl ? "" : "none";
    }

    const progressBar = node.querySelector(".progress__bar");
    if (progressBar) {
      let progressWidth = "0%";
      if (event.totalBytes > 0) {
        progressWidth = ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
      }
      progressBar.style.width = progressWidth;
    }

    const infoDiv = node.querySelector(".list__item__progressinfo");
    if (infoDiv) {
      infoDiv.textContent = this.getProgressInfoText(event);
    }

    const buttons = node.querySelectorAll("button[data-action],.tiny-x");
    buttons.forEach(b => b.disabled = false);

    const iconImg = node.querySelector(`#icon-${event.id}`);
    if (iconImg && ext.downloads.getFileIcon) {
      ext.downloads.getFileIcon(event.id, { size: 32 }, (iconURL) => {
        if (iconURL && iconImg.src !== iconURL) {
          iconCache[event.id] = iconURL;
          iconImg.src = iconURL;
        }
      });
    }
  },

  refreshDownloadView(id) {
    ext.downloads.search({ id: id }, (results) => {
      if ((ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError)) {
        const err = (ext.runtime && ext.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
        console.error(err.message);
        return;
      }
      if (results[0]) {
        const node = this.prevNodeMap[id];
        if (node) this.updateDownloadNode(node, results[0]);
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

  handleClick(event, btn) {
    const action = btn && btn.dataset ? btn.dataset.action : null;

    event.preventDefault();

    let $el = event.target.closest(".download");
    let id = $el ? +$el.dataset.id : null;

    // Only allow erase if download is .complete or .canceled
    if ((btn.classList.contains("tiny-x") || action === "erase") &&
        $el && ($el.classList.contains("complete") || $el.classList.contains("canceled"))) {
      if (id) {
        ext.downloads.erase({ id: id }, () => {
          if ($el && $el.parentNode) {
            $el.parentNode.removeChild($el);
            this.stopTimer(id);
            this.render();
          }
        });
      }
      return;
    }

    if (action === "url") {
      let href = event.target.href || (btn && btn.href) || "#";
      this.openUrl(href);
      return;
    }

    if (action === "more") {
      this.openUrl(ext === browser ? "about:downloads" : "chrome://downloads");
      return;
    }

    if (!id) return;

    const buttons = $el.querySelectorAll("button[data-action],.tiny-x");
    buttons.forEach((b) => b.disabled = true);

    if (["resume", "cancel", "pause"].includes(action)) {
      ext.downloads[action](id);
      setTimeout(() => this.refreshDownloadView(id), 200);
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
            setTimeout(() => this.refreshDownloadView(new_id), 200);
            this.startTimer(new_id);
            this.render();
            setTimeout(() => this.render(), 400);
          });
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

    const timer = () => {
      const node = this.prevNodeMap[id];
      if (!node) return;

      const infoDiv = node.querySelector(".list__item__progressinfo");
      if (infoDiv) {
        ext.downloads.search({ id: id }, (results) => {
          if (!results || !results[0]) return;
          infoDiv.textContent = this.getProgressInfoText(results[0]);
        });
      }

      const progressBar = node.querySelector(".progress__bar");
      if (progressBar) {
        ext.downloads.search({ id: id }, (results) => {
          if (!results || !results[0]) return;
          let event = results[0];
          let progressWidth = "0%";
          if (event.totalBytes > 0) {
            progressWidth = ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
          }
          progressBar.style.width = progressWidth;
        });
      }
      const buttons = node.querySelectorAll("button[data-action],.tiny-x");
      buttons.forEach(b => b.disabled = false);
    };

    this.timers[id] = setInterval(timer, 1000);
    setTimeout(timer, 1);
  },

  stopTimer(id) {
    clearInterval(this.timers[id]);
    delete this.timers[id];
    clearInterval(progressTimers[id]);
    delete progressTimers[id];
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