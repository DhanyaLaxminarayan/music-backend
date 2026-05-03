/**
 * Authentication routes (Login and Register)
 */

import { getItem, putItem } from '../services/dynamo.js';
import { successResponse, errorResponse } from '../utils/response.js';

const loginTable = process.env.LOGIN_TABLE || 'login';

/**
 * Handle login request
 * @param {object} body - Request body with email and password
 * @returns {Promise<object>} Lambda response
 */
export async function handleLogin(body) {
  try {
    if (!body || typeof body !== 'object') {
      return errorResponse('Request body is required', 400);
    }

    if (!body.email || !body.password) {
      return errorResponse('Email and password are required', 400);
    }

    const user = await getItem(loginTable, { email: body.email });

    if (!user || user.password !== body.password) {
      return successResponse({
        success: false,
        message: 'email or password is invalid'
      }, 401);
    }

    return successResponse({
      success: true,
      message: 'Login successful',
      user: {
        email: user.email,
        user_name: user.user_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return errorResponse('Internal server error', 500);
  }
}

/**
 * Handle register request
 * @param {object} body - Request body with email, user_name, password
 * @returns {Promise<object>} Lambda response
 */
export async function handleRegister(body) {
  try {
    if (!body || typeof body !== 'object') {
      return errorResponse('Request body is required', 400);
    }

    if (!body.email || !body.user_name || !body.password) {
      return errorResponse('Email, username, and password are required', 400);
    }

    try {
      await putItem(loginTable, {
        email: body.email,
        user_name: body.user_name,
        password: body.password,
        created_at: new Date().toISOString()
      }, {
        ConditionExpression: 'attribute_not_exists(email)'
      });
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        return successResponse({
          success: false,
          message: 'The email already exists'
        }, 400);
      }

      throw error;
    }

    return successResponse({
      success: true,
      message: 'Registration successful',
      user: {
        email: body.email,
        user_name: body.user_name
      }
    }, 201);
  } catch (error) {
    console.error('Register error:', error);
    return errorResponse('Internal server error', 500);
  }
}
