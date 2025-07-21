#!/bin/bash

# Linux shortcuts creation script for aiFetchly
# This script creates desktop shortcuts and menu items

set -e

# Default values
APP_NAME="aiFetchly"
APP_EXEC="aifetchly"
INSTALL_DIR="/opt/aifetchly"
DESKTOP_FILE_NAME="aifetchly.desktop"

# Function to create desktop file
create_desktop_file() {
    local desktop_dir="$HOME/.local/share/applications"
    local desktop_file="$desktop_dir/$DESKTOP_FILE_NAME"
    
    echo "Creating desktop file..."
    
    # Create applications directory if it doesn't exist
    if [ ! -d "$desktop_dir" ]; then
        mkdir -p "$desktop_dir"
    fi
    
    # Create desktop file
    cat > "$desktop_file" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=$APP_NAME
Comment=aiFetchly Application
Exec=$INSTALL_DIR/$APP_EXEC
Icon=$INSTALL_DIR/icon.png
Terminal=false
Categories=Utility;Network;Web;Office;
Keywords=social;marketing;automation;
StartupWMClass=$APP_NAME
EOF
    
    # Make desktop file executable
    chmod +x "$desktop_file"
    
    echo "Desktop file created: $desktop_file"
}

# Function to create desktop shortcut
create_desktop_shortcut() {
    local desktop_path="$HOME/Desktop"
    local shortcut_file="$desktop_path/$APP_NAME.desktop"
    
    echo "Creating desktop shortcut..."
    
    # Create Desktop directory if it doesn't exist
    if [ ! -d "$desktop_path" ]; then
        mkdir -p "$desktop_path"
    fi
    
    # Copy desktop file to desktop
    cp "$HOME/.local/share/applications/$DESKTOP_FILE_NAME" "$shortcut_file"
    
    # Make shortcut executable
    chmod +x "$shortcut_file"
    
    echo "Desktop shortcut created: $shortcut_file"
}

# Function to create system-wide desktop file (requires sudo)
create_system_desktop_file() {
    local system_desktop_dir="/usr/share/applications"
    local system_desktop_file="$system_desktop_dir/$DESKTOP_FILE_NAME"
    
    echo "Creating system-wide desktop file..."
    
    # Check if running as root
    if [ "$EUID" -eq 0 ]; then
        cat > "$system_desktop_file" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=$APP_NAME
Comment=aiFetchly Application
Exec=$INSTALL_DIR/$APP_EXEC
Icon=$INSTALL_DIR/icon.png
Terminal=false
Categories=Utility;Network;Web;Office;
Keywords=social;marketing;automation;
StartupWMClass=$APP_NAME
EOF
        
        chmod +x "$system_desktop_file"
        echo "System-wide desktop file created: $system_desktop_file"
    else
        echo "Note: System-wide desktop file requires sudo privileges"
    fi
}

# Function to update desktop database
update_desktop_database() {
    echo "Updating desktop database..."
    
    # Update user desktop database
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$HOME/.local/share/applications"
    fi
    
    # Update system desktop database (requires sudo)
    if [ "$EUID" -eq 0 ] && command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database /usr/share/applications
    fi
    
    echo "Desktop database updated"
}

# Function to create menu categories
create_menu_categories() {
    echo "Creating menu categories..."
    
    # Create custom menu directory
    local menu_dir="$HOME/.config/menus/applications-merged"
    if [ ! -d "$menu_dir" ]; then
        mkdir -p "$menu_dir"
    fi
    
    # Create custom menu file
    local menu_file="$menu_dir/aifetchly.menu"
    cat > "$menu_file" << EOF
<!DOCTYPE Menu PUBLIC "-//freedesktop//DTD Menu 1.0//EN"
 "http://www.freedesktop.org/standards/menu-spec/1.0/menu.dtd">
<Menu>
  <Name>Applications</Name>
  <Menu>
    <Name>aiFetchly</Name>
    <Include>
      <Filename>$DESKTOP_FILE_NAME</Filename>
    </Include>
  </Menu>
</Menu>
EOF
    
    echo "Menu categories created"
}

# Function to set up MIME types (optional)
setup_mime_types() {
    echo "Setting up MIME types..."
    
    local mime_dir="$HOME/.local/share/mime/packages"
    if [ ! -d "$mime_dir" ]; then
        mkdir -p "$mime_dir"
    fi
    
    # Create MIME type file
    local mime_file="$mime_dir/aifetchly.xml"
    cat > "$mime_file" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-aifetchly">
    <comment>aiFetchly Project</comment>
    <glob pattern="*.smproj"/>
  </mime-type>
</mime-info>
EOF
    
    # Update MIME database
    if command -v update-mime-database >/dev/null 2>&1; then
        update-mime-database "$HOME/.local/share/mime"
    fi
    
    echo "MIME types configured"
}

# Function to create autostart entry (optional)
create_autostart_entry() {
    local autostart_dir="$HOME/.config/autostart"
    local autostart_file="$autostart_dir/$DESKTOP_FILE_NAME"
    
    echo "Creating autostart entry..."
    
    # Create autostart directory if it doesn't exist
    if [ ! -d "$autostart_dir" ]; then
        mkdir -p "$autostart_dir"
    fi
    
    # Copy desktop file to autostart
    cp "$HOME/.local/share/applications/$DESKTOP_FILE_NAME" "$autostart_file"
    
    echo "Autostart entry created: $autostart_file"
}

# Function to install dependencies
install_dependencies() {
    echo "Checking and installing dependencies..."
    
    # List of required packages
    local packages=(
        "libgtk-3-0"
        "libnotify4"
        "libnss3"
        "libxss1"
        "libxtst6"
        "xdg-utils"
        "libatspi2.0-0"
        "libdrm2"
        "libxkbcommon0"
        "libxcomposite1"
        "libxdamage1"
        "libxfixes3"
        "libxrandr2"
        "libgbm1"
        "libasound2"
    )
    
    # Detect package manager
    if command -v apt-get >/dev/null 2>&1; then
        # Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y "${packages[@]}"
    elif command -v yum >/dev/null 2>&1; then
        # CentOS/RHEL/Fedora
        sudo yum install -y "${packages[@]}"
    elif command -v dnf >/dev/null 2>&1; then
        # Fedora (newer versions)
        sudo dnf install -y "${packages[@]}"
    elif command -v pacman >/dev/null 2>&1; then
        # Arch Linux
        sudo pacman -S --noconfirm "${packages[@]}"
    else
        echo "Warning: Could not detect package manager. Please install dependencies manually."
    fi
    
    echo "Dependencies installation completed"
}

# Main execution
main() {
    echo "Starting Linux installer script for $APP_NAME..."
    
    # Check if application exists
    if [ ! -f "$INSTALL_DIR/$APP_EXEC" ]; then
        echo "Error: Application not found at $INSTALL_DIR/$APP_EXEC"
        exit 1
    fi
    
    # Install dependencies
    install_dependencies
    
    # Create shortcuts and menu entries
    create_desktop_file
    create_desktop_shortcut
    create_system_desktop_file
    create_menu_categories
    update_desktop_database
    
    # Optional: Set up MIME types (uncomment if desired)
    # setup_mime_types
    
    # Optional: Create autostart entry (uncomment if desired)
    # create_autostart_entry
    
    echo "Installation completed successfully!"
}

# Run main function
main "$@" 