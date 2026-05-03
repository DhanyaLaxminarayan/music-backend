/**
 * Subscription routes
 */

import { queryItems, putItem, deleteItem, getSongBySongId } from '../services/dynamo.js';
import { successResponse, errorResponse } from '../utils/response.js';

const subscriptionsTable = process.env.SUBSCRIPTIONS_TABLE || 'subscriptions';

/**
 * Get all subscriptions for a user
 * @param {string} email - User email
 * @returns {Promise<object>} Lambda response
 */
export async function handleGetSubscriptions(email) {
  try {
    if (!email) {
      return errorResponse('Email parameter is required', 400);
    }

    const subscriptions = await queryItems(
      subscriptionsTable,
      'email = :email',
      { ':email': email }
    );

    const subscriptionsWithSongs = [];

    for (const subscription of subscriptions) {
      const song = await getSongBySongId(subscription.song_id);

      if (!song) {
        console.warn(`Song not found for subscription song_id: ${subscription.song_id}`);
        continue;
      }

      subscriptionsWithSongs.push({
        song_id: subscription.song_id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        year: song.year,
        image_url: song.image_url,
        subscribed_at: subscription.subscribed_at
      });
    }

    return successResponse({
      success: true,
      count: subscriptionsWithSongs.length,
      subscriptions: subscriptionsWithSongs
    });
  } catch (error) {
    console.error('Get subscriptions error:', error);
    return errorResponse('Internal server error', 500);
  }
}

/**
 * Add subscription for a user
 * @param {object} body - Request body with email and song_id
 * @returns {Promise<object>} Lambda response
 */
export async function handleAddSubscription(body) {
  try {
    if (!body || typeof body !== 'object') {
      return errorResponse('Request body is required', 400);
    }

    if (!body.email || !body.song_id) {
      return errorResponse('Email and song_id are required', 400);
    }

    try {
      await putItem(subscriptionsTable, {
        email: body.email,
        song_id: body.song_id,
        subscribed_at: new Date().toISOString()
      }, {
        ConditionExpression: 'attribute_not_exists(email) AND attribute_not_exists(song_id)'
      });
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        return successResponse({
          success: false,
          message: 'This song is already subscribed'
        }, 400);
      }

      throw error;
    }

    return successResponse({
      success: true,
      message: 'Subscription added successfully'
    }, 201);
  } catch (error) {
    console.error('Add subscription error:', error);
    return errorResponse('Internal server error', 500);
  }
}

/**
 * Remove subscription for a user
 * @param {object} body - Request body with email and song_id
 * @returns {Promise<object>} Lambda response
 */
export async function handleRemoveSubscription(body) {
  try {
    if (!body || typeof body !== 'object') {
      return errorResponse('Request body is required', 400);
    }

    if (!body.email || !body.song_id) {
      return errorResponse('Email and song_id are required', 400);
    }

    await deleteItem(subscriptionsTable, {
      email: body.email,
      song_id: body.song_id
    });

    return successResponse({
      success: true,
      message: 'Subscription removed successfully'
    });
  } catch (error) {
    console.error('Remove subscription error:', error);
    return errorResponse('Internal server error', 500);
  }
}
