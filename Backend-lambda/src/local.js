/**
 * Local testing script for Lambda handlers
 * Simulates API Gateway events without needing AWS
 */

import { handler } from './handler.js';

// Test data
const testRequests = [
  {
    name: 'Register User',
    method: 'POST',
    path: '/register',
    body: {
      email: 'test@example.com',
      user_name: 'testuser',
      password: 'password123'
    }
  },
  {
    name: 'Login User',
    method: 'POST',
    path: '/login',
    body: {
      email: 'test@example.com',
      password: 'password123'
    }
  },
  {
    name: 'Login with Wrong Password',
    method: 'POST',
    path: '/login',
    body: {
      email: 'test@example.com',
      password: 'wrongpassword'
    }
  },
  {
    name: 'Search Music by Title',
    method: 'GET',
    path: '/music',
    queryStringParameters: {
      title: 'song'
    }
  },
  {
    name: 'Search Music with Multiple Parameters',
    method: 'GET',
    path: '/music',
    queryStringParameters: {
      title: 'song',
      artist: 'artist'
    }
  },
  {
    name: 'Search Music without Parameters (should fail)',
    method: 'GET',
    path: '/music',
    queryStringParameters: null
  },
  {
    name: 'Get Subscriptions',
    method: 'GET',
    path: '/subscriptions',
    queryStringParameters: {
      email: 'test@example.com'
    }
  },
  {
    name: 'Add Subscription',
    method: 'POST',
    path: '/subscriptions',
    body: {
      email: 'test@example.com',
      song_id: 'song123'
    }
  },
  {
    name: 'Remove Subscription',
    method: 'DELETE',
    path: '/subscriptions',
    body: {
      email: 'test@example.com',
      song_id: 'song123'
    }
  },
  {
    name: 'CORS Preflight',
    method: 'OPTIONS',
    path: '/login'
  }
];

/**
 * Run a single test request
 */
async function runTest(test) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Test: ${test.name}`);
  console.log(`${test.method} ${test.path}`);
  console.log('='.repeat(60));

  try {
    const event = {
      httpMethod: test.method,
      path: test.path,
      body: test.body ? JSON.stringify(test.body) : null,
      queryStringParameters: test.queryStringParameters
    };

    const response = await handler(event);

    console.log('Status:', response.statusCode);
    console.log('Response:', response.body);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n🚀 Starting local API tests...\n');
  console.log('Note: These tests will fail if DynamoDB tables do not exist');
  console.log('or AWS credentials are not configured.\n');

  for (const test of testRequests) {
    await runTest(test);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ All tests completed');
  console.log('='.repeat(60));
}

// Run tests if this script is executed directly
runAllTests().catch(console.error);
