const PTM_INVENTORY = Object.freeze({
  SPREADSHEET_ID: "1_8iBFwGh09l3ErFj4tf2UaUKv8tTvFeimsH1SeqedLg",
  ENDPOINT: "https://ptm-realty-crm.vercel.app/api/inventory/sync",
  SECRET_PROPERTY: "PTM_INVENTORY_WEBHOOK_SECRET",
  SNAPSHOT_PREFIX: "PTM_INV_SNAPSHOT",
  SNAPSHOT_CHUNK_CHARS: 2800,
  BATCH_SIZE: 250,
  TRIGGER_HANDLER: "syncPtmInventory"
});

/**
 * Run once after adding Script Property PTM_INVENTORY_WEBHOOK_SECRET.
 * Seeds the current Sheet snapshot without changing CRM, then installs a 5-minute trigger.
 */
function setupPtmInventorySync() {
  requireInventorySecret_();
  const current = collectPtmInventory_();
  saveInventorySnapshot_(current.snapshot);
  removeInventoryTriggers_();
  ScriptApp.newTrigger(PTM_INVENTORY.TRIGGER_HANDLER).timeBased().everyMinutes(5).create();
  return {
    ok: true,
    seeded: Object.keys(current.snapshot).length,
    sheets: current.sheets,
    duplicates: current.duplicates.length,
    trigger: "every 5 minutes"
  };
}

/**
 * Called by the time-driven trigger. Only changed product statuses are posted to CRM.
 */
function syncPtmInventory() {
  const secret = requireInventorySecret_();
  const current = collectPtmInventory_();
  const previous = loadInventorySnapshot_();
  const changed = [];

  Object.keys(current.snapshot).forEach(function(code) {
    if (previous[code] !== current.snapshot[code]) changed.push(current.rowsByCode[code]);
  });

  if (!changed.length) {
    return {
      ok: true,
      scanned: Object.keys(current.snapshot).length,
      changed: 0,
      sheets: current.sheets,
      duplicates: current.duplicates.length
    };
  }

  const result = postInventoryRows_(secret, changed);
  saveInventorySnapshot_(current.snapshot);
  return Object.assign({ scanned: Object.keys(current.snapshot).length, sent: changed.length }, result);
}

/**
 * Manual recovery tool. Sends every detected product in batches, then resets the local snapshot.
 */
function forceFullPtmInventorySync() {
  const secret = requireInventorySecret_();
  const current = collectPtmInventory_();
  const rows = Object.keys(current.rowsByCode).map(function(code) { return current.rowsByCode[code]; });
  const result = postInventoryRows_(secret, rows);
  saveInventorySnapshot_(current.snapshot);
  return Object.assign({ scanned: rows.length, sent: rows.length, full_sync: true }, result);
}

function collectPtmInventory_() {
  const spreadsheet = SpreadsheetApp.openById(PTM_INVENTORY.SPREADSHEET_ID);
  const rowsByCode = {};
  const snapshot = {};
  const chosenRank = {};
  const duplicates = [];
  let scannedSheets = 0;

  spreadsheet.getSheets().forEach(function(sheet) {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow < 2 || lastColumn < 2) return;

    const headerProbeRows = Math.min(lastRow, 30);
    const headerValues = sheet.getRange(1, 1, headerProbeRows, lastColumn).getDisplayValues();
    const header = findInventoryHeader_(headerValues);
    if (!header) return;

    scannedSheets += 1;
    if (lastRow <= header.row) return;

    const data = sheet.getRange(header.row + 1, 1, lastRow - header.row, lastColumn).getDisplayValues();
    data.forEach(function(values, index) {
      const rawCode = String(values[header.codeColumn] || "").trim();
      const rawStatus = String(values[header.statusColumn] || "").trim();
      if (!rawCode || !rawStatus) return;

      const code = rawCode.toUpperCase();
      const rank = inventoryStatusRank_(rawStatus);
      const statusKey = inventoryStatusKey_(rawStatus);
      const row = {
        code: rawCode,
        status: rawStatus,
        source_sheet: sheet.getName(),
        source_row: header.row + 1 + index
      };

      if (rowsByCode[code]) {
        duplicates.push({
          code: rawCode,
          kept_sheet: rowsByCode[code].source_sheet,
          other_sheet: sheet.getName(),
          kept_status: rowsByCode[code].status,
          other_status: rawStatus
        });
      }

      // If a product appears in more than one tab, keep the more restrictive status.
      // Rank: sold > locked > deposit > hold > available > unknown.
      if (!rowsByCode[code] || rank > chosenRank[code]) {
        rowsByCode[code] = row;
        chosenRank[code] = rank;
        snapshot[code] = statusKey;
      }
    });
  });

  return { rowsByCode: rowsByCode, snapshot: snapshot, sheets: scannedSheets, duplicates: duplicates };
}

function findInventoryHeader_(rows) {
  for (let r = 0; r < rows.length; r += 1) {
    let codeColumn = -1;
    let statusColumn = -1;

    for (let c = 0; c < rows[r].length; c += 1) {
      const header = normalizeInventoryText_(rows[r][c]);
      if (header === "ma san pham" || header === "ma sp" || header === "ma sanpham") codeColumn = c;
      if (header === "trang thai" || header === "tinh trang") statusColumn = c;
    }

    if (codeColumn >= 0 && statusColumn >= 0) {
      return { row: r + 1, codeColumn: codeColumn, statusColumn: statusColumn };
    }
  }
  return null;
}

function normalizeInventoryText_(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inventoryStatusKey_(status) {
  const s = normalizeInventoryText_(status);
  if (s === "mo ban" || s === "available") return "a";
  if (s === "giu cho" || s === "giu cho" || s === "hold" || s === "reserved") return "h";
  if (s === "dat coc" || s === "coc" || s === "deposit") return "d";
  if (s === "da ban" || s === "ban" || s === "sold") return "s";
  if (s === "khoa" || s === "locked" || s === "lock") return "l";
  return "?" + s;
}

function inventoryStatusRank_(status) {
  const key = inventoryStatusKey_(status);
  if (key === "s") return 5;
  if (key === "l") return 4;
  if (key === "d") return 3;
  if (key === "h") return 2;
  if (key === "a") return 1;
  return 0;
}

function postInventoryRows_(secret, rows) {
  let changed = 0;
  let conflicts = 0;
  let unknown = 0;
  let invalid = 0;
  const conflictRows = [];
  const unknownRows = [];
  const invalidRows = [];

  for (let start = 0; start < rows.length; start += PTM_INVENTORY.BATCH_SIZE) {
    const batch = rows.slice(start, start + PTM_INVENTORY.BATCH_SIZE);
    const response = UrlFetchApp.fetch(PTM_INVENTORY.ENDPOINT, {
      method: "post",
      contentType: "application/json",
      headers: { "x-ptm-inventory-secret": secret },
      payload: JSON.stringify({ rows: batch }),
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();
    const text = response.getContentText();
    let body;
    try { body = JSON.parse(text || "{}"); } catch (error) { body = { ok: false, error: text || "INVALID_RESPONSE" }; }

    if (status < 200 || status >= 300 || !body.ok) {
      throw new Error("PTM inventory sync failed (HTTP " + status + "): " + (body.error || text || "UNKNOWN_ERROR"));
    }

    changed += Number(body.changed || 0);
    conflicts += Number(body.conflict_count || 0);
    unknown += Number(body.unknown_count || 0);
    invalid += Number(body.invalid_count || 0);
    Array.prototype.push.apply(conflictRows, body.conflicts || []);
    Array.prototype.push.apply(unknownRows, body.unknown || []);
    Array.prototype.push.apply(invalidRows, body.invalid || []);
  }

  return {
    ok: true,
    changed: changed,
    conflict_count: conflicts,
    unknown_count: unknown,
    invalid_count: invalid,
    conflicts: conflictRows.slice(0, 100),
    unknown: unknownRows.slice(0, 50),
    invalid: invalidRows.slice(0, 50)
  };
}

function requireInventorySecret_() {
  const secret = PropertiesService.getScriptProperties().getProperty(PTM_INVENTORY.SECRET_PROPERTY);
  if (!secret) {
    throw new Error("Missing Script Property " + PTM_INVENTORY.SECRET_PROPERTY + ". Add it in Apps Script > Project Settings > Script properties.");
  }
  return secret;
}

function removeInventoryTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === PTM_INVENTORY.TRIGGER_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
}

function loadInventorySnapshot_() {
  const props = PropertiesService.getScriptProperties();
  const count = Number(props.getProperty(PTM_INVENTORY.SNAPSHOT_PREFIX + "_COUNT") || 0);
  if (!count) return {};

  let json = "";
  for (let i = 0; i < count; i += 1) {
    json += props.getProperty(PTM_INVENTORY.SNAPSHOT_PREFIX + "_" + i) || "";
  }

  try { return JSON.parse(json || "{}"); } catch (error) { return {}; }
}

function saveInventorySnapshot_(snapshot) {
  const props = PropertiesService.getScriptProperties();
  const prefix = PTM_INVENTORY.SNAPSHOT_PREFIX;
  const previousCount = Number(props.getProperty(prefix + "_COUNT") || 0);
  const json = JSON.stringify(snapshot || {});
  const chunks = [];

  for (let start = 0; start < json.length; start += PTM_INVENTORY.SNAPSHOT_CHUNK_CHARS) {
    chunks.push(json.slice(start, start + PTM_INVENTORY.SNAPSHOT_CHUNK_CHARS));
  }

  const update = {};
  update[prefix + "_COUNT"] = String(chunks.length);
  chunks.forEach(function(chunk, index) { update[prefix + "_" + index] = chunk; });
  props.setProperties(update, false);

  for (let i = chunks.length; i < previousCount; i += 1) props.deleteProperty(prefix + "_" + i);
}
