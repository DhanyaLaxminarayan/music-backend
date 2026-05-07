/**
 * DynamoDB service layer
 * Handles all database operations
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  ScanCommand
} from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION || 'us-east-1';
const dynamoClient = new DynamoDBClient({ region });
const musicTable = process.env.MUSIC_TABLE || 'music';

/**
 * Get item from DynamoDB table
 * @param {string} tableName - Table name
 * @param {object} key - Partition key and sort key (if applicable)
 * @returns {Promise<object>} Item data or null if not found
 */
export async function getItem(tableName, key) {
  try {
    const command = new GetCommand({
      TableName: tableName,
      Key: key
    });
    const response = await dynamoClient.send(command);
    return response.Item || null;
  } catch (error) {
    console.error(`Error getting item from ${tableName}:`, error);
    throw error;
  }
}

/**
 * Put item into DynamoDB table
 * @param {string} tableName - Table name
 * @param {object} item - Item data to put
 * @param {object} options - Additional put options
 * @returns {Promise<void>}
 */
export async function putItem(tableName, item, options = {}) {
  try {
    const command = new PutCommand({
      TableName: tableName,
      Item: item,
      ...options
    });
    await dynamoClient.send(command);
  } catch (error) {
    console.error(`Error putting item to ${tableName}:`, error);
    throw error;
  }
}

/**
 * Query items from DynamoDB table
 * @param {string} tableName - Table name
 * @param {string} keyConditionExpression - Key condition expression
 * @param {object} expressionAttributeValues - Attribute values for expression
 * @param {object} options - Additional query options
 * @returns {Promise<array>} Array of items
 */
export async function queryItems(
  tableName,
  keyConditionExpression,
  expressionAttributeValues = {},
  options = {}
) {
  try {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...options
    });
    const response = await dynamoClient.send(command);
    return response.Items || [];
  } catch (error) {
    console.error(`Error querying ${tableName}:`, error);
    throw error;
  }
}

/**
 * Scan items from DynamoDB table with filter
 * @param {string} tableName - Table name
 * @param {string} filterExpression - Filter expression (optional)
 * @param {object} expressionAttributeValues - Attribute values for expression
 * @param {object} options - Additional scan options
 * @returns {Promise<array>} Array of items
 */
export async function scanItems(
  tableName,
  filterExpression = null,
  expressionAttributeValues = {},
  options = {}
) {
  try {
    const command = new ScanCommand({
      TableName: tableName,
      ...(filterExpression && { FilterExpression: filterExpression }),
      ...(Object.keys(expressionAttributeValues).length > 0 && {
        ExpressionAttributeValues: expressionAttributeValues
      }),
      ...options
    });
    const response = await dynamoClient.send(command);
    return response.Items || [];
  } catch (error) {
    console.error(`Error scanning ${tableName}:`, error);
    throw error;
  }
}

/**
 * Scan all pages from a DynamoDB table.
 * @param {string} tableName - Table name
 * @param {string} filterExpression - Filter expression (optional)
 * @param {object} expressionAttributeValues - Attribute values for expression
 * @param {object} options - Additional scan options
 * @returns {Promise<array>} Array of all matched items
 */
export async function scanAllItems(
  tableName,
  filterExpression = null,
  expressionAttributeValues = {},
  options = {}
) {
  try {
    const items = [];
    let exclusiveStartKey;

    do {
      const command = new ScanCommand({
        TableName: tableName,
        ...(filterExpression && { FilterExpression: filterExpression }),
        ...(Object.keys(expressionAttributeValues).length > 0 && {
          ExpressionAttributeValues: expressionAttributeValues
        }),
        ...options,
        ExclusiveStartKey: exclusiveStartKey
      });
      const response = await dynamoClient.send(command);

      items.push(...(response.Items || []));
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
  } catch (error) {
    console.error(`Error scanning all items from ${tableName}:`, error);
    throw error;
  }
}

function buildLegacySongId(song) {
  if (!song?.title || !song?.year) {
    return null;
  }

  return `${song.title}#${song.year}`;
}

/**
 * Find a song by Lambda song_id or upload_music.py title_year format.
 * @param {string} songId - Song ID or title_year value
 * @returns {Promise<object|null>} Song data or null if not found
 */
export async function getSongBySongId(songId) {
  const songs = await scanAllItems(musicTable);

  return songs.find(song => (
    song.song_id === songId ||
    song.title_year === songId ||
    buildLegacySongId(song) === songId
  )) || null;
}

/**
 * Delete item from DynamoDB table
 * @param {string} tableName - Table name
 * @param {object} key - Partition key and sort key (if applicable)
 * @returns {Promise<void>}
 */
export async function deleteItem(tableName, key) {
  try {
    const command = new DeleteCommand({
      TableName: tableName,
      Key: key
    });
    await dynamoClient.send(command);
  } catch (error) {
    console.error(`Error deleting item from ${tableName}:`, error);
    throw error;
  }
}
