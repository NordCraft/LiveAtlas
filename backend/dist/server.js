"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./db");
const s3_1 = require("./s3");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 8082;
const storageType = (process.env.STORAGE_TYPE || 'filetree').toLowerCase();
const dynmapDir = process.env.DYNMAP_DIR || path_1.default.join(process.cwd(), '../dynmap');
app.use((0, cors_1.default)({
    origin: true,
    credentials: true
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Log middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});
// Dynamic configuration serving
app.get(['/standalone/config.js', '/standalone/MySQL_config.js'], (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
window.config = {
  url : {
    configuration: 'standalone/configuration',
    update: 'standalone/update?world={world}&ts={timestamp}',
    sendmessage: 'standalone/sendmessage',
    login: 'standalone/login',
    register: 'standalone/register',
    tiles: 'standalone/tiles?tile=',
    markers: 'standalone/markers?marker='
  }
};
`);
});
// Helper to determine Content-Type
function getContentType(tilePath) {
    if (tilePath.endsWith('.webp'))
        return 'image/webp';
    if (tilePath.endsWith('.jpg') || tilePath.endsWith('.jpeg'))
        return 'image/jpeg';
    return 'image/png';
}
// 1. Get Tiles
app.get(['/standalone/tiles', '/standalone/MySQL_tiles.php', '/standalone/tiles.php'], async (req, res) => {
    const tileParam = req.query.tile || '';
    if (!tileParam || tileParam.includes('..')) {
        return res.status(400).send('Invalid tile path');
    }
    res.setHeader('Content-Type', getContentType(tileParam));
    if (storageType === 's3') {
        const buffer = await (0, s3_1.getTileFromS3)(tileParam);
        if (buffer) {
            return res.send(buffer);
        }
    }
    else if (storageType === 'db') {
        const dbResult = await (0, db_1.getTileFromDb)(tileParam);
        if (dbResult) {
            return res.send(dbResult.data);
        }
    }
    // Fallback/Default: Read from local filesystem
    // Path is typically <DYNMAP_DIR>/web/tiles/<tileParam>
    const localTilePath = path_1.default.join(dynmapDir, 'web/tiles', tileParam);
    if (fs_1.default.existsSync(localTilePath)) {
        return res.sendFile(localTilePath);
    }
    res.status(404).send('Tile not found');
});
// 2. Get Markers
app.get(['/standalone/markers', '/standalone/MySQL_markers.php', '/standalone/markers.php'], async (req, res) => {
    const markerParam = req.query.marker || '';
    if (!markerParam || markerParam.includes('..')) {
        return res.status(400).send('Invalid marker path');
    }
    if (storageType === 'db') {
        if (markerParam.startsWith('faces/')) {
            const faceBuffer = await (0, db_1.getPlayerFaceFromDb)(markerParam);
            if (faceBuffer) {
                res.setHeader('Content-Type', 'image/png');
                return res.send(faceBuffer);
            }
        }
        else if (markerParam.startsWith('icons/') || markerParam.endsWith('.png')) {
            const iconBuffer = await (0, db_1.getMarkerIconFromDb)(markerParam);
            if (iconBuffer) {
                res.setHeader('Content-Type', 'image/png');
                return res.send(iconBuffer);
            }
        }
        else {
            const markerJson = await (0, db_1.getMarkerFileFromDb)(markerParam);
            if (markerJson) {
                res.setHeader('Content-Type', 'application/json');
                return res.send(markerJson);
            }
        }
    }
    // Fallback/Default: Read from local filesystem
    // Check nested path first (typical for plugin)
    let localMarkerPath = path_1.default.join(dynmapDir, 'web/tiles', markerParam);
    if (!fs_1.default.existsSync(localMarkerPath)) {
        // Check direct path
        localMarkerPath = path_1.default.join(dynmapDir, markerParam);
    }
    if (!fs_1.default.existsSync(localMarkerPath)) {
        // Check tiles path
        localMarkerPath = path_1.default.join(dynmapDir, 'tiles', markerParam);
    }
    if (fs_1.default.existsSync(localMarkerPath)) {
        const contentType = markerParam.endsWith('.png') ? 'image/png' : 'application/json';
        res.setHeader('Content-Type', contentType);
        return res.sendFile(localMarkerPath);
    }
    res.status(404).send('Marker not found');
});
// 3. Get Configuration
app.get(['/standalone/configuration', '/standalone/MySQL_configuration.php', '/standalone/configuration.php', '/standalone/dynmap_config.json'], async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    // Attempt database config first if in db mode
    if (storageType === 'db') {
        let dbConfig = await (0, db_1.getSettingsFromDb)('config');
        if (!dbConfig) {
            dbConfig = await (0, db_1.getStandaloneFileFromDb)('standalone/dynmap_config.json');
        }
        if (!dbConfig) {
            dbConfig = await (0, db_1.getStandaloneFileFromDb)('dynmap_config.json');
        }
        if (dbConfig) {
            try {
                const jsonConfig = JSON.parse(dbConfig);
                // Add login status if required
                jsonConfig.loggedin = req.headers.cookie?.includes('liveatlas_logged_in=true') || false;
                return res.json(jsonConfig);
            }
            catch (e) {
                console.error('Failed to parse config from DB settings', e);
            }
        }
    }
    // Read from filesystem configuration
    let localConfigPath = path_1.default.join(dynmapDir, 'standalone/dynmap_config.json');
    if (!fs_1.default.existsSync(localConfigPath)) {
        localConfigPath = path_1.default.join(dynmapDir, 'dynmap_config.json');
    }
    if (fs_1.default.existsSync(localConfigPath)) {
        try {
            const configText = fs_1.default.readFileSync(localConfigPath, 'utf8');
            const jsonConfig = JSON.parse(configText);
            jsonConfig.loggedin = req.headers.cookie?.includes('liveatlas_logged_in=true') || false;
            return res.json(jsonConfig);
        }
        catch (err) {
            console.error('Failed to read local dynmap_config.json', err);
            return res.status(500).json({ error: 'Failed to read configuration' });
        }
    }
    res.status(404).json({ error: 'Configuration not found' });
});
// 4. Get Updates (Players, world time, chat messages, tile updates)
app.get(['/standalone/update', '/standalone/MySQL_update.php', '/standalone/update.php'], async (req, res) => {
    const world = req.query.world;
    if (!world || world.includes('..')) {
        return res.status(400).json({ error: 'Invalid world' });
    }
    res.setHeader('Content-Type', 'application/json');
    if (storageType === 'db') {
        let dbUpdate = await (0, db_1.getStandaloneFileFromDb)(`standalone/dynmap_${world}.json`);
        if (!dbUpdate) {
            dbUpdate = await (0, db_1.getStandaloneFileFromDb)(`dynmap_${world}.json`);
        }
        if (dbUpdate) {
            try {
                const jsonUpdate = JSON.parse(dbUpdate);
                return res.json(jsonUpdate);
            }
            catch (e) {
                console.error(`Failed to parse DB update for world ${world}`, e);
            }
        }
    }
    // Dynmap updates are periodically written to standalone/dynmap_{world}.json
    let localUpdatePath = path_1.default.join(dynmapDir, `standalone/dynmap_${world}.json`);
    if (!fs_1.default.existsSync(localUpdatePath)) {
        localUpdatePath = path_1.default.join(dynmapDir, `dynmap_${world}.json`);
    }
    if (fs_1.default.existsSync(localUpdatePath)) {
        try {
            const updateText = fs_1.default.readFileSync(localUpdatePath, 'utf8');
            const jsonUpdate = JSON.parse(updateText);
            return res.json(jsonUpdate);
        }
        catch (err) {
            console.error(`Failed to read local update for world ${world}`, err);
            return res.status(500).json({ error: 'Failed to read update' });
        }
    }
    res.status(404).json({ error: 'Update not found' });
});
// 5. Send Chat Message
app.post(['/standalone/sendmessage', '/standalone/MySQL_sendmessage.php', '/standalone/sendmessage.php'], express_1.default.text({ type: '*/*' }), async (req, res) => {
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        }
        catch (e) {
            try {
                body = Object.fromEntries(new URLSearchParams(body));
            }
            catch (err) { }
        }
    }
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const name = body?.name || null;
    const message = body?.message;
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }
    const newChatEntry = {
        timestamp: Date.now(),
        name: name,
        message: message,
        ip: ip
    };
    if (storageType === 'db') {
        let dbChat = await (0, db_1.getStandaloneFileFromDb)('standalone/dynmap_webchat.json');
        if (!dbChat) {
            dbChat = await (0, db_1.getStandaloneFileFromDb)('dynmap_webchat.json');
        }
        let chatQueue = [];
        try {
            if (dbChat) {
                chatQueue = JSON.parse(dbChat);
            }
        }
        catch (e) {
            // Ignore parse errors, start clean queue
        }
        chatQueue.push(newChatEntry);
        const updatedJson = JSON.stringify(chatQueue, null, 2);
        const success1 = await (0, db_1.writeStandaloneFileToDb)('standalone/dynmap_webchat.json', updatedJson);
        const success2 = await (0, db_1.writeStandaloneFileToDb)('dynmap_webchat.json', updatedJson);
        if (success1 || success2) {
            return res.json({ error: 'none' });
        }
        else {
            return res.status(500).json({ error: 'Failed to write chat to database' });
        }
    }
    // Write the message to standalone/dynmap_webchat.json for Dynmap to pick up
    let webchatPath = path_1.default.join(dynmapDir, 'standalone/dynmap_webchat.json');
    if (!fs_1.default.existsSync(webchatPath) && !fs_1.default.existsSync(path_1.default.dirname(webchatPath))) {
        webchatPath = path_1.default.join(dynmapDir, 'dynmap_webchat.json');
    }
    let chatQueue = [];
    try {
        if (fs_1.default.existsSync(webchatPath)) {
            const content = fs_1.default.readFileSync(webchatPath, 'utf8');
            chatQueue = JSON.parse(content);
        }
    }
    catch (e) {
        // Ignore parse errors, start clean queue
    }
    chatQueue.push(newChatEntry);
    try {
        const parentDir = path_1.default.dirname(webchatPath);
        if (!fs_1.default.existsSync(parentDir)) {
            fs_1.default.mkdirSync(parentDir, { recursive: true });
        }
        fs_1.default.writeFileSync(webchatPath, JSON.stringify(chatQueue, null, 2), 'utf8');
        return res.json({ error: 'none' });
    }
    catch (err) {
        console.error('Failed to write message to webchat queue:', err);
        return res.status(500).json({ error: 'Failed to send message' });
    }
});
// 6. User Login
app.post(['/standalone/login', '/standalone/MySQL_login.php', '/standalone/login.php'], async (req, res) => {
    if (req.query.logout === 'true') {
        res.clearCookie('liveatlas_logged_in');
        return res.json({ result: 'success' });
    }
    const username = req.body.j_username;
    const password = req.body.j_password;
    if (!username || !password) {
        return res.json({ result: 'loginfailed' });
    }
    try {
        const user = await (0, db_1.getUserFromDb)(username);
        if (!user) {
            return res.json({ result: 'loginfailed' });
        }
        // Verify hashed password
        const hash1 = crypto_1.default.createHash('sha256').update(user.salt + password).digest('hex');
        const hash2 = crypto_1.default.createHash('sha256').update(password).digest('hex');
        const hash3 = crypto_1.default.createHash('sha256').update(password + user.salt).digest('hex');
        if (user.password_hash === password || user.password_hash === hash1 || user.password_hash === hash2 || user.password_hash === hash3) {
            res.cookie('liveatlas_logged_in', 'true', { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
            return res.json({ result: 'success' });
        }
    }
    catch (e) {
        console.error('Login check failed:', e);
    }
    return res.json({ result: 'loginfailed' });
});
// 7. User Registration
app.post(['/standalone/register', '/standalone/MySQL_register.php', '/standalone/register.php'], async (req, res) => {
    const code = req.body.j_passcode;
    const username = req.body.j_username;
    const password = req.body.j_password;
    const verifyPassword = req.body.j_verify_password;
    if (!username || !password || !code) {
        return res.json({ result: 'registerfailed' });
    }
    if (password !== verifyPassword) {
        return res.json({ result: 'verifyfailed' });
    }
    try {
        const player = await (0, db_1.getRegistrationCode)(code);
        if (!player || player.toLowerCase() !== username.toLowerCase()) {
            return res.json({ result: 'registerfailed' });
        }
        // Save user to DB
        const salt = crypto_1.default.randomBytes(8).toString('hex');
        const passwordHash = crypto_1.default.createHash('sha256').update(salt + password).digest('hex');
        const success = await (0, db_1.registerUserInDb)(username, passwordHash, salt);
        if (success) {
            await (0, db_1.deleteRegistrationCode)(code);
            res.cookie('liveatlas_logged_in', 'true', { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
            return res.json({ result: 'success' });
        }
    }
    catch (e) {
        console.error('Registration failed:', e);
    }
    return res.json({ result: 'registerfailed' });
});
// 8. User Logout
app.post(['/standalone/logout'], (req, res) => {
    res.clearCookie('liveatlas_logged_in');
    return res.json({ result: 'success' });
});
// Serve frontend static assets from 'dist' directory
const frontendDist = path_1.default.join(__dirname, '../../dist');
app.use(express_1.default.static(frontendDist));
// Fallback to index.html for SPA routing
app.get('/*splat', (req, res) => {
    const indexPath = path_1.default.join(frontendDist, 'index.html');
    if (fs_1.default.existsSync(indexPath)) {
        res.sendFile(indexPath);
    }
    else {
        res.status(404).send('LiveAtlas frontend build not found. Please run: yarn build');
    }
});
app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(` LiveAtlas Node Backend is running!`);
    console.log(` Port: ${PORT}`);
    console.log(` Storage Type: ${storageType}`);
    console.log(` Dynmap Dir: ${dynmapDir}`);
    console.log(`=========================================`);
});
