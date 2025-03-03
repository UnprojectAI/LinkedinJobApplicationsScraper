# LinkedIn Job Applications Scraper Chrome Extension

This Chrome extension automates the process of downloading resumes from LinkedIn job applications. It navigates through the job applications page, opens each candidate profile, and downloads their resume.

## Installation

1. Download or clone this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" using the toggle in the top-right corner.
4. Click "Load unpacked" and select the directory containing this extension.
5. The LinkedIn Job Applications Scraper extension should now appear in your extensions list.

## Usage

1. Navigate to your LinkedIn job applications page (e.g., https://www.linkedin.com/hiring/jobs/12345678/applicants/)
2. Click on the extension icon in your browser toolbar.
3. Click "Start Scraping" in the popup.
4. The extension will:
   - Navigate through each page of job applications
   - First open each profile to ensure the resume is loaded
   - Then revisit each profile to download the resume
   - Automatically save resumes to your default Chrome download location
5. Progress information will be displayed in the popup.

## Key Features

- **Background Operation**: The scraping continues running even when you close the popup
- **State Persistence**: If you reopen the extension, it will show the current progress
- **Error Handling**: The extension automatically retries operations when tab errors occur
- **Automatic Resume**: If your browser closes, the extension will resume from where it left off
- **Stop Capability**: You can stop the scraping process at any time
- **Detailed Tracking**: Separate counts for visited, downloaded, and failed profiles
- **Failed Profiles List**: Hover over the "Failed" count to see profiles where download failed
- **Quick Access**: Click on any failed profile to open it directly in a new tab

## Notes

- You need to be logged into LinkedIn for this extension to work.
- The extension will automatically download resumes to your default Chrome download folder.
- No download dialog boxes will appear - files are saved automatically.
- The extension processes one page at a time, visiting each profile twice (once to load the resume, once to download it).
- You can continue browsing in other windows while the scraping runs in the background.
- If you encounter any issues, try refreshing the page and restarting the scraper.
- The extension is robust against browser tab interactions - it will retry operations if they fail.
- Hover over the "Failed" count to see a list of profiles that failed to download - you can click them to open manually.

## Privacy and Security

This extension operates locally on your machine and does not send any data to external servers. Your LinkedIn credentials and job applications information remain private.

## Legal Considerations

This tool is provided for educational purposes only. Please ensure you are complying with LinkedIn's terms of service when using this extension. 
