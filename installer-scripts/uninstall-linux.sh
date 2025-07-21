#!/bin/bash

# Linux uninstall script for aiFetchly application
# This script removes the application and all associated files

set -e

# Default values
APP_NAME="aiFetchly"
APP_EXEC="aifetchly"
INSTALL_DIR="/opt/aifetchly"
DESKTOP_FILE_NAME="aifetchly.desktop"

# Function to remove application files
remove_application_files() {
    echo "Removing application files..."
    
    if [ -d "$INSTALL_DIR" ]; then
        rm -rf "$INSTALL_DIR"
        echo "Removed application files from: $INSTALL_DIR"
    else
        echo "Application directory not found: $INSTALL_DIR"
    fi
}

# Function to remove desktop file
remove_desktop_file() {
    echo "Removing desktop file..."
    
    # Remove user desktop file
    local user_desktop_dir="$HOME/.local/share/applications"
    local user_desktop_file="$user_desktop_dir/$DESKTOP_FILE_NAME"
    
    if [ -f "$user_desktop_file" ]; then
        rm "$user_desktop_file"
        echo "Removed user desktop file: $user_desktop_file"
    fi
    
    # Remove system desktop file (if running as root)
    if [ "$EUID" -eq 0 ]; then
        local system_desktop_dir="/usr/share/applications"
        local system_desktop_file="$system_desktop_dir/$DESKTOP_FILE_NAME"
        
        if [ -f "$system_desktop_file" ]; then
            rm "$system_desktop_file"
            echo "Removed system desktop file: $system_desktop_file"
        fi
    else
        echo "Note: System desktop file removal requires sudo privileges"
    fi
}

# Function to remove desktop shortcut
remove_desktop_shortcut() {
    echo "Removing desktop shortcut..."
    
    local desktop_path="$HOME/Desktop"
    local shortcut_file="$desktop_path/$APP_NAME.desktop"
    
    if [ -f "$shortcut_file" ]; then
        rm "$shortcut_file"
        echo "Removed desktop shortcut: $shortcut_file"
    else
        echo "Desktop shortcut not found: $shortcut_file"
    fi
}

# Function to remove menu categories
remove_menu_categories() {
    echo "Removing menu categories..."
    
    local menu_dir="$HOME/.config/menus/applications-merged"
    local menu_file="$menu_dir/aifetchly.menu"
    
    if [ -f "$menu_file" ]; then
        rm "$menu_file"
        echo "Removed menu file: $menu_file"
    fi
    
    # Remove empty menu directory
    if [ -d "$menu_dir" ] && [ -z "$(ls -A $menu_dir)" ]; then
        rmdir "$menu_dir"
        echo "Removed empty menu directory: $menu_dir"
    fi
}

# Function to remove MIME types
remove_mime_types() {
    echo "Removing MIME types..."
    
    local mime_dir="$HOME/.local/share/mime/packages"
    local mime_file="$mime_dir/aifetchly.xml"
    
    if [ -f "$mime_file" ]; then
        rm "$mime_file"
        echo "Removed MIME type file: $mime_file"
        
        # Update MIME database
        if command -v update-mime-database >/dev/null 2>&1; then
            update-mime-database "$HOME/.local/share/mime"
            echo "Updated MIME database"
        fi
    fi
}

# Function to remove autostart entry
remove_autostart_entry() {
    echo "Removing autostart entry..."
    
    local autostart_dir="$HOME/.config/autostart"
    local autostart_file="$autostart_dir/$DESKTOP_FILE_NAME"
    
    if [ -f "$autostart_file" ]; then
        rm "$autostart_file"
        echo "Removed autostart entry: $autostart_file"
    fi
    
    # Remove empty autostart directory
    if [ -d "$autostart_dir" ] && [ -z "$(ls -A $autostart_dir)" ]; then
        rmdir "$autostart_dir"
        echo "Removed empty autostart directory: $autostart_dir"
    fi
}

# Function to remove user data
remove_user_data() {
    echo "Removing user data..."
    
    # Remove application data
    local app_data_dir="$HOME/.local/share/$APP_NAME"
    if [ -d "$app_data_dir" ]; then
        rm -rf "$app_data_dir"
        echo "Removed application data: $app_data_dir"
    fi
    
    # Remove configuration
    local config_dir="$HOME/.config/$APP_NAME"
    if [ -d "$config_dir" ]; then
        rm -rf "$config_dir"
        echo "Removed configuration: $config_dir"
    fi
    
    # Remove cache
    local cache_dir="$HOME/.cache/$APP_NAME"
    if [ -d "$cache_dir" ]; then
        rm -rf "$cache_dir"
        echo "Removed cache: $cache_dir"
    fi
    
    # Remove logs
    local logs_dir="$HOME/.local/share/$APP_NAME/logs"
    if [ -d "$logs_dir" ]; then
        rm -rf "$logs_dir"
        echo "Removed logs: $logs_dir"
    fi
}

# Function to remove system-wide installation (if running as root)
remove_system_installation() {
    if [ "$EUID" -eq 0 ]; then
        echo "Removing system-wide installation..."
        
        # Remove from system directories
        local system_locations=(
            "/usr/local/bin/$APP_EXEC"
            "/usr/bin/$APP_EXEC"
            "/opt/$APP_NAME"
            "/usr/local/share/$APP_NAME"
            "/usr/share/$APP_NAME"
        )
        
        for location in "${system_locations[@]}"; do
            if [ -e "$location" ]; then
                rm -rf "$location"
                echo "Removed system location: $location"
            fi
        done
        
        # Remove system desktop file
        local system_desktop_file="/usr/share/applications/$DESKTOP_FILE_NAME"
        if [ -f "$system_desktop_file" ]; then
            rm "$system_desktop_file"
            echo "Removed system desktop file: $system_desktop_file"
        fi
        
        # Remove system MIME types
        local system_mime_file="/usr/share/mime/packages/aifetchly.xml"
        if [ -f "$system_mime_file" ]; then
            rm "$system_mime_file"
            echo "Removed system MIME file: $system_mime_file"
            
            # Update system MIME database
            if command -v update-mime-database >/dev/null 2>&1; then
                update-mime-database /usr/share/mime
                echo "Updated system MIME database"
            fi
        fi
        
        # Remove system menu
        local system_menu_file="/usr/share/applications-merged/aifetchly.menu"
        if [ -f "$system_menu_file" ]; then
            rm "$system_menu_file"
            echo "Removed system menu file: $system_menu_file"
        fi
        
    else
        echo "Note: System-wide removal requires sudo privileges"
    fi
}

# Function to update desktop database
update_desktop_database() {
    echo "Updating desktop database..."
    
    # Update user desktop database
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$HOME/.local/share/applications"
        echo "Updated user desktop database"
    fi
    
    # Update system desktop database (if running as root)
    if [ "$EUID" -eq 0 ] && command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database /usr/share/applications
        echo "Updated system desktop database"
    fi
}

# Function to remove package manager entries
remove_package_entries() {
    echo "Removing package manager entries..."
    
    # For DEB-based systems
    if command -v dpkg >/dev/null 2>&1; then
        if dpkg -l | grep -q "$APP_NAME"; then
            echo "Found package manager entry for $APP_NAME"
            echo "Please run: sudo apt remove $APP_NAME"
        fi
    fi
    
    # For RPM-based systems
    if command -v rpm >/dev/null 2>&1; then
        if rpm -qa | grep -q "$APP_NAME"; then
            echo "Found package manager entry for $APP_NAME"
            echo "Please run: sudo yum remove $APP_NAME"
        fi
    fi
}

# Function to clean up remaining files
cleanup_remaining_files() {
    echo "Cleaning up remaining files..."
    
    # Remove any remaining temporary files
    find /tmp -name "*$APP_NAME*" -delete 2>/dev/null || true
    
    # Remove any remaining cache files
    find "$HOME/.cache" -name "*$APP_NAME*" -delete 2>/dev/null || true
    
    # Remove any remaining configuration files
    find "$HOME/.config" -name "*$APP_NAME*" -delete 2>/dev/null || true
    
    echo "Cleanup completed"
}

# Function to check for running instances
check_running_instances() {
    echo "Checking for running instances..."
    
    if pgrep -f "$APP_NAME" >/dev/null 2>&1; then
        echo "Warning: $APP_NAME is currently running"
        echo "Please close the application before uninstalling"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Uninstall cancelled"
            exit 1
        fi
    else
        echo "No running instances found"
    fi
}

# Main uninstall function
main() {
    echo "Starting Linux uninstall for $APP_NAME..."
    
    # Check for running instances
    check_running_instances
    
    # Remove application files
    remove_application_files
    
    # Remove shortcuts and menu entries
    remove_desktop_file
    remove_desktop_shortcut
    remove_menu_categories
    
    # Remove MIME types
    remove_mime_types
    
    # Remove autostart entry
    remove_autostart_entry
    
    # Remove user data
    remove_user_data
    
    # Remove system-wide installation (if running as root)
    remove_system_installation
    
    # Update desktop database
    update_desktop_database
    
    # Check for package manager entries
    remove_package_entries
    
    # Clean up remaining files
    cleanup_remaining_files
    
    echo "Uninstall completed successfully!"
}

# Run main function
main "$@" 