import cheerio from "cheerio";
import { Page } from "puppeteer";

// module.exports = {
//     get_ip_data: get_ip_data,
//     get_http_headers: get_http_headers,
// };

export async function get_ip_data(page: Page) {
  await page.goto("https://ipinfo.io/json");
  const json = await page.content();
  const $ = cheerio.load(json);
  const ipinfo_text = $("pre").text();
  return JSON.parse(ipinfo_text);
}

export async function get_http_headers(page: Page) {
  await page.goto("https://httpbin.org/get");
  const headers = await page.content();

  const $ = cheerio.load(headers);
  const headers_text = $("pre").text();
  return JSON.parse(headers_text);
}
