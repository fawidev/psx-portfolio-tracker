/**
 * PSX Portfolio Tracker — Google Apps Script Backend
 * ===================================================
 *
 * Acts as a tiny REST API backed by a Google Sheet.
 * Deploy this as a Web App:  Deploy → New deployment → Web app
 *   - Execute as:  Me
 *   - Who has access:  Anyone
 *
 * The Sheet (named "PSX Tracker Data") will be auto-created with the
 * required tabs the first time any request comes in, so you do not need
 * to set up columns by hand.
 *
 * Sheets / columns:
 *   Portfolios:  id, userEmail, name, index, monthlyTarget, createdAt
 *   Holdings:    id, portfolioId, userEmail, symbol, sector, shares, avgCost, currPrice, updatedAt
 *   Investments: id, portfolioId, userEmail, date, amount, note, createdAt
 *
 * Every read is filtered by userEmail so each user only sees their own data.
 */

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

var SHEET_NAME = 'PSX Tracker Data';

var SCHEMA = {
  Portfolios:  ['id', 'userEmail', 'name', 'index', 'monthlyTarget', 'createdAt'],
  Holdings:    ['id', 'portfolioId', 'userEmail', 'symbol', 'sector', 'shares', 'avgCost', 'currPrice', 'updatedAt'],
  Investments: ['id', 'portfolioId', 'userEmail', 'date', 'amount', 'note', 'createdAt']
};

// ----------------------------------------------------------------------------
// HTTP entry points
// ----------------------------------------------------------------------------

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

/**
 * Unified request handler. Reads params from both query string (GET) and
 * POST body. The frontend posts JSON as text/plain to dodge CORS preflight.
 */
function handleRequest(e) {
  try {
    var params = readParams(e);
    var action = params.action;

    if (!action) {
      return jsonOut({ success: false, error: 'Missing action parameter' });
    }

    var userEmail = (params.userEmail || '').toString().trim().toLowerCase();
    if (!userEmail) {
      return jsonOut({ success: false, error: 'Missing userEmail' });
    }

    var result;
    switch (action) {
      // Portfolios
      case 'getPortfolios':   result = getPortfolios(userEmail); break;
      case 'savePortfolio':   result = savePortfolio(userEmail, params); break;
      case 'deletePortfolio': result = deletePortfolio(userEmail, params); break;

      // Holdings
      case 'getHoldings':     result = getHoldings(userEmail, params); break;
      case 'saveHolding':     result = saveHolding(userEmail, params); break;
      case 'deleteHolding':   result = deleteHolding(userEmail, params); break;

      // Investments
      case 'getInvestments':  result = getInvestments(userEmail, params); break;
      case 'saveInvestment':  result = saveInvestment(userEmail, params); break;
      case 'deleteInvestment':result = deleteInvestment(userEmail, params); break;

      // Live PSX market data (proxied + parsed server-side; cached ~10 min)
      case 'getMarketWatch':  result = getMarketWatch(); break;

      default:
        return jsonOut({ success: false, error: 'Unknown action: ' + action });
    }

    return jsonOut({ success: true, data: result });
  } catch (err) {
    return jsonOut({ success: false, error: (err && err.message) ? err.message : String(err) });
  }
}

/**
 * Merge query parameters and a JSON post body into one object.
 */
function readParams(e) {
  var params = {};
  if (e && e.parameter) {
    for (var k in e.parameter) params[k] = e.parameter[k];
  }
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var key in body) params[key] = body[key];
    } catch (ignore) { /* not JSON, fall back to query params */ }
  }
  return params;
}

// ----------------------------------------------------------------------------
// Sheet helpers
// ----------------------------------------------------------------------------

function getSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');

  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // stored id is stale — fall through and recreate
    }
  }

  // Try the active spreadsheet (when bound to a sheet), else create a new one.
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
  }
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

/**
 * Return the named sheet, creating it (with a header row) if needed.
 */
function getSheet(name) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(SCHEMA[name]);
    sheet.setFrozenRows(1);
    // Remove the default "Sheet1" if it's empty and not one of ours.
    var def = ss.getSheetByName('Sheet1');
    if (def && !SCHEMA['Sheet1'] && def.getLastRow() <= 1 && ss.getSheets().length > 1) {
      ss.deleteSheet(def);
    }
  }
  // Ensure header exists.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SCHEMA[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Read all rows of a sheet as an array of objects keyed by the header row.
 */
function readRows(name) {
  var sheet = getSheet(name);
  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    var hasId = false;
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = values[r][c];
      if (headers[c] === 'id' && values[r][c] !== '' && values[r][c] !== null) hasId = true;
    }
    obj.__row = r + 1; // 1-based sheet row number
    if (hasId) rows.push(obj);
  }
  return rows;
}

function appendRow(name, obj) {
  var sheet = getSheet(name);
  var headers = SCHEMA[name];
  var row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
}

function updateRow(name, rowNumber, obj) {
  var sheet = getSheet(name);
  var headers = SCHEMA[name];
  var row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

function deleteRowByNumber(name, rowNumber) {
  var sheet = getSheet(name);
  sheet.deleteRow(rowNumber);
}

function newId() {
  return Utilities.getUuid();
}

function nowIso() {
  return new Date().toISOString();
}

function num(v) {
  var n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ----------------------------------------------------------------------------
// Portfolios
// ----------------------------------------------------------------------------

function getPortfolios(userEmail) {
  return readRows('Portfolios')
    .filter(function (p) { return ('' + p.userEmail).toLowerCase() === userEmail; })
    .map(stripRowMeta);
}

function savePortfolio(userEmail, params) {
  var rows = readRows('Portfolios');
  var id = params.id;
  var record = {
    id: id || newId(),
    userEmail: userEmail,
    name: (params.name || 'Untitled').toString(),
    index: (params.index || 'KSE-100').toString(),
    monthlyTarget: num(params.monthlyTarget),
    createdAt: nowIso()
  };

  if (id) {
    var existing = findOwned(rows, id, userEmail);
    if (existing) {
      record.createdAt = existing.createdAt || record.createdAt;
      updateRow('Portfolios', existing.__row, record);
      return stripRowMeta(record);
    }
  }
  appendRow('Portfolios', record);
  return stripRowMeta(record);
}

function deletePortfolio(userEmail, params) {
  var id = params.id;
  if (!id) throw new Error('Missing portfolio id');

  // Cascade delete holdings + investments for this portfolio.
  cascadeDelete('Holdings', 'portfolioId', id, userEmail);
  cascadeDelete('Investments', 'portfolioId', id, userEmail);

  var rows = readRows('Portfolios');
  var existing = findOwned(rows, id, userEmail);
  if (existing) deleteRowByNumber('Portfolios', existing.__row);
  return { id: id };
}

// ----------------------------------------------------------------------------
// Holdings
// ----------------------------------------------------------------------------

function getHoldings(userEmail, params) {
  var portfolioId = params.portfolioId;
  return readRows('Holdings')
    .filter(function (h) {
      return ('' + h.userEmail).toLowerCase() === userEmail &&
             (!portfolioId || '' + h.portfolioId === '' + portfolioId);
    })
    .map(stripRowMeta);
}

function saveHolding(userEmail, params) {
  var rows = readRows('Holdings');
  var id = params.id;
  var record = {
    id: id || newId(),
    portfolioId: (params.portfolioId || '').toString(),
    userEmail: userEmail,
    symbol: (params.symbol || '').toString().toUpperCase().trim(),
    sector: (params.sector || 'Other').toString(),
    shares: num(params.shares),
    avgCost: num(params.avgCost),
    currPrice: num(params.currPrice),
    updatedAt: nowIso()
  };

  if (id) {
    var existing = findOwned(rows, id, userEmail);
    if (existing) {
      updateRow('Holdings', existing.__row, record);
      return stripRowMeta(record);
    }
  }

  // If a holding with the same symbol already exists in this portfolio,
  // average down the cost instead of creating a duplicate.
  var match = null;
  for (var i = 0; i < rows.length; i++) {
    var h = rows[i];
    if (('' + h.userEmail).toLowerCase() === userEmail &&
        '' + h.portfolioId === '' + record.portfolioId &&
        ('' + h.symbol).toUpperCase().trim() === record.symbol) {
      match = h;
      break;
    }
  }

  if (match) {
    var existingShares = num(match.shares);
    var existingCost = num(match.avgCost);
    var addShares = record.shares;
    var addCost = record.avgCost;
    var totalShares = existingShares + addShares;
    var blendedAvg = totalShares > 0
      ? ((existingShares * existingCost) + (addShares * addCost)) / totalShares
      : addCost;

    var merged = {
      id: match.id,
      portfolioId: match.portfolioId,
      userEmail: userEmail,
      symbol: record.symbol,
      sector: record.sector || match.sector,
      shares: totalShares,
      avgCost: blendedAvg,
      currPrice: record.currPrice || num(match.currPrice),
      updatedAt: nowIso()
    };
    updateRow('Holdings', match.__row, merged);
    return stripRowMeta(merged);
  }

  appendRow('Holdings', record);
  return stripRowMeta(record);
}

function deleteHolding(userEmail, params) {
  var id = params.id;
  if (!id) throw new Error('Missing holding id');
  var rows = readRows('Holdings');
  var existing = findOwned(rows, id, userEmail);
  if (existing) deleteRowByNumber('Holdings', existing.__row);
  return { id: id };
}

// ----------------------------------------------------------------------------
// Investments
// ----------------------------------------------------------------------------

function getInvestments(userEmail, params) {
  var portfolioId = params.portfolioId;
  return readRows('Investments')
    .filter(function (inv) {
      return ('' + inv.userEmail).toLowerCase() === userEmail &&
             (!portfolioId || '' + inv.portfolioId === '' + portfolioId);
    })
    .map(stripRowMeta);
}

function saveInvestment(userEmail, params) {
  var rows = readRows('Investments');
  var id = params.id;
  var record = {
    id: id || newId(),
    portfolioId: (params.portfolioId || '').toString(),
    userEmail: userEmail,
    date: (params.date || nowIso().slice(0, 10)).toString(),
    amount: num(params.amount),
    note: (params.note || '').toString(),
    createdAt: nowIso()
  };

  if (id) {
    var existing = findOwned(rows, id, userEmail);
    if (existing) {
      record.createdAt = existing.createdAt || record.createdAt;
      updateRow('Investments', existing.__row, record);
      return stripRowMeta(record);
    }
  }
  appendRow('Investments', record);
  return stripRowMeta(record);
}

function deleteInvestment(userEmail, params) {
  var id = params.id;
  if (!id) throw new Error('Missing investment id');
  var rows = readRows('Investments');
  var existing = findOwned(rows, id, userEmail);
  if (existing) deleteRowByNumber('Investments', existing.__row);
  return { id: id };
}

// ----------------------------------------------------------------------------
// Live PSX market data
// ----------------------------------------------------------------------------

/**
 * Fetch + parse the PSX data portal market watch, enriched with company names
 * and sector names from the /symbols endpoint. Cached ~10 minutes.
 * Returns: [{ symbol, name, sector, indexes:[...], price, change, changePct }]
 */
function getMarketWatch() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('marketwatch');
  if (cached) return JSON.parse(cached);

  // PSX (dps.psx.com.pk) blocks Google's egress IPs, so a direct UrlFetchApp
  // call throws "Address unavailable". We route through the Jina reader relay,
  // which PSX answers; X-Return-Format:html gives us the raw page (not markdown).
  var meta = getSymbolMeta_(cache);
  var html = relayFetch_('https://dps.psx.com.pk/market-watch');
  var rows = parseMarketWatch(html, meta);
  if (!rows.length) throw new Error('Could not read PSX market watch (source may be temporarily unavailable)');

  // CacheService caps a single value at 100KB — skip caching if it overflows.
  try { cache.put('marketwatch', JSON.stringify(rows), 600); } catch (e) {}
  return rows;
}

/** Fetch a URL through the Jina reader relay and return the raw page text. */
function relayFetch_(url) {
  var res = UrlFetchApp.fetch('https://r.jina.ai/' + url, {
    muteHttpExceptions: true,
    headers: { 'X-Return-Format': 'html', 'Accept': '*/*' }
  });
  return res.getContentText();
}

/** Company name + friendly sector name keyed by symbol. Cached 6 h (rarely changes). */
function getSymbolMeta_(cache) {
  var hit = cache.get('psx_symbols');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  var meta = {};
  try {
    var raw = relayFetch_('https://dps.psx.com.pk/symbols');
    var a = raw.indexOf('['), b = raw.lastIndexOf(']');
    if (a >= 0 && b > a) {
      JSON.parse(raw.substring(a, b + 1)).forEach(function (s) {
        if (s && s.symbol) meta[s.symbol] = { name: s.name, sector: s.sectorName };
      });
    }
  } catch (e) { /* names/sectors are best-effort — market-watch data-title is a fallback */ }

  try { cache.put('psx_symbols', JSON.stringify(meta), 21600); } catch (e) {}
  return meta;
}

function parseMarketWatch(html, meta) {
  var out = [];
  var trs = html.split('<tr');
  for (var i = 0; i < trs.length; i++) {
    var tr = trs[i];
    if (tr.indexOf('data-search=') === -1) continue;

    var symMatch = tr.match(/data-search="([^"]+)"/);
    if (!symMatch) continue;
    var symbol = symMatch[1];

    // Pull each <td>'s text content, tags stripped.
    var tds = [], re = /<td[^>]*>([\s\S]*?)<\/td>/g, m;
    while ((m = re.exec(tr)) !== null) {
      tds.push(m[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim());
    }
    if (tds.length < 8) continue;

    // [0]=symbol [1]=sectorCode [2]=listedIn [3]=ldcp [4]=open [5]=high [6]=low [7]=current [8]=change [9]=change% [10]=volume
    var listedIn = (tds[2] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var ldcp    = parseFloat((tds[3] || '').replace(/,/g, '')) || 0;
    var current = parseFloat((tds[7] || '').replace(/,/g, '')) || 0;
    var change  = parseFloat((tds[8] || '').replace(/[^0-9.\-]/g, '')) || 0;
    var changePct = parseFloat((tds[9] || '').replace(/[^0-9.\-]/g, '')) || 0;

    var info = meta[symbol] || {};
    var titleMatch = tr.match(/data-title="([^"]*)"/);   // company name embedded in the row
    out.push({
      symbol: symbol,
      name: info.name || (titleMatch ? titleMatch[1] : symbol),
      sector: info.sector || '',
      indexes: listedIn,
      price: current || ldcp,
      change: change,
      changePct: changePct
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Shared utilities
// ----------------------------------------------------------------------------

function findOwned(rows, id, userEmail) {
  for (var i = 0; i < rows.length; i++) {
    if ('' + rows[i].id === '' + id &&
        ('' + rows[i].userEmail).toLowerCase() === userEmail) {
      return rows[i];
    }
  }
  return null;
}

/**
 * Delete every row in `name` where row[field] === value and it belongs to user.
 * Deletes bottom-up so row numbers stay valid.
 */
function cascadeDelete(name, field, value, userEmail) {
  var rows = readRows(name).filter(function (r) {
    return '' + r[field] === '' + value &&
           ('' + r.userEmail).toLowerCase() === userEmail;
  });
  rows.sort(function (a, b) { return b.__row - a.__row; });
  rows.forEach(function (r) { deleteRowByNumber(name, r.__row); });
}

function stripRowMeta(obj) {
  var copy = {};
  for (var k in obj) {
    if (k !== '__row') copy[k] = obj[k];
  }
  return copy;
}

/**
 * Build a JSON response. ContentService responses from a Web App include
 * permissive CORS behaviour for cross-origin GET/simple-POST requests.
 */
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
