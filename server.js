const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "findit.sqlite");
const FRONTEND_FILES = new Set(["index.html", "tests.html", "app.js", "styles.css"]);

const ITEM_FIELDS = [
  "name",
  "category",
  "foundLocation",
  "foundDate",
  "publicDescription",
  "privateClue"
];
const CLAIM_FIELDS = ["claimantName", "contact", "evidence"];

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    foundLocation TEXT NOT NULL,
    foundDate TEXT NOT NULL,
    publicDescription TEXT NOT NULL,
    privateClue TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    itemId TEXT NOT NULL,
    claimantName TEXT NOT NULL,
    contact TEXT NOT NULL,
    evidence TEXT NOT NULL,
    status TEXT NOT NULL,
    decisionReason TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (itemId) REFERENCES items(id)
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    createdAt TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    itemId TEXT NOT NULL DEFAULT '',
    claimId TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS archives (
    id TEXT PRIMARY KEY,
    itemId TEXT NOT NULL,
    archivedAt TEXT NOT NULL,
    snapshot TEXT NOT NULL
  );
`);

function tableColumnNames(table) {
  return db.prepare("PRAGMA table_info(" + table + ")").all().map(function (column) {
    return column.name;
  });
}

function ensureColumn(table, name, definition) {
  const names = tableColumnNames(table);
  if (names.indexOf(name) === -1) {
    db.exec("ALTER TABLE " + table + " ADD COLUMN " + name + " " + definition);
  }
}

function ensureSchemaExtras() {
  ensureColumn("items", "createdAt", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("items", "publishedAt", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("items", "returnedAt", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("items", "archived", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("claims", "visitorMarkedClaimed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("claims", "staffMarkedClaimed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("claims", "decidedBy", "TEXT NOT NULL DEFAULT ''");
}

ensureSchemaExtras();
db.prepare(
  "UPDATE claims SET decidedBy = 'Staff' WHERE status IN ('APPROVED', 'REJECTED') AND decidedBy = ''"
).run();

function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS total FROM items").get().total;
  if (count > 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO items (
      id, name, category, foundLocation, foundDate, publicDescription, privateClue, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    "item-1",
    "Navy hoodie",
    "Clothing",
    "Library, 2nd floor",
    "2026-08-12",
    "A navy zip-up hoodie left on a study table near the windows.",
    "Laundry tag inside the collar has the initials M.K.",
    "DRAFT"
  );
  insert.run(
    "item-2",
    "Student ID card",
    "Cards",
    "Campus Cafe",
    "2026-08-14",
    "A campus student ID found near the till. The name is not shown in the public listing.",
    "The photo shows a student wearing a red beanie.",
    "PUBLISHED"
  );
  insert.run(
    "item-3",
    "Silver keys",
    "Keys",
    "Gym entrance",
    "2026-08-10",
    "A small set of silver keys on a blue carabiner.",
    "One key has a tiny sticker that says locker 214.",
    "RESERVED"
  );
  insert.run(
    "item-4",
    "Black umbrella",
    "Other",
    "Bus stop B",
    "2026-08-08",
    "A folded black umbrella left under the shelter bench.",
    "The handle has a chipped red paint mark.",
    "RETURNED"
  );
}

seedIfEmpty();

function nowIso() {
  return new Date().toISOString();
}

function firstLogTime(itemId, action) {
  const row = db
    .prepare(
      "SELECT createdAt FROM activity_log WHERE itemId = ? AND action = ? ORDER BY createdAt ASC, id ASC"
    )
    .get(itemId, action);
  return row && row.createdAt ? row.createdAt : "";
}

function backfillItemTimestamps() {
  db.prepare("SELECT * FROM items").all().forEach(function (row) {
    const item = plain(row);
    if (!item.createdAt) {
      const draftedAt = firstLogTime(item.id, "report_item");
      if (draftedAt) {
        db.prepare("UPDATE items SET createdAt = ? WHERE id = ?").run(draftedAt, item.id);
      }
    }
    if (!item.publishedAt && item.status !== "DRAFT") {
      const publishedAt = firstLogTime(item.id, "publish_item");
      if (publishedAt) {
        db.prepare("UPDATE items SET publishedAt = ? WHERE id = ?").run(publishedAt, item.id);
      }
    }
    if (!item.returnedAt && item.status === "RETURNED") {
      const returnedAt =
        firstLogTime(item.id, "staff_mark_claimed") ||
        firstLogTime(item.id, "visitor_mark_claimed");
      if (returnedAt) {
        db.prepare("UPDATE items SET returnedAt = ? WHERE id = ?").run(returnedAt, item.id);
      }
    }
  });
}

backfillItemTimestamps();

function plain(row) {
  return row ? Object.assign({}, row) : null;
}

function requestRole(req) {
  const role = String(req.get("X-Role") || "visitor").toLowerCase();
  return role === "staff" ? "staff" : "visitor";
}

function missingFields(body, fields) {
  return fields.filter(function (field) {
    return !body || typeof body[field] !== "string" || body[field].trim() === "";
  });
}

function nextPrefixedId(prefix, rows) {
  let max = 0;
  rows.forEach(function (row) {
    if (typeof row.id === "string" && row.id.indexOf(prefix) === 0) {
      const value = Number(row.id.slice(prefix.length));
      if (Number.isFinite(value) && value > max) {
        max = value;
      }
    }
  });
  return prefix + (max + 1);
}

function publicItem(item) {
  const copy = plain(item);
  delete copy.privateClue;
  return copy;
}

function publicClaim(claim) {
  const copy = plain(claim);
  delete copy.evidence;
  return copy;
}

function findItem(id) {
  return plain(db.prepare("SELECT * FROM items WHERE id = ?").get(id));
}

function findClaim(id) {
  return plain(db.prepare("SELECT * FROM claims WHERE id = ?").get(id));
}

function logAction(role, action, detail, itemId, claimId) {
  const id = nextPrefixedId("log-", db.prepare("SELECT id FROM activity_log").all());
  db.prepare(
    "INSERT INTO activity_log (id, createdAt, role, action, detail, itemId, claimId) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    new Date().toISOString(),
    role,
    action,
    detail || "",
    itemId || "",
    claimId || ""
  );
}

function isArchivedItem(item) {
  return !!(item && Number(item.archived) === 1);
}

function archivedItemIds() {
  return db
    .prepare("SELECT id FROM items WHERE archived = 1")
    .all()
    .map(function (row) {
      return row.id;
    });
}

function claimsForItem(itemId) {
  return db.prepare("SELECT * FROM claims WHERE itemId = ?").all(itemId).map(plain);
}

function logsForItem(itemId) {
  const claimIds = claimsForItem(itemId).map(function (claim) {
    return claim.id;
  });
  return db
    .prepare("SELECT * FROM activity_log ORDER BY createdAt ASC, id ASC")
    .all()
    .map(plain)
    .filter(function (entry) {
      return (
        entry.itemId === itemId ||
        (entry.claimId && claimIds.indexOf(entry.claimId) !== -1)
      );
    });
}

function parseArchiveRow(row) {
  const archive = plain(row);
  try {
    archive.record = JSON.parse(archive.snapshot);
  } catch (error) {
    archive.record = {};
  }
  delete archive.snapshot;
  return archive;
}

function buildArchiveRecord(item) {
  const relatedClaims = claimsForItem(item.id);
  let approved = null;
  relatedClaims.forEach(function (claim) {
    if (!approved && claim.status === "APPROVED") {
      approved = claim;
    }
  });
  return {
    itemId: item.id,
    name: item.name,
    category: item.category,
    foundLocation: item.foundLocation,
    foundDate: item.foundDate,
    publicDescription: item.publicDescription,
    privateClue: item.privateClue,
    draftedAt: item.createdAt || firstLogTime(item.id, "report_item"),
    publishedAt: item.publishedAt || firstLogTime(item.id, "publish_item"),
    returnedAt: item.returnedAt || "",
    approvedBy: approved ? approved.decidedBy || "Staff" : "",
    returnedTo: approved ? approved.claimantName : "",
    returnedToContact: approved ? approved.contact : "",
    decisionReason: approved ? approved.decisionReason : "",
    claims: relatedClaims,
    logs: logsForItem(item.id)
  };
}

function attachApprovedClaim(item) {
  if (!item) {
    return item;
  }
  const approved = plain(
    db
      .prepare(
        "SELECT id, visitorMarkedClaimed, staffMarkedClaimed FROM claims WHERE itemId = ? AND status = ?"
      )
      .get(item.id, "APPROVED")
  );
  item.approvedClaimId = approved ? approved.id : null;
  item.visitorMarkedClaimed = approved ? Number(approved.visitorMarkedClaimed) : 0;
  item.staffMarkedClaimed = approved ? Number(approved.staffMarkedClaimed) : 0;
  return item;
}

function isVisitorVisibleStatus(status) {
  return status === "PUBLISHED" || status === "RESERVED" || status === "RETURNED";
}

const app = express();
app.use(express.json());

app.get("/", function (_req, res) {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/:file", function (req, res, next) {
  if (!FRONTEND_FILES.has(req.params.file)) {
    return next();
  }
  res.sendFile(path.join(__dirname, req.params.file));
});

app.get("/api/items", function (req, res) {
  const role = requestRole(req);
  const rows = db
    .prepare("SELECT * FROM items WHERE archived = 0")
    .all()
    .map(plain);
  if (role === "staff") {
    return res.json({ ok: true, items: rows.map(attachApprovedClaim) });
  }
  const items = rows
    .filter(function (item) {
      return isVisitorVisibleStatus(item.status);
    })
    .map(publicItem)
    .map(attachApprovedClaim);
  return res.json({ ok: true, items: items });
});

app.get("/api/items/:id", function (req, res) {
  const role = requestRole(req);
  const item = findItem(req.params.id);
  if (!item || isArchivedItem(item)) {
    return res.status(404).json({ ok: false, error: "Item not found." });
  }
  if (role === "staff") {
    return res.json({ ok: true, item: attachApprovedClaim(item) });
  }
  if (item.status === "DRAFT") {
    return res.status(404).json({ ok: false, error: "Item not found." });
  }
  return res.json({ ok: true, item: attachApprovedClaim(publicItem(item)) });
});

app.post("/api/items", function (req, res) {
  if (requestRole(req) !== "staff") {
    return res.status(403).json({ ok: false, error: "Only staff can report items." });
  }

  const missing = missingFields(req.body, ITEM_FIELDS);
  if (missing.length > 0) {
    return res.status(400).json({
      ok: false,
      error: "Please fill in all required fields.",
      missing: missing
    });
  }

  const item = {
    id: nextPrefixedId("item-", db.prepare("SELECT id FROM items").all()),
    name: req.body.name.trim(),
    category: req.body.category.trim(),
    foundLocation: req.body.foundLocation.trim(),
    foundDate: req.body.foundDate.trim(),
    publicDescription: req.body.publicDescription.trim(),
    privateClue: req.body.privateClue.trim(),
    status: "DRAFT",
    createdAt: nowIso(),
    publishedAt: "",
    returnedAt: "",
    archived: 0
  };

  db.prepare(`
    INSERT INTO items (
      id, name, category, foundLocation, foundDate, publicDescription, privateClue, status,
      createdAt, publishedAt, returnedAt, archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id,
    item.name,
    item.category,
    item.foundLocation,
    item.foundDate,
    item.publicDescription,
    item.privateClue,
    item.status,
    item.createdAt,
    item.publishedAt,
    item.returnedAt,
    item.archived
  );

  logAction("staff", "report_item", "Reported " + item.name + " as DRAFT", item.id, "");
  return res.status(201).json({ ok: true, item: attachApprovedClaim(item) });
});

app.post("/api/items/:id/publish", function (req, res) {
  if (requestRole(req) !== "staff") {
    return res.status(403).json({ ok: false, error: "Only staff can publish items." });
  }

  const item = findItem(req.params.id);
  if (!item) {
    return res.status(404).json({ ok: false, error: "Item not found." });
  }
  if (item.status !== "DRAFT") {
    return res.status(400).json({ ok: false, error: "Only DRAFT items can be published." });
  }

  const publishedAt = nowIso();
  db.prepare("UPDATE items SET status = ?, publishedAt = ? WHERE id = ?").run(
    "PUBLISHED",
    publishedAt,
    item.id
  );
  item.status = "PUBLISHED";
  item.publishedAt = publishedAt;
  logAction("staff", "publish_item", "Published " + item.name, item.id, "");
  return res.json({ ok: true, item: attachApprovedClaim(item) });
});

function findApprovedClaimForItem(itemId) {
  return plain(
    db
      .prepare("SELECT * FROM claims WHERE itemId = ? AND status = ?")
      .get(itemId, "APPROVED")
  );
}

app.get("/api/claims", function (req, res) {
  const role = requestRole(req);
  const hidden = archivedItemIds();
  const rows = db
    .prepare("SELECT * FROM claims")
    .all()
    .map(plain)
    .filter(function (claim) {
      return hidden.indexOf(claim.itemId) === -1;
    });
  if (role === "staff") {
    return res.json({ ok: true, claims: rows });
  }
  return res.json({
    ok: true,
    claims: rows.map(publicClaim)
  });
});

app.post("/api/claims", function (req, res) {
  if (requestRole(req) !== "visitor") {
    return res.status(403).json({ ok: false, error: "Only visitors can submit a claim." });
  }

  const item = findItem(req.body && req.body.itemId);
  if (!item) {
    return res.status(404).json({ ok: false, error: "Item not found." });
  }
  if (item.status !== "PUBLISHED") {
    return res.status(400).json({
      ok: false,
      error: "A claim can only be submitted for a PUBLISHED item."
    });
  }
  if (isArchivedItem(item)) {
    return res.status(404).json({ ok: false, error: "Item not found." });
  }

  const missing = missingFields(req.body, CLAIM_FIELDS);
  if (missing.length > 0) {
    return res.status(400).json({
      ok: false,
      error: "Please fill in all required fields.",
      missing: missing
    });
  }

  const claim = {
    id: nextPrefixedId("claim-", db.prepare("SELECT id FROM claims").all()),
    itemId: item.id,
    claimantName: req.body.claimantName.trim(),
    contact: req.body.contact.trim(),
    evidence: req.body.evidence.trim(),
    status: "SUBMITTED",
    decisionReason: "",
    visitorMarkedClaimed: 0,
    staffMarkedClaimed: 0
  };

  db.prepare(`
    INSERT INTO claims (
      id, itemId, claimantName, contact, evidence, status, decisionReason,
      visitorMarkedClaimed, staffMarkedClaimed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    claim.id,
    claim.itemId,
    claim.claimantName,
    claim.contact,
    claim.evidence,
    claim.status,
    claim.decisionReason,
    claim.visitorMarkedClaimed,
    claim.staffMarkedClaimed
  );

  logAction(
    "visitor",
    "submit_claim",
    "Submitted a claim by " + claim.claimantName + " for item " + item.id,
    item.id,
    claim.id
  );
  return res.status(201).json({ ok: true, claim: claim });
});

app.post("/api/claims/:id/decision", function (req, res) {
  if (requestRole(req) !== "staff") {
    return res.status(403).json({ ok: false, error: "Only staff can decide claims." });
  }

  const claim = findClaim(req.params.id);
  if (!claim) {
    return res.status(404).json({ ok: false, error: "Claim not found." });
  }
  if (claim.status !== "SUBMITTED") {
    return res.status(400).json({ ok: false, error: "Only SUBMITTED claims can be decided." });
  }

  const nextStatus = req.body && req.body.status;
  if (nextStatus !== "APPROVED" && nextStatus !== "REJECTED") {
    return res.status(400).json({ ok: false, error: "Decision must be APPROVED or REJECTED." });
  }

  const decisionReason =
    req.body && typeof req.body.decisionReason === "string"
      ? req.body.decisionReason.trim()
      : "";
  if (!decisionReason) {
    return res.status(400).json({
      ok: false,
      error: "A staff decision must include a decisionReason."
    });
  }

  const item = findItem(claim.itemId);
  if (!item) {
    return res.status(404).json({ ok: false, error: "Item not found." });
  }

  if (nextStatus === "APPROVED") {
    const approved = db
      .prepare("SELECT id FROM claims WHERE itemId = ? AND status = ?")
      .get(claim.itemId, "APPROVED");
    if (approved) {
      return res.status(400).json({
        ok: false,
        error: "Only one claim can be approved for an item."
      });
    }
    if (item.status !== "PUBLISHED") {
      return res.status(400).json({
        ok: false,
        error: "Only PUBLISHED items can be reserved by an approved claim."
      });
    }
  }

  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE claims SET status = ?, decisionReason = ?, decidedBy = ? WHERE id = ?"
    ).run(nextStatus, decisionReason, "Staff", claim.id);
    if (nextStatus === "APPROVED") {
      db.prepare("UPDATE items SET status = ? WHERE id = ?").run(
        "RESERVED",
        item.id
      );
      item.status = "RESERVED";
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  claim.status = nextStatus;
  claim.decisionReason = decisionReason;
  claim.decidedBy = "Staff";
  logAction(
    "staff",
    nextStatus === "APPROVED" ? "approve_claim" : "reject_claim",
    (nextStatus === "APPROVED"
      ? "Approved by Staff; item is Approved - Reserved. "
      : "Rejected by Staff. ") + decisionReason,
    item.id,
    claim.id
  );
  return res.json({
    ok: true,
    claim: claim,
    item: attachApprovedClaim(item)
  });
});

app.post("/api/items/:id/mark-claimed", function (req, res) {
  const role = requestRole(req);
  const item = findItem(req.params.id);
  if (!item) {
    return res.status(404).json({ ok: false, error: "Item not found." });
  }
  if (isArchivedItem(item)) {
    return res.status(400).json({ ok: false, error: "Archived items cannot be updated." });
  }
  if (item.status === "RETURNED") {
    return res.status(400).json({
      ok: false,
      error:
        "This item is already " +
        (role === "staff" ? "Approved - Claimed" : "Claimed") +
        "."
    });
  }
  if (item.status !== "RESERVED") {
    return res.status(400).json({
      ok: false,
      error:
        "Only " +
        (role === "staff" ? "Approved - Reserved" : "Reserved") +
        " items can be marked as claimed."
    });
  }

  const claim = findApprovedClaimForItem(item.id);
  if (!claim) {
    return res.status(400).json({
      ok: false,
      error: "An approved claim is required before marking claimed."
    });
  }

  const flagColumn = role === "staff" ? "staffMarkedClaimed" : "visitorMarkedClaimed";
  if (Number(claim[flagColumn]) === 1) {
    return res.status(400).json({
      ok: false,
      error:
        role === "staff"
          ? "Staff already marked this item as claimed."
          : "Visitor already marked this item as claimed."
    });
  }

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE claims SET " + flagColumn + " = 1 WHERE id = ?").run(claim.id);
    claim[flagColumn] = 1;
    const bothMarked =
      Number(claim.visitorMarkedClaimed) === 1 &&
      Number(claim.staffMarkedClaimed) === 1;
    if (bothMarked) {
      const returnedAt = nowIso();
      db.prepare("UPDATE items SET status = ?, returnedAt = ? WHERE id = ?").run(
        "RETURNED",
        returnedAt,
        item.id
      );
      item.status = "RETURNED";
      item.returnedAt = returnedAt;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  logAction(
    role,
    role === "staff" ? "staff_mark_claimed" : "visitor_mark_claimed",
    item.status === "RETURNED"
      ? "Marked claimed. Item is now Approved - Claimed."
      : "Marked claimed. Waiting for the other side.",
    item.id,
    claim.id
  );

  return res.json({
    ok: true,
    item: attachApprovedClaim(item),
    claim: publicClaim(claim)
  });
});

app.get("/api/logs", function (req, res) {
  if (requestRole(req) !== "staff") {
    return res.status(403).json({
      ok: false,
      error: "Only staff can view the activity log."
    });
  }
  const logs = db
    .prepare("SELECT * FROM activity_log ORDER BY createdAt DESC, id DESC")
    .all()
    .map(plain);
  return res.json({ ok: true, logs: logs });
});

app.get("/api/archives", function (req, res) {
  if (requestRole(req) !== "staff") {
    return res.status(403).json({
      ok: false,
      error: "Only staff can view the archive."
    });
  }
  const archives = db
    .prepare("SELECT * FROM archives ORDER BY archivedAt DESC, id DESC")
    .all()
    .map(parseArchiveRow);
  return res.json({ ok: true, archives: archives });
});

app.post("/api/items/:id/archive", function (req, res) {
  if (requestRole(req) !== "staff") {
    return res.status(403).json({ ok: false, error: "Only staff can archive claims." });
  }
  const item = findItem(req.params.id);
  if (!item) {
    return res.status(404).json({ ok: false, error: "Item not found." });
  }
  if (isArchivedItem(item)) {
    return res.status(400).json({ ok: false, error: "This claim is already archived." });
  }
  if (item.status !== "RETURNED") {
    return res.status(400).json({
      ok: false,
      error: "Only Approved - Claimed items can be archived."
    });
  }
  const approved = findApprovedClaimForItem(item.id);
  if (!approved) {
    return res.status(400).json({
      ok: false,
      error: "An approved claim is required before archiving."
    });
  }

  logAction(
    "staff",
    "archive_claim",
    "Archived claim for " + item.name + ", returned to " + (approved.claimantName || "unknown"),
    item.id,
    approved.id
  );

  const archivedAt = nowIso();
  const record = buildArchiveRecord(item);
  record.archivedAt = archivedAt;
  const archive = {
    id: nextPrefixedId("archive-", db.prepare("SELECT id FROM archives").all()),
    itemId: item.id,
    archivedAt: archivedAt,
    snapshot: JSON.stringify(record)
  };

  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO archives (id, itemId, archivedAt, snapshot) VALUES (?, ?, ?, ?)"
    ).run(archive.id, archive.itemId, archive.archivedAt, archive.snapshot);
    db.prepare("UPDATE items SET archived = 1 WHERE id = ?").run(item.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return res.status(201).json({
    ok: true,
    archive: {
      id: archive.id,
      itemId: archive.itemId,
      archivedAt: archive.archivedAt,
      record: record
    }
  });
});

const server = app.listen(PORT, function () {
  console.log("FindIt running at http://127.0.0.1:" + PORT);
});

server.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    console.error(
      "Port " +
        PORT +
        " is already in use. The app may already be open at http://127.0.0.1:" +
        PORT
    );
    process.exit(1);
  }
  throw err;
});
