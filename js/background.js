(function () {
  // Removed unsupported setUIOptions call
  
  let isPopupOpen = false;
  let isUnsafe = false;
  let unseen = [];
  let timer;
  let activeDownloads = {};
  let devicePixelRatio = 1;
  let prefersColorSchemeDark = true;

  function detectDisplaySettings() {
    devicePixelRatio = window.devicePixelRatio || 1;
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    prefersColorSchemeDark = darkModeMediaQuery.matches;
    
    darkModeMediaQuery.addEventListener('change', (e) => {
      prefersColorSchemeDark = e.matches;
      refresh();
    });
  }
  
  detectDisplaySettings();

  // Creating a canvas for icon rendering
  let canvas = document.createElement('canvas');
  canvas.width = 38;
  canvas.height = 38;
  let ctx = canvas.getContext('2d');
  const scale = 1;
  const size = 38;
  ctx.scale(scale, scale);

  function getIconColor(state) {
    if (state === "inProgress") {
      return "#FFBB00"; // Yellow
    } else if (state === "finished") {
      return "#00CC00"; // Green
    } else {
      return "#0b57d0"; // Blue
    }
  }

  function drawProgressIcon(progress) {
    progress = Math.max(0, Math.min(1, progress || 0));
    const width = progress * 38;
    const iconColor = getIconColor("inProgress");
    
    ctx.clearRect(0, 0, 38, 38);

    // Draw arrow
    ctx.strokeStyle = iconColor;
    ctx.fillStyle = iconColor;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(19, 0);
    ctx.lineTo(19, 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, 10);
    ctx.lineTo(32, 10);
    ctx.lineTo(19, 25);
    ctx.fill();
    
    // Draw progress bar background
    ctx.fillStyle = iconColor + '40'; // Semi-transparent
    ctx.fillRect(0, 28, 38, 10);
    
    // Draw progress bar fill
    ctx.fillStyle = iconColor;
    ctx.fillRect(0, 28, width, 10);
    
    return ctx.getImageData(0, 0, size, size);
  }

  function drawIcon(state) {
    const iconColor = getIconColor(state);
    
    ctx.clearRect(0, 0, 38, 38);
    ctx.strokeStyle = iconColor;
    ctx.fillStyle = iconColor;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(19, 2);
    ctx.lineTo(19, 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(38, 18);
    ctx.lineTo(19, 38);
    ctx.fill();
    
    return ctx.getImageData(0, 0, size, size);
  }
  
  function setIcon(imageData, fallbackPath) {
    try {
      browser.browserAction.setIcon({
        imageData: {
          [size]: imageData
        }
      }).catch(() => {
        if (fallbackPath) {
          browser.browserAction.setIcon({ path: fallbackPath }).catch(() => {});
        }
      });
    } catch (e) {
      if (fallbackPath) {
        browser.browserAction.setIcon({ path: fallbackPath }).catch(() => {});
      }
    }
  }

  function setDirectIcon(path) {
    browser.browserAction.setIcon({ path: path }).catch(() => {});
  }

  // Handle download creation
  browser.downloads.onCreated.addListener(item => {
    activeDownloads[item.id] = {
      bytesReceived: item.bytesReceived || 0,
      totalBytes: item.totalBytes || 1,
      progress: 0
    };
    
    // Draw progress icon at 0%
    setIcon(drawProgressIcon(0), "/icons/iconyellow.png");
    
    // Start timer if not already running
    if (!timer) {
      timer = setInterval(updateProgress, 500);
    }
  });
  
  // Handle download changes
  browser.downloads.onChanged.addListener(event => {
    // Track when downloads complete
    if (event.state && event.state.current === "complete") {
      // Mark unseen for badge
      if (!isPopupOpen) {
        unseen.push(event);
      }
      
      // Remove from active downloads
      if (event.id && activeDownloads[event.id]) {
        delete activeDownloads[event.id];
      }
      
      // If no more active downloads, set to green
      if (Object.keys(activeDownloads).length === 0) {
        setIcon(drawIcon("finished"), "/icons/icongreen.png");
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }
    }
    
    // Track progress changes
    if (event.bytesReceived || event.totalBytes) {
      if (!activeDownloads[event.id]) {
        activeDownloads[event.id] = {
          bytesReceived: 0, 
          totalBytes: 1, 
          progress: 0
        };
      }
      
      if (event.bytesReceived) {
        activeDownloads[event.id].bytesReceived = event.bytesReceived.current || 0;
      }
      
      if (event.totalBytes) {
        activeDownloads[event.id].totalBytes = event.totalBytes.current || 1;
      }
      
      if (activeDownloads[event.id].totalBytes > 0) {
        activeDownloads[event.id].progress = 
          activeDownloads[event.id].bytesReceived / activeDownloads[event.id].totalBytes;
      }
      
      // Update progress icon
      updateProgress();
    }
    
    // Handle file picker or filename changing
    if (event.filename) {
      // When picking a filename, show yellow icon
      setIcon(drawProgressIcon(0), "/icons/iconyellow.png");
      
      // Send gizmo message if appropriate
      if (event.filename.previous === "") {
        try {
          sendShowGizmo();
        } catch (e) {
          // Ignore gizmo errors
        }
      }
    }
    
    // Handle danger states
    if (event.danger) {
      isUnsafe = event.danger.current !== "accepted";
    }
  });

  // Update active download progress
  function updateProgress() {
    // Check if there are active downloads
    const downloads = Object.values(activeDownloads);
    
    if (downloads.length === 0) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      
      // Check if we have any completed but unseen downloads
      if (unseen.length > 0) {
        setIcon(drawIcon("finished"), "/icons/icongreen.png");
      } else {
        // Set back to blue
        setIcon(drawIcon("default"), {
          16: "/icons/icon-16x16.png",
          48: "/icons/icon-48x48.png",
          128: "/icons/icon-128x128.png"
        });
      }
      return;
    }
    
    // Calculate average progress for all active downloads
    let totalProgress = 0;
    downloads.forEach(download => {
      totalProgress += download.progress || 0;
    });
    
    const avgProgress = downloads.length > 0 ? 
      (totalProgress / downloads.length) : 0;
    
    // Draw and set progress icon
    setIcon(drawProgressIcon(avgProgress), "/icons/iconyellow.png");
    
    // Refresh download data periodically
    browser.downloads.search({ state: "in_progress" })
      .then(items => {
        if (items.length === 0 && Object.keys(activeDownloads).length > 0) {
          // No active downloads found but we think there are - refresh
          refresh();
          return;
        }
        
        // Update tracking data with fresh info
        items.forEach(item => {
          if (activeDownloads[item.id]) {
            activeDownloads[item.id].bytesReceived = item.bytesReceived || 0;
            activeDownloads[item.id].totalBytes = Math.max(1, item.totalBytes || 1);
            activeDownloads[item.id].progress = 
              (item.totalBytes > 0) ? (item.bytesReceived / item.totalBytes) : 0;
          } else {
            // New download we weren't tracking
            activeDownloads[item.id] = {
              bytesReceived: item.bytesReceived || 0,
              totalBytes: Math.max(1, item.totalBytes || 1),
              progress: (item.totalBytes > 0) ? (item.bytesReceived / item.totalBytes) : 0
            };
          }
        });
      })
      .catch(() => {});
  }

  // Handle popup open/close
  browser.runtime.onMessage.addListener(message => {
    if (message === "popup_open") {
      isPopupOpen = true;
      unseen = [];
      refresh();
      try {
        sendInvalidateGizmo();
      } catch (e) {}
    }
    return Promise.resolve();
  });

  browser.runtime.onConnect.addListener(externalPort => {
    externalPort.onDisconnect.addListener(() => {
      isPopupOpen = false;
      refresh();
    });
  });

  // Overall state refresh
  function refresh() {
    browser.downloads.search({ state: "in_progress", paused: false })
      .then(items => {
        // Reset tracked downloads
        activeDownloads = {};
        
        if (items.length > 0) {
          // We have active downloads
          items.forEach(item => {
            activeDownloads[item.id] = {
              bytesReceived: item.bytesReceived || 0,
              totalBytes: Math.max(1, item.totalBytes || 1),
              progress: item.totalBytes > 0 ? item.bytesReceived / item.totalBytes : 0
            };
          });
          
          // Calculate average progress
          updateProgress();
          
          if (!timer) {
            timer = setInterval(updateProgress, 500);
          }
        } else {
          // No active downloads
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          
          browser.downloads.search({})
            .then(allDownloads => {
              const completedDownloads = allDownloads.filter(d => d.state === "complete");
              
              if (unseen.length > 0 || completedDownloads.length > 0) {
                setIcon(drawIcon("finished"), "/icons/icongreen.png");
              } else {
                setIcon(drawIcon("default"), {
                  16: "/icons/icon-16x16.png",
                  48: "/icons/icon-48x48.png",
                  128: "/icons/icon-128x128.png"
                });
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }
  
  // Initialize
  refresh();

  // Helper functions for gizmo interaction
  function sendShowGizmo() {
    sendMessageToActiveTab("show_gizmo");
  }

  function sendInvalidateGizmo() {
    sendMessageToActiveTab("invalidate_gizmo");
  }

  function sendMessageToActiveTab(message) {
    try {
      browser.tabs.query({
        active: true,
        currentWindow: true,
        windowType: "normal",
      }).then(tabs => {
        if (!tabs || !tabs.length) return;
        
        for (const tab of tabs) {
          if (tab && tab.url && tab.url.startsWith("http")) {
            // Wrap in try-catch to prevent uncaught promise errors
            try {
              browser.tabs.sendMessage(tab.id, message).catch(() => {});
            } catch (e) {
              // Ignore any errors
            }
          }
        }
      }).catch(() => {});
    } catch (e) {
      // Catch any top-level errors
    }
  }

  // Handle download erasures
  browser.downloads.onErased.addListener(id => {
    if (activeDownloads[id]) {
      delete activeDownloads[id];
    }
    
    browser.downloads.search({}).then(allDownloads => {
      if (allDownloads.length === 0) {
        unseen = [];
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        setIcon(drawIcon("default"), {
          16: "/icons/icon-16x16.png",
          48: "/icons/icon-48x48.png",
          128: "/icons/icon-128x128.png"
        });
      } else {
        refresh();
      }
    }).catch(() => {});
  });
})();