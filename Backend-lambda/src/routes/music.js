/**
 * Music search routes
 */

import { queryAllItems, scanAllItems } from '../services/dynamo.js';
import { withImageUrls } from '../services/images.js';
import { successResponse, errorResponse } from '../utils/response.js';

const musicTable = process.env.MUSIC_TABLE || 'music-final';

function buildLegacySongId(song) {
  if (!song?.title || !song?.year) {
    return null;
  }

  return `${song.title}#${song.year}`;
}

async function normalizeSong(song) {
  const songId = song.song_id || song.title_year || buildLegacySongId(song);

  return withImageUrls({
    ...song,
    ...(songId && { song_id: songId }),
    ...(song.title_year && { title_year: song.title_year })
  });
}

function yearCandidates(year) {
  const value = String(year || '').trim();

  if (!value) {
    return [];
  }

  const asNumber = Number(value);

  if (Number.isInteger(asNumber)) {
    return [asNumber, value];
  }

  return [value];
}

async function queryYearIndex(year, artist = '') {
  let lastError;
  const artistValue = artist ? String(artist).trim() : '';

  for (const candidate of yearCandidates(year)) {
    try {
      const keyCondition = artistValue
        ? '#yr = :year AND artist = :artist'
        : '#yr = :year';
      const expressionValues = artistValue
        ? { ':year': candidate, ':artist': artistValue }
        : { ':year': candidate };

      return await queryAllItems(
        musicTable,
        keyCondition,
        expressionValues,
        {
          IndexName: 'YearArtistIndex',
          ExpressionAttributeNames: {
            '#yr': 'year'
          }
        }
      );
    } catch (error) {
      lastError = error;

      if (error.name !== 'ValidationException') {
        throw error;
      }
    }
  }

  throw lastError;
}

async function getCandidateSongs({ artist, album, year }) {
  const artistValue = artist ? String(artist).trim() : '';
  const albumValue = album ? String(album).trim() : '';
  const yearValue = year ? String(year).trim() : '';

  if (artistValue && albumValue) {
    return {
      // LSI supports artist + album searches such as Taylor Swift in Fearless.
      operation: 'Query using LSI',
      items: await queryAllItems(
        musicTable,
        'artist = :artist AND album = :album',
        {
          ':artist': artistValue,
          ':album': albumValue
        },
        { IndexName: 'album-index' }
      )
    };
  }

  if (yearValue) {
    return {
      // GSI supports year and artist + year searches.
      operation: 'Query using GSI',
      items: await queryYearIndex(yearValue, artistValue)
    };
  }

  if (artistValue) {
    return {
      // Main table key supports artist-only searches.
      operation: 'Query using main key',
      items: await queryAllItems(
        musicTable,
        'artist = :artist',
        { ':artist': artistValue }
      )
    };
  }

  return {
    operation: 'Scan',
    items: await scanAllItems(musicTable)
  };
}

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

    const titleFilter = title ? String(title).trim().toLowerCase() : null;
    const artistFilter = artist ? String(artist).trim().toLowerCase() : null;
    const albumFilter = album ? String(album).trim().toLowerCase() : null;
    const { operation, items: candidateSongs } = await getCandidateSongs({ artist, album, year });

    const matchingSongs = candidateSongs.filter(song => {
      const matchesTitle = !titleFilter || String(song.title || '').trim().toLowerCase() === titleFilter;
      const matchesArtist = !artistFilter || String(song.artist || '').trim().toLowerCase() === artistFilter;
      const matchesAlbum = !albumFilter || String(song.album || '').trim().toLowerCase() === albumFilter;
      const matchesYear = !year || String(song.year || '').trim() === String(year).trim();

      return matchesTitle && matchesArtist && matchesAlbum && matchesYear;
    });

    const songs = await Promise.all(matchingSongs.map(normalizeSong));

    if (songs.length === 0) {
      return successResponse({
        success: true,
        count: 0,
        songs: [],
        operation,
        message: 'No result is retrieved. Please query again'
      });
    }

    return successResponse({
      success: true,
      count: songs.length,
      songs: songs,
      operation
    });
  } catch (error) {
    console.error('Music search error:', error);
    return errorResponse('Internal server error', 500);
  }
}
