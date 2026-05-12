/**
 * Music search routes
 */

import { scanAllItems } from '../services/dynamo.js';
import { withImageUrls } from '../services/images.js';
import { successResponse, errorResponse } from '../utils/response.js';

const musicTable = process.env.MUSIC_TABLE || 'music';

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
    const artistFilter = artist ? String(artist).toLowerCase() : null;
    const albumFilter = album ? String(album).toLowerCase() : null;

    const candidateSongs = await scanAllItems(musicTable);

    const matchingSongs = candidateSongs.filter(song => {
      const matchesTitle = !titleFilter || String(song.title || '').toLowerCase().includes(titleFilter);
      const matchesArtist = !artistFilter || String(song.artist || '').toLowerCase().includes(artistFilter);
      const matchesAlbum = !albumFilter || String(song.album || '').toLowerCase().includes(albumFilter);
      const matchesYear = !year || Number(song.year) === parsedYear;

      return matchesTitle && matchesArtist && matchesAlbum && matchesYear;
    });

    const songs = await Promise.all(matchingSongs.map(normalizeSong));

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
