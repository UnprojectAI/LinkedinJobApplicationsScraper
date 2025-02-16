import os
import time
import sys
import subprocess
import logging
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager
import argparse

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def ensure_required_packages_installed():
    """Ensure all required packages are installed."""
    required_libraries = ["selenium", "webdriver-manager", "requests"]
    for package in required_libraries:
        try:
            __import__(package)
        except ImportError:
            logging.info(f"Installing missing package: {package}...")
            subprocess.run([sys.executable, "-m", "pip", "install", package], check=True)

def setup_chrome_options(download_dir):
    """Set up Chrome options for the WebDriver."""
    # Set up Chrome options
    chrome_options = Options()
    chrome_options.add_argument("--start-maximized")
    chrome_options.add_argument("--disable-backgrounding-occluded-windows")  # Prevents stealing focus
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
    chrome_options.add_experimental_option("useAutomationExtension", False)
    chrome_options.add_experimental_option("prefs", {
        "download.default_directory": os.path.abspath(download_dir),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True
    })
    return chrome_options

def download_all_profiles_for_single_page(driver, download_resume=False, sleep_time=10):
    """Download all profiles for a single page."""
    original_window = driver.current_window_handle
    profile_elements = driver.find_elements(By.CSS_SELECTOR, ".hiring-applicants__list-item")
    if not profile_elements:
        logging.info("No profiles found on the page.")
        return 0

    profile_count = 0
    for profile in profile_elements:
        try:
            element = profile.find_element(By.TAG_NAME, "a")
            applicant_link = element.get_attribute("href")
            driver.execute_script(f"window.open('{applicant_link}', '_blank');")
            time.sleep(sleep_time)
            driver.switch_to.window(driver.window_handles[-1])
            if download_resume:
                try:
                    resume = driver.find_elements(By.CSS_SELECTOR, ".hiring-resume-viewer__resume-wrapper--collapsed")
                    anchor_tag = resume[0].find_element(By.TAG_NAME, "a")
                    pdf_url = anchor_tag.get_attribute("href")
                    driver.get(pdf_url)
                except Exception as e:
                    print("⚠️ Resume download link not found:", e)
            driver.close()
            driver.switch_to.window(original_window)
            profile_count += 1

        except Exception as e:
            print(f"⚠️ Error processing profile: {e}")

    driver.switch_to.window(original_window)
    return profile_count

def main():
    # Parse command-line arguments
    parser = argparse.ArgumentParser(description='Download resumes from job applications.')
    parser.add_argument('job_application_url', type=str, help='The URL of the job application page.')
    parser.add_argument('--download_dir', type=str, default=os.path.join(os.path.expanduser("~"), "Downloads"),
                        help='The directory to download resumes to. Defaults to the Downloads folder.')
    args = parser.parse_args()

    job_application_url = args.job_application_url
    download_dir = args.download_dir
    time_to_login = 60
    time_to_load_profile = 2
    time_to_download_profile = 5

    os.makedirs(download_dir, exist_ok=True)
    
    # Path to ChromeDriver (Automatically managed by WebDriver Manager)
    chrome_options = setup_chrome_options(download_dir)
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)

    try:
        logging.info(f"Opening job application URL: {job_application_url}")
        driver.get(job_application_url)
        time.sleep(time_to_login)

        count = 0
        while True:
            page_url = f"{job_application_url}?start={count}"
            logging.info(f"Loading page URL: {page_url}")
            driver.get(page_url)
            time.sleep(time_to_load_profile)
            download_all_profiles_for_single_page(driver, False, time_to_load_profile)
            download_all_profiles_for_single_page(driver, True, time_to_download_profile)

            count += 25
    finally:
        logging.info("Closing the browser.")
        driver.quit()

if __name__ == "__main__":
    main()
