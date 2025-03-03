// Global variables to track scraping state
let isScrapingRunning = false;
let currentJobUrl = '';
let totalProfilesVisited = 0;
let totalProfilesDownloaded = 0;
let totalProfilesFailed = 0;
let failedProfileUrls = []; // Array to store failed profile URLs and names
let currentPageNumber = 0;
let lastStatusUpdate = {};
let retryCount = 0;
const MAX_RETRIES = 3;
let mainTabId = null;
let stopRequested = false; // Flag to indicate a stop has been requested
let activeTimeouts = []; // Array to track all active timeouts
let profileUrlsOnCurrentPage = []; // Store profile URLs found on the current page

// Save state to storage for persistence
function saveState() {
  chrome.storage.local.set({
    scrapingState: {
      isRunning: isScrapingRunning,
      jobUrl: currentJobUrl,
      profilesVisited: totalProfilesVisited,
      profilesDownloaded: totalProfilesDownloaded,
      profilesFailed: totalProfilesFailed,
      failedProfiles: failedProfileUrls,
      pageNumber: currentPageNumber,
      lastStatus: lastStatusUpdate,
      mainTabId: mainTabId,
      stopRequested: stopRequested,
      profileUrlsOnCurrentPage: profileUrlsOnCurrentPage
    }
  });
}

// Load state from storage
function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get('scrapingState', (result) => {
      if (result.scrapingState) {
        isScrapingRunning = result.scrapingState.isRunning;
        currentJobUrl = result.scrapingState.jobUrl;
        totalProfilesVisited = result.scrapingState.profilesVisited || 0;
        totalProfilesDownloaded = result.scrapingState.profilesDownloaded || 0;
        totalProfilesFailed = result.scrapingState.profilesFailed || 0;
        failedProfileUrls = result.scrapingState.failedProfiles || [];
        currentPageNumber = result.scrapingState.pageNumber;
        lastStatusUpdate = result.scrapingState.lastStatus;
        mainTabId = result.scrapingState.mainTabId;
        stopRequested = result.scrapingState.stopRequested || false;
        profileUrlsOnCurrentPage = result.scrapingState.profileUrlsOnCurrentPage || [];
        
        // If stop was requested before browser was closed
        if (stopRequested) {
          isScrapingRunning = false;
          stopRequested = false;
          saveState();
        }
      }
      resolve();
    });
  });
}

// Initialize state on startup
loadState().then(() => {
  // Check if we need to resume a scraping operation
  if (isScrapingRunning && currentJobUrl) {
    // Verify if the main tab still exists
    if (mainTabId) {
      chrome.tabs.get(mainTabId, (tab) => {
        if (chrome.runtime.lastError) {
          // Tab no longer exists, reset the state
          isScrapingRunning = false;
          mainTabId = null;
          saveState();
        } else {
          // Resume from where we left off
          setTimeout(() => {
            updateStatus('Resuming scraping operation...', true);
            continueScrapingFromCurrentState();
          }, 1000);
        }
      });
    } else {
      // No main tab ID stored, reset state
      isScrapingRunning = false;
      saveState();
    }
  }
});

// Function to check if we should continue scraping
function shouldContinueScraping() {
  return isScrapingRunning && !stopRequested;
}

// Function to send status updates to the popup
function updateStatus(text, isRunning = true, currentPage = currentPageNumber, 
                     visited = totalProfilesVisited, 
                     downloaded = totalProfilesDownloaded, 
                     failed = totalProfilesFailed,
                     progress = 0) {
  const statusUpdate = {
    type: 'status',
    text: text,
    isRunning: isRunning,
    currentPage: currentPage,
    profilesVisited: visited,
    profilesDownloaded: downloaded,
    profilesFailed: failed,
    failedProfiles: failedProfileUrls,
    progress: progress,
    timestamp: Date.now()
  };
  
  lastStatusUpdate = statusUpdate;
  
  // Save state to maintain context
  saveState();
  
  // Send to any open popups
  chrome.runtime.sendMessage(statusUpdate).catch(() => {
    // It's normal for this to fail if popup is closed, no need to handle error
  });
}

// Function to safely execute tab operations with retries
async function safeTabOperation(operation, errorMessage) {
  return new Promise(async (resolve, reject) => {
    // Check if we should stop
    if (!shouldContinueScraping()) {
      resolve(null);
      return;
    }
    
    let retry = 0;
    
    const tryOperation = async () => {
      // Check if we should stop before each retry
      if (!shouldContinueScraping()) {
        resolve(null);
        return;
      }
      
      try {
        const result = await operation();
        retryCount = 0; // Reset global retry counter on success
        resolve(result);
      } catch (error) {
        retry++;
        retryCount++;
        
        console.error(`${errorMessage}: ${error.message}`);
        
        // Check if we should stop before retrying
        if (!shouldContinueScraping()) {
          resolve(null);
          return;
        }
        
        if (retry <= 3 && retryCount <= MAX_RETRIES) {
          // Wait longer between retries to avoid conflicts with user actions
          const delay = retry * 1000;
          console.log(`Retrying in ${delay}ms... (Attempt ${retry})`);
          updateStatus(`Tab operation failed. Retrying in ${delay/1000}s... (Attempt ${retry})`, true);
          
          // Using setTimeout with a check for stopRequested
          const timeoutPromise = new Promise(r => {
            const timeoutId = setTimeout(() => {
              // Check if we should stop before proceeding with retry
              if (shouldContinueScraping()) {
                r();
              } else {
                // If stopped, resolve the original promise with null
                resolve(null);
              }
            }, delay);
            
            // Store the timeout ID to potentially clear it
            activeTimeouts.push(timeoutId);
          });
          
          await timeoutPromise;
          
          // One final check before trying again
          if (shouldContinueScraping()) {
            tryOperation();
          } else {
            resolve(null);
          }
        } else {
          // If we've reached max retries, resolve with null to continue
          // rather than rejecting and stopping everything
          console.warn('Max retries reached or too many global retries. Continuing...');
          retryCount = 0;
          resolve(null);
        }
      }
    };
    
    tryOperation();
  });
}

// Function to get all profiles on the page
async function findAllProfilesOnPage(tabId) {
  try {
    // Check if we should stop
    if (!shouldContinueScraping()) {
      return [];
    }
    
    // Find all profile elements on the page using different selectors to ensure we get all profiles
    const profileElementsResult = await safeTabOperation(
      () => chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: () => {
          // Use multiple selectors to ensure we find all profiles
          const selectors = [
            '.hiring-applicants__list-item', // Original selector
            '.artdeco-list__item', // Alternative selector
            'li.artdeco-list__item[data-view-name="profile-entity-lockup"]' // Another possible selector
          ];
          
          let allProfiles = [];
          
          // Try each selector
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              console.log(`Found ${elements.length} profiles with selector: ${selector}`);
              
              // Map elements to profile objects
              const profiles = Array.from(elements).map(profile => {
                const element = profile.querySelector('a');
                // Try multiple selectors for name
                const nameSelectors = [
                  '.artdeco-entity-lockup__title',
                  '.artdeco-entity-lockup__content .artdeco-entity-lockup__title',
                  'h3'
                ];
                
                let name = 'Unknown';
                for (const nameSelector of nameSelectors) {
                  const nameElement = profile.querySelector(nameSelector);
                  if (nameElement) {
                    name = nameElement.textContent.trim();
                    break;
                  }
                }
                
                return element ? { url: element.href, name: name } : null;
              }).filter(profile => profile !== null);
              
              allProfiles = profiles;
              
              // If we found a good number of profiles, return them
              if (profiles.length > 0) {
                console.log(`Using selector ${selector} with ${profiles.length} profiles`);
                break;
              }
            }
          }
          
          console.log(`Total profiles found: ${allProfiles.length}`);
          return allProfiles;
        }
      }),
      'Error finding profile elements'
    );
    
    if (!profileElementsResult || profileElementsResult.length === 0) {
      console.warn('No profiles found or error retrieving profiles');
      return [];
    }
    
    return profileElementsResult[0].result || [];
    
  } catch (error) {
    console.error('Error in findAllProfilesOnPage:', error);
    return [];
  }
}

// Function to process profiles (either visiting or downloading)
async function processProfiles(profiles, downloadResume = false, sleepTime = 2000) {
  return new Promise(async (resolve) => {
    try {
      // Check if we should stop
      if (!shouldContinueScraping() || !profiles || profiles.length === 0) {
        resolve(0);
        return;
      }
      
      const actionText = downloadResume ? 'Downloading resumes' : 'Visiting profiles';
      updateStatus(`Found ${profiles.length} profiles on page ${currentPageNumber}. ${actionText}...`);
      
      let processedCount = 0;
      let downloadedCount = 0;
      let failedCount = 0;
      
      // Process each profile
      for (const profile of profiles) {
        // Check if we should stop before processing each profile
        if (!shouldContinueScraping()) {
          resolve(processedCount);
          return;
        }
        
        try {
          // Open profile in a new tab
          const newTab = await safeTabOperation(
            () => chrome.tabs.create({ url: profile.url, active: false }),
            'Error creating new tab'
          );
          
          // Check if we should stop after opening tab
          if (!shouldContinueScraping()) {
            if (newTab) {
              try {
                await chrome.tabs.remove(newTab.id);
              } catch (e) {
                // Ignore errors when closing tab
              }
            }
            resolve(processedCount);
            return;
          }
          
          if (!newTab) {
            continue; // Skip this profile if tab creation failed
          }
          
          // Wait for the page to load
          await new Promise((r) => {
            const waitTimeout = setTimeout(() => r(), sleepTime);
            
            // Store timeout so we can clear it if needed
            activeTimeouts.push(waitTimeout);
          });
          
          // Check if we should stop after page load
          if (!shouldContinueScraping()) {
            try {
              await chrome.tabs.remove(newTab.id);
            } catch (e) {
              // Ignore errors when closing tab
            }
            resolve(processedCount);
            return;
          }
          
          if (downloadResume) {
            // Execute script to download resume
            const downloadResult = await safeTabOperation(
              () => chrome.scripting.executeScript({
                target: { tabId: newTab.id },
                function: () => {
                  try {
                    // Try multiple selectors for resume elements
                    const resumeSelectors = [
                      '.hiring-resume-viewer__resume-wrapper--collapsed',
                      '[data-test-hiring-resume-viewer-wrapper]',
                      '.resume-viewer-wrapper'
                    ];
                    
                    for (const selector of resumeSelectors) {
                      const resumeElements = document.querySelectorAll(selector);
                      if (resumeElements.length > 0) {
                        for (const resumeElement of resumeElements) {
                          const anchorTag = resumeElement.querySelector('a');
                          if (anchorTag && anchorTag.href) {
                            const pdfUrl = anchorTag.href;
                            window.location.href = pdfUrl;
                            console.log('Found and downloading resume with URL:', pdfUrl);
                            return true;
                          }
                        }
                      }
                    }
                    
                    console.warn('No resume elements found on the page');
                    return false;
                  } catch (error) {
                    console.error('Error downloading resume:', error);
                    return false;
                  }
                }
              }),
              'Error downloading resume'
            );
            
            // Check if we should stop after download attempt
            if (!shouldContinueScraping()) {
              try {
                await chrome.tabs.remove(newTab.id);
              } catch (e) {
                // Ignore errors when closing tab
              }
              resolve(processedCount);
              return;
            }
            
            // Check if download was successful
            const downloadSuccess = downloadResult && downloadResult[0] && downloadResult[0].result === true;
            
            if (downloadSuccess) {
              downloadedCount++;
              totalProfilesDownloaded++;
            } else {
              failedCount++;
              totalProfilesFailed++;
              
              // Add to failed profiles list if not already there
              const failedProfileExists = failedProfileUrls.some(p => p.url === profile.url);
              if (!failedProfileExists) {
                failedProfileUrls.push({
                  url: profile.url,
                  name: profile.name,
                  timestamp: Date.now()
                });
              }
            }
            
            // Wait for download to start
            await new Promise((r) => {
              const waitTimeout = setTimeout(() => r(), sleepTime);
              
              // Store timeout so we can clear it if needed
              activeTimeouts.push(waitTimeout);
            });
            
            // Check if we should stop after waiting for download
            if (!shouldContinueScraping()) {
              try {
                await chrome.tabs.remove(newTab.id);
              } catch (e) {
                // Ignore errors when closing tab
              }
              resolve(processedCount);
              return;
            }
          } else {
            // Just visiting the profile
            totalProfilesVisited++;
          }
          
          // Close the tab
          await safeTabOperation(
            () => chrome.tabs.remove(newTab.id),
            'Error closing tab'
          );
          
          processedCount++;
          
          // Update progress
          const progress = (processedCount / profiles.length) * 100;
          let statusMessage = '';
          
          if (downloadResume) {
            statusMessage = `Page ${currentPageNumber}: Downloaded ${downloadedCount} resumes, failed ${failedCount} (${processedCount}/${profiles.length})`;
          } else {
            statusMessage = `Page ${currentPageNumber}: Visited ${processedCount}/${profiles.length} profiles`;
          }
          
          updateStatus(
            statusMessage,
            true,
            currentPageNumber,
            totalProfilesVisited,
            totalProfilesDownloaded,
            totalProfilesFailed,
            progress
          );
          
        } catch (error) {
          console.error('Error processing profile:', error);
        }
      }
      
      resolve(processedCount);
      
    } catch (error) {
      console.error('Error in processProfiles:', error);
      resolve(0);
    }
  });
}

// Function to clear all active timeouts
function clearAllTimeouts() {
  if (activeTimeouts.length > 0) {
    console.log(`Clearing ${activeTimeouts.length} active timeouts`);
    activeTimeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    activeTimeouts = [];
  }
}

// Function to process a single page (both visiting and downloading)
async function processPage(tabId) {
  try {
    // Check if we should stop
    if (!shouldContinueScraping()) {
      return 0;
    }
    
    // First, collect all profiles on the page
    updateStatus(`Finding all profiles on page ${currentPageNumber}...`);
    const profiles = await findAllProfilesOnPage(tabId);
    
    if (!profiles || profiles.length === 0) {
      updateStatus('No profiles found on this page.');
      return 0;
    }
    
    // Store profiles for the current page
    profileUrlsOnCurrentPage = profiles;
    saveState();
    
    // First pass: visit all profiles
    updateStatus(`Visiting ${profiles.length} profiles on page ${currentPageNumber}...`);
    await processProfiles(profiles, false, 2000);
    
    // Check if we should stop after first pass
    if (!shouldContinueScraping()) {
      return 0;
    }
    
    // Second pass: download resumes
    updateStatus(`Downloading resumes for ${profiles.length} profiles on page ${currentPageNumber}...`);
    const profilesProcessed = await processProfiles(profiles, true, 3000);
    
    return profilesProcessed;
  } catch (error) {
    console.error('Error in processPage:', error);
    return 0;
  }
}

// Function to continue scraping from current state
async function continueScrapingFromCurrentState() {
  try {
    // Check if we should stop before starting
    if (!shouldContinueScraping()) {
      updateStatus('Scraping stopped.', false);
      return;
    }
    
    let continueScraping = true;
    
    // Check if main tab still exists
    let mainTab;
    try {
      if (mainTabId) {
        mainTab = await safeTabOperation(
          () => chrome.tabs.get(mainTabId),
          'Error getting main tab'
        );
      }
    } catch (error) {
      console.log('Main tab no longer exists, creating a new one');
    }
    
    // If main tab doesn't exist, create a new one
    if (!mainTab) {
      mainTab = await safeTabOperation(
        () => chrome.tabs.create({ url: currentJobUrl, active: false }),
        'Error creating new main tab'
      );
      
      if (!mainTab) {
        throw new Error('Failed to create main tab');
      }
      
      mainTabId = mainTab.id;
      saveState();
      
      // Wait for LinkedIn to load
      await new Promise((r) => {
        const waitTimeout = setTimeout(() => r(), 5000);
        
        // Store timeout so we can clear it if needed
        activeTimeouts.push(waitTimeout);
      });
      
      // Check if we should stop after page load
      if (!shouldContinueScraping()) {
        updateStatus('Scraping stopped.', false);
        return;
      }
    }
    
    while (continueScraping && shouldContinueScraping()) {
      const pageUrl = `${currentJobUrl}?start=${(currentPageNumber - 1) * 25}`;
      
      // Navigate to the current page
      await safeTabOperation(
        () => chrome.tabs.update(mainTabId, { url: pageUrl }),
        'Error navigating to page'
      );
      
      // Check if we should stop after navigation
      if (!shouldContinueScraping()) {
        updateStatus('Scraping stopped.', false);
        return;
      }
      
      // Wait for page to load
      await new Promise((r) => {
        const waitTimeout = setTimeout(() => r(), 5000);
        
        // Store timeout so we can clear it if needed
        activeTimeouts.push(waitTimeout);
      });
      
      // Check if we should stop after page load
      if (!shouldContinueScraping()) {
        updateStatus('Scraping stopped.', false);
        return;
      }
      
      updateStatus(`Processing page ${currentPageNumber}...`);
      
      // Process the current page (both visiting and downloading)
      const profilesOnPage = await processPage(mainTabId);
      
      // Check if we should stop after processing page
      if (!shouldContinueScraping()) {
        updateStatus('Scraping stopped.', false);
        return;
      }
      
      // Check if we should continue to next page (if profiles were found on this page)
      continueScraping = profilesOnPage > 0;
      
      if (continueScraping) {
        currentPageNumber++;
        saveState();
      } else {
        updateStatus('No more profiles found. Scraping complete.', false);
        isScrapingRunning = false;
        saveState();
        break;
      }
    }
    
    // Don't close the main tab so user can continue manually if needed
    
  } catch (error) {
    console.error('Error in continueScrapingFromCurrentState:', error);
    updateStatus(`Error: ${error.message}`, false);
    isScrapingRunning = false;
    saveState();
  }
}

// Main scraping function
async function startScraping(jobUrl) {
  if (isScrapingRunning) {
    updateStatus('Scraping already in progress.', true);
    return;
  }
  
  isScrapingRunning = true;
  stopRequested = false;
  currentJobUrl = jobUrl;
  totalProfilesVisited = 0;
  totalProfilesDownloaded = 0;
  totalProfilesFailed = 0;
  failedProfileUrls = [];
  profileUrlsOnCurrentPage = [];
  currentPageNumber = 1;
  mainTabId = null;
  
  updateStatus('Starting LinkedIn scraper...');
  saveState();
  
  try {
    // Create main tab
    const mainTab = await safeTabOperation(
      () => chrome.tabs.create({ url: jobUrl, active: false }),
      'Error creating main tab'
    );
    
    if (!mainTab) {
      throw new Error('Failed to create main tab');
    }
    
    mainTabId = mainTab.id;
    saveState();
    
    // Wait for LinkedIn to load
    await new Promise((r) => {
      const waitTimeout = setTimeout(() => r(), 5000);
      
      // Store timeout so we can clear it if needed
      activeTimeouts.push(waitTimeout);
    });
    
    // Check if we should stop after page load
    if (!shouldContinueScraping()) {
      updateStatus('Scraping stopped.', false);
      return;
    }
    
    let continueScraping = true;
    
    while (continueScraping && shouldContinueScraping()) {
      const pageUrl = `${jobUrl}?start=${(currentPageNumber - 1) * 25}`;
      
      // Navigate to the current page
      await safeTabOperation(
        () => chrome.tabs.update(mainTabId, { url: pageUrl }),
        'Error navigating to page'
      );
      
      // Check if we should stop after navigation
      if (!shouldContinueScraping()) {
        updateStatus('Scraping stopped.', false);
        return;
      }
      
      // Wait for page to load
      await new Promise((r) => {
        const waitTimeout = setTimeout(() => r(), 5000);
        
        // Store timeout so we can clear it if needed
        activeTimeouts.push(waitTimeout);
      });
      
      // Check if we should stop after page load
      if (!shouldContinueScraping()) {
        updateStatus('Scraping stopped.', false);
        return;
      }
      
      updateStatus(`Processing page ${currentPageNumber}...`);
      
      // Process the current page (both visiting and downloading)
      const profilesOnPage = await processPage(mainTabId);
      
      // Check if we should stop after processing page
      if (!shouldContinueScraping()) {
        updateStatus('Scraping stopped.', false);
        return;
      }
      
      // Check if we should continue to next page (if profiles were found on this page)
      continueScraping = profilesOnPage > 0;
      
      if (continueScraping) {
        currentPageNumber++;
        saveState();
      } else {
        updateStatus('No more profiles found. Scraping complete.', false);
        isScrapingRunning = false;
        saveState();
        break;
      }
    }
    
    // Don't close the main tab
    
  } catch (error) {
    console.error('Error in startScraping:', error);
    updateStatus(`Error: ${error.message}`, false);
    isScrapingRunning = false;
    saveState();
  }
}

// Function to stop scraping
function stopScraping() {
  console.log('Stop scraping requested');
  stopRequested = true;
  
  // Clear any active timeouts to stop waiting processes
  clearAllTimeouts();
  
  updateStatus('Stopping scraping process...', true);
  
  // We'll set isScrapingRunning to false after a short delay
  // to allow in-progress operations to see the stop requested flag
  setTimeout(() => {
    isScrapingRunning = false;
    updateStatus('Scraping stopped by user.', false);
    saveState();
  }, 1000);
  
  return true;
}

// Function to clear the failed profiles list
function clearFailedProfiles() {
  failedProfileUrls = [];
  saveState();
  updateStatus('Failed profiles list cleared.', isScrapingRunning);
  return true;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping') {
    startScraping(message.jobUrl);
    sendResponse({success: true});
  } else if (message.action === 'stopScraping') {
    const success = stopScraping();
    sendResponse({success: success});
  } else if (message.action === 'getStatus') {
    // Send the current status to the popup when requested
    if (lastStatusUpdate && Object.keys(lastStatusUpdate).length > 0) {
      chrome.runtime.sendMessage(lastStatusUpdate).catch(() => {});
    } else {
      chrome.runtime.sendMessage({
        type: 'status',
        text: isScrapingRunning ? 'Scraping in progress...' : 'Ready to start scraping.',
        isRunning: isScrapingRunning,
        currentPage: currentPageNumber,
        profilesVisited: totalProfilesVisited,
        profilesDownloaded: totalProfilesDownloaded,
        profilesFailed: totalProfilesFailed,
        failedProfiles: failedProfileUrls,
        progress: 0
      }).catch(() => {});
    }
    sendResponse({success: true});
  } else if (message.action === 'clearFailedProfiles') {
    const success = clearFailedProfiles();
    sendResponse({success: success});
  } else if (message.action === 'getFailedProfiles') {
    sendResponse({failedProfiles: failedProfileUrls});
  }
  return true;
}); 
