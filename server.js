const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 5500;
const ROOT = __dirname;
const DATABASE_FILE = path.join(ROOT, "locations.db");
const TEST_NOW = process.env.SWASTHYAMAP_TEST_NOW ? new Date(process.env.SWASTHYAMAP_TEST_NOW) : null;
if (TEST_NOW && Number.isNaN(TEST_NOW.getTime())) {
	throw new Error("SWASTHYAMAP_TEST_NOW must be a valid date, for example 2026-09-08T19:00:00");
}
const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
};

const database = new DatabaseSync(DATABASE_FILE);
database.exec(`
	CREATE TABLE IF NOT EXISTS locations (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		facility_type TEXT,
		drive_type TEXT,
		latitude REAL NOT NULL,
		longitude REAL NOT NULL,
		cost TEXT NOT NULL,
		open_now INTEGER NOT NULL,
		name TEXT NOT NULL,
		organisation TEXT NOT NULL,
		address TEXT NOT NULL,
		hours TEXT,
		services TEXT,
		time_label TEXT,
		phone TEXT,
		photo TEXT,
		confirmation_count INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS location_confirmations (
		location_id TEXT NOT NULL,
		ip_identifier TEXT NOT NULL,
		confirmed_at TEXT NOT NULL,
		PRIMARY KEY (location_id, ip_identifier),
		FOREIGN KEY (location_id) REFERENCES locations(id)
	);
	CREATE TABLE IF NOT EXISTS location_reports (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		location_id TEXT NOT NULL,
		reason TEXT NOT NULL,
		details TEXT,
		ip_identifier TEXT NOT NULL,
		reported_at TEXT NOT NULL,
		FOREIGN KEY (location_id) REFERENCES locations(id)
	);
	CREATE TABLE IF NOT EXISTS location_confirmation_counts (
		location_id TEXT PRIMARY KEY,
		confirmation_count INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (location_id) REFERENCES locations(id)
	);
`);
try { database.exec("ALTER TABLE locations ADD COLUMN end_date TEXT"); } catch {}
try { database.exec("ALTER TABLE locations ADD COLUMN confirmation_count INTEGER NOT NULL DEFAULT 0"); } catch {}
try { database.exec("ALTER TABLE locations ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0"); } catch {}
try { database.exec("ALTER TABLE locations ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0"); } catch {}
try { database.exec("ALTER TABLE locations ADD COLUMN photo TEXT"); } catch {}
database.exec(`
	INSERT OR IGNORE INTO location_confirmation_counts (location_id, confirmation_count)
	SELECT id, confirmation_count FROM locations;
	CREATE TRIGGER IF NOT EXISTS locations_confirmation_count_insert
	AFTER INSERT ON locations
	BEGIN
		INSERT OR IGNORE INTO location_confirmation_counts (location_id, confirmation_count) VALUES (NEW.id, NEW.confirmation_count);
	END;
`);

const REPORT_REASONS = new Set([
	"closed_permanently",
	"closed_temporarily",
	"wrong_hours",
	"wrong_address",
	"wrong_phone",
	"duplicate",
	"not_healthcare",
	"other",
]);

function locationFromRow(row) {
	return {
		id: row.id,
		type: row.type,
		facilityType: row.facility_type || undefined,
		driveType: row.drive_type || undefined,
		location: { lat: row.latitude, lng: row.longitude },
		distanceKm: null,
		cost: row.cost,
		openNow: row.type === "DRIVE" ? false : isOpenNow(row.hours || ""),
		freshness: "checking",
		freshnessNote: { en: "Submitted by a contributor" },
		name: { en: row.name },
		org: { en: row.organisation },
		address: { en: row.address },
		hours: row.hours || "",
		services: { en: row.services || "" },
		timeLabel: row.time_label ? { en: row.time_label } : undefined,
		endDate: row.end_date || undefined,
		phone: row.phone || "—",
		photo: row.photo || undefined,
		confirmationCount: row.confirmation_count_total ?? row.confirmation_count ?? 0,
		createdAt: row.created_at,
	};
}

function readLocations() {
	return database.prepare(`SELECT locations.*, COALESCE(location_confirmation_counts.confirmation_count, locations.confirmation_count, 0) AS confirmation_count_total
		FROM locations LEFT JOIN location_confirmation_counts ON location_confirmation_counts.location_id = locations.id
		ORDER BY locations.created_at DESC`).all()
		.filter(row => !isDriveExpired(row))
		.map(locationFromRow);
}

function isDriveExpired(row) {
	if (row.type !== "DRIVE" || !row.end_date) return false;
	const match = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}-(\d{2}:\d{2})$/.exec(row.time_label || "");
	if (!match) return false;
	return new Date(`${row.end_date}T${match[1]}`) < now();
}

function now() {
	return TEST_NOW || new Date();
}

function sendJson(response, status, payload) {
	response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(payload));
}

function isOpenNow(hours) {
	if (hours === "ALL_DAY") return true;
	const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(hours);
	if (!match) return false;
	const opening = Number(match[1]) * 60 + Number(match[2]);
	const closing = Number(match[3]) * 60 + Number(match[4]);
	const now = new Date();
	const current = now.getHours() * 60 + now.getMinutes();
	return opening <= closing
		? current >= opening && current <= closing
		: current >= opening || current <= closing;
}

function getIpIdentifier(request) {
	const address = request.socket.remoteAddress || "unknown";
	const salt = process.env.CONFIRMATION_IP_SALT || "swasthyamap-confirmation";
	return crypto.createHash("sha256").update(`${salt}:${address}`).digest("hex");
}

function confirmLocation(request, response, locationId) {
	try {
		const location = database.prepare("SELECT id FROM locations WHERE id = ?").get(locationId);
		if (!location) {
			sendJson(response, 404, { error: "Location not found." });
			return;
		}
		const ipIdentifier = getIpIdentifier(request);
		const confirmation = database.prepare(`INSERT INTO location_confirmations
			(location_id, ip_identifier, confirmed_at) VALUES (?, ?, ?)
			ON CONFLICT(location_id, ip_identifier) DO NOTHING`)
			.run(locationId, ipIdentifier, new Date().toISOString());
		if (confirmation.changes) {
			database.prepare("UPDATE locations SET confirmation_count = confirmation_count + 1 WHERE id = ?").run(locationId);
			database.prepare("UPDATE location_confirmation_counts SET confirmation_count = confirmation_count + 1 WHERE location_id = ?").run(locationId);
		}
			const row = database.prepare("SELECT confirmation_count FROM location_confirmation_counts WHERE location_id = ?").get(locationId);
		sendJson(response, confirmation.changes ? 200 : 409, {
			confirmationCount: row?.confirmation_count || 0,
			alreadyConfirmed: !confirmation.changes,
		});
	} catch {
		sendJson(response, 500, { error: "Confirmation could not be saved." });
	}
}

function retractConfirmation(request, response, locationId) {
	try {
		const location = database.prepare("SELECT id FROM locations WHERE id = ?").get(locationId);
		if (!location) {
			sendJson(response, 404, { error: "Location not found." });
			return;
		}
		const ipIdentifier = getIpIdentifier(request);
		const deletion = database.prepare("DELETE FROM location_confirmations WHERE location_id = ? AND ip_identifier = ?")
			.run(locationId, ipIdentifier);
		if (deletion.changes) {
			database.prepare("UPDATE locations SET confirmation_count = MAX(0, confirmation_count - 1) WHERE id = ?").run(locationId);
			database.prepare("UPDATE location_confirmation_counts SET confirmation_count = MAX(0, confirmation_count - 1) WHERE location_id = ?").run(locationId);
		}
			const row = database.prepare("SELECT confirmation_count FROM location_confirmation_counts WHERE location_id = ?").get(locationId);
		sendJson(response, 200, {
			confirmationCount: row?.confirmation_count || 0,
			retracted: Boolean(deletion.changes),
		});
	} catch {
		sendJson(response, 500, { error: "Confirmation could not be retracted." });
	}
}

function reportLocation(request, response, locationId) {
	let body = "";
	request.on("data", chunk => { body += chunk; });
	request.on("end", () => {
		try {
			const location = database.prepare("SELECT id FROM locations WHERE id = ?").get(locationId);
			if (!location) {
				sendJson(response, 404, { error: "Location not found." });
				return;
			}
			const input = JSON.parse(body || "{}");
			const reason = String(input.reason || "");
			if (!REPORT_REASONS.has(reason)) {
				sendJson(response, 400, { error: "A valid reason is required." });
				return;
			}
			const details = input.details ? String(input.details).trim().slice(0, 1000) : null;
			const ipIdentifier = getIpIdentifier(request);
			database.prepare(`INSERT INTO location_reports
				(location_id, reason, details, ip_identifier, reported_at) VALUES (?, ?, ?, ?, ?)`)
				.run(locationId, reason, details, ipIdentifier, new Date().toISOString());
			database.prepare("UPDATE locations SET flagged = 1, report_count = report_count + 1 WHERE id = ?").run(locationId);
			const row = database.prepare("SELECT report_count FROM locations WHERE id = ?").get(locationId);
			sendJson(response, 201, { reportCount: row.report_count });
		} catch {
			sendJson(response, 400, { error: "Invalid report data." });
		}
	});
}

function saveLocation(request, response) {
	let body = "";
	request.on("data", chunk => { body += chunk; });
	request.on("end", () => {
		try {
			const input = JSON.parse(body);
			const photo = input.photo ? String(input.photo) : null;
			if (photo && (!/^data:image\/(?:jpeg|png|gif|webp);base64,/i.test(photo) || photo.length > 7 * 1024 * 1024)) {
				sendJson(response, 400, { error: "The image must be a valid image smaller than 5 MB." });
				return;
			}
			const latitude = Number(input.location?.lat);
			const longitude = Number(input.location?.lng);
			if (input.type === "DRIVE" && (!input.endDate || !/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}-\d{2}:\d{2}$/.test(String(input.timeLabel || "")))) {
				sendJson(response, 400, { error: "Drive end date and time are required." });
				return;
			}
			if (!input.name || !input.address || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
				sendJson(response, 400, { error: "Name, address, and coordinates are required." });
				return;
			}
			const hours = String(input.hours || "").trim();
			const location = {
				id: `user-${Date.now()}`,
				type: input.type || "FACILITY",
				facilityType: input.facilityType || null,
				driveType: input.driveType || null,
				lat: latitude,
				lng: longitude,
				cost: input.cost || "FREE",
				openNow: input.type !== "DRIVE" && isOpenNow(hours),
				name: String(input.name).trim(),
				org: String(input.org || "Community contributor").trim(),
				address: String(input.address).trim(),
				hours,
				services: String(input.services || ""),
				timeLabel: input.timeLabel ? String(input.timeLabel) : null,
				endDate: input.endDate ? String(input.endDate) : null,
				phone: String(input.phone || "—"),
				createdAt: new Date().toISOString(),
			};
			database.prepare(`INSERT INTO locations
			(id, type, facility_type, drive_type, latitude, longitude, cost, open_now, name, organisation, address, hours, services, time_label, end_date, phone, photo, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
			.run(location.id, location.type, location.facilityType, location.driveType, location.lat, location.lng, location.cost, location.openNow ? 1 : 0, location.name, location.org, location.address, location.hours, location.services, location.timeLabel, location.endDate, location.phone, photo, location.createdAt);
			sendJson(response, 201, locationFromRow(database.prepare("SELECT * FROM locations WHERE id = ?").get(location.id)));
		} catch (error) {
			console.error("Location save failed:", error);
			sendJson(response, 400, { error: "Invalid location data." });
		}
	});
}

function serveFile(request, response, requestPath) {
	const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
	const filePath = path.resolve(ROOT, relativePath);
	if (!filePath.startsWith(ROOT + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
		response.writeHead(404);
		response.end("Not found");
		return;
	}
	response.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
	fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
	const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
	if (requestPath === "/api/config" && request.method === "GET") {
		sendJson(response, 200, { googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "" });
		return;
	}
	if (requestPath === "/api/locations" && request.method === "GET") {
		sendJson(response, 200, readLocations());
		return;
	}
	if (requestPath === "/api/locations" && request.method === "POST") {
		saveLocation(request, response);
		return;
	}
	const confirmationMatch = requestPath.match(/^\/api\/locations\/([^/]+)\/confirm$/);
	if (confirmationMatch && request.method === "POST") {
		confirmLocation(request, response, decodeURIComponent(confirmationMatch[1]));
		return;
	}
	if (confirmationMatch && request.method === "DELETE") {
		retractConfirmation(request, response, decodeURIComponent(confirmationMatch[1]));
		return;
	}
	const reportMatch = requestPath.match(/^\/api\/locations\/([^/]+)\/report$/);
	if (reportMatch && request.method === "POST") {
		reportLocation(request, response, decodeURIComponent(reportMatch[1]));
		return;
	}
	if (request.method !== "GET") {
		response.writeHead(405);
		response.end("Method not allowed");
		return;
	}
	serveFile(request, response, requestPath);
});

function listen(port) {
	server.once("error", error => {
		if (error.code === "EADDRINUSE") {
			console.warn(`Port ${port} is already in use; trying ${port + 1}.`);
			listen(port + 1);
			return;
		}
		throw error;
	});
	server.listen(port, "127.0.0.1", () => {
		console.log(`SwasthyaMap is running at http://localhost:${port}`);
		console.log(TEST_NOW ? `Using test time: ${TEST_NOW.toISOString()}` : "Using real system time");
	});
}

listen(PORT);
