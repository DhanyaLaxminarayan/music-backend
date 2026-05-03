/**
 * Music search routes
 */

import { queryItems, scanAllItems } from '../services/dynamo.js';
import { successResponse, errorResponse } from '../utils/response.js';

const musicTable = process.env.MUSIC_TABLE || 'music';

/**
 * Handle music search with query parameters
 * Supports: title, artist, album, year
 * All conditions are combined with AND
 * @param {object} queryParams - Query parameters
 * @returns {Promise<object>} Lambda response
 */
export async function handleMusicSearch(queryParams) {
  try {
    const { title, artist, album, year } = queryParams;

    // At least one query parameter must be provided
    if (!title && !artist && !album && !year) {
      return errorResponse(
        'At least one query parameter (title, artist, album, or year) is required',
        400
      );
    }

    const parsedYear = year ? Number(year) : null;

    if (year && !Number.isInteger(parsedYear)) {
      return errorResponse('Year must be a valid number', 400);
    }

    const titleFilter = title ? String(title).toLowerCase() : null;
    const artistValue = artist ? String(artist).trim() : null;
    const artistFilter = artistValue ? artistValue.toLowerCase() : null;
    const albumFilter = album ? String(album).toLowerCase() : null;

    let candidateSongs;

    if (artistValue && album) {
      candidateSongs = await queryItems(
        musicTable,
        'artist = :artist AND begins_with(album, :album)',
        {
          ':artist': artistValue,
          ':album': String(album)
        },
        { IndexName: 'album-index' }
      );
    } else if (year && artistValue) {
      candidateSongs = await queryItems(
        musicTable,
        '#year = :year AND artist = :artist',
        {
          ':year': parsedYear,
          ':artist': artistValue
        },
        {
          IndexName: 'year-artist-index',
          ExpressionAttributeNames: { '#year': 'year' }
        }
      );
    } else if (artistValue) {
      candidateSongs = await queryItems(
        musicTable,
        'artist = :artist',
        { ':artist': artistValue }
      );
    } else {
      candidateSongs = await scanAllItems(musicTable);
    }

    const songs = candidateSongs.filter(song => {
      const matchesTitle = !titleFilter || String(song.title || '').toLowerCase().includes(titleFilter);
      const matchesArtist = !artistFilter || String(song.artist || '').toLowerCase().includes(artistFilter);
      const matchesAlbum = !albumFilter || String(song.album || '').toLowerCase().includes(albumFilter);
      const matchesYear = !year || Number(song.year) === parsedYear;

      return matchesTitle && matchesArtist && matchesAlbum && matchesYear;
    });

    if (songs.length === 0) {
      return successResponse({
        success: true,
        count: 0,
        songs: [],
        message: 'No result is retrieved. Please query again'
      });
    }

    return successResponse({
      success: true,
      count: songs.length,
      songs: songs
    });
  } catch (error) {
    console.error('Music search error:', error);
    return errorResponse('Internal server error', 500);
  }
}
