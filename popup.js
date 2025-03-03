document.addEventListener('DOMContentLoaded', function() {
  const urlInput = document.getElementById('job-url');
  const startButton = document.getElementById('start-downloading');
  const statusText = document.getElementById('status-text');
  const progressContainer = document.getElementById('progress-container');
  const currentPage = document.getElementById('current-page');
  const profilesVisited = document.getElementById('profiles-visited');
  const profilesDownloaded = document.getElementById('profiles-downloaded');
  const profilesFailed = document.getElementById('profiles-failed');
  const failedList = document.getElementById('failed-list');
  const failedProfilesList = document.getElementById('failed-profiles-list');
  const clearFailedButton = document.getElementById('clear-failed');
  const progressBar = document.getElementById('progress-bar');
  const retryFailedButton = document.getElementById('retry-failed');
  const advancedSettingsToggle = document.getElementById('advanced-settings-toggle');
  const advancedSettings = document.getElementById('advanced-settings');
  const startPageInput = document.getElementById('start-page');
  const endPageInput = document.getElementById('end-page');
  
  let isScrapingInProgress = false;
  let currentFailedProfiles = [];
  let failedListActive = false;
  
  // Format a timestamp
  function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }
  
  // Update the list of failed profiles
  function updateFailedProfilesList(failedProfiles) {
    currentFailedProfiles = failedProfiles || [];
    
    // Clear the list
    failedProfilesList.innerHTML = '';
    
    if (!failedProfiles || failedProfiles.length === 0) {
      failedProfilesList.innerHTML = '<p>No failed downloads yet.</p>';
      retryFailedButton.classList.add('hidden');
      return;
    }
    
    // Sort by most recent first
    const sortedProfiles = [...failedProfiles].sort((a, b) => b.timestamp - a.timestamp);
    
    // Add each profile to the list
    sortedProfiles.forEach(profile => {
      const profileLink = document.createElement('a');
      profileLink.href = profile.url;
      profileLink.target = '_blank';
      profileLink.setAttribute('title', 'Open profile');
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'profile-name';
      nameSpan.textContent = profile.name || 'Unknown Profile';
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'profile-time';
      timeSpan.textContent = formatTimestamp(profile.timestamp);
      
      profileLink.appendChild(nameSpan);
      profileLink.appendChild(timeSpan);
      failedProfilesList.appendChild(profileLink);
    });

    // Make sure the count shows the correct number
    profilesFailed.textContent = failedProfiles.length;
    
    // Show the retry button if there are failed profiles and scraping is not in progress
    if (failedProfiles.length > 0 && !isScrapingInProgress) {
      retryFailedButton.classList.remove('hidden');
    } else {
      retryFailedButton.classList.add('hidden');
    }
  }
  
  // Set up toggle functionality for failed list
  profilesFailed.addEventListener('click', function(e) {
    e.stopPropagation(); // Prevent event from bubbling up
    failedListActive = !failedListActive;
    
    if (failedListActive) {
      failedList.classList.add('active');
    } else {
      failedList.classList.remove('active');
    }
  });
  
  // Handle clicks outside the failed list to close it
  document.addEventListener('click', function(e) {
    if (failedListActive && !failedList.contains(e.target) && e.target !== profilesFailed) {
      failedListActive = false;
      failedList.classList.remove('active');
    }
  });
  
  // Prevent clicks inside the failed list from bubbling up
  failedList.addEventListener('click', function(e) {
    e.stopPropagation();
  });
  
  // Function to update the UI based on status
  function updateUI(message) {
    statusText.textContent = message.text;
    
    isScrapingInProgress = message.isRunning;
    
    if (message.isRunning) {
      startButton.disabled = true;
      startButton.textContent = 'Downloading...';
      progressContainer.classList.remove('hidden');
      retryFailedButton.classList.add('hidden');
      retryFailedButton.disabled = true;
      
      // Update progress information
      if (message.currentPage !== undefined) {
        currentPage.textContent = `Page: ${message.currentPage}`;
      }
      
      if (message.profilesVisited !== undefined) {
        profilesVisited.textContent = message.profilesVisited;
      }
      
      if (message.profilesDownloaded !== undefined) {
        profilesDownloaded.textContent = message.profilesDownloaded;
      }
      
      if (message.profilesFailed !== undefined) {
        profilesFailed.textContent = message.profilesFailed;
      }
      
      if (message.failedProfiles !== undefined) {
        updateFailedProfilesList(message.failedProfiles);
      }
      
      if (message.progress !== undefined) {
        progressBar.style.width = `${message.progress}%`;
      }
      
      // Add stop button if it doesn't exist
      if (!document.getElementById('stop-downloading')) {
        const stopButton = document.createElement('button');
        stopButton.id = 'stop-downloading';
        stopButton.textContent = 'Stop Downloading';
        stopButton.style.marginTop = '10px';
        stopButton.style.backgroundColor = '#e74c3c';
        
        stopButton.addEventListener('click', function() {
          chrome.runtime.sendMessage({
            action: 'stopScraping'
          });
          this.disabled = true;
          this.textContent = 'Stopping...';
        });
        
        document.querySelector('.form-group:nth-child(2)').appendChild(stopButton);
      }
    } else {
      startButton.disabled = false;
      startButton.textContent = 'Start Downloading';
      
      // Remove stop button if exists
      const stopButton = document.getElementById('stop-downloading');
      if (stopButton) {
        stopButton.remove();
      }
      
      // Re-enable retry button if needed
      retryFailedButton.disabled = false;
      
      // Show retry button if there are failed profiles
      if (currentFailedProfiles && currentFailedProfiles.length > 0) {
        retryFailedButton.classList.remove('hidden');
        retryFailedButton.textContent = 'Retry Failed Profiles';
      } else {
        retryFailedButton.classList.add('hidden');
      }
    }
  }
  
  // Function to request latest failed profiles from background script
  function refreshFailedProfiles() {
    chrome.runtime.sendMessage({ action: 'getFailedProfiles' }, function(response) {
      if (response && response.failedProfiles) {
        updateFailedProfilesList(response.failedProfiles);
      }
    });
  }
  
  // Set up toggle functionality for advanced settings
  advancedSettingsToggle.addEventListener('click', function() {
    advancedSettings.classList.toggle('hidden');
    
    // Save advanced settings state
    const isAdvancedSettingsVisible = !advancedSettings.classList.contains('hidden');
    chrome.storage.local.set({
      advancedSettingsVisible: isAdvancedSettingsVisible
    });
  });
  
  // Save pagination input values when they change
  startPageInput.addEventListener('change', function() {
    const value = parseInt(this.value) || 1;
    if (value < 1) this.value = 1;
    chrome.storage.local.set({ startPage: parseInt(this.value) });
  });
  
  endPageInput.addEventListener('change', function() {
    const value = parseInt(this.value) || 20;
    if (value < 1) this.value = 1;
    chrome.storage.local.set({ endPage: parseInt(this.value) });
  });

  // Restore previously entered settings
  chrome.storage.local.get(['linkedinJobUrl', 'scrapingState', 'startPage', 'endPage', 'advancedSettingsVisible'], function(result) {
    if (result.linkedinJobUrl) {
      urlInput.value = result.linkedinJobUrl;
    }
    
    // Restore pagination settings if available
    if (result.startPage) {
      startPageInput.value = result.startPage;
    }
    
    if (result.endPage) {
      endPageInput.value = result.endPage;
    }
    
    // Restore advanced settings visibility
    if (result.advancedSettingsVisible) {
      advancedSettings.classList.remove('hidden');
    }
    
    // Check if there's an active scraping operation
    if (result.scrapingState && result.scrapingState.isRunning) {
      isScrapingInProgress = true;
      
      // Request current status from background script
      chrome.runtime.sendMessage({ action: 'getStatus' });
    }
    
    // Also check if there are any failed profiles to display
    if (result.scrapingState && result.scrapingState.failedProfiles) {
      updateFailedProfilesList(result.scrapingState.failedProfiles);
    }
  });
  
  // Listen for scraping status updates from background script
  chrome.runtime.onMessage.addListener(function(message) {
    if (message.type === 'status') {
      updateUI(message);
    }
  });
  
  // When popup opens, request current status from background script
  chrome.runtime.sendMessage({ action: 'getStatus' });
  
  // Request failed profiles specifically
  refreshFailedProfiles();
  
  // Start button click handler
  startButton.addEventListener('click', function() {
    const jobUrl = urlInput.value.trim();
    
    if (!jobUrl) {
      statusText.textContent = 'Please enter a LinkedIn job applications URL';
      return;
    }
    
    if (!jobUrl.includes('linkedin.com')) {
      statusText.textContent = 'Please enter a valid LinkedIn URL';
      return;
    }
    
    // Get pagination settings
    const startPage = parseInt(startPageInput.value) || 1;
    const endPage = parseInt(endPageInput.value) || 20;
    
    // Validate pagination settings
    if (startPage < 1) {
      statusText.textContent = 'Start page must be at least 1';
      return;
    }
    
    if (endPage < startPage) {
      statusText.textContent = 'End page must be greater than or equal to start page';
      return;
    }
    
    // Save settings for future use
    chrome.storage.local.set({
      linkedinJobUrl: jobUrl,
      startPage: startPage,
      endPage: endPage
    });
    
    // Update UI
    startButton.disabled = true;
    startButton.textContent = 'Starting...';
    statusText.textContent = 'Initializing downloader...';
    progressContainer.classList.remove('hidden');
    retryFailedButton.classList.add('hidden');
    
    // Send message to background script to start scraping
    chrome.runtime.sendMessage({
      action: 'startScraping',
      jobUrl: jobUrl,
      startPage: startPage,
      endPage: endPage
    });
  });
  
  // Retry Failed Profiles button click handler
  retryFailedButton.addEventListener('click', function() {
    if (currentFailedProfiles.length === 0) {
      statusText.textContent = 'No failed profiles to retry';
      return;
    }
    
    // Update UI
    retryFailedButton.disabled = true;
    retryFailedButton.textContent = 'Retrying...';
    statusText.textContent = 'Retrying failed profiles...';
    
    // Send message to background script to retry failed profiles
    chrome.runtime.sendMessage({
      action: 'retryFailedProfiles'
    }, function(response) {
      if (response && response.success) {
        console.log('Started retrying failed profiles');
      } else {
        // If there was an error starting the retry process
        retryFailedButton.disabled = false;
        retryFailedButton.textContent = 'Retry Failed Profiles';
        statusText.textContent = 'Failed to start retry process';
      }
    });
  });
  
  // Clear failed profiles button click handler
  clearFailedButton.addEventListener('click', function(e) {
    e.stopPropagation(); // Prevent the event from bubbling up
    
    chrome.runtime.sendMessage({
      action: 'clearFailedProfiles'
    }, function(response) {
      if (response && response.success) {
        updateFailedProfilesList([]);
        profilesFailed.textContent = '0';
      }
    });
  });
  
  // Set up an interval to refresh failed profiles list periodically
  setInterval(refreshFailedProfiles, 5000);
}); 
