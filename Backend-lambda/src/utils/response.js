/**
 * Utility functions for HTTP responses with CORS headers
 * Compatible with API Gateway Lambda Proxy Integration
 */

/**
 * Generate standard success response
 * @param {object} data - Response data
 * @param {number} statusCode - HTTP status code (default: 200)
 * @returns {object} Formatted response for API Gateway
 */
export function successResponse(data, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(data)
  };
}

/**
 * Generate standard error response
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 400)
 * @returns {object} Formatted response for API Gateway
 */
export function errorResponse(message, statusCode = 400) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify({
      success: false,
      message
    })
  };
}

/**
 * Handle preflight OPTIONS requests for CORS
 * @returns {object} CORS preflight response
 */
export function corsPreflightResponse() {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: ''
  };
}
