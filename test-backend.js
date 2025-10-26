#!/usr/bin/env node

/**
 * Simple test script to verify the backend server is working
 */

const testDomain = 'example.com';

async function testBackend() {
  try {
    console.log('🧪 Testing backend server...');

    // Test health endpoint
    console.log('📊 Testing health endpoint...');
    const healthResponse = await fetch('http://localhost:3001/health');
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status}`);
    }
    const healthData = await healthResponse.json();
    console.log('✅ Health check passed:', healthData);

    // Test WHOIS endpoint
    console.log(`🔍 Testing WHOIS endpoint for ${testDomain}...`);
    const whoisResponse = await fetch(`http://localhost:3001/api/whois/${testDomain}`);
    if (!whoisResponse.ok) {
      throw new Error(`WHOIS test failed: ${whoisResponse.status}`);
    }
    const whoisData = await whoisResponse.json();
    console.log('✅ WHOIS test passed:', {
      domain: whoisData.domain,
      success: whoisData.success,
      hasData: !!whoisData.data
    });

    console.log('🎉 All tests passed! Backend server is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n💡 Make sure:');
    console.log('   1. Backend server is running (cd backend && npm run dev)');
    console.log('   2. WHOIS_API_KEY is set in backend/.env');
    console.log('   3. Server is accessible at http://localhost:3001');
    process.exit(1);
  }
}

testBackend();