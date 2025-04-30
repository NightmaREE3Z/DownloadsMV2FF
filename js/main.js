window.$ = document.querySelector.bind(document);
Node.prototype.on = window.on = function(name, fn) {
  this.addEventListener(name, fn);
};

const Format = {
  toByte: function(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1000 * 1000) return (bytes / 1000).toFixed() + " KB";
    if (bytes < 1000 * 1000 * 10) return (bytes / 1000 / 1000).toFixed(1) + " MB";
    if (bytes < 1000 * 1000 * 1000) return (bytes / 1000 / 1000).toFixed() + " MB";
    if (bytes < 1000 * 1000 * 1000 * 1000) return (bytes / 1000 / 1000 / 1000).toFixed(1) + " GB";
    return bytes + " B";
  },
  toTime: function(sec) {
    if (sec < 60) return Math.ceil(sec) + " secs";
    if (sec < 60 * 5) return Math.floor(sec / 60) + " mins " + Math.ceil(sec % 60) + " secs";
    if (sec < 60 * 60) return Math.ceil(sec / 60) + " mins";
    if (sec < 60 * 60 * 5) return Math.floor(sec / 60 / 60) + " hours " + (Math.ceil(sec / 60) % 60) + " mins";
    if (sec < 60 * 60 * 24) return Math.ceil(sec / 60 / 60) + " hours";
    return Math.ceil(sec / 60 / 60 / 24) + " days";
  }
};

const Template = {
  button: function(type, action, text) {
    return `<button class="button button--${type}" data-action="${action}">${text}</button>`;
  },
  buttonShowMore: function() {
    return `<button class="button button--secondary button--block" data-action="more">Show more</button>`;
  }
};

const App = {
  timers: [],
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

    browser.runtime.onMessage.addListener((message) => {
      if (message.type === "download_created" || message.type === "download_changed") {
        this.render();
      }
      return Promise.resolve({ status: "Message received in popup" });
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
          // Create empty state without innerHTML
          const downloadsContainer = $("#downloads");
          if (downloadsContainer) {
            downloadsContainer.textContent = ""; // Clear safely
            
            const emptyDiv = document.createElement("div");
            emptyDiv.className = "empty-state";
            
            const emptyIcon = document.createElement("div");
            emptyIcon.className = "empty-state__icon";
            emptyDiv.appendChild(emptyIcon);
            
            const emptyText = document.createElement("div");
            emptyText.className = "empty-state__text";
            emptyText.textContent = "No downloads yet";
            emptyDiv.appendChild(emptyText);
            
            downloadsContainer.appendChild(emptyDiv);
          }
        }
      });
    });

    $("#downloads").on("click", this.handleClick.bind(this));
  },
  render: function() {
    browser.downloads.search({
      limit: 0,
    }).then(() => {
      browser.downloads.search({
        limit: this.resultsLimit + 1,
        orderBy: ["-startTime"]
      }).then(data => {
        this.resultsLength = data.length;
        browser.downloads.search({
          limit: this.resultsLimit,
          orderBy: ["-startTime"]
        }).then(results => {
          this.displayDownloads(results);
        });
      });
    }).catch(error => {
      console.error("Error fetching downloads:", error);
    });
  },
  displayDownloads: function(results) {
    const $target = $("#downloads");
    if (!$target) return;
    
    // Clear the container safely
    $target.textContent = "";
    
    if (!results || !results.length) {
      // Create empty state
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "empty-state";
      
      const emptyIcon = document.createElement("div");
      emptyIcon.className = "empty-state__icon";
      emptyDiv.appendChild(emptyIcon);
      
      const emptyText = document.createElement("div");
      emptyText.className = "empty-state__text";
      emptyText.textContent = "No downloads yet";
      emptyDiv.appendChild(emptyText);
      
      $target.appendChild(emptyDiv);
      return;
    }
    
    // Process download items
    results.forEach(item => {
      if (this.isDangerous(item)) {
        // Skip unsupported acceptDanger for Firefox
      }

      if (item.state === "in_progress" && !item.paused) {
        this.startTimer(item.id);
      }

      // Create download element and add to container
      const downloadElement = this.createDownloadElement(item);
      if (downloadElement) {
        $target.appendChild(downloadElement);
      }
    });
    
    // Add "Show more" button if needed
    if (this.resultsLength > this.resultsLimit) {
      const showMoreButton = document.createElement("button");
      showMoreButton.className = "button button--secondary button--block";
      showMoreButton.setAttribute("data-action", "more");
      showMoreButton.textContent = "Show more";
      $target.appendChild(showMoreButton);
    }
  },
  createDownloadElement: function(event) {
    if (!event) return null;
    
    // Create main container
    const downloadItem = document.createElement("div");
    downloadItem.id = `download-${event.id}`;
    downloadItem.setAttribute("data-id", event.id);
    
    // Handle file exists check
    const fileRemoved = event.exists === false;
    
    // Set classes
    downloadItem.className = "list__item download";
    if (fileRemoved) downloadItem.classList.add("removed");
    if (event.state === "interrupted") downloadItem.classList.add("canceled");
    if (event.paused) downloadItem.classList.add("paused");
    if (this.isDangerous(event)) downloadItem.classList.add("danger");
    if (event.state === "in_progress" && !event.paused) downloadItem.classList.add("in-progress");
    
    // Ensure all required fields are present
    event.totalBytes = event.totalBytes || 0;
    event.bytesReceived = event.bytesReceived || 0;
    event.filename = event.filename || "";
    event.finalUrl = event.finalUrl || event.url || "";
    
    // Create icon section
    const iconDiv = document.createElement("div");
    iconDiv.className = "list__item__icon";
    const iconImg = document.createElement("img");
    iconImg.id = `icon-${event.id}`;
    iconImg.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAACzElEQVRYhe2YT3LaMBTGP3VgmAZqPOlFegA6JCG3yarXYMMqu3TDFF+DK/QGzQ3a6SYbS68LWViS9SRZZrrKNwgL2U/++f2RjYF3T";
    iconDiv.appendChild(iconImg);
    
    // Create content section
    const contentDiv = document.createElement("div");
    contentDiv.className = "list__item__content";
    
    // Filename handling
    const fileName = this.getProperFilename(event.filename);
    const fileUrl = event.finalUrl;
    
    if (event.state !== "complete" || fileRemoved) {
      const fileNameP = document.createElement("p");
      fileNameP.className = "list__item__filename";
      fileNameP.title = fileName;
      fileNameP.textContent = fileName;
      contentDiv.appendChild(fileNameP);
    } else {
      const fileNameA = document.createElement("a");
      fileNameA.href = `file://${event.filename}`;
      fileNameA.className = "list__item__filename";
      fileNameA.setAttribute("data-action", "open");
      fileNameA.title = fileName;
      fileNameA.textContent = fileName;
      contentDiv.appendChild(fileNameA);
    }
    
    // Source URL
    const sourceA = document.createElement("a");
    sourceA.href = fileUrl;
    sourceA.className = "list__item__source";
    sourceA.setAttribute("data-action", "url");
    sourceA.title = fileUrl;
    sourceA.textContent = fileUrl;
    contentDiv.appendChild(sourceA);
    
    // Progress bar for active downloads
    if (event.state === "in_progress" && !event.paused) {
      const progressDiv = document.createElement("div");
      progressDiv.className = "progress";
      
      const progressBarDiv = document.createElement("div");
      progressBarDiv.className = "progress__bar";
      
      // Calculate progress width
      let progressWidth = "0%";
      if (event.totalBytes > 0) {
        progressWidth = ((100 * event.bytesReceived) / event.totalBytes).toFixed(1) + "%";
      }
      progressBarDiv.style.width = progressWidth;
      
      progressDiv.appendChild(progressBarDiv);
      contentDiv.appendChild(progressDiv);
    }
    
    // Controls section
    const controlsDiv = document.createElement("div");
    controlsDiv.className = "list__item__controls";
    
    // Buttons
    const buttonsDiv = document.createElement("div");
    buttonsDiv.className = "list__item__buttons";
    
    // Determine which buttons to show
    if (event.state === "complete") {
      if (fileRemoved) {
        // Retry button for deleted files
        const retryButton = document.createElement("button");
        retryButton.className = "button button--primary";
        retryButton.setAttribute("data-action", "retry");
        retryButton.textContent = "Retry";
        buttonsDiv.appendChild(retryButton);
      } else {
        // Show in folder button
        const showButton = document.createElement("button");
        showButton.className = "button button--secondary";
        showButton.setAttribute("data-action", "show");
        showButton.textContent = "Show in folder";
        buttonsDiv.appendChild(showButton);
      }
    } else if (event.state === "interrupted") {
      // Retry button for interrupted downloads
      const retryButton = document.createElement("button");
      retryButton.className = "button button--primary";
      retryButton.setAttribute("data-action", "retry");
      retryButton.textContent = "Retry";
      buttonsDiv.appendChild(retryButton);
    } else if (event.paused) {
      // Resume and cancel buttons for paused downloads
      const resumeButton = document.createElement("button");
      resumeButton.className = "button button--primary";
      resumeButton.setAttribute("data-action", "resume");
      resumeButton.textContent = "Resume";
      buttonsDiv.appendChild(resumeButton);
      
      const cancelButton = document.createElement("button");
      cancelButton.className = "button button--secondary";
      cancelButton.setAttribute("data-action", "cancel");
      cancelButton.textContent = "Cancel";
      buttonsDiv.appendChild(cancelButton);
    } else {
      // Pause and cancel buttons for active downloads
      const pauseButton = document.createElement("button");
      pauseButton.className = "button button--primary";
      pauseButton.setAttribute("data-action", "pause");
      pauseButton.textContent = "Pause";
      buttonsDiv.appendChild(pauseButton);
      
      const cancelButton = document.createElement("button");
      cancelButton.className = "button button--secondary";
      cancelButton.setAttribute("data-action", "cancel");
      cancelButton.textContent = "Cancel";
      buttonsDiv.appendChild(cancelButton);
    }
    
    // Status text
    const statusDiv = document.createElement("div");
    statusDiv.className = "list__item__status status";
    
    // Determine status text
    if (event.state === "complete") {
      if (fileRemoved) {
        statusDiv.textContent = "Deleted";
      } else {
        statusDiv.textContent = Format.toByte(Math.max(event.totalBytes, event.bytesReceived));
      }
    } else if (event.state === "interrupted") {
      statusDiv.textContent = event.error === "NETWORK_FAILED" ? "Failed - Network error" : "Canceled";
    } else if (event.paused) {
      statusDiv.textContent = "Paused";
    } else {
      statusDiv.textContent = "Downloading...";
    }
    
    controlsDiv.appendChild(buttonsDiv);
    controlsDiv.appendChild(statusDiv);
    contentDiv.appendChild(controlsDiv);
    
    // Clear button
    const clearDiv = document.createElement("div");
    clearDiv.className = "list__item__clear";
    
    const clearButton = document.createElement("button");
    clearButton.className = "button button--icon";
    clearButton.title = "Clear";
    clearButton.setAttribute("data-action", "erase");
    clearButton.textContent = "×";
    
    clearDiv.appendChild(clearButton);
    
    // Assemble the download item
    downloadItem.appendChild(iconDiv);
    downloadItem.appendChild(contentDiv);
    downloadItem.appendChild(clearDiv);
    
    // Get file icon if available
    if (fileName) {
      browser.downloads.getFileIcon(event.id, { size: 32 }).then(iconURL => {
        if (iconURL) {
          iconImg.src = iconURL;
        }
      }).catch(() => {});
    }
    
    return downloadItem;
  },
  refreshDownloadView: function(id) {
    browser.downloads.search({ id: id }).then(results => {
      if (results && results.length > 0) {
        const newElement = this.createDownloadElement(results[0]);
        const oldElement = $(`#download-${id}`);
        if (oldElement && newElement) {
          oldElement.parentNode.replaceChild(newElement, oldElement);
        }
      }
    }).catch(() => {});
  },
  clearAllDownloadsExceptRunning: function(callback) {
    browser.downloads.search({}).then(results => {
      const running = results.filter(item => item.state === "in_progress");
      results.forEach(item => {
        if (item.state !== "in_progress") {
          browser.downloads.erase({ id: item.id });
        }
      });
      callback && callback(running);
    }).catch(error => {
      if (callback) callback([]);
    });
  },
  handleClick: function(event) {
    const action = event.target.dataset.action;
    if (!action) return;

    event.preventDefault();

    if (action === "url") {
      this.openUrl(event.target.href);
      return;
    }

    if (action === "more") {
      this.openUrl("about:downloads");
      return;
    }

    const $el = event.target.closest(".download");
    if (!$el) return;
    
    const id = +$el.dataset.id;
    if (!id) return;

    if (["resume", "cancel", "pause"].includes(action)) {
      browser.downloads[action](id).then(() => {
        this.refreshDownloadView(id);
        if (action === "resume") {
          this.startTimer(id);
        } else {
          this.stopTimer(id);
        }
      }).catch(() => {});
    } else if (action === "retry") {
      browser.downloads.search({ id: id }).then(results => {
        if (results && results.length > 0) {
          browser.downloads.download({ url: results[0].url }).then(new_id => {
            this.startTimer(new_id);
          }).catch(() => {});
        }
      }).catch(() => {});
    } else if (action === "erase") {
      browser.downloads.erase({ id: id }).then(() => {
        if ($el && $el.parentNode) {
          $el.parentNode.removeChild($el);
          this.render();
        }
      }).catch(() => {});
    } else if (action === "show") {
      browser.downloads.show(id).catch(() => {
        this.openUrl("about:downloads");
      });
    } else if (action === "open") {
      browser.downloads.open(id).catch(() => {});
    }
  },
  startTimer: function(id) {
    clearInterval(this.timers[id]);

    let progressLastValue = 0;
    let progressCurrentValue = 0;
    let progressNextValue = 0;
    let progressRemainingTime = 0;
    let progressLastFrame = Date.now();

    const timer = () => {
      const $el = $(`#download-${id}`);
      if (!$el) return;

      const $status = $el.querySelector(".status");
      if (!$status) return;

      browser.downloads.search({ id: id }).then(results => {
        if (!results || !results.length) {
          this.stopTimer(id);
          return;
        }

        const event = results[0];
        
        if (!event.bytesReceived) event.bytesReceived = 0;
        if (!event.totalBytes) event.totalBytes = 1;

        if (event.state !== "complete") {
          let speed = 0;
          let left_text = "";
          
          const remainingBytes = event.totalBytes - event.bytesReceived;
          let remainingSeconds = 0;
          
          if (event.estimatedEndTime) {
            remainingSeconds = Math.max(0, (new Date(event.estimatedEndTime) - new Date()) / 1000);
            if (remainingSeconds > 0 && remainingBytes > 0) {
              speed = remainingBytes / remainingSeconds;
            }
          }

          if (speed) {
            left_text = `, ${Format.toTime(remainingSeconds)} left`;
          }

          if (event.bytesReceived === event.totalBytes) {
            $status.textContent = Format.toByte(event.totalBytes);
          } else if (speed > 0) {
            $status.textContent = `${Format.toByte(speed)}/s - ${Format.toByte(event.bytesReceived)} of ${Format.toByte(event.totalBytes)}${left_text}`;
          } else {
            $status.textContent = `${Format.toByte(event.bytesReceived)} of ${Format.toByte(event.totalBytes)}`;
          }
          
          const $progress = $el.querySelector(".progress__bar");
          if ($progress && event.totalBytes > 0) {
            $progress.style.width = `${Math.min(100, (event.bytesReceived / event.totalBytes * 100)).toFixed(1)}%`;
          }
        } else {
          $status.textContent = Format.toByte(event.totalBytes);
          this.stopTimer(id);
          this.refreshDownloadView(event.id);
        }
      }).catch(() => {
        this.stopTimer(id);
      });
    };

    this.timers[id] = setInterval(timer, 1000);
    setTimeout(timer, 1);
  },
  stopTimer: function(id) {
    clearInterval(this.timers[id]);
    this.timers[id] = null;
  },
  elementFromHtml: function(html) {
    const $el = document.createElement("div");
    $el.textContent = html; // Changed from innerHTML for safety
    return $el.firstChild;
  },
  getProperFilename: function(filename) {
    if (!filename) return "Unknown";
    
    const backArray = filename.split("\\");
    const forwardArray = filename.split("/");
    const array = backArray.length > forwardArray.length ? backArray : forwardArray;
    return array.pop().replace(/.crdownload$/, "");
  },
  isDangerous: function(event) {
    return event && event.danger && !/safe|accepted/.test(event.danger) && event.state === "in_progress";
  },
  openUrl: function(url) {
    browser.tabs.create({
      url: url,
      active: true
    }).catch(() => {});
  }
};

App.init();