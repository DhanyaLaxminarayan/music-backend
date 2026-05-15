/**
 * Subscription routes
 */

import { createHash } from 'node:crypto';
import { queryItems, putItem, deleteItem, getSongBySongId } from '../services/dynamo.js';
import { withImageUrls } from '../services/images.js';
import { successResponse, errorResponse } from '../utils/response.js';

const subscriptionsTable = process.env.SUBSCRIPTIONS_TABLE || 'subscriptions';

function norm(value) {
  return value == null ? '' : String(value).trim().toLowerCase();
}

function sha1(value) {
  return createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 24);
}

function makeSubscriptionSongId(song) {
  if (song?.title_year) {
    return String(song.title_year);
  }

  const raw = [
    norm(song.artist),
    norm(song.title),
    song.year == null ? '' : String(song.year).trim(),
    norm(song.album)
  ].join('|');

  return sha1(raw);
}

function getExplicitSongIdentifier(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  if (body.song_id) {
    return body.song_id;
  }

  if (body.title_year) {
    return body.title_year;
  }

  return null;
}

function getLegacySongIdentifier(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  if (body.title && body.year) {
    return `${body.title}#${body.year}`;
  }

  return null;
}

function hasStoredSongDetails(subscription) {
  return Boolean(subscription.title && subscription.artist);
}

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
      if (hasStoredSongDetails(subscription)) {
        subscriptionsWithSongs.push(await withImageUrls({
          song_id: subscription.song_id,
          title: subscription.title,
          artist: subscription.artist,
          album: subscription.album,
          year: subscription.year,
          image_s3_key: subscription.image_s3_key,
          original_image_url: subscription.original_image_url,
          image_url: subscription.image_url || subscription.original_image_url,
          img_url: subscription.img_url,
          subscribed_at: subscription.subscribed_at
        }));
        continue;
      }

      const song = await getSongBySongId(subscription.song_id);

      if (!song) {
        console.warn(`Song not found for subscription song_id: ${subscription.song_id}`);
        subscriptionsWithSongs.push(await withImageUrls({
          song_id: subscription.song_id,
          title: subscription.title,
          artist: subscription.artist,
          album: subscription.album,
          year: subscription.year,
          image_url: subscription.image_url,
          img_url: subscription.img_url,
          subscribed_at: subscription.subscribed_at
        }));
        continue;
      }

      subscriptionsWithSongs.push(await withImageUrls({
        song_id: subscription.song_id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        year: song.year,
        image_s3_key: song.image_s3_key,
        image_url: song.image_url,
        img_url: song.img_url,
        subscribed_at: subscription.subscribed_at
      }));
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
 * @param {object} body - Request body with email and song_id or title/year
 * @returns {Promise<object>} Lambda response
 */
export async function handleAddSubscription(body) {
  try {
    if (!body || typeof body !== 'object') {
      return errorResponse('Request body is required', 400);
    }

    const song = body.song && typeof body.song === 'object' ? body.song : body;
    const songId = getExplicitSongIdentifier(song) || makeSubscriptionSongId(song);

    if (!body.email || !song.title || !song.artist) {
      return errorResponse('Email, title and artist are required', 400);
    }

    try {
      await putItem(subscriptionsTable, {
        // subscriptions table key: email + song_id
        email: body.email,
        song_id: songId,
        title: song.title,
        artist: song.artist,
        year: song.year == null ? '' : String(song.year).trim(),
        album: song.album || '',
        ...(song.title_year && { title_year: song.title_year }),
        artist_norm: norm(song.artist),
        title_norm: norm(song.title),
        album_norm: norm(song.album),
        ...(song.image_s3_key && { image_s3_key: song.image_s3_key }),
        ...(song.original_image_url && { original_image_url: song.original_image_url }),
        ...(!song.original_image_url && song.image_url && { original_image_url: song.image_url }),
        ...(!song.original_image_url && !song.image_url && song.img_url && { original_image_url: song.img_url }),
        ...(song.image_url && { image_url: song.image_url }),
        ...(song.img_url && { img_url: song.img_url }),
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
 * @param {object} body - Request body with email and song_id or title/year
 * @returns {Promise<object>} Lambda response
 */
export async function handleRemoveSubscription(body) {
  try {
    if (!body || typeof body !== 'object') {
      return errorResponse('Request body is required', 400);
    }

    const songId = getExplicitSongIdentifier(body);

    if (!body.email) {
      return errorResponse('Email and song_id or song details are required', 400);
    }

    let subscriptionSongId = songId;

    if (!subscriptionSongId && body.title && body.artist) {
      subscriptionSongId = makeSubscriptionSongId(body);
    }

    if (!subscriptionSongId && body.title && body.year) {
      subscriptionSongId = getLegacySongIdentifier(body);
    }

    if (!subscriptionSongId && body.title) {
      const subscriptions = await queryItems(
        subscriptionsTable,
        'email = :email',
        { ':email': body.email }
      );
      const matchingSubscription = subscriptions.find(subscription => (
        subscription.title === body.title ||
        norm(subscription.title) === norm(body.title) ||
        String(subscription.song_id || '').startsWith(`${body.title}#`)
      ));

      subscriptionSongId = matchingSubscription?.song_id;
    }

    if (!subscriptionSongId) {
      return errorResponse('Email and song_id or song details are required', 400);
    }

    await deleteItem(subscriptionsTable, {
      email: body.email,
      song_id: subscriptionSongId
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
