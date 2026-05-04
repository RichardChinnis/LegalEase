#!/usr/bin/env node
console.log('=== Minimal Test Started ===');
console.log('Working directory:', process.cwd());
console.log('Node version:', process.version);

try {
    console.log('Testing logger require...');
    const logger = require('./lib/logger');
    console.log('✓ Logger loaded');

    console.log('Testing email-config require...');
    const emailConfig = require('./config/email-config');
    console.log('✓ Email config loaded');

    console.log('Testing email service require...');
    const EmailService = require('./lib/email-service');
    console.log('✓ Email service loaded');

    console.log('=== All modules loaded successfully ===');
    process.exit(0);
} catch (error) {
    console.log('=== ERROR ===');
    console.log('Error message:', error.message);
    console.log('Error stack:', error.stack);
    process.exit(1);
}
