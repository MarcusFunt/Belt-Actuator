const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..", "..");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png"
};

let server;
let baseUrl;
let browser;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function staticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const withIndex = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const relative = withIndex.replace(/^\/+/, "");
  const resolved = path.resolve(repoRoot, relative);
  const rootRelative = path.relative(repoRoot, resolved);
  if (rootRelative.startsWith("..") || path.isAbsolute(rootRelative)) {
    return null;
  }
  return resolved;
}

async function startStaticServer() {
  const port = await freePort();
  const nextServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);
    const filePath = staticPath(requestUrl.pathname);

    if (!filePath) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.stat(filePath, (statError, stats) => {
      if (statError || !stats.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        "content-length": stats.size,
        "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
      });
      fs.createReadStream(filePath).pipe(response);
    });
  });

  await new Promise((resolve, reject) => {
    nextServer.once("error", reject);
    nextServer.listen(port, "127.0.0.1", resolve);
  });
  return { nextServer, url: `http://127.0.0.1:${port}` };
}

async function newPage(viewport, isMobile = false) {
  const context = await browser.newContext({ acceptDownloads: true, viewport, isMobile });
  const page = await context.newPage();
  const diagnostics = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error}`));
  return { context, page, diagnostics };
}

before(async () => {
  const started = await startStaticServer();
  server = started.nextServer;
  baseUrl = started.url;

  const launchOptions = { headless: true };
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROME_BIN;
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }
  browser = await chromium.launch(launchOptions);
});

after(async () => {
  if (browser) {
    await browser.close();
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("root page redirects into the web app and renders the solved default layout", { timeout: 30000 }, async () => {
  const { context, page, diagnostics } = await newPage({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "load" });
    await page.waitForURL(/\/web\//, { timeout: 10000 });
    await page.waitForSelector("#layoutSvg .belt-line", { timeout: 10000 });

    const title = await page.title();
    const status = (await page.locator("#status").textContent()).trim();
    const metricsCount = await page.locator(".metric").count();
    const circleCount = await page.locator("#layoutSvg circle.circle-line").count();
    const beltElementCount = await page.locator("#layoutSvg .belt-line").count();
    const viewBox = await page.locator("#layoutSvg").getAttribute("viewBox");
    const svgHtml = await page.locator("#layoutSvg").evaluate((element) => element.outerHTML);

    assert.equal(title, "Belt Actuator Solver");
    assert.match(page.url(), /\/web\//);
    assert.match(status, /Solved neutral idler Y = 29\.263 mm/);
    assert.equal(metricsCount, 6);
    assert.equal(circleCount, 4);
    assert.ok(beltElementCount >= 8);
    assert.equal(viewBox.split(/\s+/).length, 4);
    assert.doesNotMatch(svgHtml, /NaN|Infinity/);
    assert.deepEqual(diagnostics, []);
  } finally {
    await context.close();
  }
});

test("controls handle custom profile, invalid geometry, reset, warning, and CSV export", { timeout: 30000 }, async () => {
  const { context, page, diagnostics } = await newPage({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/web/`, { waitUntil: "load" });
    await page.waitForSelector("#layoutSvg .belt-line", { timeout: 10000 });

    await page.selectOption("#beltType", "Custom");
    assert.equal(await page.locator("#belt_pitch_mm-number").isEnabled(), true);
    assert.equal(await page.locator("#belt_pitch_mm-number").inputValue(), "2");

    await page.fill("#belt_length_mm-number", "100");
    await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Selected belt is too short"));
    await expectText(page, "#diagnostics", /Invalid selected belt:/);

    await page.click("#resetButton");
    await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Solved neutral idler Y = 29.263 mm"));

    await page.fill("#tension_offset_mm-number", "10");
    await page.waitForFunction(() => document.querySelector("#diagnostics")?.textContent.includes("Tension offset is outside half"));

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      page.click("#exportButton")
    ]);
    assert.equal(download.suggestedFilename(), "belt_actuator_fusion_parameters.csv");

    const stream = await download.createReadStream();
    let csv = "";
    for await (const chunk of stream) {
      csv += chunk.toString("utf8");
    }
    assert.ok(csv.startsWith("Name,Unit,Expression,Comment"));
    assert.ok(csv.includes("belt_pitch_mm,mm"));
    assert.equal(csv.trim().split(/\r?\n/).length, 44);
    assert.deepEqual(diagnostics, []);
  } finally {
    await context.close();
  }
});

test("mobile layout renders without horizontal overflow", { timeout: 30000 }, async () => {
  const { context, page, diagnostics } = await newPage({ width: 390, height: 844 }, true);
  try {
    await page.goto(`${baseUrl}/web/`, { waitUntil: "load" });
    await page.waitForSelector("#layoutSvg .belt-line", { timeout: 10000 });

    const mobileState = await page.evaluate(() => {
      const svg = document.querySelector("#layoutSvg");
      const toolbar = document.querySelector(".toolbar");
      const maxScrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      return {
        innerWidth: window.innerWidth,
        maxScrollWidth,
        svgHeight: svg.getBoundingClientRect().height,
        toolbarPosition: getComputedStyle(toolbar).position,
        metrics: document.querySelectorAll(".metric").length,
        beltElements: svg.querySelectorAll(".belt-line").length
      };
    });

    assert.equal(mobileState.metrics, 6);
    assert.ok(mobileState.svgHeight >= 512, JSON.stringify(mobileState));
    assert.equal(mobileState.toolbarPosition, "sticky");
    assert.ok(mobileState.beltElements >= 8, JSON.stringify(mobileState));
    assert.ok(mobileState.maxScrollWidth <= mobileState.innerWidth + 1, JSON.stringify(mobileState));
    assert.deepEqual(diagnostics, []);
  } finally {
    await context.close();
  }
});

async function expectText(page, selector, pattern) {
  const text = await page.locator(selector).textContent();
  assert.match(text, pattern);
}
