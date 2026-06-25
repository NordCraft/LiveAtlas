import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

let s3Client: S3Client | null = null;
const bucketName = process.env.S3_BUCKET || '';
const pathPrefix = process.env.S3_PATH_PREFIX || '';

export function initS3() {
	if (s3Client) return;

	if (process.env.STORAGE_TYPE === 's3' && process.env.S3_BUCKET) {
		s3Client = new S3Client({
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

export async function getTileFromS3(tilePath: string): Promise<Buffer | null> {
	initS3();
	if (!s3Client) {
		throw new Error('S3 client is not initialized');
	}

	const key = `${pathPrefix}${tilePath}`;
	try {
		const command = new GetObjectCommand({
			Bucket: bucketName,
			Key: key,
		});
		const response = await s3Client.send(command);
		if (response.Body) {
			const byteArray = await response.Body.transformToByteArray();
			return Buffer.from(byteArray);
		}
		return null;
	} catch (error) {
		// Log errors other than NoSuchKey (which is common for missing empty tiles)
		const err = error as any;
		if (err.name !== 'NoSuchKey') {
			console.error(`Failed to fetch tile ${tilePath} from S3 (Key: ${key}):`, error);
		}
		return null;
	}
}
