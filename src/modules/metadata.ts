import cheerio from 'cheerio'

// module.exports = {
//     get_ip_data: get_ip_data,
//     get_http_headers: get_http_headers,
// };

export async function get_ip_data(page) {
    await page.goto('https://ipinfo.io/json', {
      waitLoad: true,
      waitNetworkIdle: true
    });
    const json = await page.content({
        timeout: 20000
    });
    const $ = cheerio.load(json);
    const ipinfo_text =  $('pre').text();
    return JSON.parse(ipinfo_text);
}

export async function get_http_headers(page) {
    await page.goto('https://httpbin.org/get', {
      waitLoad: true,
      waitNetworkIdle: true
    });
    const headers = await page.content();

    const $ = cheerio.load(headers);
    const headers_text =  $('pre').text();
    return JSON.parse(headers_text);
}