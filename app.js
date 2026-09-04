(function (global) {
  "use strict";

  var REQUIRED_FIELDS = [
    "name",
    "category",
    "foundLocation",
    "foundDate",
    "publicDescription",
    "privateClue"
  ];

  var REQUIRED_CLAIM_FIELDS = ["claimantName", "contact", "evidence"];

  var items = [];
  var claims = [];
  var nextNumericId = 1;
  var nextClaimId = 1;

  var activityLogs = [];
  var nextLogId = 1;
  var archives = [];
  var nextArchiveId = 1;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function itemStatusLabel(status, role) {
    var isStaff = role === "staff";
    if (status === "RESERVED") {
      return isStaff ? "Approved - Reserved" : "Reserved";
    }
    if (status === "RETURNED") {
      return isStaff ? "Approved - Claimed" : "Claimed";
    }
    if (status === "PUBLISHED") {
      return isStaff ? "Published" : "Available";
    }
    if (status === "DRAFT") {
      return "Draft";
    }
    return status;
  }

  function omitPrivateClue(item) {
    var copy = clone(item);
    delete copy.privateClue;
    return copy;
  }

  function getSeedItems() {
    return [
      {
        id: "item-1",
        name: "Navy hoodie",
        category: "Clothing",
        foundLocation: "Library, 2nd floor",
        foundDate: "2026-08-12",
        publicDescription:
          "A navy zip-up hoodie left on a study table near the windows.",
        privateClue: "Laundry tag inside the collar has the initials M.K.",
        status: "DRAFT",
        createdAt: "",
        publishedAt: "",
        returnedAt: "",
        archived: 0
      },
      {
        id: "item-2",
        name: "Student ID card",
        category: "Cards",
        foundLocation: "Campus Cafe",
        foundDate: "2026-08-14",
        publicDescription:
          "A campus student ID found near the till. The name is not shown in the public listing.",
        privateClue: "The photo shows a student wearing a red beanie.",
        status: "PUBLISHED",
        createdAt: "",
        publishedAt: "",
        returnedAt: "",
        archived: 0
      },
      {
        id: "item-3",
        name: "Silver keys",
        category: "Keys",
        foundLocation: "Gym entrance",
        foundDate: "2026-08-10",
        publicDescription: "A small set of silver keys on a blue carabiner.",
        privateClue: "One key has a tiny sticker that says locker 214.",
        status: "RESERVED",
        createdAt: "",
        publishedAt: "",
        returnedAt: "",
        archived: 0
      },
      {
        id: "item-4",
        name: "Black umbrella",
        category: "Other",
        foundLocation: "Bus stop B",
        foundDate: "2026-08-08",
        publicDescription: "A folded black umbrella left under the shelter bench.",
        privateClue: "The handle has a chipped red paint mark.",
        status: "RETURNED",
        createdAt: "",
        publishedAt: "",
        returnedAt: "",
        archived: 0
      }
    ];
  }

  function omitEvidence(claim) {
    var copy = clone(claim);
    delete copy.evidence;
    return copy;
  }

  function reset() {
    items = getSeedItems();
    claims = [];
    activityLogs = [];
    archives = [];
    nextNumericId = items.length + 1;
    nextClaimId = 1;
    nextLogId = 1;
    nextArchiveId = 1;
    return getItems();
  }

  function getItems() {
    return items.map(clone);
  }

  function getPublicItems() {
    return items
      .filter(function (item) {
        return (
          !item.archived &&
          (item.status === "PUBLISHED" ||
            item.status === "RESERVED" ||
            item.status === "RETURNED")
        );
      })
      .map(omitPrivateClue);
  }

  function findStoredItem(id) {
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].id === id) {
        return items[i];
      }
    }
    return null;
  }

  function getItem(id, options) {
    var item = findStoredItem(id);
    if (!item) {
      return null;
    }

    var role = options && options.role ? options.role : "visitor";
    if (role === "staff") {
      return clone(item);
    }

    if (item.status === "DRAFT" || item.archived) {
      return null;
    }

    return omitPrivateClue(item);
  }

  function validateItemInput(data) {
    var missing = [];
    REQUIRED_FIELDS.forEach(function (field) {
      if (!data || typeof data[field] !== "string" || data[field].trim() === "") {
        missing.push(field);
      }
    });
    return missing;
  }

  function createItem(data) {
    var missing = validateItemInput(data);
    if (missing.length > 0) {
      return {
        ok: false,
        error: "Please fill in all required fields.",
        missing: missing
      };
    }

    var item = {
      id: "item-" + nextNumericId,
      name: data.name.trim(),
      category: data.category.trim(),
      foundLocation: data.foundLocation.trim(),
      foundDate: data.foundDate.trim(),
      publicDescription: data.publicDescription.trim(),
      privateClue: data.privateClue.trim(),
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      publishedAt: "",
      returnedAt: "",
      archived: 0
    };
    nextNumericId += 1;
    items.push(item);
    recordLog("staff", "report_item", "Reported " + item.name + " as DRAFT", item.id, "");
    return { ok: true, item: clone(item) };
  }

  function publishItem(id) {
    var item = findStoredItem(id);
    if (!item) {
      return { ok: false, error: "Item not found." };
    }
    if (item.status !== "DRAFT") {
      return { ok: false, error: "Only DRAFT items can be published." };
    }
    item.status = "PUBLISHED";
    item.publishedAt = new Date().toISOString();
    recordLog("staff", "publish_item", "Published " + item.name, item.id, "");
    return { ok: true, item: clone(item) };
  }

  function canClaimItem(id) {
    var item = findStoredItem(id);
    return !!(item && item.status === "PUBLISHED");
  }

  function validateClaimInput(data) {
    var missing = [];
    REQUIRED_CLAIM_FIELDS.forEach(function (field) {
      if (!data || typeof data[field] !== "string" || data[field].trim() === "") {
        missing.push(field);
      }
    });
    return missing;
  }

  function createClaim(data) {
    var itemId = data && data.itemId;
    var item = findStoredItem(itemId);
    if (!item) {
      return { ok: false, error: "Item not found." };
    }
    if (item.status !== "PUBLISHED") {
      return {
        ok: false,
        error: "A claim can only be submitted for a PUBLISHED item."
      };
    }

    var missing = validateClaimInput(data);
    if (missing.length > 0) {
      return {
        ok: false,
        error: "Please fill in all required fields.",
        missing: missing
      };
    }

    var claim = {
      id: "claim-" + nextClaimId,
      itemId: item.id,
      claimantName: data.claimantName.trim(),
      contact: data.contact.trim(),
      evidence: data.evidence.trim(),
      status: "SUBMITTED",
      decisionReason: "",
      visitorMarkedClaimed: 0,
      staffMarkedClaimed: 0,
      decidedBy: ""
    };
    nextClaimId += 1;
    claims.push(claim);
    recordLog(
      "visitor",
      "submit_claim",
      "Submitted a claim by " + claim.claimantName + " for item " + item.id,
      item.id,
      claim.id
    );
    return { ok: true, claim: clone(claim) };
  }

  function getClaims(options) {
    var role = options && options.role ? options.role : "staff";
    if (role === "visitor") {
      return claims.map(omitEvidence);
    }
    return claims.map(clone);
  }

  function decideClaim(id, data) {
    var claim = null;
    for (var i = 0; i < claims.length; i += 1) {
      if (claims[i].id === id) {
        claim = claims[i];
        break;
      }
    }
    if (!claim) {
      return { ok: false, error: "Claim not found." };
    }
    if (claim.status !== "SUBMITTED") {
      return { ok: false, error: "Only SUBMITTED claims can be decided." };
    }

    var nextStatus = data && data.status;
    if (nextStatus !== "APPROVED" && nextStatus !== "REJECTED") {
      return { ok: false, error: "Decision must be APPROVED or REJECTED." };
    }

    var decisionReason =
      data && typeof data.decisionReason === "string" ? data.decisionReason.trim() : "";
    if (!decisionReason) {
      return {
        ok: false,
        error: "A staff decision must include a decisionReason."
      };
    }

    var item = findStoredItem(claim.itemId);
    if (!item) {
      return { ok: false, error: "Item not found." };
    }

    if (nextStatus === "APPROVED") {
      for (var j = 0; j < claims.length; j += 1) {
        if (claims[j].itemId === claim.itemId && claims[j].status === "APPROVED") {
          return {
            ok: false,
            error: "Only one claim can be approved for an item."
          };
        }
      }
      if (item.status !== "PUBLISHED") {
        return {
          ok: false,
          error: "Only PUBLISHED items can be reserved by an approved claim."
        };
      }
      item.status = "RESERVED";
    }

    claim.status = nextStatus;
    claim.decisionReason = decisionReason;
    claim.decidedBy = "Staff";
    recordLog(
      "staff",
      nextStatus === "APPROVED" ? "approve_claim" : "reject_claim",
      nextStatus === "APPROVED"
        ? "Approved by Staff; item is Approved - Reserved."
        : "Rejected by Staff.",
      item.id,
      claim.id
    );
    return { ok: true, claim: clone(claim), item: clone(item) };
  }

  function recordLog(role, action, detail, itemId, claimId) {
    activityLogs.unshift({
      id: "log-" + nextLogId,
      createdAt: new Date().toISOString(),
      role: role,
      action: action,
      detail: detail || "",
      itemId: itemId || "",
      claimId: claimId || ""
    });
    nextLogId += 1;
  }

  function markClaimed(itemId, role) {
    role = role === "staff" ? "staff" : "visitor";
    var item = findStoredItem(itemId);
    if (!item) {
      return { ok: false, error: "Item not found." };
    }
    if (item.status === "RETURNED") {
      return {
        ok: false,
        error: "This item is already " + itemStatusLabel("RETURNED", role) + "."
      };
    }
    if (item.status !== "RESERVED") {
      return {
        ok: false,
        error:
          "Only " +
          itemStatusLabel("RESERVED", role) +
          " items can be marked as claimed."
      };
    }
    var claim = null;
    for (var i = 0; i < claims.length; i += 1) {
      if (claims[i].itemId === item.id && claims[i].status === "APPROVED") {
        claim = claims[i];
        break;
      }
    }
    if (!claim) {
      return {
        ok: false,
        error: "An approved claim is required before marking claimed."
      };
    }
    var flag = role === "staff" ? "staffMarkedClaimed" : "visitorMarkedClaimed";
    if (claim[flag] === 1) {
      return {
        ok: false,
        error:
          role === "staff"
            ? "Staff already marked this item as claimed."
            : "Visitor already marked this item as claimed."
      };
    }
    claim[flag] = 1;
    if (claim.visitorMarkedClaimed === 1 && claim.staffMarkedClaimed === 1) {
      item.status = "RETURNED";
      item.returnedAt = new Date().toISOString();
    }
    recordLog(
      role,
      role === "staff" ? "staff_mark_claimed" : "visitor_mark_claimed",
      item.status === "RETURNED"
        ? "Marked claimed. Item is now Approved - Claimed."
        : "Marked claimed. Waiting for the other side.",
      item.id,
      claim.id
    );
    return { ok: true, item: clone(item), claim: omitEvidence(claim) };
  }

  function getLogs(options) {
    if (!options || options.role !== "staff") {
      return { ok: false, error: "Only staff can view the activity log." };
    }
    return { ok: true, logs: activityLogs.map(clone) };
  }

  function logsForItem(itemId) {
    var claimIds = [];
    claims.forEach(function (claim) {
      if (claim.itemId === itemId) {
        claimIds.push(claim.id);
      }
    });
    return activityLogs.filter(function (entry) {
      return (
        entry.itemId === itemId ||
        (entry.claimId && claimIds.indexOf(entry.claimId) !== -1)
      );
    });
  }

  function archiveItem(itemId, role) {
    if (role !== "staff") {
      return { ok: false, error: "Only staff can archive claims." };
    }
    var item = findStoredItem(itemId);
    if (!item) {
      return { ok: false, error: "Item not found." };
    }
    if (item.archived) {
      return { ok: false, error: "This claim is already archived." };
    }
    if (item.status !== "RETURNED") {
      return {
        ok: false,
        error: "Only Approved - Claimed items can be archived."
      };
    }
    var relatedClaims = [];
    var approved = null;
    claims.forEach(function (claim) {
      if (claim.itemId === item.id) {
        relatedClaims.push(claim);
        if (!approved && claim.status === "APPROVED") {
          approved = claim;
        }
      }
    });
    if (!approved) {
      return {
        ok: false,
        error: "An approved claim is required before archiving."
      };
    }
    recordLog(
      "staff",
      "archive_claim",
      "Archived claim for " + item.name + ", returned to " + approved.claimantName,
      item.id,
      approved.id
    );
    var archivedAt = new Date().toISOString();
    var archive = {
      id: "archive-" + nextArchiveId,
      itemId: item.id,
      archivedAt: archivedAt,
      record: {
        itemId: item.id,
        name: item.name,
        category: item.category,
        foundLocation: item.foundLocation,
        foundDate: item.foundDate,
        publicDescription: item.publicDescription,
        privateClue: item.privateClue,
        draftedAt: item.createdAt || "",
        publishedAt: item.publishedAt || "",
        returnedAt: item.returnedAt || "",
        archivedAt: archivedAt,
        approvedBy: approved.decidedBy || "Staff",
        returnedTo: approved.claimantName,
        returnedToContact: approved.contact,
        decisionReason: approved.decisionReason,
        claims: relatedClaims.map(clone),
        logs: logsForItem(item.id).map(clone)
      }
    };
    nextArchiveId += 1;
    item.archived = 1;
    archives.unshift(archive);
    return { ok: true, archive: clone(archive) };
  }

  function getArchives(options) {
    if (!options || options.role !== "staff") {
      return { ok: false, error: "Only staff can view the archive." };
    }
    return { ok: true, archives: archives.map(clone) };
  }

  global.FindIt = {
    getItems: getItems,
    getPublicItems: getPublicItems,
    getItem: getItem,
    createItem: createItem,
    publishItem: publishItem,
    canClaimItem: canClaimItem,
    createClaim: createClaim,
    getClaims: getClaims,
    decideClaim: decideClaim,
    markClaimed: markClaimed,
    getLogs: getLogs,
    archiveItem: archiveItem,
    getArchives: getArchives,
    itemStatusLabel: itemStatusLabel,
    reset: reset,
    validateItemInput: validateItemInput,
    validateClaimInput: validateClaimInput
  };

  reset();

  function initUI() {
    var role = "visitor";
    var view = "list";
    var selectedId = null;
    var selectedClaimId = null;
    var selectedArchiveId = null;

    var banner = document.getElementById("banner");
    var viewList = document.getElementById("view-list");
    var viewDetails = document.getElementById("view-details");
    var viewReport = document.getElementById("view-report");
    var viewClaim = document.getElementById("view-claim");
    var viewReview = document.getElementById("view-review");
    var viewMyClaims = document.getElementById("view-my-claims");
    var viewDecision = document.getElementById("view-decision");
    var viewLog = document.getElementById("view-log");
    var viewArchive = document.getElementById("view-archive");
    var viewArchiveDetails = document.getElementById("view-archive-details");
    var reviewEmpty = document.getElementById("review-empty");
    var myClaimsEmpty = document.getElementById("my-claims-empty");
    var logEmpty = document.getElementById("log-empty");
    var archiveEmpty = document.getElementById("archive-empty");
    var claimList = document.getElementById("claim-list");
    var myClaimList = document.getElementById("my-claim-list");
    var logList = document.getElementById("log-list");
    var archiveList = document.getElementById("archive-list");
    var archiveDetails = document.getElementById("archive-details");
    var claimDecision = document.getElementById("claim-decision");
    var navReport = document.getElementById("nav-report");
    var navReview = document.getElementById("nav-review");
    var navMyClaims = document.getElementById("nav-my-claims");
    var navLog = document.getElementById("nav-log");
    var navArchive = document.getElementById("nav-archive");
    var listHeading = document.getElementById("list-heading");
    var listIntro = document.getElementById("list-intro");
    var listEmpty = document.getElementById("list-empty");
    var itemList = document.getElementById("item-list");
    var itemDetails = document.getElementById("item-details");
    var roleDropdown = document.getElementById("role-dropdown");
    var roleToggle = document.getElementById("role-toggle");
    var roleMenu = document.getElementById("role-menu");
    var roleCurrent = document.getElementById("role-current");
    var roleOptions = roleMenu.querySelectorAll(".role-option");
    var reportForm = document.getElementById("report-form");
    var formError = document.getElementById("form-error");
    var claimForm = document.getElementById("claim-form");
    var claimError = document.getElementById("claim-error");
    var claimItemName = document.getElementById("claim-item-name");

    function showBanner(type, text) {
      banner.hidden = !text;
      banner.className = "banner banner-" + type;
      banner.textContent = text || "";
    }

    function clearBanner() {
      showBanner("", "");
    }

    function closeRoleMenu() {
      roleMenu.hidden = true;
      roleDropdown.classList.remove("is-open");
      roleToggle.setAttribute("aria-expanded", "false");
    }

    function openRoleMenu() {
      roleMenu.hidden = false;
      roleDropdown.classList.add("is-open");
      roleToggle.setAttribute("aria-expanded", "true");
    }

    function request(method, path, body) {
      var options = {
        method: method,
        headers: {
          "Content-Type": "application/json",
          "X-Role": role
        }
      };
      if (body) {
        options.body = JSON.stringify(body);
      }
      return fetch(path, options)
        .then(function (response) {
          return response.json().catch(function () {
            return { ok: false, error: "The server returned an unexpected response." };
          });
        })
        .catch(function () {
          return {
            ok: false,
            error: "Could not reach the server. Run npm start and open the app from that address."
          };
        });
    }

    function setRole(nextRole) {
      role = nextRole;
      roleCurrent.textContent = nextRole === "staff" ? "Staff" : "Visitor";
      for (var i = 0; i < roleOptions.length; i += 1) {
        var selected = roleOptions[i].getAttribute("data-role") === role;
        roleOptions[i].classList.toggle("is-selected", selected);
        roleOptions[i].setAttribute("aria-selected", selected ? "true" : "false");
      }
      navReport.hidden = role !== "staff";
      navReview.hidden = role !== "staff";
      navLog.hidden = role !== "staff";
      navArchive.hidden = role !== "staff";
      navMyClaims.hidden = role !== "visitor";
      if (role === "visitor" && (view === "report" || view === "review" || view === "decision" || view === "log" || view === "archive" || view === "archive-details")) {
        view = "list";
      }
      if (role === "staff" && (view === "claim" || view === "my-claims")) {
        view = "list";
      }
      render();
    }

    function setView(nextView, id) {
      view = nextView;
      if (typeof id !== "undefined") {
        if (nextView === "decision") {
          selectedClaimId = id;
        } else if (nextView === "archive-details") {
          selectedArchiveId = id;
        } else {
          selectedId = id;
        }
      }
      render();
    }

    function listedItems() {
      return request("GET", "/api/items").then(function (data) {
        return data.items || [];
      });
    }

    function renderList() {
      listHeading.textContent = role === "staff" ? "Staff item catalogue" : "Found items";
      listIntro.textContent =
        role === "staff"
          ? "Drafts stay private until you publish them. Visitors see published, reserved, and claimed items."
          : "Browse Available, Reserved, and Claimed items.";

      listedItems().then(function (records) {
        if (view !== "list") {
          return;
        }
        if (records.length === 0) {
          listEmpty.hidden = false;
          listEmpty.textContent =
            role === "staff"
              ? "No items have been reported yet."
              : "There are no items to browse yet.";
          itemList.innerHTML = "";
          return;
        }

        listEmpty.hidden = true;
        itemList.innerHTML = records
          .map(function (item) {
            var archiveButton =
              role === "staff" && item.status === "RETURNED" && item.approvedClaimId
                ? '<button type="button" class="secondary-button" data-archive-item="' +
                  escapeHtml(item.id) +
                  '">Archive Claim</button>'
                : "";
            return (
              '<article class="item-card" data-open-item="' +
              escapeHtml(item.id) +
              '">' +
              '<p class="status-badge status-' +
              item.status.toLowerCase() +
              '">' +
              escapeHtml(itemStatusLabel(item.status, role)) +
              "</p>" +
              "<h3>" +
              escapeHtml(item.name) +
              "</h3>" +
              '<p class="card-meta"><span>' +
              escapeHtml(item.category) +
              "</span><span>" +
              escapeHtml(item.foundLocation) +
              "</span></p>" +
              '<div class="card-actions">' +
              '<button type="button" class="text-button" data-open-item="' +
              escapeHtml(item.id) +
              '">View details</button>' +
              archiveButton +
              "</div>" +
              "</article>"
            );
          })
          .join("");
      });
    }

    function renderDetails() {
      request("GET", "/api/items/" + encodeURIComponent(selectedId)).then(function (data) {
        if (view !== "details") {
          return;
        }
        var item = data.item;
        if (!item) {
          itemDetails.innerHTML =
            "<p class=\"empty-message\">This item is not available in the current view.</p>";
          return;
        }

        var html =
          '<p class="status-badge status-' +
          item.status.toLowerCase() +
          '">' +
          escapeHtml(itemStatusLabel(item.status, role)) +
          "</p>" +
          "<h2>" +
          escapeHtml(item.name) +
          "</h2>" +
          '<dl class="details-list">' +
          "<dt>Category</dt><dd>" +
          escapeHtml(item.category) +
          "</dd>" +
          "<dt>Found location</dt><dd>" +
          escapeHtml(item.foundLocation) +
          "</dd>" +
          "<dt>Found date</dt><dd>" +
          escapeHtml(item.foundDate) +
          "</dd>" +
          "<dt>Public description</dt><dd>" +
          escapeHtml(item.publicDescription) +
          "</dd>";

        if (role === "staff" && Object.prototype.hasOwnProperty.call(item, "privateClue")) {
          html +=
            '<dt>Private clue</dt><dd class="private-clue">' +
            escapeHtml(item.privateClue) +
            "</dd>";
        }

        html += "</dl>";

        if (item.status === "RESERVED") {
          html +=
            "<p class=\"lede\">Visitor marked claimed: " +
            (Number(item.visitorMarkedClaimed) === 1 ? "yes" : "not yet") +
            ". Staff marked claimed: " +
            (Number(item.staffMarkedClaimed) === 1 ? "yes" : "not yet") +
            ".</p>";
        }

        if (role === "staff" && item.status === "DRAFT") {
          html +=
            '<button type="button" id="publish-item" class="primary-button">Publish item</button>';
        }

        if (role === "visitor" && item.status === "PUBLISHED") {
          html +=
            '<button type="button" id="claim-item" class="primary-button">Claim item</button>';
        } else if (item.status === "RESERVED" && item.approvedClaimId) {
          var alreadyMarked =
            (role === "staff" && Number(item.staffMarkedClaimed) === 1) ||
            (role === "visitor" && Number(item.visitorMarkedClaimed) === 1);
          if (alreadyMarked) {
            html +=
              '<p class="lede">You have marked this item as claimed. Waiting for the other side.</p>';
          } else {
            html +=
              '<button type="button" id="mark-claimed" class="primary-button">Mark as claimed</button>';
          }
        } else if (item.status === "RETURNED") {
          html +=
            '<p class="lede">Visitor and staff have both marked this item as claimed.</p>';
          if (role === "staff" && item.approvedClaimId) {
            html +=
              '<button type="button" id="archive-claim" class="secondary-button">Archive Claim</button>';
          }
        } else if (role === "visitor") {
          html +=
            '<p class="lede">This item is not available to claim.</p>';
        }

        itemDetails.innerHTML = html;
      });
    }

    function renderClaim() {
      request("GET", "/api/items/" + encodeURIComponent(selectedId)).then(function (data) {
        if (view !== "claim") {
          return;
        }
        var item = data.item;
        if (!item || item.status !== "PUBLISHED") {
          claimItemName.textContent = "";
          claimForm.hidden = true;
          claimError.hidden = false;
          claimError.textContent = "This item is not available to claim.";
          return;
        }
        claimForm.hidden = false;
        claimError.hidden = true;
        claimItemName.textContent = item.name;
      });
    }

    function itemNameFromList(items, itemId) {
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].id === itemId) {
          return items[i].name;
        }
      }
      return itemId;
    }

    function itemStatusFromList(items, itemId) {
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].id === itemId) {
          return items[i].status;
        }
      }
      return "";
    }

    function formatLogTime(value) {
      if (!value) {
        return "Unknown";
      }
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return date.toLocaleString();
    }

    function claimStatusLabel(status) {
      if (status === "APPROVED") {
        return "Approved";
      }
      if (status === "REJECTED") {
        return "Rejected";
      }
      if (status === "SUBMITTED") {
        return "Submitted";
      }
      return status;
    }

    function claimOutcomeText(claim) {
      if (claim.status === "APPROVED") {
        return claim.decisionReason
          ? "Approved. " + claim.decisionReason
          : "Approved.";
      }
      if (claim.status === "REJECTED") {
        return claim.decisionReason
          ? "Rejected. " + claim.decisionReason
          : "Rejected.";
      }
      return "Submitted. Waiting for a staff decision.";
    }

    function renderMyClaims() {
      Promise.all([request("GET", "/api/claims"), request("GET", "/api/items")]).then(
        function (results) {
          if (view !== "my-claims") {
            return;
          }
          var claims = results[0].claims || [];
          var items = results[1].items || [];
          if (!results[0].ok) {
            myClaimsEmpty.hidden = false;
            myClaimsEmpty.textContent = results[0].error || "Could not load claims.";
            myClaimList.innerHTML = "";
            return;
          }
          if (claims.length === 0) {
            myClaimsEmpty.hidden = false;
            myClaimsEmpty.textContent = "You have not submitted any claims yet.";
            myClaimList.innerHTML = "";
            return;
          }
          myClaimsEmpty.hidden = true;
          myClaimList.innerHTML = claims
            .map(function (claim) {
              return (
                '<article class="item-card" data-open-item="' +
                escapeHtml(claim.itemId) +
                '">' +
                '<p class="status-badge status-' +
                claim.status.toLowerCase() +
                '">' +
                claim.status +
                "</p>" +
                "<h3>" +
                escapeHtml(itemNameFromList(items, claim.itemId)) +
                "</h3>" +
                '<p class="card-meta">' +
                escapeHtml(
                  claimOutcomeText(claim) +
                    (claim.status === "APPROVED"
                      ? " Item is " +
                        itemStatusLabel(itemStatusFromList(items, claim.itemId), role) +
                        "."
                      : "")
                ) +
                "</p>" +
                '<button type="button" class="text-button" data-open-item="' +
                escapeHtml(claim.itemId) +
                '">View item</button>' +
                "</article>"
              );
            })
            .join("");
        }
      );
    }

    function renderReview() {
      Promise.all([request("GET", "/api/claims"), request("GET", "/api/items")]).then(
        function (results) {
          if (view !== "review") {
            return;
          }
          var claims = results[0].claims || [];
          var items = results[1].items || [];
          if (!results[0].ok) {
            reviewEmpty.hidden = false;
            reviewEmpty.textContent = results[0].error || "Could not load claims.";
            claimList.innerHTML = "";
            return;
          }
          if (claims.length === 0) {
            reviewEmpty.hidden = false;
            reviewEmpty.textContent = "No claims have been submitted yet.";
            claimList.innerHTML = "";
            return;
          }
          reviewEmpty.hidden = true;
          claimList.innerHTML = claims
            .map(function (claim) {
              return (
                '<article class="item-card" data-open-claim="' +
                escapeHtml(claim.id) +
                '">' +
                '<p class="status-badge status-' +
                claim.status.toLowerCase() +
                '">' +
                claim.status +
                "</p>" +
                "<h3>" +
                escapeHtml(itemNameFromList(items, claim.itemId)) +
                "</h3>" +
                '<p class="card-meta"><span>' +
                escapeHtml(claim.claimantName) +
                "</span></p>" +
                '<button type="button" class="text-button" data-open-claim="' +
                escapeHtml(claim.id) +
                '">Review claim</button>' +
                "</article>"
              );
            })
            .join("");
        }
      );
    }

    function renderDecision() {
      Promise.all([request("GET", "/api/claims"), request("GET", "/api/items")]).then(
        function (results) {
          if (view !== "decision") {
            return;
          }
          var claims = results[0].claims || [];
          var items = results[1].items || [];
          var claim = null;
          var item = null;
          var i;
          for (i = 0; i < claims.length; i += 1) {
            if (claims[i].id === selectedClaimId) {
              claim = claims[i];
              break;
            }
          }
          if (claim) {
            for (i = 0; i < items.length; i += 1) {
              if (items[i].id === claim.itemId) {
                item = items[i];
                break;
              }
            }
          }
          if (!claim) {
            claimDecision.innerHTML =
              '<p class="empty-message">This claim is not available.</p>';
            return;
          }

          var html =
            '<p class="status-badge status-' +
            claim.status.toLowerCase() +
            '">' +
            claim.status +
            "</p>" +
            "<h2>" +
            escapeHtml(item ? item.name : claim.itemId) +
            "</h2>" +
            '<dl class="details-list">' +
            "<dt>Item status</dt><dd>" +
            escapeHtml(item ? itemStatusLabel(item.status, role) : "") +
            "</dd>" +
            "<dt>Claimant</dt><dd>" +
            escapeHtml(claim.claimantName) +
            "</dd>" +
            "<dt>Contact</dt><dd>" +
            escapeHtml(claim.contact) +
            "</dd>" +
            "<dt>Evidence</dt><dd class=\"private-clue\">" +
            escapeHtml(claim.evidence || "") +
            "</dd>";
          if (item && item.privateClue) {
            html +=
              "<dt>Private clue</dt><dd class=\"private-clue\">" +
              escapeHtml(item.privateClue) +
              "</dd>";
          }
          if (claim.decisionReason) {
            html +=
              "<dt>Decision reason</dt><dd>" +
              escapeHtml(claim.decisionReason) +
              "</dd>";
          }
          html += "</dl>";

          if (claim.status === "SUBMITTED") {
            html +=
              '<form id="decision-form" class="report-form" novalidate>' +
              '<p id="decision-error" class="form-error full" hidden></p>' +
              '<label class="full">Decision reason' +
              '<textarea name="decisionReason" rows="3" maxlength="400" required></textarea>' +
              "</label>" +
              '<div class="decision-actions full">' +
              '<button type="button" id="approve-claim" class="primary-button">Approve</button>' +
              '<button type="button" id="reject-claim" class="secondary-button">Reject</button>' +
              "</div>" +
              "</form>";
          }

          claimDecision.innerHTML = html;
        }
      );
    }

    function renderLog() {
      request("GET", "/api/logs").then(function (data) {
        if (view !== "log") {
          return;
        }
        var logs = data.logs || [];
        if (!data.ok) {
          logEmpty.hidden = false;
          logEmpty.textContent = data.error || "Could not load the activity log.";
          logList.innerHTML = "";
          return;
        }
        if (logs.length === 0) {
          logEmpty.hidden = false;
          logEmpty.textContent = "No actions have been logged yet.";
          logList.innerHTML = "";
          return;
        }
        logEmpty.hidden = true;
        logList.innerHTML = logs
          .map(function (entry) {
            return (
              '<article class="log-row">' +
              "<p class=\"log-meta\">" +
              escapeHtml(formatLogTime(entry.createdAt)) +
              " · " +
              escapeHtml(entry.role) +
              " · " +
              escapeHtml(entry.action) +
              "</p>" +
              "<p>" +
              escapeHtml(entry.detail) +
              "</p>" +
              "</article>"
            );
          })
          .join("");
      });
    }

    function archiveRecordHtml(archive) {
      var record = archive.record || {};
      var claimsHtml =
        (record.claims || [])
          .map(function (claim) {
            return (
              "<li>" +
              "<strong>" +
              escapeHtml(claim.claimantName) +
              "</strong> (" +
              escapeHtml(claim.contact) +
              ") — " +
              escapeHtml(claimStatusLabel(claim.status)) +
              (claim.decisionReason
                ? ". " + escapeHtml(claim.decisionReason)
                : "") +
              (claim.evidence
                ? " Evidence: " + escapeHtml(claim.evidence)
                : "") +
              "</li>"
            );
          })
          .join("") || "<li>No claims were recorded.</li>";
      var logsHtml =
        (record.logs || [])
          .map(function (entry) {
            return (
              "<li>" +
              '<p class="log-meta">' +
              escapeHtml(formatLogTime(entry.createdAt)) +
              " · " +
              escapeHtml(entry.role) +
              " · " +
              escapeHtml(entry.action) +
              "</p>" +
              "<p>" +
              escapeHtml(entry.detail) +
              "</p>" +
              "</li>"
            );
          })
          .join("") || "<li>No related log entries.</li>";
      return (
        '<p class="status-badge status-archived">Archived</p>' +
        "<h2>" +
        escapeHtml(record.name || archive.itemId) +
        "</h2>" +
        '<dl class="details-list">' +
        "<dt>Approved by</dt><dd>" +
        escapeHtml(record.approvedBy || "Unknown") +
        "</dd>" +
        "<dt>Returned to</dt><dd>" +
        escapeHtml(record.returnedTo || "Unknown") +
        (record.returnedToContact
          ? " (" + escapeHtml(record.returnedToContact) + ")"
          : "") +
        "</dd>" +
        "<dt>Drafted</dt><dd>" +
        escapeHtml(formatLogTime(record.draftedAt)) +
        "</dd>" +
        "<dt>Published</dt><dd>" +
        escapeHtml(formatLogTime(record.publishedAt)) +
        "</dd>" +
        "<dt>Returned</dt><dd>" +
        escapeHtml(formatLogTime(record.returnedAt)) +
        "</dd>" +
        "<dt>Archived</dt><dd>" +
        escapeHtml(formatLogTime(record.archivedAt || archive.archivedAt)) +
        "</dd>" +
        "<dt>Found location</dt><dd>" +
        escapeHtml(record.foundLocation || "") +
        "</dd>" +
        "<dt>Public description</dt><dd>" +
        escapeHtml(record.publicDescription || "") +
        "</dd>" +
        "<dt>Private clue</dt><dd class=\"private-clue\">" +
        escapeHtml(record.privateClue || "") +
        "</dd>" +
        "</dl>" +
        "<h3>Who made claims</h3>" +
        '<ul class="archive-claims">' +
        claimsHtml +
        "</ul>" +
        "<h3>Related activity log</h3>" +
        '<ul class="archive-logs">' +
        logsHtml +
        "</ul>"
      );
    }

    function renderArchive() {
      request("GET", "/api/archives").then(function (data) {
        if (view !== "archive") {
          return;
        }
        var archives = data.archives || [];
        if (!data.ok) {
          archiveEmpty.hidden = false;
          archiveEmpty.textContent = data.error || "Could not load the archive.";
          archiveList.innerHTML = "";
          return;
        }
        if (archives.length === 0) {
          archiveEmpty.hidden = false;
          archiveEmpty.textContent = "No claims have been archived yet.";
          archiveList.innerHTML = "";
          return;
        }
        archiveEmpty.hidden = true;
        archiveList.innerHTML = archives
          .map(function (archive) {
            var record = archive.record || {};
            return (
              '<article class="item-card" data-open-archive="' +
              escapeHtml(archive.id) +
              '">' +
              '<p class="status-badge status-archived">Archived</p>' +
              "<h3>" +
              escapeHtml(record.name || archive.itemId) +
              "</h3>" +
              '<p class="card-meta"><span>' +
              escapeHtml(record.category || "") +
              "</span><span>" +
              escapeHtml(record.foundLocation || "") +
              "</span></p>" +
              '<button type="button" class="text-button" data-open-archive="' +
              escapeHtml(archive.id) +
              '">View details</button>' +
              "</article>"
            );
          })
          .join("");
      });
    }

    function renderArchiveDetails() {
      request("GET", "/api/archives").then(function (data) {
        if (view !== "archive-details") {
          return;
        }
        var archives = data.archives || [];
        var archive = null;
        var i;
        for (i = 0; i < archives.length; i += 1) {
          if (archives[i].id === selectedArchiveId) {
            archive = archives[i];
            break;
          }
        }
        if (!data.ok || !archive) {
          archiveDetails.innerHTML =
            '<p class="empty-message">This archived claim is not available.</p>';
          return;
        }
        archiveDetails.innerHTML = archiveRecordHtml(archive);
      });
    }

    function render() {
      viewList.hidden = view !== "list";
      viewDetails.hidden = view !== "details";
      viewReport.hidden = view !== "report";
      viewClaim.hidden = view !== "claim";
      viewMyClaims.hidden = view !== "my-claims";
      viewReview.hidden = view !== "review";
      viewDecision.hidden = view !== "decision";
      viewLog.hidden = view !== "log";
      viewArchive.hidden = view !== "archive";
      viewArchiveDetails.hidden = view !== "archive-details";

      if (view === "list") {
        renderList();
      } else if (view === "details") {
        renderDetails();
      } else if (view === "claim") {
        renderClaim();
      } else if (view === "my-claims") {
        renderMyClaims();
      } else if (view === "review") {
        renderReview();
      } else if (view === "decision") {
        renderDecision();
      } else if (view === "log") {
        renderLog();
      } else if (view === "archive") {
        renderArchive();
      } else if (view === "archive-details") {
        renderArchiveDetails();
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    roleToggle.addEventListener("click", function (event) {
      event.stopPropagation();
      if (roleDropdown.classList.contains("is-open")) {
        closeRoleMenu();
      } else {
        openRoleMenu();
      }
    });

    roleMenu.addEventListener("click", function (event) {
      var option = event.target.closest(".role-option");
      if (!option) {
        return;
      }
      clearBanner();
      setRole(option.getAttribute("data-role"));
      closeRoleMenu();
    });

    document.addEventListener("click", function (event) {
      if (!roleDropdown.contains(event.target)) {
        closeRoleMenu();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeRoleMenu();
      }
    });

    document.getElementById("nav-list").addEventListener("click", function () {
      setView("list");
    });

    navReport.addEventListener("click", function () {
      formError.hidden = true;
      reportForm.reset();
      clearFieldErrors();
      clearBanner();
      setView("report");
    });

    navMyClaims.addEventListener("click", function () {
      clearBanner();
      setView("my-claims");
    });

    navReview.addEventListener("click", function () {
      clearBanner();
      setView("review");
    });

    navLog.addEventListener("click", function () {
      clearBanner();
      setView("log");
    });

    navArchive.addEventListener("click", function () {
      clearBanner();
      setView("archive");
    });

    document.getElementById("back-to-list").addEventListener("click", function () {
      setView("list");
    });

    document.getElementById("back-to-details").addEventListener("click", function () {
      setView("details");
    });

    document.getElementById("back-to-review").addEventListener("click", function () {
      setView("review");
    });

    document.getElementById("back-to-archive").addEventListener("click", function () {
      setView("archive");
    });

    function archiveClaim(itemId) {
      request("POST", "/api/items/" + encodeURIComponent(itemId) + "/archive").then(
        function (result) {
          if (!result.ok) {
            showBanner("error", result.error);
            return;
          }
          showBanner("success", "Claim archived. Open Archive to view the full record.");
          setView("archive");
        }
      );
    }

    itemList.addEventListener("click", function (event) {
      var archiveButton = event.target.closest("[data-archive-item]");
      if (archiveButton) {
        event.preventDefault();
        event.stopPropagation();
        archiveClaim(archiveButton.getAttribute("data-archive-item"));
        return;
      }
      var itemButton = event.target.closest("[data-open-item]");
      if (!itemButton) {
        return;
      }
      clearBanner();
      setView("details", itemButton.getAttribute("data-open-item"));
    });

    archiveList.addEventListener("click", function (event) {
      var archiveCard = event.target.closest("[data-open-archive]");
      if (!archiveCard) {
        return;
      }
      clearBanner();
      setView("archive-details", archiveCard.getAttribute("data-open-archive"));
    });

    myClaimList.addEventListener("click", function (event) {
      var itemButton = event.target.closest("[data-open-item]");
      if (!itemButton) {
        return;
      }
      clearBanner();
      setView("details", itemButton.getAttribute("data-open-item"));
    });

    claimList.addEventListener("click", function (event) {
      var button = event.target.closest("[data-open-claim]");
      if (!button) {
        return;
      }
      clearBanner();
      setView("decision", button.getAttribute("data-open-claim"));
    });

    function sendDecision(status) {
      var form = document.getElementById("decision-form");
      var errorBox = document.getElementById("decision-error");
      var reasonField = form && form.decisionReason;
      var decisionReason = reasonField ? reasonField.value : "";
      if (errorBox) {
        errorBox.hidden = true;
      }
      if (reasonField) {
        reasonField.classList.remove("has-error");
      }
      request("POST", "/api/claims/" + encodeURIComponent(selectedClaimId) + "/decision", {
        status: status,
        decisionReason: decisionReason
      }).then(function (result) {
        if (!result.ok) {
          if (errorBox) {
            errorBox.hidden = false;
            errorBox.textContent = result.error;
          }
          if (reasonField && /decisionReason/i.test(result.error || "")) {
            reasonField.classList.add("has-error");
          }
          showBanner("error", result.error);
          return;
        }
        var message =
          status === "APPROVED"
            ? "Claim approved. The item is now Approved - Reserved."
            : "Claim rejected.";
        showBanner("success", message);
        renderDecision();
      });
    }

    claimDecision.addEventListener("click", function (event) {
      if (event.target.id === "approve-claim") {
        sendDecision("APPROVED");
      }
      if (event.target.id === "reject-claim") {
        sendDecision("REJECTED");
      }
    });

    itemDetails.addEventListener("click", function (event) {
      if (event.target.id === "publish-item") {
        request("POST", "/api/items/" + encodeURIComponent(selectedId) + "/publish").then(
          function (result) {
            if (!result.ok) {
              showBanner("error", result.error);
              return;
            }
            showBanner("success", "Published. Visitors can now see this item.");
            renderDetails();
          }
        );
        return;
      }
      if (event.target.id === "claim-item") {
        claimError.hidden = true;
        claimForm.reset();
        clearFormErrors(claimForm);
        clearBanner();
        setView("claim");
        return;
      }
      if (event.target.id === "mark-claimed") {
        request("POST", "/api/items/" + encodeURIComponent(selectedId) + "/mark-claimed").then(
          function (result) {
            if (!result.ok) {
              showBanner("error", result.error);
              return;
            }
            var nextLabel = itemStatusLabel(result.item && result.item.status, role);
            if (result.item && result.item.status === "RETURNED") {
              showBanner("success", "Both sides marked as claimed. The item is now " + nextLabel + ".");
            } else {
              showBanner("success", "Marked as claimed. Waiting for the other side.");
            }
            renderDetails();
          }
        );
        return;
      }
      if (event.target.id === "archive-claim") {
        archiveClaim(selectedId);
      }
    });

    function clearFormErrors(form) {
      var fields = form.querySelectorAll(".has-error");
      for (var i = 0; i < fields.length; i += 1) {
        fields[i].classList.remove("has-error");
      }
    }

    function clearFieldErrors() {
      clearFormErrors(reportForm);
    }

    reportForm.addEventListener("submit", function (event) {
      event.preventDefault();
      clearFieldErrors();

      var data = {
        name: reportForm.name.value,
        category: reportForm.category.value,
        foundLocation: reportForm.foundLocation.value,
        foundDate: reportForm.foundDate.value,
        publicDescription: reportForm.publicDescription.value,
        privateClue: reportForm.privateClue.value
      };

      request("POST", "/api/items", data).then(function (result) {
        if (!result.ok) {
          formError.hidden = false;
          formError.textContent = result.error;
          if (result.missing) {
            result.missing.forEach(function (fieldName) {
              reportForm[fieldName].classList.add("has-error");
            });
          }
          showBanner("error", result.error);
          return;
        }

        formError.hidden = true;
        reportForm.reset();
        showBanner("success", "Saved as a draft. Publish it when the public details are ready.");
        setView("details", result.item.id);
      });
    });

    claimForm.addEventListener("submit", function (event) {
      event.preventDefault();
      clearFormErrors(claimForm);

      request("POST", "/api/claims", {
        itemId: selectedId,
        claimantName: claimForm.claimantName.value,
        contact: claimForm.contact.value,
        evidence: claimForm.evidence.value
      }).then(function (result) {
        if (!result.ok) {
          claimError.hidden = false;
          claimError.textContent = result.error;
          if (result.missing) {
            result.missing.forEach(function (fieldName) {
              claimForm[fieldName].classList.add("has-error");
            });
          }
          showBanner("error", result.error);
          return;
        }

        claimError.hidden = true;
        claimForm.reset();
        showBanner("success", "Claim submitted. Open My claims to track the decision.");
        setView("my-claims");
      });
    });

    setRole("visitor");
  }

  if (document.getElementById("app")) {
    initUI();
  }
})(window);
