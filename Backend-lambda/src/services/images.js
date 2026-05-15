import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const region = process.env.AWS_REGION || 'us-east-1';
const s3Bucket = process.env.S3_BUCKET || 'music-a2-images-307302876893-final';
const s3Client = new S3Client({ region });

function parseS3Url(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const virtualHostedMatch = url.hostname.match(/^(.+)\.s3[.-][^.]+\.amazonaws\.com$/);

    if (virtualHostedMatch) {
      return {
        bucket: virtualHostedMatch[1],
        key: decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      };
    }

    const pathStyleMatch = url.hostname.match(/^s3[.-][^.]+\.amazonaws\.com$/);
    const pathParts = url.pathname.replace(/^\/+/, '').split('/');

    if (pathStyleMatch && pathParts.length >= 2) {
      return {
        bucket: pathParts.shift(),
        key: decodeURIComponent(pathParts.join('/'))
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function buildPresignedImageUrl(song) {
  const imageKey = song?.image_s3_key;
  const parsedUrl = parseS3Url(song?.image_url || song?.img_url || '');
  const bucket = imageKey ? s3Bucket : parsedUrl?.bucket;
  const key = imageKey || parsedUrl?.key;

  // Return a presigned S3 URL when the image is stored as an object key.
  if (!bucket || !key) {
    return song?.image_url || song?.img_url || '';
  }

  try {
    return await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 }
    );
  } catch (error) {
    console.warn(`Failed to presign image URL for ${bucket}/${key}:`, error);
    return song?.image_url || song?.img_url || '';
  }
}

export async function withImageUrls(song) {
  const imageUrl = await buildPresignedImageUrl(song);

  return {
    ...song,
    image_url: imageUrl,
    img_url: imageUrl
  };
}
