"use strict";
import { expect, test, describe, afterEach } from "vitest";
import puppeteer from "puppeteer";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Cluster } from "puppeteer-cluster";
import path from "path";
import os from "os";
import { CustomConcurrency } from "@/modules/concurrency-implementation";

/**
 * Manual stealth-detection lane. The detection tests below launch headful
 * (headless: false) browsers against the external site bot.sannysoft.com,
 * and one pauses for interactive stdin input — they can only run on a dev
 * machine with a display and network access, and are excluded from CI via
 * CI_UNSAFE_UTILITY_TESTS (vite.utilityCode.ci.config.mjs). Gating on
 * AIFETCHLY_STEALTH_LANE keeps the default suite (`yarn vitest-puppeteer`)
 * deterministic; the dedicated package.json scripts
 * (vitest-puppeteer-stealth / -regular / -cluster) opt in by setting it.
 */
const stealthLane = process.env.AIFETCHLY_STEALTH_LANE === "1";

test("start-puppeteer", { skip: !stealthLane }, async function () {
  (async () => {
    // Launch the browser and open a new blank page
    const browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--single-process", "--incognito"],
      devtools: true,
    });

    const page = await browser.newPage();
    await page.evaluate(() => {
      debugger;
    });
    // Navigate the page to a URL
    await page.goto("https://www.baidu.com");

    // Set screen size
    await page.setViewport({ width: 1080, height: 1024 });
    await browser.close();
  })();
});

describe("Puppeteer Stealth Tests", () => {
  let browser: any;

  afterEach(async () => {
    if (browser) {
      await browser.close();
    }
  });

  test(
    "Regular Puppeteer - Should be detected",
    { skip: !stealthLane, timeout: 500000 },
    async () => {
      browser = await puppeteer.launch({
        headless: false,
        args: [
          "--no-sandbox",
          // '--single-process',
          // '--incognito'
        ],
        //devtools: true
      });

      const page = await browser.newPage();
      try {
        await page.goto("https://bot.sannysoft.com/");

        // Wait for the page to load completely
        await page.waitForSelector("table");

        // Take screenshot before getting results
        await page.screenshot({
          path: path.join(
            os.homedir(),
            "tmp",
            "regular-puppeteer-detection.png"
          ),
          fullPage: true,
        });

        // Get the test results
        const results = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll("table tr"));
          return rows
            .map((row) => {
              const cells = row.querySelectorAll("td");
              if (cells.length >= 2) {
                return {
                  test: cells[0].textContent?.trim(),
                  result: cells[1].textContent?.trim(),
                };
              }
              return null;
            })
            .filter(Boolean);
        });

        // Check if WebDriver is detected
        const webdriverTest = results.find((r) =>
          r?.test?.includes("WebDriver")
        );
        expect(webdriverTest?.result).toContain("present");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      } finally {
        await page.close();
      }
    }
  );

  test(
    "Stealth Puppeteer - Should not be detected",
    { skip: !stealthLane, timeout: 500000 },
    async () => {
      const puppeteerExtra = addExtra(puppeteer);
      puppeteerExtra.use(StealthPlugin());

      browser = await puppeteerExtra.launch({
        headless: false,
        args: [
          "--no-sandbox",
          // '--single-process',
          // '--incognito'
        ],
        devtools: true,
      });

      const page = await browser.newPage();
      try {
        await page.goto("https://bot.sannysoft.com/");

        // Wait for the page to load completely
        await page.waitForSelector("table");

        // Wait for user interaction
        console.log(
          "Browser is open. Please handle the browser manually and press Enter in the console when done..."
        );
        await new Promise((resolve) => {
          process.stdin.once("data", () => {
            resolve(true);
          });
        });
        // Take screenshot before getting results
        await page.screenshot({
          path: path.join(
            os.homedir(),
            "tmp",
            "stealth-puppeteer-detection.png"
          ),
          fullPage: true,
        });

        // Get the test results
        const results = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll("table tr"));
          return rows
            .map((row) => {
              const cells = row.querySelectorAll("td");
              if (cells.length >= 2) {
                return {
                  test: cells[0].textContent?.trim(),
                  result: cells[1].textContent?.trim(),
                };
              }
              return null;
            })
            .filter(Boolean);
        });

        // Check if WebDriver is detected
        const webdriverTest = results.find((r) =>
          r?.test?.includes("WebDriver")
        );
        expect(webdriverTest?.result).not.toContain("present");

        // Additional checks for other detection methods
        const chromeTest = results.find((r) => r?.test?.includes("Chrome"));
        expect(chromeTest?.result).not.toContain("missing");

        const pluginsTest = results.find((r) =>
          r?.test?.includes("Plugins Length")
        );
        expect(pluginsTest?.result).not.toContain("0");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      } finally {
        await page.close();
      }
    }
  );
});

describe("Puppeteer Cluster Tests", () => {
  let cluster: any;

  afterEach(async () => {
    if (cluster) {
      await cluster.close();
    }
  });

  test(
    "Cluster with Stealth Plugin - Should not be detected",
    { skip: !stealthLane, timeout: 5000000 },
    async () => {
      const puppeteerExtra = addExtra(puppeteer);
      puppeteerExtra.use(StealthPlugin());

      cluster = await Cluster.launch({
        concurrency: CustomConcurrency,
        maxConcurrency: 1,
        puppeteerOptions: {
          headless: false,
          args: ["--no-sandbox"],
          devtools: true,
        },
        puppeteer: puppeteerExtra,
        timeout: 30000,
        retryLimit: 3,
        retryDelay: 5000,
        monitor: true,
      });

      await cluster.task(async ({ page, data: url }) => {
        try {
          await page.goto(url);

          // Wait for the page to load completely
          await page.waitForSelector("table");

          // Take screenshot
          await page.screenshot({
            path: path.join(
              os.homedir(),
              "tmp",
              "cluster-stealth-detection.png"
            ),
            fullPage: true,
          });

          // Get the test results
          const results = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("table tr"));
            return rows
              .map((row) => {
                const cells = row.querySelectorAll("td");
                if (cells.length >= 2) {
                  return {
                    test: cells[0].textContent?.trim(),
                    result: cells[1].textContent?.trim(),
                  };
                }
                return null;
              })
              .filter(Boolean);
          });

          // Check if WebDriver is detected
          const webdriverTest = results.find((r) =>
            r?.test?.includes("WebDriver")
          );
          expect(webdriverTest?.result).not.toContain("present");

          // Additional checks for other detection methods
          const chromeTest = results.find((r) => r?.test?.includes("Chrome"));
          expect(chromeTest?.result).not.toContain("missing");

          const pluginsTest = results.find((r) =>
            r?.test?.includes("Plugins Length")
          );
          expect(pluginsTest?.result).not.toContain("0");
        } catch (error) {
          console.error("Test failed:", error);
          throw error;
        }
      });

      cluster.on("taskerror", (err, data, willRetry) => {
        // if (willRetry) {
        //     console.warn(`Encountered an error while crawling ${data}. ${err.message}\nThis job will be retried`);
        // } else {
        console.error(`Failed to crawl ${data}: ${err.message}`);
        // }
      });

      // Queue the task
      await cluster.queue("https://bot.sannysoft.com/");
      await cluster.idle();
      await cluster.close();
    }
  );
});
