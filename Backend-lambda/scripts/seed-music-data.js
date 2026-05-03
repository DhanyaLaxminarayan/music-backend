/**
 * Seed music data from 2026a2_songs.json into DynamoDB.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const songsFilePath = path.resolve(__dirname, '../2026a2_songs.json');

const region = process.env.AWS_REGION || 'us-east-1';
const musicTable = process.env.MUSIC_TABLE || 'music';
const s3Bucket = process.env.S3_BUCKET;

if (!s3Bucket) {
  console.error('Missing S3_BUCKET environment variable.');
  process.exit(1);
}

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

function slugify(value) {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildSongId({ artist, album, year, title }) {
  return `${artist}#${album}#${year}#${title}`;
}

function buildImageUrl(artist) {
  const key = `artist-images/${slugify(artist)}.jpg`;
  return `https://${s3Bucket}.s3.${region}.amazonaws.com/${key}`;
}

async function loadSongs() {
  const raw = await readFile(songsFilePath, 'utf8');
  const data = JSON.parse(raw);

  if (!data || !Array.isArray(data.songs)) {
    throw new Error('Invalid 2026a2_songs.json format: expected { songs: [...] }');
  }

  return data.songs;
}

function transformSongs(sourceSongs) {
  const seenSongIds = new Set();

  return sourceSongs.map((song, index) => {
    if (!song || typeof song !== 'object') {
      throw new Error(`Invalid song entry at index ${index}`);
    }

    const title = String(song.title || '').trim();
    const artist = String(song.artist || '').trim();
    const album = String(song.album || '').trim();
    const year = Number(String(song.year || '').trim());
    const imgUrl = String(song.img_url || '').trim();

    if (!title || !artist || !album || !imgUrl || !Number.isInteger(year)) {
      throw new Error(`Invalid song fields at index ${index}`);
    }

    const songId = buildSongId({ title, artist, album, year });

    if (seenSongIds.has(songId)) {
      throw new Error(`Duplicate song_id detected: ${songId}`);
    }

    seenSongIds.add(songId);

    return {
      artist,
      song_id: songId,
      title,
      year,
      album,
      image_url: buildImageUrl(artist)
    };
  });
}

async function batchWriteAll(items) {
  let writtenCount = 0;

  for (let index = 0; index < items.length; index += 25) {
    let batchItems = items.slice(index, index + 25).map(item => ({
      PutRequest: { Item: item }
    }));

    while (batchItems.length > 0) {
      const response = await dynamoClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [musicTable]: batchItems
          }
        })
      );

      const unprocessedItems = response.UnprocessedItems?.[musicTable] || [];
      writtenCount += batchItems.length - unprocessedItems.length;

      if (unprocessedItems.length === 0) {
        break;
      }

      batchItems = unprocessedItems;
      console.log(`Retrying ${batchItems.length} unprocessed music items...`);
    }
  }

  return writtenCount;
}

async function seedMusicData() {
  try {
    const sourceSongs = await loadSongs();
    const items = transformSongs(sourceSongs);

    console.log(`Seeding ${items.length} songs to ${musicTable} in ${region}...`);

    const writtenCount = await batchWriteAll(items);

    console.log(`Seeded ${writtenCount} music items.`);
  } catch (error) {
    console.error('Error seeding music data:', error);
    process.exit(1);
  }
}

seedMusicData();
