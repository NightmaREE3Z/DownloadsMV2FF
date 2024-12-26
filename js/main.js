window.$ = document.querySelector.bind(document);
Node.prototype.on = window.on = function(name, fn) {
  this.addEventListener(name, fn);
};

const Format = {
  toByte: function(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1000 * 1000) return (bytes / 1000).toFixed() + " KB";
    if (bytes < 1000 * 1000 * 10)
      return (bytes / 1000 / 1000).toFixed(1) + " MB";
    if (bytes < 1000 * 1000 * 1000)
      return (bytes / 1000 / 1000).toFixed() + " MB";
    if (bytes < 1000 * 1000 * 1000 * 1000)
      return (bytes / 1000 / 1000 / 1000).toFixed(1) + " GB";
    return bytes + " B";
  },
  toTime: function(sec) {
    if (sec < 60) return Math.ceil(sec) + " secs";
    if (sec < 60 * 5)
      return Math.floor(sec / 60) + " mins " + Math.ceil(sec % 60) + " secs";
    if (sec < 60 * 60) return Math.ceil(sec / 60) + " mins";
    if (sec < 60 * 60 * 5)
      return (
        Math.floor(sec / 60 / 60) +
        " hours " +
        (Math.ceil(sec / 60) % 60) +
        " mins"
      );
    if (sec < 60 * 60 * 24) return Math.ceil(sec / 60 / 60) + " hours";
    return Math.ceil(sec / 60 / 60 / 24) + " days";
  }
};

const Template = {
  button: function(type, action, text) {
    const button = document.createElement("button");
    button.className = `button button--${type}`;
    button.dataset.action = action;
    button.textContent = text;
    return button;
  },
  buttonShowMore: function() {
    const button = document.createElement("button");
    button.className = "button button--secondary button--block";
    button.dataset.action = "more";
    button.textContent = "Show more";
    return button;
  }
};

const App = {
  timers: {},
  resultsLength: 0,
  resultsLimit: 10,
  init: function() {
    this.bindEvents();
    this.render();
  },
  bindEvents: function() {
    window.on("DOMContentLoaded", () => {
      browser.runtime.sendMessage("popup_open");
    });

    browser.downloads.onCreated.addListener(event => {
      const $target = $("#downloads");
      const $state = $target.querySelector(".state");
      if ($state) $target.removeChild($state);

      const $newEl = this.getDownloadViewElement(event);
      $target.insertBefore($newEl, $target.firstChild);
      if ($target.children.length > this.resultsLimit) {
        $target.removeChild($target.children[this.resultsLimit - 1]);
      }
    });

    browser.downloads.onChanged.addListener(delta => {
      if (delta.filename) this.refreshDownloadView(delta.id);
      if (delta.danger && delta.danger.current === "accepted")
        $(`#download-${delta.id}`).classList.remove("danger");
    });

    $("#main").on("scroll", () => {
      if ($("#main").scrollTop > 0) {
        $(".toolbar").classList.add("toolbar--fixed");
      } else {
        $(".toolbar").classList.remove("toolbar--fixed");
      }
    });

    $("#action-show-all").on("click", () => this.openUrl("about:downloads"));

    $("#action-clear-all").on("click", () => {
      this.clearAllDownloadsExceptRunning(running => {
        if (running.length) {
          this.render();
        } else {
          const tmplStateEmpty = this.elementFromHtml($("#tmpl__state-empty").innerHTML);
          $("#downloads").textContent = ''; // Clear the current content
          $("#downloads").appendChild(tmplStateEmpty);
        }
      });
    });

    $("#downloads").on("click", this.handleClick.bind(this));
  },
  render: function() {
    browser.downloads.search({ limit: 0 }, () => {
      browser.downloads.search(
        {
          limit: this.resultsLimit + 1,
          filenameRegex: ".+",
          orderBy: ["-startTime"]
        },
        data => {
          this.resultsLength = data.length;
          browser.downloads.search(
            {
              limit: this.resultsLimit,
              filenameRegex: ".+",
              orderBy: ["-startTime"]
            },
            this.getDownloadsView.bind(this)
          );
        }
      );
    });
  },
  getDownloadsView: function(results) {
    let _this = App;
    let fragment = document.createDocumentFragment();

    results.forEach(item => {
      if (_this.isDangerous(item)) {
        setTimeout(() => console.log("Dangerous download detected"), 100);
      }

      if (item.state === "in_progress" && !item.paused) {
        _this.startTimer(item.id);
      }

      const downloadElement = this.getDownloadViewElement(item);
      fragment.appendChild(downloadElement);
    });

    const $target = $("#downloads");
    $target.textContent = ''; // Clear the current content

    if (fragment.children.length > 0) {
      $target.appendChild(fragment);
      if (_this.resultsLength > _this.resultsLimit) {
        $target.appendChild(Template.buttonShowMore());
      }
    } else {
      const tmplStateEmpty = this.elementFromHtml($("#tmpl__state-empty").innerHTML);
      $target.appendChild(tmplStateEmpty);
    }
  },
  getDownloadView: function(event) {
    let buttons = "";
    let status = "";
    let progressClass = "";
    let progressWidth = 0;

    if (event.state === "complete") {
      status = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
      buttons = Template.button("secondary", "show", "Show in folder").outerHTML;
      if (!event.exists) {
        status = "Deleted";
        buttons = Template.button("primary", "retry", "Retry").outerHTML;
      }
    } else if (event.state === "interrupted") {
      if (event.error === "NETWORK_FAILED") {
        status = "Failed - Network error";
      } else {
        status = "Canceled";
      }
      buttons = Template.button("primary", "retry", "Retry").outerHTML;
    } else {
      if (event.paused) {
        status = "Paused";
        progressClass = "paused";
        buttons = Template.button("primary", "resume", "Resume").outerHTML;
        buttons += Template.button("secondary", "cancel", "Cancel").outerHTML;
      } else {
        status = `${Format.toByte(event.bytesReceived)} of ${Format.toByte(event.totalBytes)} - ${Format.toByte(event.bytesReceived / ((Date.now() - new Date(event.startTime)) / 1000))}/s`;
        progressClass = "in-progress";
        buttons = Template.button("primary", "pause", "Pause").outerHTML;
        buttons += Template.button("secondary", "cancel", "Cancel").outerHTML;
      }
      progressWidth = ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
    }

    const canceledClass = event.state === "interrupted" ? "canceled" : "";
    const removedClass = !event.exists ? "removed" : "";
    let extraClass = ["download", removedClass, canceledClass, progressClass];

    if (this.isDangerous(event)) {
      extraClass.push("danger");
    }

    const fileName = this.getProperFilename(event.filename);
    const fileUrl = event.finalUrl || event.url; // Ensure fileUrl is set correctly

    const defaultFileIcon = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T`;
    if (fileName) {
      browser.downloads.getFileIcon(event.id, { size: 32 }, iconURL =>
        iconURL ? ($(`#icon-${event.id}`).src = iconURL) : false
      );
    }

    const downloadElement = document.createElement("div");
    downloadElement.id = `download-${event.id}`;
    downloadElement.className = `list__item ${extraClass.join(" ").replace(/\s\s+/g, " ").trim()}`;
    downloadElement.dataset.id = event.id;

    const iconDiv = document.createElement("div");
    iconDiv.className = "list__item__icon";
    const iconImg = document.createElement("img");
    iconImg.id = `icon-${event.id}`;
    iconImg.src = defaultFileIcon;
    iconDiv.appendChild(iconImg);
    downloadElement.appendChild(iconDiv);

    const contentDiv = document.createElement("div");
    contentDiv.className = "list__item__content";
    const filenameElement = document.createElement(event.state != "complete" || !event.exists ? "p" : "a");
    filenameElement.className = "list__item__filename";
    filenameElement.title = fileName;
    filenameElement.textContent = fileName;
    if (event.state == "complete" && event.exists) {
      filenameElement.href = `file://${event.filename}`;
      filenameElement.dataset.action = "open";
    }
    contentDiv.appendChild(filenameElement);

    const sourceElement = document.createElement("a");
    sourceElement.className = "list__item__source";
    sourceElement.dataset.action = "url";
    sourceElement.href = fileUrl;
    sourceElement.title = fileUrl;
    sourceElement.textContent = fileUrl;
    contentDiv.appendChild(sourceElement);

    if (extraClass.includes("in-progress")) {
      const progressDiv = document.createElement("div");
      progressDiv.className = "progress";
      const progressBar = document.createElement("div");
      progressBar.className = "progress__bar";
      progressBar.style.width = progressWidth;
      progressDiv.appendChild(progressBar);
      contentDiv.appendChild(progressDiv);
    }

    const controlsDiv = document.createElement("div");
    controlsDiv.className = "list__item__controls";
    const buttonsDiv = document.createElement("div");
    buttonsDiv.className = "list__item__buttons";

    // Create buttons directly and append them to buttonsDiv
    const buttonParser = new DOMParser();
    const buttonsDoc = buttonParser.parseFromString(`<div>${buttons}</div>`, 'text/html');
    const buttonsContainer = buttonsDoc.querySelector('div');

    while (buttonsContainer.firstChild) {
      buttonsDiv.appendChild(buttonsContainer.firstChild);
    }

    controlsDiv.appendChild(buttonsDiv);

    const statusDiv = document.createElement("div");
    statusDiv.className = "list__item__status status";
    statusDiv.textContent = status;
    controlsDiv.appendChild(statusDiv);

    contentDiv.appendChild(controlsDiv);
    downloadElement.appendChild(contentDiv);

    const clearDiv = document.createElement("div");
    clearDiv.className = "list__item__clear";
    const clearButton = document.createElement("button");
    clearButton.className = "button button--icon";
    clearButton.title = "Clear";
    clearButton.dataset.action = "erase";
    clearButton.textContent = "×";
    clearDiv.appendChild(clearButton);
    downloadElement.appendChild(clearDiv);

    return downloadElement;
  },
  getDownloadViewElement: function(event) {
    const div = document.createElement("div");
    div.appendChild(this.getDownloadView(event));
    return div.firstChild;
  },
  refreshDownloadView: function(id) {
    browser.downloads.search({ id: id }, results => {
      const $el = this.getDownloadViewElement(results[0]);
      const $target = $(`#download-${id}`);
      $target.replaceWith($el);
    });
  },
  clearAllDownloadsExceptRunning: function(callback) {
    browser.downloads.search({}, results => {
      const running = results.map(item => {
        if (item.state == "in_progress") return true;
        browser.downloads.erase({
          id: item.id
        });
      });
      callback && callback(running);
    });
  },
  handleClick: function(event) {
    const action = event.target.dataset.action;

    if (!action) return;

    event.preventDefault();

    if (/url/.test(action)) {
      this.openUrl(event.target.href);
      return;
    }

    if (/more/.test(action)) {
      this.openUrl("about:downloads");
      return;
    }

    const $el = event.target.closest(".download");
    const id = +$el.dataset.id;

    if (/resume|cancel|pause/.test(action)) {
      browser.downloads[action](id);
      this.refreshDownloadView(id);

      if (/resume/.test(action)) {
        this.startTimer(id);
      } else {
        this.stopTimer(id);
      }
    } else if (/retry/.test(action)) {
      browser.downloads.search({ id: id }, results => {
        browser.downloads.download({ url: results[0].url }, new_id => {
          this.startTimer(new_id);
        });
      });
    } else if (/erase/.test(action)) {
      browser.downloads.search(
        {
          limit: this.resultsLimit,
          filenameRegex: ".+",
          orderBy: ["-startTime"]
        },
        results => {
          const $list = $el.parentNode;
          $list.removeChild($el);

          const new_item = results[this.resultsLimit];
          if (!new_item) return;

          const newEl = this.getDownloadViewElement(new_item);
          $list.appendChild(newEl);
        }
      );
      browser.downloads.erase({ id: id }, this.render.bind(this));
    } else if (/show/.test(action)) {
      browser.downloads.show(id);
    } else if (/open/.test(action)) {
      browser.downloads.open(id);
      return;
    }
  },
  startTimer: function(id) {
    clearInterval(this.timers[id]);

    let progressLastValue = 0;
    let progressCurrentValue = 0;
    let progressNextValue = 0;
    let progressRemainingTime = 0;
    let progressLastFrame = +new Date();

    const timer = () => {
      const $el = $(`#download-${id}`);
      const $status = $el.querySelector(".status");

      browser.downloads.search({ id: id }, results => {
        const event = results[0];

        if (!event) {
          this.stopTimer(id);
          this.render();
          return;
        }

        if (event.state != "complete") {
          let speed = 0;
          let left_text = "";
          const remainingBytes = event.totalBytes - event.bytesReceived;
          const remainingSeconds =
            (new Date(event.estimatedEndTime) - new Date()) / 1000;

          speed = remainingBytes / remainingSeconds;

          if (speed) {
            left_text = `, ${Format.toTime(remainingSeconds)} left`;
          }

          if (progressCurrentValue === 0) {
            if (speed) {
              progressCurrentValue = event.bytesReceived / event.totalBytes;
              progressNextValue =
                (event.bytesReceived + speed) / event.totalBytes;
              progressLastValue = progressCurrentValue;
              progressRemainingTime += 1000;
            }
          } else {
            const currentProgress = event.bytesReceived / event.totalBytes;
            const progressDelta = currentProgress - progressLastValue;
            progressNextValue = currentProgress + progressDelta;
            progressLastValue = currentProgress;
            progressRemainingTime += 1000;
          }

          $status.textContent = `${Format.toByte(speed)}/s - ${Format.toByte(
            event.bytesReceived
          )} of ${Format.toByte(event.totalBytes)}${left_text}`;

          if (event.bytesReceived && event.bytesReceived === event.totalBytes) {
            $status.textContent = Format.toByte(event.totalBytes);
          }
        } else {
          $status.textContent = "";
          clearInterval(this.timers[id]);
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
  stopTimer: function(id) {
    clearInterval(this.timers[id]);
    this.timers[id] = null;
  },
  elementFromHtml: function(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body.firstChild;
  },
  getProperFilename: function(filename) {
    const backArray = filename.split("\\");
    const forwardArray = filename.split("/");
    const array = backArray.length > forwardArray.length ? backArray : forwardArray;
    return array.pop().replace(/.crdownload$/, "");
  },
  isDangerous: function(event) {
    return !/safe|accepted/.test(event.danger) && event.state === "in_progress";
  },
  openUrl: function(url) {
    browser.tabs.create({
      url: url,
      active: true
    });
  }
};

App.init();