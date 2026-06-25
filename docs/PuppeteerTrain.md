### Puppeteer session code

```
const fs = require('fs');
const path = require('path');

let sessionLog = [];

function logAction(state, action) {
  sessionLog.push({ state, action });
}

function saveSession(filename = 'session.json') {
  fs.writeFileSync(path.join(__dirname, filename), JSON.stringify(sessionLog, null, 2));
}

```

### Wrap your Puppeteer commands to log each step:
```
async function searchYellowPages(keyword) {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('https://www.yellowpages.com/', { waitUntil: 'networkidle2' });
  const state1 = await page.content();
  logAction(state1, `goto('https://www.yellowpages.com/')`);

  await page.type('#search-term', keyword);
  const state2 = await page.content();
  logAction(state2, `type('#search-term', '${keyword}')`);

  await page.click('#search-submit');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  const state3 = await page.content();
  logAction(state3, `click('#search-submit')`);

  // Extract results
  const results = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.result'));
    return items.map(item => ({
      name: item.querySelector('.business-name')?.innerText,
      phone: item.querySelector('.phones')?.innerText,
      address: item.querySelector('.street-address')?.innerText,
    }));
  });

  logAction(await page.content(), `extract(${results.length} results)`);

  saveSession(); // Save the full session log
  await browser.close();
  return results;
}

```