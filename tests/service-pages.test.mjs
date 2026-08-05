// Regression cover for the per-service landing pages.
//
// Until these routes existed every service lived on one /services page, so a
// search for "pasang CCTV Bali" had nothing to land on but a five-service list
// whose title, description and social card said "Layanan IT untuk Bisnis di
// Bali" no matter which service the searcher wanted. What has to hold now:
//
//   * /services/[slug] and /en/services/[slug] answer for every published
//     service, in the language of the route;
//   * an unknown slug — and a slug the owner has unpublished in the panel —
//     answers 404 rather than an empty shell;
//   * every page carries its own title, description, canonical and social card,
//     none of them the /services list's, with a reciprocal hreflang pair;
//   * the Service JSON-LD parses and names the Organization by @id instead of
//     restating the company, and the BreadcrumbList matches the visible trail;
//   * the sitemap carries all ten URLs and every URL in it still answers 200;
//   * every <lastmod> in the sitemap is the moment its page's content changed —
//     stable between two fetches, and moved by editing that page's own row
//     rather than by the clock;
//   * features_json is rendered, and a malformed value cannot take the page
//     down.
//
// Every test here fails on the commit before the pages existed: the routes 404,
// the sitemap is 16 URLs, and there is no Service node to parse.
//
// The database is written to directly for the unpublish and malformed-JSON
// cases. Those are panel edits — is_published and features_json are both
// owner-editable — and each test restores the row it touched.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, test } from "node:test";

const ORIGIN = "https://enterprise.perumnet.id";
const SLUGS = ["managed-wifi", "cctv", "ip-pabx", "smart-home-device", "perumnet-labs"];

let server;
let baseUrl;
let databasePath;
let database;

async function freePort() {
  return await new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
      lastError = new Error(`Health endpoint returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError ?? new Error("Server did not become ready.");
}

async function page(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, html: await response.text() };
}

/**
 * Is this CMS value rendered on the page? "CCTV & Surveillance" and
 * "Site survey & heatmap" reach the document as "&amp;", so a raw
 * String.includes against the column value silently never matches.
 */
function rendered(html, value) {
  const escaped = String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return html.includes(escaped);
}

function head(html) {
  const end = html.indexOf("</head>");
  return end === -1 ? html : html.slice(0, end);
}

function meta(html, pattern) {
  return head(html).match(pattern)?.[1] ?? null;
}

function seo(html) {
  return {
    title: meta(html, /<title>([^<]*)<\/title>/),
    description: meta(html, /<meta name="description" content="([^"]*)"/),
    canonical: meta(html, /<link rel="canonical" href="([^"]*)"/),
    ogTitle: meta(html, /<meta property="og:title" content="([^"]*)"/),
    ogDescription: meta(html, /<meta property="og:description" content="([^"]*)"/),
    ogUrl: meta(html, /<meta property="og:url" content="([^"]*)"/),
    alternates: Object.fromEntries(
      [...head(html).matchAll(/<link rel="alternate" hrefLang="([^"]+)" href="([^"]+)"/g)].map(
        (match) => [match[1], match[2]],
      ),
    ),
  };
}

/** Every JSON-LD block on the page, parsed. A block that does not parse is a
 *  block Google silently drops, so parsing is the assertion. */
function structuredData(html) {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]),
  );
}

function node(html, type) {
  return structuredData(html).find((entry) => entry["@type"] === type);
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = `/tmp/perumnet-service-pages-${process.pid}-${Date.now()}.db`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        TURSO_DATABASE_URL: `file:${databasePath}`,
        APP_URL: baseUrl,
        TURNSTILE_SECRET_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForServer(baseUrl);
  database = createClient({ url: `file:${databasePath}` });
}, { timeout: 90_000 });

after(async () => {
  database?.close();
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      server.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  for (const suffix of ["", "-shm", "-wal"]) {
    if (existsSync(`${databasePath}${suffix}`)) unlinkSync(`${databasePath}${suffix}`);
  }
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test("every published service answers on both language routes", { timeout: 180_000 }, async () => {
  const rows = await database.execute(
    "SELECT slug,title,title_en FROM cms_services WHERE is_published=1 ORDER BY sort_order",
  );
  assert.deepEqual(rows.rows.map((row) => String(row.slug)).sort(), [...SLUGS].sort());

  for (const row of rows.rows) {
    const slug = String(row.slug);
    const indonesian = await page(`/services/${slug}`);
    assert.equal(indonesian.status, 200, `/services/${slug}`);
    assert.ok(
      rendered(indonesian.html, row.title),
      `/services/${slug} does not render its CMS title`,
    );

    const english = await page(`/en/services/${slug}`);
    assert.equal(english.status, 200, `/en/services/${slug}`);
    assert.ok(
      rendered(english.html, row.title_en),
      `/en/services/${slug} does not render its title_en`,
    );
  }
});

test("an unknown slug is a 404 page, not a blank one", { timeout: 60_000 }, async () => {
  for (const path of [
    "/services/tidak-ada-layanan-ini",
    "/en/services/tidak-ada-layanan-ini",
    "/services/managed-wifi-typo",
  ]) {
    const response = await page(path);
    assert.equal(response.status, 404, path);
    // A 404 status over an empty document is how a soft-404 looks to a crawler.
    assert.ok(response.html.length > 500, `${path} answered 404 with an empty body`);
    assert.match(response.html, /could not be found|Not Found/i, path);
  }
});

test("unpublishing a service in the panel takes its pages down", { timeout: 60_000 }, async () => {
  assert.equal((await page("/services/ip-pabx")).status, 200);
  await database.execute("UPDATE cms_services SET is_published=0 WHERE slug='ip-pabx'");
  try {
    assert.equal((await page("/services/ip-pabx")).status, 404, "unpublished ID page still renders");
    assert.equal((await page("/en/services/ip-pabx")).status, 404, "unpublished EN page still renders");

    // And it is gone from everything that would otherwise keep pointing at it.
    const list = await page("/services");
    assert.ok(!list.html.includes("/services/ip-pabx"), "/services still links to the hidden page");
    const sitemap = await page("/sitemap.xml");
    assert.ok(
      !sitemap.html.includes("/services/ip-pabx"),
      "the sitemap still advertises the hidden page",
    );
  } finally {
    await database.execute("UPDATE cms_services SET is_published=1 WHERE slug='ip-pabx'");
  }
  assert.equal((await page("/services/ip-pabx")).status, 200, "republishing did not restore the page");
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

test("each service page carries its own title, description and card", { timeout: 180_000 }, async () => {
  const list = seo((await page("/services")).html);
  const listEn = seo((await page("/en/services")).html);
  const seen = new Map();

  for (const slug of SLUGS) {
    for (const [language, path, listing] of [
      ["id", `/services/${slug}`, list],
      ["en", `/en/services/${slug}`, listEn],
    ]) {
      const found = seo((await page(path)).html);

      assert.ok(found.title, `${path} has no title`);
      assert.ok(found.description, `${path} has no description`);
      assert.notEqual(found.title, listing.title, `${path} reuses the /services title`);
      assert.notEqual(
        found.description,
        listing.description,
        `${path} reuses the /services description`,
      );
      assert.notEqual(found.ogTitle, listing.ogTitle, `${path} reuses the /services social card`);

      // The list page's own metadata must not have been collateral damage.
      assert.ok(listing.title, "/services lost its title");

      // Length budget: the root layout appends " — PerumNet Enterprise", so the
      // rendered title is what has to fit a result line.
      assert.ok(found.title.length <= 70, `${path} title is ${found.title.length} chars`);
      assert.ok(
        found.description.length <= 165,
        `${path} description is ${found.description.length} chars`,
      );

      // Canonical and og:url point at this page in this language.
      const expected = `${ORIGIN}${language === "en" ? "/en" : ""}/services/${slug}`;
      assert.equal(found.canonical, expected, `${path} canonical`);
      assert.equal(found.ogUrl, expected, `${path} og:url`);

      // No two service pages may share a title or a description.
      for (const [key, value] of [["title", found.title], ["description", found.description]]) {
        const previous = seen.get(`${key}:${value}`);
        assert.equal(previous, undefined, `${path} shares its ${key} with ${previous}`);
        seen.set(`${key}:${value}`, path);
      }
    }
  }
});

test("service pages point hreflang at their own pair, reciprocally", { timeout: 120_000 }, async () => {
  for (const slug of SLUGS) {
    const id = `${ORIGIN}/services/${slug}`;
    const en = `${ORIGIN}/en/services/${slug}`;
    for (const path of [`/services/${slug}`, `/en/services/${slug}`]) {
      const { alternates } = seo((await page(path)).html);
      assert.equal(alternates["id-ID"], id, `${path} id-ID`);
      assert.equal(alternates.en, en, `${path} en`);
      assert.equal(alternates["x-default"], id, `${path} x-default`);
    }
  }
});

test("the English route renders the English columns, not the Indonesian ones", { timeout: 60_000 }, async () => {
  const row = (await database.execute(
    "SELECT * FROM cms_services WHERE slug='smart-home-device'",
  )).rows[0];
  const english = (await page("/en/services/smart-home-device")).html;
  const indonesian = (await page("/services/smart-home-device")).html;

  assert.ok(rendered(english, row.summary_en), "/en summary_en missing");
  assert.ok(rendered(english, row.description_en), "/en description_en missing");
  assert.ok(!rendered(english, row.description), "/en still shows the Indonesian description");

  assert.ok(rendered(indonesian, row.summary), "/id summary missing");
  assert.ok(rendered(indonesian, row.description), "/id description missing");

  for (const feature of JSON.parse(String(row.features_json_en))) {
    assert.ok(rendered(english, feature), `/en is missing feature "${feature}"`);
  }
  for (const feature of JSON.parse(String(row.features_json))) {
    assert.ok(rendered(indonesian, feature), `/id is missing feature "${feature}"`);
  }
});

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

test("the Service JSON-LD parses and names the Organization by @id", { timeout: 120_000 }, async () => {
  for (const slug of SLUGS) {
    for (const [language, path] of [["id", `/services/${slug}`], ["en", `/en/services/${slug}`]]) {
      const html = (await page(path)).html;
      const blocks = structuredData(html);
      assert.ok(blocks.length >= 3, `${path} has ${blocks.length} JSON-LD blocks`);

      const organization = blocks.find((entry) => entry["@id"] === `${ORIGIN}/#organization`);
      assert.ok(organization, `${path} lost the Organization node`);

      const service = node(html, "Service");
      assert.ok(service, `${path} has no Service node`);
      assert.equal(service["@context"], "https://schema.org", `${path} Service @context`);
      assert.deepEqual(
        service.provider,
        { "@id": `${ORIGIN}/#organization` },
        `${path} restates the company instead of referencing the Organization @id`,
      );
      assert.ok(service.name, `${path} Service has no name`);
      assert.ok(service.description, `${path} Service has no description`);
      assert.equal(
        service.url,
        `${ORIGIN}${language === "en" ? "/en" : ""}/services/${slug}`,
        `${path} Service url`,
      );

      const breadcrumb = node(html, "BreadcrumbList");
      assert.ok(breadcrumb, `${path} has no BreadcrumbList`);
      assert.equal(breadcrumb.itemListElement.length, 3, `${path} breadcrumb depth`);
      assert.deepEqual(
        breadcrumb.itemListElement.map((step) => step.position),
        [1, 2, 3],
        `${path} breadcrumb positions`,
      );
      const prefix = language === "en" ? `${ORIGIN}/en` : ORIGIN;
      assert.equal(breadcrumb.itemListElement[0].item, language === "en" ? `${ORIGIN}/en` : `${ORIGIN}/`);
      assert.equal(breadcrumb.itemListElement[1].item, `${prefix}/services`);
      assert.equal(breadcrumb.itemListElement[2].item, `${prefix}/services/${slug}`);

      // The visible trail has to say the same thing the crawler is told.
      for (const step of breadcrumb.itemListElement) {
        assert.ok(rendered(html, step.name), `${path} breadcrumb "${step.name}" is not on the page`);
      }
      assert.equal(
        service.name,
        breadcrumb.itemListElement[2].name,
        `${path} breadcrumb leaf disagrees with the Service name`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Internal linking and the sitemap
// ---------------------------------------------------------------------------

test("the list page links to every detail page, and back again", { timeout: 60_000 }, async () => {
  const list = await page("/services");
  assert.equal(list.status, 200);
  for (const slug of SLUGS) {
    assert.match(list.html, new RegExp(`href="/services/${slug}"`), `/services does not link ${slug}`);
  }
  const listEn = await page("/en/services");
  for (const slug of SLUGS) {
    assert.match(listEn.html, new RegExp(`href="/en/services/${slug}"`), `/en/services misses ${slug}`);
  }

  // In the body, not only in the shared header nav — the nav links to both of
  // these on every page, so matching the href alone would pass on a page with
  // no internal linking at all.
  const detail = await page("/services/cctv");
  assert.match(
    detail.html,
    /href="\/services"[^>]*>Lihat semua layanan/,
    "the detail page body does not link back to the list",
  );
  assert.match(
    detail.html,
    /href="\/contact"[^>]*>Hubungi kami/,
    "the detail page body does not link on to /contact",
  );
  // And on to its siblings, which is what turns five orphans into a cluster.
  for (const slug of SLUGS.filter((item) => item !== "cctv")) {
    assert.match(detail.html, new RegExp(`href="/services/${slug}"`), `cctv does not reach ${slug}`);
  }

  const detailEn = await page("/en/services/cctv");
  assert.match(
    detailEn.html,
    /href="\/en\/services"[^>]*>View all services/,
    "the English detail page has no way back",
  );
  assert.match(
    detailEn.html,
    /href="\/en\/contact"[^>]*>Contact us/,
    "the English detail page never reaches contact",
  );
});

test("the sitemap carries every service in both languages", { timeout: 120_000 }, async () => {
  const xml = (await page("/sitemap.xml")).html;
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.equal(new Set(urls).size, urls.length, "the sitemap repeats a URL");

  for (const slug of SLUGS) {
    assert.ok(urls.includes(`${ORIGIN}/services/${slug}`), `sitemap misses /services/${slug}`);
    assert.ok(urls.includes(`${ORIGIN}/en/services/${slug}`), `sitemap misses /en/services/${slug}`);
  }
  // Five services in two languages on top of the eight routes that were there.
  assert.equal(urls.length, 26, `sitemap has ${urls.length} URLs`);

  // Each entry names both members of its own pair.
  const alternates = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);
  for (const slug of SLUGS) {
    for (const entry of alternates.filter((block) => block.includes(`/services/${slug}<`))) {
      assert.ok(entry.includes(`href="${ORIGIN}/services/${slug}"`), `${slug} alternate id`);
      assert.ok(entry.includes(`href="${ORIGIN}/en/services/${slug}"`), `${slug} alternate en`);
    }
  }
});

test("every URL the sitemap advertises answers 200", { timeout: 240_000 }, async () => {
  const xml = (await page("/sitemap.xml")).html;
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(urls.length >= 26, `only ${urls.length} URLs in the sitemap`);
  for (const url of urls) {
    assert.ok(url.startsWith(ORIGIN), `${url} is not on the public origin`);
    const response = await page(url.slice(ORIGIN.length) || "/");
    assert.equal(response.status, 200, `${url} answered ${response.status}`);
  }
});

/**
 * loc -> lastmod for every <url> block, paired inside the block so a missing
 * <lastmod> shows up as null instead of silently borrowing its neighbour's.
 */
function sitemapLastmods(xml) {
  return new Map(
    [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => [
      match[1].match(/<loc>([^<]*)<\/loc>/)?.[1] ?? null,
      match[1].match(/<lastmod>([^<]*)<\/lastmod>/)?.[1] ?? null,
    ]),
  );
}

/**
 * <lastmod> has to be the moment the page's content changed. It was
 * `new Date()` applied to every entry, so it was the moment of the *request*:
 * two fetches seconds apart disagreed, all 26 URLs always agreed with each
 * other, and editing one service description told Google nothing about which
 * page to recrawl. Google drops a lastmod it can show to be unreliable, so the
 * field was worthless — and it is the field the owner needs most, having just
 * submitted this sitemap to Search Console.
 *
 * Both halves of that fail on the commit before the fix: the stability check
 * because the timestamp is minted per request, and the per-page checks because
 * every URL carries the same value no matter what the database says.
 */
test("the sitemap dates every URL from its own content, not from the clock", { timeout: 180_000 }, async () => {
  const lastmods = async () => sitemapLastmods((await page("/sitemap.xml")).html);
  const original = String(
    (await database.execute("SELECT updated_at FROM cms_services WHERE slug='cctv'")).rows[0]
      .updated_at,
  );
  const cctv = [`${ORIGIN}/services/cctv`, `${ORIGIN}/en/services/cctv`];
  const services = [`${ORIGIN}/services`, `${ORIGIN}/en/services`];
  const home = [`${ORIGIN}/`, `${ORIGIN}/en`];

  const baseline = await lastmods();
  assert.equal(baseline.size, 26, `sitemap has ${baseline.size} URLs`);
  for (const [url, lastmod] of baseline) {
    assert.ok(lastmod, `${url} has no <lastmod>`);
    // "Invalid Date" is what an unparseable updated_at serialises to, and it is
    // worse than no lastmod at all.
    assert.ok(!Number.isNaN(Date.parse(lastmod)), `${url} lastmod is "${lastmod}"`);
  }

  // 1. Nothing in the sitemap may depend on when it was fetched.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  assert.deepEqual(
    [...(await lastmods())],
    [...baseline],
    "a second fetch returned different lastmod values with no CMS edit in between",
  );

  try {
    // 2. Backdating one service moves that service's two URLs and nothing
    //    else. A value older than every other row keeps the /services and /
    //    maxima where they are, which isolates the per-URL granularity.
    const backdated = "2019-07-04T05:06:07.000Z";
    await database.execute({
      sql: "UPDATE cms_services SET updated_at=? WHERE slug='cctv'",
      args: [backdated],
    });
    const moved = await lastmods();
    for (const url of cctv) {
      assert.equal(Date.parse(moved.get(url)), Date.parse(backdated), `${url} kept the old lastmod`);
    }
    for (const [url, lastmod] of baseline) {
      if (cctv.includes(url)) continue;
      assert.equal(moved.get(url), lastmod, `${url} moved because a different page was edited`);
    }

    // 3. A real panel edit stamps the row with "now", and then the pages that
    //    render that row — its own, the list that reprints its description,
    //    and the home page whose cards come from the same table — all move,
    //    while the pages that render other tables stay put.
    const newest = Math.max(...[...baseline.values()].map((value) => Date.parse(value)));
    const edited = new Date(newest + 3_600_000).toISOString();
    await database.execute({
      sql: "UPDATE cms_services SET updated_at=? WHERE slug='cctv'",
      args: [edited],
    });
    const bumped = await lastmods();
    for (const url of [...cctv, ...services, ...home]) {
      assert.equal(Date.parse(bumped.get(url)), Date.parse(edited), `${url} did not follow the edit`);
    }
    for (const url of [
      `${ORIGIN}/portfolio`,
      `${ORIGIN}/en/portfolio`,
      `${ORIGIN}/testimonials`,
      `${ORIGIN}/en/testimonials`,
      `${ORIGIN}/contact`,
      `${ORIGIN}/en/contact`,
      ...SLUGS.filter((slug) => slug !== "cctv").flatMap((slug) => [
        `${ORIGIN}/services/${slug}`,
        `${ORIGIN}/en/services/${slug}`,
      ]),
    ]) {
      assert.equal(bumped.get(url), baseline.get(url), `${url} moved for an edit it does not render`);
    }
  } finally {
    await database.execute({
      sql: "UPDATE cms_services SET updated_at=? WHERE slug='cctv'",
      args: [original],
    });
  }

  assert.deepEqual([...(await lastmods())], [...baseline], "restoring updated_at did not restore the sitemap");
});

// ---------------------------------------------------------------------------
// features_json
// ---------------------------------------------------------------------------

test("a malformed features_json cannot take the page down", { timeout: 60_000 }, async () => {
  const original = String((await database.execute(
    "SELECT features_json FROM cms_services WHERE slug='cctv'",
  )).rows[0].features_json);

  for (const broken of ["", "not json at all", "{\"a\":1}", "[", "null", "[]"]) {
    await database.execute({
      sql: "UPDATE cms_services SET features_json=? WHERE slug='cctv'",
      args: [broken],
    });
    const response = await page("/services/cctv");
    assert.equal(response.status, 200, `features_json=${JSON.stringify(broken)} broke the page`);
    assert.ok(rendered(response.html, "CCTV & Surveillance"), "the page lost its own title");
    assert.ok(node(response.html, "Service"), "the Service JSON-LD disappeared");
  }

  await database.execute({
    sql: "UPDATE cms_services SET features_json=? WHERE slug='cctv'",
    args: [original],
  });
  const restored = await page("/services/cctv");
  for (const feature of JSON.parse(original)) {
    assert.ok(rendered(restored.html, feature), `feature "${feature}" is not rendered`);
  }
});
