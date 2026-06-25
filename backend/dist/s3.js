"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTileFromS3 = exports.initS3 = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
let s3Client = null;
const bucketName = process.env.S3_BUCKET || '';
const pathPrefix = process.env.S3_PATH_PREFIX || '';
function initS3() {
    if (s3Client)
        return;
    if (process.env.STORAGE_TYPE === 's3' && process.env.S3_BUCKET) {
        s3Client = new client_s3_1.S3Client({
            endpoint: process.env.S3_ENDPOINT,
            region: process.env.S3_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
            },
            forcePathStyle: true,
        });
        console.log('S3 storage client initialized.');
    }
}
exports.initS3 = initS3;
async function getTileFromS3(tilePath) {
    initS3();
    if (!s3Client) {
        throw new Error('S3 client is not initialized');
    }
    const key = `${pathPrefix}${tilePath}`;
    try {
        const command = new client_s3_1.GetObjectCommand({
            Bucket: bucketName,
            Key: key,
        });
        const response = await s3Client.send(command);
        if (response.Body) {
            const byteArray = await response.Body.transformToByteArray();
            return Buffer.from(byteArray);
        }
        return null;
    }
    catch (error) {
        // Log errors other than NoSuchKey (which is common for missing empty tiles)
        const err = error;
        if (err.name !== 'NoSuchKey') {
            console.error(`Failed to fetch tile ${tilePath} from S3 (Key: ${key}):`, error);
        }
        return null;
    }
}
exports.getTileFromS3 = getTileFromS3;
