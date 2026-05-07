/**
 * AWS Lambda handler for Music Subscription API
 * Entry point for all API Gateway requests
 */

import { corsPreflightResponse, errorResponse } from './utils/response.js';
import { handleLogin, handleRegister } from './routes/auth.js';
import { handleMusicSearch } from './routes/music.js';
import {
  handleGetSubscriptions,
  handleAddSubscription,
  handleRemoveSubscription
} from './routes/subscriptions.js';

/**
 * Parse HTTP method and path from API Gateway event
 * @param {string} path - HTTP path
 * @param {string} method - HTTP method
 * @returns {object} Parsed route info
 */
function parseRoute(path, method) {
  // Remove leading/trailing slashes
  const cleanPath = path.replace(/^\/+|\/+$/g, '');
  const pathSegments = cleanPath.split('/');
  
  return {
    resource: pathSegments[0] || '',
    method: method.toUpperCase()
  };
}

/**
 * Main Lambda handler
 * Compatible with API Gateway Lambda Proxy Integration
 * @param {object} event - API Gateway Lambda Proxy event
 * @returns {Promise<object>} Lambda response
 */
export async function handler(event) {
  console.log('Received event:', JSON.stringify(event, null, 2));

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return corsPreflightResponse();
  }

  const { httpMethod, path, body, queryStringParameters } = event;
  const route = parseRoute(path, httpMethod);

  try {
    let requestBody = null;

    if (body) {
      try {
        requestBody = JSON.parse(body);
      } catch {
        return errorResponse('Invalid JSON request body', 400);
      }
    }

    // Route to appropriate handler
    switch (route.resource) {
      case 'login':
        if (httpMethod === 'POST') {
          return await handleLogin(requestBody);
        }
        break;

      case 'register':
        if (httpMethod === 'POST') {
          return await handleRegister(requestBody);
        }
        break;

      case 'music':
      case 'getMusic':
        if (httpMethod === 'GET') {
          return await handleMusicSearch(queryStringParameters || {});
        }
        break;

      case 'subscriptions':
      case 'getSub':
        if (httpMethod === 'GET') {
          const email = queryStringParameters?.email;
          return await handleGetSubscriptions(email);
        } else if (route.resource === 'subscriptions' && httpMethod === 'POST') {
          return await handleAddSubscription(requestBody);
        } else if (route.resource === 'subscriptions' && httpMethod === 'DELETE') {
          return await handleRemoveSubscription(requestBody);
        }
        break;

      case 'createSub':
        if (httpMethod === 'POST') {
          return await handleAddSubscription(requestBody);
        }
        break;

      case 'deleteSub':
        if (httpMethod === 'DELETE') {
          return await handleRemoveSubscription(requestBody);
        }
        break;

      default:
        return errorResponse('Not found', 404);
    }

    return errorResponse('Method not allowed', 405);
  } catch (error) {
    console.error('Handler error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// For local testing only
export async function handleRequest(httpMethod, path, body, queryStringParameters) {
  const event = {
    httpMethod,
    path,
    body: body ? JSON.stringify(body) : null,
    queryStringParameters
  };
  return await handler(event);
}
