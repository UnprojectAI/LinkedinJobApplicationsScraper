document.addEventListener('DOMContentLoaded', function() {
  const urlInput = document.getElementById('job-url');
  const startButton = document.getElementById('start-downloading');
  const statusText = document.getElementById('status-text');
  const progressContainer = document.getElementById('progress-container');
  const currentPage = document.getElementById('current-page');
  const profilesVisited = document.getElementById('profiles-visited');
  const profilesDownloaded = document.getElementById('profiles-downloaded');
  const profilesFailed = document.getElementById('profiles-failed');
  const failedProfilesList = document.getElementById('failed-profiles-list');
  const clearFailedButton = document.getElementById('clear-failed');
  const progressBar = document.getElementById('progress-bar');
  
  let isScrapingInProgress = false;
  let currentFailedProfiles = [];
  
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
      nameSpan.textContent = profile.name;
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'profile-time';
      timeSpan.textContent = formatTimestamp(profile.timestamp);
      
      profileLink.appendChild(nameSpan);
      profileLink.appendChild(timeSpan);
      failedProfilesList.appendChild(profileLink);
    });
  }
  
  // Function to update the UI based on status
  function updateUI(message) {
    statusText.textContent = message.text;
    
    isScrapingInProgress = message.isRunning;
    
    if (message.isRunning) {
      startButton.disabled = true;
      startButton.textContent = 'Downloading...';
      progressContainer.classList.remove('hidden');
      
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
    }
  }
  
  // Restore previously entered URL if any
  chrome.storage.local.get(['linkedinJobUrl', 'scrapingState'], function(result) {
    if (result.linkedinJobUrl) {
      urlInput.value = result.linkedinJobUrl;
    }
    
    // Check if there's an active downloading operation
    if (result.scrapingState && result.scrapingState.isRunning) {
      isScrapingInProgress = true;
      
      // Request current status from background script
      chrome.runtime.sendMessage({ action: 'getStatus' });
    }
  });
  
  // Listen for downloading status updates from background script
  chrome.runtime.onMessage.addListener(function(message) {
    if (message.type === 'status') {
      updateUI(message);
    }
  });
  
  // When popup opens, request current status from background script
  chrome.runtime.sendMessage({ action: 'getStatus' });
  
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
    
    // Save URL for future use
    chrome.storage.local.set({ linkedinJobUrl: jobUrl });
    
    // Update UI
    startButton.disabled = true;
    startButton.textContent = 'Starting...';
    statusText.textContent = 'Initializing Downloader...';
    progressContainer.classList.remove('hidden');
    
    // Send message to background script to start downloading
    chrome.runtime.sendMessage({
      action: 'startScraping',
      jobUrl: jobUrl
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
}); 
