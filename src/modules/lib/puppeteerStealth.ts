import { Page } from "puppeteer";

/**
 * Puppeteer stealth-evasion utilities — extracted from lib/function.ts (R5.6).
 * All browser-fingerprint-spoofing code (webdriver flag removal, chrome
 * runtime mock, permissions query override, etc.).
 */
// This is where we'll put the code to get around the tests.
export async function evadeChromeHeadlessDetection(page: Page) {
  // Pass the Webdriver Test.
  await page.evaluateOnNewDocument(() => {
    // const newProto = navigator.__proto__;
    const newProto = Object.getPrototypeOf(navigator);
    delete newProto.webdriver;
    // navigator.__proto__ = newProto;
    Object.setPrototypeOf(navigator, newProto);
  });

  // Pass the Chrome Test.
  await page.evaluateOnNewDocument(() => {
    const mockObj = {
      app: {
        isInstalled: false,
      },
      webstore: {
        onInstallStageChanged: {},
        onDownloadProgress: {},
      },
      runtime: {
        PlatformOs: {
          MAC: "mac",
          WIN: "win",
          ANDROID: "android",
          CROS: "cros",
          LINUX: "linux",
          OPENBSD: "openbsd",
        },
        PlatformArch: {
          ARM: "arm",
          X86_32: "x86-32",
          X86_64: "x86-64",
        },
        PlatformNaclArch: {
          ARM: "arm",
          X86_32: "x86-32",
          X86_64: "x86-64",
        },
        RequestUpdateCheckStatus: {
          THROTTLED: "throttled",
          NO_UPDATE: "no_update",
          UPDATE_AVAILABLE: "update_available",
        },
        OnInstalledReason: {
          INSTALL: "install",
          UPDATE: "update",
          CHROME_UPDATE: "chrome_update",
          SHARED_MODULE_UPDATE: "shared_module_update",
        },
        OnRestartRequiredReason: {
          APP_UPDATE: "app_update",
          OS_UPDATE: "os_update",
          PERIODIC: "periodic",
        },
      },
    };
    (window as any).chrome = mockObj;
    (window.navigator as any).chrome = mockObj;
  });

  // Pass the Permissions Test.
  await page.evaluateOnNewDocument(() => {
    const originalQuery = window.navigator.permissions.query;
    Object.getPrototypeOf(window.navigator.permissions).query = (
      parameters: PermissionDescriptor
    ) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });

  // Pass the Plugins Length Test with realistic plugin data.
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const plugins = [
          {
            0: {
              type: "application/pdf",
              suffixes: "pdf",
              description: "Portable Document Format",
            },
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            length: 1,
            name: "Chrome PDF Plugin",
          },
          {
            0: {
              type: "application/x-google-chrome-pdf",
              suffixes: "pdf",
              description: "Portable Document Format",
            },
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            length: 1,
            name: "Chrome PDF Viewer",
          },
          {
            0: {
              type: "application/x-nacl",
              suffixes: "",
              description: "Native Client Executable",
            },
            1: {
              type: "application/x-pnacl",
              suffixes: "",
              description: "Portable Native Client Executable",
            },
            description: "",
            filename: "internal-nacl-plugin",
            length: 2,
            name: "Native Client",
          },
        ];
        return Object.assign(plugins, { length: plugins.length });
      },
    });
  });

  // Pass the Languages Test.
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
  });

  // Pass the iframe Test
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      get: function () {
        return window;
      },
    });
  });

  // Pass toString test, though it breaks console.debug() from working
  await page.evaluateOnNewDocument(() => {
    window.console.debug = () => {
      return null;
    };
  });

  // Fix WebGL vendor/renderer for headless Chrome detection
  await page.evaluateOnNewDocument(() => {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) {
        return "Google Inc. (NVIDIA)";
      }
      if (parameter === 37446) {
        return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0)";
      }
      return getParameter.call(this, parameter);
    };
  });

  // Override navigator.connection to look realistic
  await page.evaluateOnNewDocument(() => {
    if (!(navigator as any).connection) {
      Object.defineProperty(navigator, "connection", {
        get: () => ({
          effectiveType: "4g",
          rtt: 50,
          downlink: 10,
          saveData: false,
        }),
      });
    }
  });

  // Hide automation indicators on window
  await page.evaluateOnNewDocument(() => {
    // Remove Puppeteer/CDP markers
    delete (window as any).__puppeteer_evaluation_script__;
    // Override the CDP detection vector
    const originalError = Error.captureStackTrace;
    if (originalError) {
      Error.captureStackTrace = function (
        targetObject: object,
        constructorOpt?: (...args: unknown[]) => unknown
      ) {
        originalError.call(this, targetObject, constructorOpt);
        if ((targetObject as any).stack) {
          (targetObject as any).stack = (targetObject as any).stack.replace(
            /\n.*puppeteer.*\n/g,
            "\n"
          );
        }
      };
    }
  });
}
