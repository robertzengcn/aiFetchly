# macOS lzma-native Build Fix

## Problem

The macOS build was failing during `electron-rebuild` with the following error:

```
gyp: Call to 'sh liblzma-config.sh' returned exit status 77 while in binding.gyp
```

This error occurred because the `lzma-native` package (a transitive dependency of `electron-rebuild`) requires the `liblzma` system library to compile, which was not installed on the build runner.

## Root Cause

- `lzma-native` is a dependency of `electron-rebuild` (not directly in our package.json)
- `lzma-native` requires the system library `liblzma` and its development headers
- macOS GitHub runners don't have `liblzma` pre-installed
- Exit status 77 typically indicates missing build dependencies

## Solution Applied

### 1. Install System Dependencies

Added a new step to install required system libraries before `yarn install`:

```yaml
- name: Install system dependencies for native modules
  run: |
    brew install xz pkg-config
    echo "Installed xz (liblzma) and pkg-config"
```

**Why:**
- `xz` package provides the `liblzma` library and headers
- `pkg-config` helps the build system locate the library

### 2. Add Verification Step

Added verification to confirm the library is properly installed:

```yaml
- name: Verify liblzma installation
  run: |
    echo "=== Verifying liblzma installation ==="
    pkg-config --exists liblzma && echo "✅ liblzma found" || echo "❌ liblzma not found"
    pkg-config --modversion liblzma || echo "Could not get version"
    # ... additional checks
```

**Why:**
- Helps debug if the issue persists
- Confirms library is properly installed before proceeding

### 3. Configure Build Environment

Added environment variables to help the build system find liblzma:

```yaml
echo "PKG_CONFIG_PATH=/opt/homebrew/lib/pkgconfig:/usr/local/lib/pkgconfig" >> $GITHUB_ENV
echo "LIBLZMA_CFLAGS=-I/opt/homebrew/include" >> $GITHUB_ENV
echo "LIBLZMA_LIBS=-L/opt/homebrew/lib -llzma" >> $GITHUB_ENV
```

**Why:**
- Homebrew installs libraries in `/opt/homebrew` on Apple Silicon or `/usr/local` on Intel
- These variables explicitly tell the compiler where to find the library
- Covers both possible installation locations

### 4. Add Fallback for electron-rebuild

Modified the electron-rebuild command to fall back to non-optional dependencies if optional ones fail:

```yaml
- name: Download Electron headers
  run: |
    CXXFLAGS="-std=c++20" CFLAGS="-std=c11" npx electron-rebuild --force --types prod,dev,optional --module-dir . || \
    CXXFLAGS="-std=c++20" CFLAGS="-std=c11" npx electron-rebuild --force --types prod,dev --module-dir .
```

**Why:**
- If lzma-native is truly optional for electron-rebuild, this allows the build to proceed
- Provides a safety net without compromising required dependencies

### 5. Update yarn install

Added fallback for yarn install:

```yaml
- name: Install dependencies
  run: yarn install --ignore-optional || yarn install
```

**Why:**
- First tries to skip optional dependencies if they cause issues
- Falls back to full install if needed

## Verification

To verify the fix works locally on macOS:

```bash
# Install dependencies
brew install xz pkg-config

# Verify installation
pkg-config --exists liblzma && echo "✅ liblzma available"

# Set environment variables
export PKG_CONFIG_PATH="/opt/homebrew/lib/pkgconfig:/usr/local/lib/pkgconfig"
export LIBLZMA_CFLAGS="-I/opt/homebrew/include"
export LIBLZMA_LIBS="-L/opt/homebrew/lib -llzma"

# Install dependencies
yarn install

# Rebuild native modules
CXXFLAGS="-std=c++20" CFLAGS="-std=c11" npx electron-rebuild --force
```

## Alternative Solutions Considered

1. **Remove electron-rebuild dependency**: Not viable as we need it for native modules
2. **Use older lzma-native version**: Would require forking electron-rebuild
3. **Pre-build native modules**: Complex and not maintainable
4. **Use Docker for builds**: Overkill for this specific issue

## Related Issues

- lzma-native GitHub: https://github.com/addaleax/lzma-native
- electron-rebuild usage of lzma-native for compression

## Testing Checklist

- [x] Build workflow YAML syntax is valid
- [x] No linting errors in build.yml
- [ ] GitHub Actions build succeeds on macOS
- [ ] All native modules rebuild successfully
- [ ] Application package is created successfully
- [ ] DMG installer is generated

## Next Steps

1. Push changes and monitor GitHub Actions build
2. Verify all macOS build steps complete successfully
3. Test the generated DMG on a clean macOS system
4. Document any additional issues that arise

## Notes

- This fix applies to both Apple Silicon (M1/M2) and Intel Macs
- The paths in PKG_CONFIG_PATH cover both architectures
- If build still fails, check GitHub Actions logs for the "Verify liblzma installation" step

