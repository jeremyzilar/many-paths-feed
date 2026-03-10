'use strict';

const Parser = require('rss-parser');
const yaml = require('js-yaml');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------

const sources = yaml.load(fs.readFileSync(path.join(ROOT, 'sources.yaml'), 'utf8'));
const keywords = yaml.load(fs.readFileSync(path.join(ROOT, 'keywords.yaml'), 'utf8'));

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const db = new Database(path.join(ROOT, 'digest.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    url              TEXT    UNIQUE NOT NULL,
    title            TEXT    NOT NULL,
    description      TEXT,
    source_name      TEXT    NOT NULL,
    pub_date         TEXT,
    keywords_matched TEXT,
    discovered_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS source_stats (
    source_name   TEXT    PRIMARY KEY,
    article_count INTEGER DEFAULT 0,
    last_seen     TEXT
  );
`);

const stmtInsertArticle = db.prepare(`
  INSERT OR IGNORE INTO articles
    (url, title, description, source_name, pub_date, keywords_matched)
  VALUES
    (@url, @title, @description, @source_name, @pub_date, @keywords_matched)
`);

const stmtUpsertStat = db.prepare(`
  INSERT INTO source_stats (source_name, article_count, last_seen)
  VALUES (@source_name, 1, @now)
  ON CONFLICT(source_name) DO UPDATE SET
    article_count = article_count + 1,
    last_seen = @now
`);

const stmtUrlExists = db.prepare('SELECT 1 FROM articles WHERE url = ?');

const stmtTopSources = db.prepare(`
  SELECT source_name, article_count
  FROM source_stats
  ORDER BY article_count DESC
  LIMIT 5
`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchKeywords(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  return keywords.filter((kw) => text.includes(kw.toLowerCase()));
}

async function fetchFeed(source) {
  const parser = new Parser({ timeout: 12000 });
  const feed = await parser.parseURL(source.url);
  return feed.items || [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const now = new Date().toISOString();
  const newArticles = [];

  for (const source of sources) {
    let items;
    try {
      items = await fetchFeed(source);
    } catch (err) {
      console.warn(`[SKIP] ${source.name}: ${err.message}`);
      continue;
    }

    for (const item of items) {
      const url = item.link || item.guid;
      const title = (item.title || '').trim();
      const description = (item.contentSnippet || item.content || item.summary || '').trim();

      if (!url || !title) continue;

      const matched = matchKeywords(title, description);
      if (matched.length === 0) continue;

      // Skip if already in database
      if (stmtUrlExists.get(url)) continue;

      stmtInsertArticle.run({
        url,
        title,
        description: description.slice(0, 600),
        source_name: source.name,
        pub_date: item.pubDate || item.isoDate || now,
        keywords_matched: matched.join(', '),
      });

      stmtUpsertStat.run({ source_name: source.name, now });

      newArticles.push({ title, url, source: source.name, matched });
    }
  }

  if (newArticles.length === 0) {
    console.log('No new articles today. No email sent.');
    return;
  }

  await sendDigest(newArticles);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

async function sendDigest(articles) {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // Group articles by source
  const bySource = {};
  for (const a of articles) {
    (bySource[a.source] = bySource[a.source] || []).push(a);
  }

  const sourceCount = Object.keys(bySource).length;
  const articleWord = articles.length === 1 ? 'article' : 'articles';
  const sourceWord = sourceCount === 1 ? 'source' : 'sources';

  const subject = `NM Homelessness News -- ${dateStr} (${articles.length} ${articleWord})`;

  const topSources = stmtTopSources.all();
  const statsLine = topSources.map((s) => `${s.source_name} (${s.article_count})`).join(', ');

  // ---------------------------------------------------------------------------
  // Plain text body
  // ---------------------------------------------------------------------------
  const divider = '\u2500'.repeat(44);
  let text = `NM Homelessness News Digest\n${dateStr}\n${divider}\n\n`;

  for (const [sourceName, items] of Object.entries(bySource)) {
    text += `${sourceName}\n`;
    for (const a of items) {
      text += `  - ${a.title}\n    ${a.url}\n    keywords: ${a.matched.join(', ')}\n\n`;
    }
  }

  text += `${divider}\n`;
  text += `${articles.length} ${articleWord} from ${sourceCount} ${sourceWord} today.\n`;
  text += `Top sources all time: ${statsLine}\n`;

  // ---------------------------------------------------------------------------
  // HTML body
  // ---------------------------------------------------------------------------
  let sourceRows = '';
  for (const [sourceName, items] of Object.entries(bySource)) {
    const articleItems = items
      .map(
        (a) => `
        <li style="margin-bottom:12px;">
          <a href="${escHtml(a.url)}" style="font-weight:600;color:#1a56db;text-decoration:none;">
            ${escHtml(a.title)}
          </a><br>
          <small style="color:#888;">keywords: ${escHtml(a.matched.join(', '))}</small>
        </li>`
      )
      .join('');

    sourceRows += `
      <h3 style="margin:24px 0 6px;color:#111;font-size:15px;">${escHtml(sourceName)}</h3>
      <ul style="padding-left:18px;margin:0;">${articleItems}</ul>`;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9f9f9;">
  <div style="font-family:system-ui,sans-serif;max-width:660px;margin:32px auto;background:#fff;
              border:1px solid #e5e7eb;border-radius:8px;padding:32px;color:#1a1a1a;">
    <h2 style="margin:0 0 4px;">NM Homelessness News Digest</h2>
    <p style="margin:0 0 20px;color:#666;">${escHtml(dateStr)}</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
    ${sourceRows}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;">
    <p style="margin:0;color:#555;font-size:14px;">
      <strong>${articles.length} ${articleWord}</strong> from
      <strong>${sourceCount} ${sourceWord}</strong> today.<br>
      Top sources all time: ${escHtml(statsLine)}
    </p>
  </div>
</body>
</html>`;

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"NM Homelessness Digest" <${process.env.GMAIL_USER}>`,
    to: process.env.RECIPIENT_EMAIL,
    subject,
    text,
    html,
  });

  console.log(`Digest sent: ${articles.length} ${articleWord} from ${sourceCount} ${sourceWord}.`);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
