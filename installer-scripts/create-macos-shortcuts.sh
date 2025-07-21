#!/bin/bash

# macOS shortcuts creation script for aiFetchly
# This script creates desktop shortcuts and launch agents

set -e

# Configuration
APP_NAME="aiFetchly"
BUNDLE_ID="com.aifetchly"
INSTALL_DIR="/Applications"
APP_PATH="$INSTALL_DIR/$APP_NAME.app"

# Function to create desktop alias
create_desktop_alias() {
    local desktop_path="$HOME/Desktop"
    local alias_path="$desktop_path/$APP_NAME"
    
    echo "Creating desktop alias..."
    
    # Remove existing alias if it exists
    if [ -L "$alias_path" ]; then
        rm "$alias_path"
    fi
    
    # Create alias using osascript
    osascript << EOF
tell application "Finder"
    make new alias file at POSIX file "$desktop_path" to POSIX file "$APP_PATH"
    set name of result to "$APP_NAME"
end tell
EOF
    
    echo "Desktop alias created: $alias_path"
}

# Function to create dock icon (optional)
create_dock_icon() {
    echo "Adding application to dock..."
    
    # Add to dock using defaults
    defaults write com.apple.dock persistent-apps -array-add "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>$APP_PATH</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>"
    
    # Restart dock to apply changes
    killall Dock
    
    echo "Application added to dock"
}

# Function to create application menu items
create_menu_items() {
    echo "Creating application menu items..."
    
    # Create Applications folder if it doesn't exist
    local apps_folder="$HOME/Applications"
    if [ ! -d "$apps_folder" ]; then
        mkdir -p "$apps_folder"
    fi
    
    # Create alias in user Applications folder
    local user_app_path="$apps_folder/$APP_NAME.app"
    
    # Remove existing alias if it exists
    if [ -L "$user_app_path" ]; then
        rm "$user_app_path"
    fi
    
    # Create alias
    ln -sf "$APP_PATH" "$user_app_path"
    
    echo "Menu items created"
}

# Function to set up Spotlight indexing
setup_spotlight() {
    echo "Setting up Spotlight indexing..."
    
    # Add application to Spotlight index
    mdutil -a on
    mdimport "$APP_PATH"
    
    echo "Spotlight indexing configured"
}

# Function to create launch agent for auto-start (optional)
create_launch_agent() {
    local launch_agent_dir="$HOME/Library/LaunchAgents"
    local plist_file="$launch_agent_dir/com.aifetchly.plist"
    
    echo "Creating launch agent for auto-start..."
    
    # Create LaunchAgents directory if it doesn't exist
    if [ ! -d "$launch_agent_dir" ]; then
        mkdir -p "$launch_agent_dir"
    fi
    
    # Create plist file for launch agent
    cat > "$plist_file" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aifetchly</string>
    <key>ProgramArguments</key>
    <array>
        <string>$APP_PATH/Contents/MacOS/$APP_NAME</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
EOF
    
    # Load the launch agent
    launchctl load "$plist_file"
    
    echo "Launch agent created: $plist_file"
}

# Main execution
main() {
    echo "Starting macOS installer script for $APP_NAME..."
    
    # Check if application exists
    if [ ! -d "$APP_PATH" ]; then
        echo "Error: Application not found at $APP_PATH"
        exit 1
    fi
    
    # Create shortcuts and menu items
    create_desktop_alias
    create_menu_items
    setup_spotlight
    
    # Optional: Add to dock (uncomment if desired)
    # create_dock_icon
    
    # Optional: Create launch agent for auto-start (uncomment if desired)
    # create_launch_agent
    
    echo "Installation completed successfully!"
}

# Run main function
main "$@" 