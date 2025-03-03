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
    
    const EXPECTED_PROFILES = 25; // LinkedIn typically shows 25 profiles per page
    const MAX_RETRIES = 3;
    let retryCount = 0;
    let profiles = [];
    
    while (retryCount < MAX_RETRIES && profiles.length < EXPECTED_PROFILES) {
      if (retryCount > 0) {
        console.log(`Retry #${retryCount}: Only found ${profiles.length} profiles, expecting ${EXPECTED_PROFILES}. Retrying...`);
        
        // Scroll down the page to ensure all content is loaded
        await safeTabOperation(
          () => chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: () => {
              return new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                  window.scrollBy(0, distance);
                  totalHeight += distance;
                  
                  if (totalHeight >= document.body.scrollHeight) {
                    clearInterval(timer);
                    // Scroll back to top
                    window.scrollTo(0, 0);
                    resolve();
                  }
                }, 100);
              });
            }
          }),
          'Error scrolling the page'
        );
        
        // Wait for a moment to let any lazy-loaded content appear
        await new Promise(r => {
          const timeout = setTimeout(r, 1500);
          activeTimeouts.push(timeout);
        });
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
              'li.artdeco-list__item[data-view-name="profile-entity-lockup"]', // Another possible selector
              '.artdeco-list > li', // Broader selector
              '.hiring-applicants__container .artdeco-list__item' // More specific selector
            ];
            
            let allProfiles = [];
            let bestProfileSet = [];
            
            // Try each selector
            for (const selector of selectors) {
              const elements = document.querySelectorAll(selector);
              if (elements.length > 0) {
                console.log(`Found ${elements.length} profiles with selector: ${selector}`);
                
                // Map elements to profile objects
                const profiles = Array.from(elements).map(profile => {
                  let linkElement = null;
                  
                  // Try different approaches to find the profile link
                  const linkSelectors = [
                    'a[href*="/in/"]',
                    'a[href*="/talent/profile/"]',
                    '.artdeco-entity-lockup__title a',
                    '.artdeco-entity-lockup__content a'
                  ];
                  
                  for (const linkSelector of linkSelectors) {
                    const foundLink = profile.querySelector(linkSelector);
                    if (foundLink && foundLink.href) {
                      linkElement = foundLink;
                      break;
                    }
                  }
                  
                  if (!linkElement) return null;
                  
                  // Try multiple selectors for name
                  const nameSelectors = [
                    '.artdeco-entity-lockup__title',
                    '.artdeco-entity-lockup__content .artdeco-entity-lockup__title',
                    'h3',
                    '.artdeco-entity-lockup__subtitle',
                    '.artdeco-entity-lockup__title span'
                  ];
                  
                  let name = 'Unknown';
                  for (const nameSelector of nameSelectors) {
                    const nameElement = profile.querySelector(nameSelector);
                    if (nameElement) {
                      name = nameElement.textContent.trim();
                      break;
                    }
                  }
                  
                  return { url: linkElement.href, name: name };
                }).filter(profile => profile !== null);
                
                if (profiles.length > bestProfileSet.length) {
                  bestProfileSet = profiles;
                  console.log(`New best selector: ${selector} with ${profiles.length} profiles`);
                }
              }
            }
            
            // Use the selector that found the most profiles
            allProfiles = bestProfileSet;
            
            // Remove duplicates (based on URL)
            const uniqueProfiles = allProfiles.filter((profile, index, self) =>
              index === self.findIndex((p) => p.url === profile.url)
            );
            
            console.log(`Total unique profiles found: ${uniqueProfiles.length}`);
            return uniqueProfiles;
          }
        }),
        'Error finding profile elements'
      );
      
      if (profileElementsResult && profileElementsResult.length > 0 && profileElementsResult[0].result) {
        profiles = profileElementsResult[0].result;
        
        // If we found a good number of profiles or it's our last retry, return them
        if (profiles.length >= EXPECTED_PROFILES || retryCount === MAX_RETRIES - 1) {
          console.log(`Found ${profiles.length} profiles out of expected ${EXPECTED_PROFILES}`);
          return profiles;
        }
      }
      
      retryCount++;
    }
    
    console.log(`After ${retryCount} retries, found ${profiles.length} profiles out of expected ${EXPECTED_PROFILES}`);
    return profiles;
    
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
    // Load pagination settings
    const paginationSettings = await new Promise(resolve => {
      chrome.storage.local.get('paginationSettings', result => {
        resolve(result.paginationSettings || { startPage: 1, endPage: 20 });
      });
    });
    
    updateStatus(`Processing page ${currentPageNumber} of ${paginationSettings.endPage}...`);
    
    // Find all profile links on the current page
    let profiles = await findAllProfilesOnPage(tabId);
    
    // If we found some profiles but less than expected, try reloading the page once
    const EXPECTED_PROFILES = 25;
    if (profiles && profiles.length > 0 && profiles.length < EXPECTED_PROFILES) {
      console.log(`Found only ${profiles.length} profiles, expecting ${EXPECTED_PROFILES}. Trying to reload the page...`);
      
      // Reload the page
      updateStatus(`Reloading page ${currentPageNumber} to find more profiles...`);
      
      // Calculate the start parameter for the current page
      const currentPageStartParam = (currentPageNumber - 1) * 25;
      
      // Update URL with the current start parameter
      let currentPageUrl = currentJobUrl;
      const url = new URL(currentJobUrl);
      
      // Remove any existing start parameter
      if (url.searchParams.has('start')) {
        url.searchParams.delete('start');
      }
      
      // Add the correct start parameter
      url.searchParams.append('start', currentPageStartParam);
      currentPageUrl = url.toString();
      
      // Navigate to the same page again
      await safeTabOperation(
        () => chrome.tabs.update(tabId, { url: currentPageUrl }),
        'Error reloading page'
      );
      
      // Wait for page to load
      await new Promise(r => {
        const timeout = setTimeout(r, 5000);
        activeTimeouts.push(timeout);
      });
      
      if (stopRequested) {
        throw new Error("Scraping stopped by user");
      }
      
      // Try finding profiles again
      const newProfiles = await findAllProfilesOnPage(tabId);
      
      // Use the set with more profiles
      if (newProfiles && newProfiles.length > profiles.length) {
        console.log(`Reload successful! Found ${newProfiles.length} profiles after reload (was ${profiles.length}).`);
        profiles = newProfiles;
      } else {
        console.log(`Reload did not find more profiles. Continuing with the ${profiles.length} profiles found initially.`);
      }
    }
    
    if (!profiles || profiles.length === 0) {
      updateStatus('No profiles found on this page.', isScrapingRunning);
      console.log('No profiles found on page ' + currentPageNumber);
      
      // Check if we should try the next page
      if (currentPageNumber < paginationSettings.endPage) {
        // Go to next page
        currentPageNumber++;
        const nextPageStartParam = (currentPageNumber - 1) * 25;
        
        // Update URL with new start parameter
        let nextPageUrl = currentJobUrl;
        const url = new URL(currentJobUrl);
        
        // Remove any existing start parameter
        if (url.searchParams.has('start')) {
          url.searchParams.delete('start');
        }
        
        // Add the correct start parameter
        url.searchParams.append('start', nextPageStartParam);
        nextPageUrl = url.toString();
        
        updateStatus(`Navigating to page ${currentPageNumber}...`);
        saveState();
        
        // Navigate to the next page
        await safeTabOperation(
          () => chrome.tabs.update(tabId, { url: nextPageUrl }),
          'Error navigating to next page'
        );
        
        // Wait for page to load
        await new Promise(r => {
          const timeout = setTimeout(r, 5000);
          activeTimeouts.push(timeout);
        });
        
        if (stopRequested) {
          throw new Error("Scraping stopped by user");
        }
        
        // Process the next page
        return processPage(tabId);
      } else {
        // Reached the end page limit
        updateStatus('Reached the end page limit. Scraping complete.', false);
        isScrapingRunning = false;
        saveState();
        
        // Close the tab
        try {
          await chrome.tabs.remove(tabId);
        } catch (e) {
          console.error("Error closing tab:", e);
        }
        mainTabId = null;
        
        return 0;
      }
    }
    
    // Step 1: Visit all profiles to ensure resumes are loaded
    await processProfiles(profiles, false);
    
    if (stopRequested) {
      throw new Error("Scraping stopped by user");
    }
    
    // Step 2: Visit all profiles again to download resumes
    await processProfiles(profiles, true);
    
    if (stopRequested) {
      throw new Error("Scraping stopped by user");
    }
    
    // Check if we reached the end page
    if (currentPageNumber >= paginationSettings.endPage) {
      updateStatus('Reached the end page limit. Scraping complete.', false);
      isScrapingRunning = false;
      saveState();
      
      // Close the tab
      try {
        await chrome.tabs.remove(tabId);
      } catch (e) {
        console.error("Error closing tab:", e);
      }
      mainTabId = null;
      
      return profiles.length;
    }
    
    // Continue to next page if not stopped
    if (shouldContinueScraping()) {
      // Go to next page
      currentPageNumber++;
      const nextPageStartParam = (currentPageNumber - 1) * 25;
      
      // Update URL with new start parameter
      let nextPageUrl = currentJobUrl;
      const url = new URL(currentJobUrl);
      
      // Remove any existing start parameter
      if (url.searchParams.has('start')) {
        url.searchParams.delete('start');
      }
      
      // Add the correct start parameter
      url.searchParams.append('start', nextPageStartParam);
      nextPageUrl = url.toString();
      
      updateStatus(`Navigating to page ${currentPageNumber}...`);
      saveState();
      
      // Navigate to the next page
      await safeTabOperation(
        () => chrome.tabs.update(tabId, { url: nextPageUrl }),
        'Error navigating to next page'
      );
      
      // Wait for page to load
      await new Promise(r => {
        const timeout = setTimeout(r, 5000);
        activeTimeouts.push(timeout);
      });
      
      if (stopRequested) {
        throw new Error("Scraping stopped by user");
      }
      
      // Process the next page
      return processPage(tabId);
    }
    
    return profiles.length;
  } catch (error) {
    console.error("Error in processPage:", error);
    
    if (error.message === "Scraping stopped by user") {
      updateStatus('Scraping stopped by user.', false);
    } else {
      updateStatus(`Error processing page: ${error.message}`, false);
    }
    
    isScrapingRunning = false;
    saveState();
    
    // Close the tab
    try {
      await chrome.tabs.remove(tabId);
    } catch (e) {
      console.error("Error closing tab:", e);
    }
    mainTabId = null;
    
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
async function startScraping(jobUrl, startPage = 1, endPage = 20) {
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
  currentPageNumber = startPage;
  mainTabId = null;
  
  // Calculate LinkedIn's start parameter for the first page
  // LinkedIn uses start=(page-1)*25 for pagination
  const firstPageStartParam = (startPage - 1) * 25;
  
  // Store pagination settings
  const paginationSettings = {
    startPage: startPage,
    endPage: endPage,
    currentStartParam: firstPageStartParam
  };
  
  updateStatus(`Starting LinkedIn scraper from page ${startPage} to ${endPage}...`);
  
  // Save pagination settings in state
  chrome.storage.local.set({
    paginationSettings: paginationSettings
  });
  
  saveState();
  
  try {
    // Check if URL already has a start parameter
    let urlToOpen = jobUrl;
    const url = new URL(jobUrl);
    
    // Remove any existing start parameter
    if (url.searchParams.has('start')) {
      url.searchParams.delete('start');
    }
    
    // Add the correct start parameter
    url.searchParams.append('start', firstPageStartParam);
    urlToOpen = url.toString();
    
    console.log(`Opening LinkedIn with URL: ${urlToOpen}`);
    
    // Create a new tab for LinkedIn
    const tab = await safeTabOperation(
      () => chrome.tabs.create({ url: urlToOpen, active: false }),
      "Failed to create LinkedIn tab"
    );
    
    if (!tab || !tab.id) {
      throw new Error("Could not create LinkedIn tab");
    }
    
    mainTabId = tab.id;
    saveState();
    
    // Wait for the page to fully load
    await new Promise(r => {
      const timeout = setTimeout(r, 5000);
      activeTimeouts.push(timeout);
    });
    
    if (stopRequested) {
      throw new Error("Scraping stopped by user");
    }
    
    // Start processing the first page
    await processPage(mainTabId);
    
  } catch (error) {
    console.error("Error in startScraping:", error);
    isScrapingRunning = false;
    updateStatus(`Error: ${error.message}`, false);
    saveState();
    
    // Close the tab if it exists
    if (mainTabId) {
      try {
        await chrome.tabs.remove(mainTabId);
      } catch (e) {
        console.error("Error closing tab:", e);
      }
      mainTabId = null;
    }
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

// Function to retry failed profiles
async function retryFailedProfiles() {
  if (isScrapingRunning) {
    console.log("Cannot retry failed profiles while scraping is in progress");
    return false;
  }
  
  if (!failedProfileUrls || failedProfileUrls.length === 0) {
    console.log("No failed profiles to retry");
    return false;
  }
  
  console.log(`Retrying ${failedProfileUrls.length} failed profiles`);
  
  // Set up state for retrying
  isScrapingRunning = true;
  stopRequested = false;
  let retrySuccess = 0;
  let retryFailed = 0;
  const profilesToRetry = [...failedProfileUrls]; // Clone the array
  
  // Clear the failed profiles list since we're retrying them
  failedProfileUrls = [];
  totalProfilesFailed = 0;
  
  updateStatus(
    `Retrying ${profilesToRetry.length} failed profiles...`, 
    true, 
    0, // currentPage
    0, // visited - we'll increment as we go
    totalProfilesDownloaded, // keep the overall count
    0, // failed - we'll increment as we go
    0  // progress
  );
  
  saveState();
  
  try {
    // Create a new tab for retrying
    const tab = await safeTabOperation(
      () => chrome.tabs.create({ url: currentJobUrl, active: false }),
      "Failed to create tab for retrying"
    );
    
    if (!tab || !tab.id) {
      throw new Error("Could not create tab for retrying");
    }
    
    mainTabId = tab.id;
    
    // Process each failed profile
    for (let i = 0; i < profilesToRetry.length; i++) {
      if (stopRequested) {
        console.log("Retry operation was stopped by user");
        break;
      }
      
      const profile = profilesToRetry[i];
      console.log(`Retrying profile: ${profile.name} (${i+1}/${profilesToRetry.length})`);
      
      // Update progress
      updateStatus(
        `Retrying profile ${i+1} of ${profilesToRetry.length}: ${profile.name}`,
        true,
        0, // currentPage
        totalProfilesVisited, // keep overall count
        totalProfilesDownloaded, // keep overall count
        totalProfilesFailed, // current failed count
        Math.floor((i / profilesToRetry.length) * 100) // progress
      );
      
      try {
        // Navigate to the profile
        await safeTabOperation(
          () => chrome.tabs.update(mainTabId, { url: profile.url }),
          "Failed to navigate to profile"
        );
        
        // Wait for page to load
        await new Promise(r => {
          const timeout = setTimeout(r, 3000);
          activeTimeouts.push(timeout);
        });
        
        if (stopRequested) break;
        
        // Attempt to find and click the download button
        const downloadSuccess = await safeTabOperation(async () => {
          return await chrome.scripting.executeScript({
            target: { tabId: mainTabId },
            function: () => {
              // Try multiple selectors for the resume download link
              const resumeSelectors = [
                '.hiring-resume-viewer__resume-wrapper--collapsed a[download]',
                '.resume-viewer-wrapper a[download]',
                'a[download][href*="resume"]',
                'a.hiring-resume-action-bar__download-btn[href*="resume"]',
                'a[href*="resume"][download]'
              ];
              
              for (const selector of resumeSelectors) {
                const downloadLink = document.querySelector(selector);
                if (downloadLink && downloadLink.href) {
                  console.log("Found download link:", downloadLink.href);
                  downloadLink.click();
                  return { success: true };
                }
              }
              
              return { success: false, error: "No download link found" };
            }
          });
        }, "Failed to execute download script");
        
        // Check if download was successful
        if (downloadSuccess && downloadSuccess[0] && downloadSuccess[0].result && downloadSuccess[0].result.success) {
          console.log(`Successfully downloaded resume for ${profile.name}`);
          retrySuccess++;
          totalProfilesDownloaded++; // Increment overall downloaded count
        } else {
          console.log(`Failed to download resume for ${profile.name}`);
          failedProfileUrls.push(profile); // Add back to failed list
          retryFailed++;
          totalProfilesFailed++; // Increment overall failed count
        }
        
        // Wait a bit between profiles
        await new Promise(r => {
          const timeout = setTimeout(r, 2000);
          activeTimeouts.push(timeout);
        });
        
      } catch (error) {
        console.error(`Error retrying profile ${profile.name}:`, error);
        failedProfileUrls.push(profile); // Add back to failed list
        retryFailed++;
        totalProfilesFailed++; // Increment overall failed count
      }
      
      // Save state after each profile to persist the updated lists
      saveState();
    }
    
    // Close the tab we created
    try {
      await chrome.tabs.remove(mainTabId);
    } catch (e) {
      console.error("Error closing tab:", e);
    }
    
    // Update final status
    isScrapingRunning = false;
    mainTabId = null;
    
    updateStatus(
      `Retry complete: ${retrySuccess} downloaded, ${retryFailed} failed`,
      false,
      0,
      totalProfilesVisited,
      totalProfilesDownloaded,
      totalProfilesFailed,
      100
    );
    
    saveState();
    return true;
    
  } catch (error) {
    console.error("Error in retryFailedProfiles:", error);
    
    // Update status with error
    isScrapingRunning = false;
    mainTabId = null;
    
    updateStatus(
      `Error retrying profiles: ${error.message}`,
      false,
      0,
      totalProfilesVisited,
      totalProfilesDownloaded,
      totalProfilesFailed,
      100
    );
    
    saveState();
    return false;
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping') {
    startScraping(message.jobUrl, parseInt(message.startPage) || 1, parseInt(message.endPage) || 20);
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
  } else if (message.action === 'retryFailedProfiles') {
    // Start the retry process and respond immediately
    retryFailedProfiles().then(success => {
      // This happens after the retry is complete, but we've already sent a response
      console.log("Retry completed with result:", success);
    }).catch(error => {
      console.error("Retry failed with error:", error);
    });
    
    // Let the popup know we've started the retry process
    sendResponse({success: true, message: "Started retrying failed profiles"});
  }
  return true;
}); 
