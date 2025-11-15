# macOS lzma-native Build Fix

## Problem

The macOS build was failing during `electron-rebuild` with the following error:

```
gyp: Call to 'sh liblzma-config.sh' returned exit status 77 while in binding.gyp
```

This error occurred because the `lzma-native` package (a transitive dependency of `electron-rebuild`) requires the `liblzma` system library to compile **and** needs to be built for the correct target architecture. Without the system library and explicit architecture settings, the build fails with exit status 77.

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

Added environment variables to help the build system find liblzma and apply the correct architecture flags:

```yaml
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  TARGET_ARCH="arm64"
  ARCH_FLAGS="-arch arm64"
  HOMEBREW_PREFIX="/opt/homebrew"
else
  TARGET_ARCH="x86_64"
  ARCH_FLAGS="-arch x86_64"
  HOMEBREW_PREFIX="/usr/local"
fi
echo "TARGET_ARCH=${TARGET_ARCH}" >> $GITHUB_ENV
echo "ARCH_FLAGS=${ARCH_FLAGS}" >> $GITHUB_ENV
echo "PKG_CONFIG_PATH=/opt/homebrew/lib/pkgconfig:/usr/local/lib/pkgconfig" >> $GITHUB_ENV
echo "LIBLZMA_CFLAGS=-I${HOMEBREW_PREFIX}/include" >> $GITHUB_ENV
echo "LIBLZMA_LIBS=-L${HOMEBREW_PREFIX}/lib -llzma" >> $GITHUB_ENV
```

**Why:**
- Homebrew installs libraries in `/opt/homebrew` on Apple Silicon or `/usr/local` on Intel
- The script now detects the host architecture and sets `TARGET_ARCH`, `ARCH_FLAGS`, and `HOMEBREW_PREFIX` accordingly
- These variables explicitly tell the compiler where to find the library and which architecture to target

### 4. Add Fallback for electron-rebuild

Modified the electron-rebuild command to always respect the detected architecture and provide an optional fallback build:

```yaml
- name: Download Electron headers
  run: |
    TARGET_ARCH="${TARGET_ARCH:-$(uname -m)}"
    CXXFLAGS="-std=c++20" CFLAGS="-std=c11" npx electron-rebuild --force --arch="${TARGET_ARCH}" --types prod,dev,optional --module-dir . || \
    CXXFLAGS="-std=c++20" CFLAGS="-std=c11" npx electron-rebuild --force --arch="${TARGET_ARCH}" --types prod,dev --module-dir .
```

**Why:**
- Ensures the rebuild always targets the correct architecture (arm64 on Apple Silicon, x86_64 on Intel)
- Keeps the fallback in place for optional packages while respecting architecture flags

### 5. Update yarn install

Ensured optional dependencies are always installed:

```yaml
- name: Install dependencies
  run: yarn install
```

**Why:**
- Optional dependencies (including `lzma-native`) are required for the rebuild, so we now always install them
- Removes variability introduced by `--ignore-optional`

### 6. Add Post-install Verification

Added a sanity check to confirm the bundled `xz` source tarball is present before rebuilding:

```yaml
- name: Debug - Verify lzma-native assets
  run: |
    if [ -d node_modules/lzma-native/deps ]; then
      echo "Found lzma-native deps directory"
      ls -la node_modules/lzma-native/deps
      ls -la node_modules/lzma-native/deps | grep xz- || true
    else
      echo "lzma-native deps directory not found"
    fi
```

**Why:**
- Confirms the `xz-5.2.3.tar.bz2` tarball is available before the build step runs
- Provides immediate diagnostics if `lzma-native` fails to install for any reason

## Verification

To verify the fix works locally on macOS:

```bash
# Install dependencies
brew install xz pkg-config

# Verify installation
pkg-config --exists liblzma && echo "✅ liblzma available"

# Set environment variables
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  TARGET_ARCH="arm64"
  ARCH_FLAGS="-arch arm64"
  HOMEBREW_PREFIX="/opt/homebrew"
else
  TARGET_ARCH="x86_64"
  ARCH_FLAGS="-arch x86_64"
  HOMEBREW_PREFIX="/usr/local"
fi
export PKG_CONFIG_PATH="/opt/homebrew/lib/pkgconfig:/usr/local/lib/pkgconfig"
export LIBLZMA_CFLAGS="-I${HOMEBREW_PREFIX}/include"
export LIBLZMA_LIBS="-L${HOMEBREW_PREFIX}/lib -llzma"
export CXXFLAGS="-std=c++20 ${ARCH_FLAGS}"
export CFLAGS="-std=c11 ${ARCH_FLAGS}"
export LDFLAGS="-std=c++20 ${ARCH_FLAGS}"
export npm_config_arch="${TARGET_ARCH}"
export npm_config_target_arch="${TARGET_ARCH}"

# Install dependencies
yarn install

# Rebuild native modules
npx electron-rebuild --force --arch="${TARGET_ARCH}"
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

