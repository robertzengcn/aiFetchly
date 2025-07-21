#!/bin/bash

# macOS uninstall script for aiFetchly application
# This script removes the application and all associated files

set -e

# Configuration
APP_NAME="aiFetchly"
BUNDLE_ID="com.aifetchly"
APP_BUNDLE="$APP_NAME.app"
INSTALL_DIR="/Applications"
APP_PATH="$INSTALL_DIR/$APP_BUNDLE"

# Function to remove application
remove_application() {
    echo "Removing application..."
    
    if [ -d "$APP_PATH" ]; then
        rm -rf "$APP_PATH"
        echo "Removed application from: $APP_PATH"
    else
        echo "Application not found at: $APP_PATH"
    fi
}

# Function to remove desktop alias
remove_desktop_alias() {
    echo "Removing desktop alias..."
    
    local desktop_path="$HOME/Desktop"
    local alias_path="$desktop_path/$APP_NAME"
    
    if [ -L "$alias_path" ]; then
        rm "$alias_path"
        echo "Removed desktop alias: $alias_path"
    else
        echo "Desktop alias not found: $alias_path"
    fi
}

# Function to remove dock icon
remove_dock_icon() {
    echo "Removing from dock..."
    
    # Remove from dock using defaults
    defaults delete com.apple.dock persistent-apps | grep -v "$APP_PATH" > /tmp/dock_apps.plist
    if [ -s /tmp/dock_apps.plist ]; then
        defaults write com.apple.dock persistent-apps -array < /tmp/dock_apps.plist
        killall Dock
        echo "Removed from dock"
    else
        echo "Not found in dock"
    fi
    rm -f /tmp/dock_apps.plist
}

# Function to remove user Applications folder alias
remove_user_applications_alias() {
    echo "Removing from user Applications folder..."
    
    local user_apps_path="$HOME/Applications"
    local user_app_path="$user_apps_path/$APP_BUNDLE"
    
    if [ -L "$user_app_path" ]; then
        rm "$user_app_path"
        echo "Removed user Applications alias: $user_app_path"
    else
        echo "User Applications alias not found: $user_app_path"
    fi
}

# Function to remove launch agent
remove_launch_agent() {
    echo "Removing launch agent..."
    
    local launch_agent_dir="$HOME/Library/LaunchAgents"
    local plist_file="$launch_agent_dir/com.aifetchly.plist"
    
    if [ -f "$plist_file" ]; then
        launchctl unload "$plist_file" 2>/dev/null || true
        rm "$plist_file"
        echo "Removed launch agent: $plist_file"
    else
        echo "Launch agent not found: $plist_file"
    fi
}

# Function to remove user data
remove_user_data() {
    echo "Removing user data..."
    
    # Remove application support data
    local app_support_path="$HOME/Library/Application Support/$APP_NAME"
    if [ -d "$app_support_path" ]; then
        rm -rf "$app_support_path"
        echo "Removed application support data: $app_support_path"
    fi
    
    # Remove preferences
    local preferences_path="$HOME/Library/Preferences/com.aifetchly.plist"
    if [ -f "$preferences_path" ]; then
        rm "$preferences_path"
        echo "Removed preferences: $preferences_path"
    fi
    
    # Remove caches
    local cache_path="$HOME/Library/Caches/$APP_NAME"
    if [ -d "$cache_path" ]; then
        rm -rf "$cache_path"
        echo "Removed caches: $cache_path"
    fi
    
    # Remove logs
    local logs_path="$HOME/Library/Logs/$APP_NAME"
    if [ -d "$logs_path" ]; then
        rm -rf "$logs_path"
        echo "Removed logs: $logs_path"
    fi
    
    # Remove saved application state
    local saved_state_path="$HOME/Library/Saved Application State/com.aifetchly.savedState"
    if [ -d "$saved_state_path" ]; then
        rm -rf "$saved_state_path"
        echo "Removed saved application state: $saved_state_path"
    fi
}

# Function to remove Spotlight index
remove_spotlight_index() {
    echo "Updating Spotlight index..."
    
    # Remove from Spotlight index
    mdimport -d "$APP_PATH" 2>/dev/null || true
    echo "Updated Spotlight index"
}

# Function to remove system-wide installation (if running as root)
remove_system_installation() {
    if [ "$EUID" -eq 0 ]; then
        echo "Removing system-wide installation..."
        
        # Remove from system Applications folder
        local system_app_path="/Applications/$APP_BUNDLE"
        if [ -d "$system_app_path" ]; then
            rm -rf "$system_app_path"
            echo "Removed system application: $system_app_path"
        fi
        
        # Remove system preferences
        local system_preferences_path="/Library/Preferences/com.aifetchly.plist"
        if [ -f "$system_preferences_path" ]; then
            rm "$system_preferences_path"
            echo "Removed system preferences: $system_preferences_path"
        fi
        
        # Remove system launch daemon
        local launch_daemon_path="/Library/LaunchDaemons/com.aifetchly.plist"
        if [ -f "$launch_daemon_path" ]; then
            launchctl unload "$launch_daemon_path" 2>/dev/null || true
            rm "$launch_daemon_path"
            echo "Removed system launch daemon: $launch_daemon_path"
        fi
    else
        echo "Note: System-wide removal requires sudo privileges"
    fi
}

# Function to clean up any remaining files
cleanup_remaining_files() {
    echo "Cleaning up remaining files..."
    
    # Remove any remaining .DS_Store files
    find "$HOME" -name ".DS_Store" -path "*$APP_NAME*" -delete 2>/dev/null || true
    
    # Remove any remaining temporary files
    find /tmp -name "*$APP_NAME*" -delete 2>/dev/null || true
    
    echo "Cleanup completed"
}

# Main uninstall function
main() {
    echo "Starting macOS uninstall for $APP_NAME..."
    
    # Check if application exists
    if [ ! -d "$APP_PATH" ] && [ ! -d "$HOME/Applications/$APP_BUNDLE" ]; then
        echo "Application not found in standard locations"
        echo "Checking for custom installation..."
    fi
    
    # Remove application
    remove_application
    
    # Remove shortcuts and aliases
    remove_desktop_alias
    remove_user_applications_alias
    
    # Remove dock icon (optional)
    # remove_dock_icon
    
    # Remove launch agent
    remove_launch_agent
    
    # Remove user data
    remove_user_data
    
    # Remove system-wide installation (if running as root)
    remove_system_installation
    
    # Update Spotlight index
    remove_spotlight_index
    
    # Clean up remaining files
    cleanup_remaining_files
    
    echo "Uninstall completed successfully!"
}

# Run main function
main "$@" 