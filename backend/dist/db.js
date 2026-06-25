"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeStandaloneFileToDb = exports.getPlayerFaceFromDb = exports.getMarkerIconFromDb = exports.getMarkerFileFromDb = exports.deleteRegistrationCode = exports.getRegistrationCode = exports.registerUserInDb = exports.getUserFromDb = exports.getStandaloneFileFromDb = exports.getSettingsFromDb = exports.getTileFromDb = exports.query = exports.initDb = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const dbType = (process.env.DB_TYPE || 'mysql').toLowerCase();
const prefix = process.env.DB_PREFIX !== undefined ? process.env.DB_PREFIX.trim() : 'dynmap_';
let mysqlPool = null;
let pgPool = null;
async function initDb() {
    if (mysqlPool || pgPool)
        return;
    // Check if DB configuration is present
    if (!process.env.DB_HOST && !process.env.DB_NAME) {
        console.log('Database configuration not found. Running in file-only mode.');
        return;
    }
    const config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || (dbType === 'postgres' ? '5432' : '3306')),
        user: process.env.DB_USER || 'dynmap',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'dynmap',
    };
    try {
        if (dbType === 'postgres') {
            pgPool = new pg_1.Pool({
                host: config.host,
                port: config.port,
                user: config.user,
                password: config.password,
                database: config.database,
                max: 10,
            });
            console.log('PostgreSQL database pool initialized.');
        }
        else {
            // mysql or mariadb
            mysqlPool = promise_1.default.createPool({
                host: config.host,
                port: config.port,
                user: config.user,
                password: config.password,
                database: config.database,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0,
            });
            console.log(`${dbType === 'mariadb' ? 'MariaDB' : 'MySQL'} database pool initialized.`);
        }
    }
    catch (err) {
        console.error('Failed to initialize database pool:', err);
    }
}
exports.initDb = initDb;
async function query(sql, params = []) {
    await initDb();
    if (pgPool) {
        const res = await pgPool.query(sql, params);
        return res.rows;
    }
    else if (mysqlPool) {
        const [rows] = await mysqlPool.execute(sql, params);
        return rows;
    }
    else {
        throw new Error('No database connection available');
    }
}
exports.query = query;
async function getTileFromDb(tilePath) {
    // Parse tilePath: world/t/3_0/zzzzz_96_0.jpg
    const parts = tilePath.split('/');
    if (parts.length < 3)
        return null;
    const worldName = parts[0];
    const mapName = parts[1];
    const fileName = parts[parts.length - 1];
    // Parse zoom, x, y from fileName (e.g., zzzzz_96_0.jpg)
    let nameWithoutExt = fileName;
    const dotIdx = fileName.lastIndexOf('.');
    if (dotIdx !== -1) {
        nameWithoutExt = fileName.slice(0, dotIdx);
    }
    let zoom = 0;
    while (zoom < nameWithoutExt.length && nameWithoutExt[zoom] === 'z') {
        zoom++;
    }
    let coordsPart = nameWithoutExt.slice(zoom);
    if (coordsPart.startsWith('_')) {
        coordsPart = coordsPart.slice(1);
    }
    const coordParts = coordsPart.split('_');
    if (coordParts.length < 2)
        return null;
    const x = parseInt(coordParts[0]);
    const y = parseInt(coordParts[1]);
    if (isNaN(x) || isNaN(y))
        return null;
    const tilesTables = [`${prefix}Tiles`, `${prefix}tiles`, `Tiles`, `tiles`];
    const mapsTables = [`${prefix}Maps`, `${prefix}maps`, `Maps`, `maps`];
    for (let i = 0; i < tilesTables.length; i++) {
        const tTable = tilesTables[i];
        const mTable = mapsTables[i];
        let sql = `
			SELECT t.Image, t.NewImage, t.Format FROM "${tTable}" t
			JOIN "${mTable}" m ON t.MapID = m.ID
			WHERE m.WorldID = $1 AND m.MapID = $2 AND t.x = $3 AND t.y = $4 AND t.zoom = $5
		`;
        if (dbType !== 'postgres') {
            sql = `
				SELECT t.Image, t.NewImage, t.Format FROM \`${tTable}\` t
				JOIN \`${mTable}\` m ON t.MapID = m.ID
				WHERE m.WorldID = ? AND m.MapID = ? AND t.x = ? AND t.y = ? AND t.zoom = ?
			`;
        }
        try {
            const rows = await query(sql, [worldName, mapName, x, y, zoom]);
            if (rows && rows.length > 0) {
                const data = rows[0].Image || rows[0].image || rows[0].NewImage || rows[0].newimage || rows[0].IMAGE;
                const format = rows[0].Format !== undefined ? rows[0].Format : rows[0].format;
                if (data) {
                    return {
                        data: Buffer.from(data),
                        format: format || 0,
                    };
                }
            }
        }
        catch (error) {
            // Try next table combination
        }
    }
    console.error(`Failed to fetch tile ${tilePath} (world: ${worldName}, map: ${mapName}, x: ${x}, y: ${y}, zoom: ${zoom}) from database`);
    return null;
}
exports.getTileFromDb = getTileFromDb;
async function getSettingsFromDb(key) {
    const tableName = `${prefix}Settings`;
    let sql = `SELECT value FROM "${tableName}" WHERE name = $1`;
    if (dbType !== 'postgres') {
        sql = `SELECT value FROM \`${tableName}\` WHERE name = ?`;
    }
    try {
        const rows = await query(sql, [key]);
        if (rows && rows.length > 0) {
            return rows[0].value || rows[0].Value;
        }
        return null;
    }
    catch (e) {
        return null;
    }
}
exports.getSettingsFromDb = getSettingsFromDb;
async function getStandaloneFileFromDb(fileName) {
    const tableNames = [`${prefix}StandaloneFiles`, `${prefix}standalonefiles`, `StandaloneFiles`, `standalonefiles`];
    for (const table of tableNames) {
        let sql = `SELECT Content FROM "${table}" WHERE FileName = $1`;
        if (dbType !== 'postgres') {
            sql = `SELECT Content FROM \`${table}\` WHERE FileName = ?`;
        }
        try {
            const rows = await query(sql, [fileName]);
            if (rows && rows.length > 0) {
                const content = rows[0].Content !== undefined ? rows[0].Content : (rows[0].content !== undefined ? rows[0].content : rows[0].CONTENT);
                if (content !== null && content !== undefined) {
                    return typeof content === 'string' ? content : content.toString();
                }
            }
        }
        catch (e) {
            // Try next table
        }
    }
    return null;
}
exports.getStandaloneFileFromDb = getStandaloneFileFromDb;
async function getUserFromDb(username) {
    // Try a few possible table variations for users
    const tableNames = [`${prefix}users`, `${prefix}Users`, `users`, `Users`];
    for (const table of tableNames) {
        let sql = `SELECT password, salt FROM "${table}" WHERE username = $1`;
        if (dbType !== 'postgres') {
            sql = `SELECT password, salt FROM \`${table}\` WHERE username = ?`;
        }
        try {
            const rows = await query(sql, [username]);
            if (rows && rows.length > 0) {
                return {
                    password_hash: rows[0].password || rows[0].password_hash,
                    salt: rows[0].salt || '',
                };
            }
        }
        catch (e) {
            // Try next table
        }
    }
    return null;
}
exports.getUserFromDb = getUserFromDb;
async function registerUserInDb(username, passwordHash, salt) {
    const tableNames = [`${prefix}users`, `${prefix}Users`, `users`, `Users`];
    for (const table of tableNames) {
        let sql = `INSERT INTO "${table}" (username, password, salt) VALUES ($1, $2, $3)`;
        if (dbType !== 'postgres') {
            sql = `INSERT INTO \`${table}\` (username, password, salt) VALUES (?, ?, ?)`;
        }
        try {
            await query(sql, [username, passwordHash, salt]);
            return true;
        }
        catch (e) {
            // Try next table
        }
    }
    return false;
}
exports.registerUserInDb = registerUserInDb;
async function getRegistrationCode(code) {
    const tableNames = [`${prefix}registrationcodes`, `${prefix}RegistrationCodes`, `registrationcodes`, `RegistrationCodes`];
    for (const table of tableNames) {
        let sql = `SELECT player FROM "${table}" WHERE code = $1`;
        if (dbType !== 'postgres') {
            sql = `SELECT player FROM \`${table}\` WHERE code = ?`;
        }
        try {
            const rows = await query(sql, [code]);
            if (rows && rows.length > 0) {
                return rows[0].player || rows[0].Player;
            }
        }
        catch (e) {
            // Try next
        }
    }
    return null;
}
exports.getRegistrationCode = getRegistrationCode;
async function deleteRegistrationCode(code) {
    const tableNames = [`${prefix}registrationcodes`, `${prefix}RegistrationCodes`, `registrationcodes`, `RegistrationCodes`];
    for (const table of tableNames) {
        let sql = `DELETE FROM "${table}" WHERE code = $1`;
        if (dbType !== 'postgres') {
            sql = `DELETE FROM \`${table}\` WHERE code = ?`;
        }
        try {
            await query(sql, [code]);
            return;
        }
        catch (e) {
            // Try next
        }
    }
}
exports.deleteRegistrationCode = deleteRegistrationCode;
async function getMarkerFileFromDb(markerName) {
    let extractedName = markerName;
    if (markerName.startsWith('_markers_/marker_') && markerName.endsWith('.json')) {
        extractedName = markerName.slice(17, -5);
    }
    const tableNames = [`${prefix}MarkerFiles`, `${prefix}markerfiles`, `MarkerFiles`, `markerfiles`];
    for (const table of tableNames) {
        for (const nameToTry of [extractedName, markerName]) {
            let sql = `SELECT Content FROM "${table}" WHERE FileName = $1`;
            if (dbType !== 'postgres') {
                sql = `SELECT Content FROM \`${table}\` WHERE FileName = ?`;
            }
            try {
                const rows = await query(sql, [nameToTry]);
                if (rows && rows.length > 0) {
                    const content = rows[0].Content !== undefined ? rows[0].Content : (rows[0].content !== undefined ? rows[0].content : rows[0].CONTENT);
                    if (content !== null && content !== undefined) {
                        return typeof content === 'string' ? content : content.toString();
                    }
                }
            }
            catch (e) {
                // Try next
            }
        }
    }
    return null;
}
exports.getMarkerFileFromDb = getMarkerFileFromDb;
async function getMarkerIconFromDb(iconParam) {
    let extractedName = iconParam;
    const lastSlash = iconParam.lastIndexOf('/');
    if (lastSlash !== -1) {
        extractedName = iconParam.slice(lastSlash + 1);
    }
    if (extractedName.endsWith('.png')) {
        extractedName = extractedName.slice(0, -4);
    }
    const tableNames = [`${prefix}MarkerIcons`, `${prefix}markericons`, `MarkerIcons`, `markericons`];
    for (const table of tableNames) {
        for (const nameToTry of [extractedName, iconParam]) {
            let sql = `SELECT Image FROM "${table}" WHERE IconName = $1`;
            if (dbType !== 'postgres') {
                sql = `SELECT Image FROM \`${table}\` WHERE IconName = ?`;
            }
            try {
                const rows = await query(sql, [nameToTry]);
                if (rows && rows.length > 0) {
                    const data = rows[0].Image || rows[0].image || rows[0].IMAGE;
                    if (data) {
                        return Buffer.from(data);
                    }
                }
            }
            catch (e) {
                // Try next
            }
        }
    }
    return null;
}
exports.getMarkerIconFromDb = getMarkerIconFromDb;
async function getPlayerFaceFromDb(faceParam) {
    if (!faceParam.startsWith('faces/'))
        return null;
    const parts = faceParam.split('/');
    if (parts.length < 3)
        return null;
    const typeStr = parts[1];
    let playerName = parts[2];
    if (playerName.endsWith('.png')) {
        playerName = playerName.slice(0, -4);
    }
    let typeId = 0;
    if (typeStr === '16x16') {
        typeId = 1;
    }
    else if (typeStr === '32x32') {
        typeId = 2;
    }
    else if (typeStr === 'body') {
        typeId = 3;
    }
    const tableNames = [`${prefix}Faces`, `${prefix}faces`, `Faces`, `faces`];
    for (const table of tableNames) {
        let sql = `SELECT Image FROM "${table}" WHERE PlayerName = $1 AND TypeID = $2`;
        if (dbType !== 'postgres') {
            sql = `SELECT Image FROM \`${table}\` WHERE PlayerName = ? AND TypeID = ?`;
        }
        try {
            const rows = await query(sql, [playerName, typeId]);
            if (rows && rows.length > 0) {
                const data = rows[0].Image || rows[0].image || rows[0].IMAGE;
                if (data) {
                    return Buffer.from(data);
                }
            }
        }
        catch (e) {
            // Try next
        }
    }
    return null;
}
exports.getPlayerFaceFromDb = getPlayerFaceFromDb;
async function writeStandaloneFileToDb(fileName, content) {
    const tableNames = [`${prefix}StandaloneFiles`, `${prefix}standalonefiles`, `StandaloneFiles`, `standalonefiles`];
    for (const table of tableNames) {
        let selectSql = `SELECT FileName FROM "${table}" WHERE FileName = $1`;
        if (dbType !== 'postgres') {
            selectSql = `SELECT FileName FROM \`${table}\` WHERE FileName = ?`;
        }
        try {
            const rows = await query(selectSql, [fileName]);
            if (rows && rows.length > 0) {
                let updateSql = `UPDATE "${table}" SET Content = $1 WHERE FileName = $2`;
                if (dbType !== 'postgres') {
                    updateSql = `UPDATE \`${table}\` SET Content = ? WHERE FileName = ?`;
                }
                await query(updateSql, [content, fileName]);
                return true;
            }
            else {
                let insertSql = `INSERT INTO "${table}" (FileName, ServerID, Content) VALUES ($1, 0, $2)`;
                if (dbType !== 'postgres') {
                    insertSql = `INSERT INTO \`${table}\` (FileName, ServerID, Content) VALUES (?, 0, ?)`;
                }
                await query(insertSql, [fileName, content]);
                return true;
            }
        }
        catch (e) {
            // Try next table
        }
    }
    return false;
}
exports.writeStandaloneFileToDb = writeStandaloneFileToDb;
