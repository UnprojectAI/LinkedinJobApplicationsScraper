ICON FILES INSTRUCTIONS
====================

You need to replace the placeholder icon files with real PNG images:

- icon16.png (16x16 pixels)
- icon48.png (48x48 pixels)
- icon128.png (128x128 pixels)

You can generate these icons using one of these methods:

1. Use the create_icons.html file in the root directory:
   - Open this file in a browser
   - Follow the instructions to generate and download the icons
   - Save each icon to this folder with the correct name

2. Use the create_icons.sh script in the root directory (requires ImageMagick):
   - Make the script executable: `chmod +x create_icons.sh`
   - Run the script: `./create_icons.sh`
   - This will automatically generate all icon files

Without proper icon files, Chrome may display generic placeholders for your extension. 
