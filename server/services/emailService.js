const nodemailer = require('nodemailer');

/**
 * Email Service
 * Handles sending emails for verification, notifications, etc.
 * Uses Gmail SMTP with app-specific password
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.initializeTransporter();
  }

  /**
   * Initialize the email transporter with Gmail SMTP
   */
  initializeTransporter() {
    try {
      // Validate required environment variables
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
        console.warn('⚠️  Email service not configured: Missing EMAIL_USER or EMAIL_PASSWORD');
        return;
      }

      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT || '587', 10),
        secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        },
        tls: {
          // Do not fail on invalid certs (for development)
          rejectUnauthorized: false,
        },
      });

      this.isConfigured = true;
      console.log('✅ Email service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize email service:', error.message);
      this.isConfigured = false;
    }
  }

  /**
   * Verify the email transporter connection
   * @returns {Promise<boolean>}
   */
  async verifyConnection() {
    if (!this.isConfigured) {
      return false;
    }

    try {
      await this.transporter.verify();
      console.log('✅ Email service connection verified');
      return true;
    } catch (error) {
      console.error('❌ Email service connection failed:', error.message);
      return false;
    }
  }

  /**
   * Send verification email with link
   * @param {string} to - Recipient email address
   * @param {string} token - Verification token (not hashed)
   * @param {string} name - User's name (optional)
   * @returns {Promise<Object>}
   */
  async sendVerificationEmail(to, token, name = '') {
    if (!this.isConfigured) {
      throw new Error('Email service is not configured');
    }

    const firstName = name ? name.split(' ')[0] : 'there';

    // Build verification link
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verificationLink = `${baseUrl}/verify-email?token=${token}`;

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || 'Pocket Indexer',
        address: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER,
      },
      to: to,
      subject: 'Verify Your Email Address - Pocket Indexer',
      html: this.getVerificationEmailTemplate(verificationLink, firstName),
      text: this.getVerificationEmailText(verificationLink, firstName),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`📧 Verification email sent to ${to}:`, info.messageId);
      return {
        success: true,
        messageId: info.messageId,
        to: to,
      };
    } catch (error) {
      console.error(`❌ Failed to send verification email to ${to}:`, error.message);
      throw new Error(`Failed to send verification email: ${error.message}`);
    }
  }

  /**
   * HTML template for verification email
   * @param {string} verificationLink - Complete verification link
   * @param {string} name - User's first name
   * @returns {string}
   */
  getVerificationEmailTemplate(verificationLink, name) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9fafb;
    }
    .container {
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 40px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #3b82f6;
    }
    .logo {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    }
    .title {
      font-size: 22px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 10px 0;
    }
    .subtitle {
      font-size: 14px;
      color: #6b7280;
      margin: 0;
    }
    .message {
      font-size: 15px;
      color: #374151;
      margin-bottom: 20px;
      line-height: 1.7;
    }
    .button-container {
      text-align: center;
      margin: 30px 0;
    }
    .verify-button {
      display: inline-block;
      padding: 14px 32px;
      background-color: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      border: 2px solid #1e40af;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .expiry {
      text-align: center;
      color: #6b7280;
      font-size: 13px;
      margin: 20px 0;
    }
    .warning-box {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      margin: 25px 0;
      border-radius: 4px;
    }
    .warning-box p {
      margin: 0;
      color: #92400e;
      font-size: 14px;
    }
    .link-box {
      background-color: #f9fafb;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 15px;
      margin: 20px 0;
      word-break: break-all;
    }
    .link-box p {
      margin: 5px 0;
      font-size: 12px;
      color: #6b7280;
    }
    .link-box a {
      color: #3b82f6;
      text-decoration: none;
      font-size: 13px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Pocket Indexer</div>
      <h1 class="title">Verify Your Email Address</h1>
      <p class="subtitle">Complete your registration</p>
    </div>

    <div class="message">
      <p>Hi ${name},</p>
      <p>Thank you for registering with Pocket Indexer. To complete your registration and activate your account, please verify your email address by clicking the button below.</p>
    </div>

    <div class="button-container">
      <a href="${verificationLink}" class="verify-button">Verify Email Address</a>
    </div>

    <div class="expiry">
      This verification link will expire in 24 hours
    </div>

    <div class="link-box">
      <p><strong>Alternative: Copy and paste this link</strong></p>
      <a href="${verificationLink}">${verificationLink}</a>
    </div>

    <div class="warning-box">
      <p><strong>Security Notice:</strong> If you didn't request this verification, please ignore this email. Your account is safe.</p>
    </div>

    <div class="message">
      <p>After verifying your email, you'll receive your API token and have full access to the Pocket Indexer API.</p>
      <p>If you have any questions or need assistance, feel free to reach out to our support team.</p>
    </div>

    <div class="footer">
      <p>Best regards,<br><strong>Pocket Indexer Team</strong></p>
      <p style="margin-top: 15px; font-size: 12px;">
        This is an automated message, please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Plain text version for email clients that don't support HTML
   * @param {string} verificationLink - Complete verification link
   * @param {string} name - User's first name
   * @returns {string}
   */
  getVerificationEmailText(verificationLink, name) {
    return `
Hi ${name},

Thank you for registering with Pocket Indexer!

To verify your email address and activate your account, please click the link below:

${verificationLink}

This link will expire in 24 hours.

If you didn't request this verification, please ignore this email. Your account is safe.

After verifying your email, you'll have full access to the Pocket Indexer API.

Best regards,
Pocket Indexer Team

---
This is an automated message, please do not reply to this email.
    `.trim();
  }

  /**
   * Send API token email for quick registration
   * @param {string} to - Recipient email address
   * @param {string} token - API token
   * @param {string} name - User's name (optional)
   * @returns {Promise<Object>}
   */
  async sendApiTokenEmail(to, token, name = '') {
    if (!this.isConfigured) {
      throw new Error('Email service is not configured');
    }

    const firstName = name ? name.split(' ')[0] : 'there';

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || 'Pocket Indexer',
        address: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER,
      },
      to: to,
      subject: 'Your Pocket Indexer API Token',
      html: this.getApiTokenEmailTemplate(token, firstName),
      text: this.getApiTokenEmailText(token, firstName),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`📧 API token email sent to ${to}:`, info.messageId);
      return {
        success: true,
        messageId: info.messageId,
        to: to,
      };
    } catch (error) {
      console.error(`❌ Failed to send API token email to ${to}:`, error.message);
      throw new Error(`Failed to send API token email: ${error.message}`);
    }
  }

  /**
   * Send welcome email with credentials to newly created user
   * @param {string} to - Recipient email
   * @param {string} password - Temporary password
   * @param {string} name - User's full name
   * @param {string} loginUrl - URL to login page
   * @returns {Promise<Object>}
   */
  async sendUserCredentialsEmail(to, password, name = '', loginUrl = '') {
    if (!this.isConfigured) {
      throw new Error('Email service is not configured');
    }

    const firstName = name ? name.split(' ')[0] : 'there';
    const actualLoginUrl = loginUrl || process.env.FRONTEND_URL || 'http://localhost:3000';

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || 'Pocket Indexer',
        address: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER,
      },
      to: to,
      subject: 'Welcome to Pocket Indexer - Your Account Credentials',
      html: this.getUserCredentialsEmailTemplate(to, password, firstName, actualLoginUrl),
      text: this.getUserCredentialsEmailText(to, password, firstName, actualLoginUrl),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`📧 Credentials email sent to ${to}:`, info.messageId);
      return {
        success: true,
        messageId: info.messageId,
        to: to,
      };
    } catch (error) {
      console.error(`❌ Failed to send credentials email to ${to}:`, error.message);
      throw new Error(`Failed to send credentials email: ${error.message}`);
    }
  }

  /**
   * HTML template for API token email
   * @param {string} token - API token
   * @param {string} name - User's first name
   * @returns {string}
   */
  getApiTokenEmailTemplate(token, name) {
    const dashboardUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your API Token</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9fafb;
    }
    .container {
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 40px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #3b82f6;
    }
    .logo {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    }
    .title {
      font-size: 22px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 10px 0;
    }
    .subtitle {
      font-size: 14px;
      color: #6b7280;
      margin: 0;
    }
    .message {
      font-size: 15px;
      color: #374151;
      margin-bottom: 20px;
      line-height: 1.7;
    }
    .token-section {
      background-color: #f9fafb;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 20px;
      margin: 25px 0;
    }
    .token-label {
      font-size: 13px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    .token-value {
      font-family: 'Courier New', monospace;
      font-size: 14px;
      color: #1f2937;
      background-color: #ffffff;
      padding: 12px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      word-break: break-all;
      margin-bottom: 10px;
    }
    .copy-notice {
      font-size: 12px;
      color: #6b7280;
      font-style: italic;
    }
    .warning-box {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      margin: 25px 0;
      border-radius: 4px;
    }
    .warning-box p {
      margin: 0;
      color: #92400e;
      font-size: 14px;
    }
    .info-list {
      margin: 20px 0;
      padding-left: 20px;
    }
    .info-list li {
      margin: 8px 0;
      color: #374151;
      font-size: 14px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Pocket Indexer</div>
      <h1 class="title">Your API Token</h1>
      <p class="subtitle">Start building with our API</p>
    </div>

    <div class="message">
      <p>Hi ${name},</p>
      <p>Thank you for registering with Pocket Indexer. Your account has been successfully created, and your API token is ready to use.</p>
    </div>

    <div class="token-section">
      <div class="token-label">Your API Token</div>
      <div class="token-value">${token}</div>
      <div class="copy-notice">Save this token securely - it will not be shown again</div>
    </div>

    <div class="warning-box">
      <p><strong>Security Notice:</strong> Keep this token secure and never share it publicly. Anyone with this token can access the API on your behalf.</p>
    </div>

    <div class="message">
      <p><strong>Getting Started:</strong></p>
      <ul class="info-list">
        <li>Use this token in the Authorization header of your API requests</li>
        <li>Format: <code>Authorization: Bearer YOUR_TOKEN</code></li>
      </ul>
    </div>

  

    <div class="footer">
      <p>Best regards,<br><strong>Pocket Indexer Team</strong></p>
      <p style="margin-top: 15px; font-size: 12px;">
        This is an automated message, please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Plain text version for API token email
   * @param {string} token - API token
   * @param {string} name - User's first name
   * @returns {string}
   */
  getApiTokenEmailText(token, name) {
    return `
Hi ${name},

Thank you for registering with Pocket Indexer. Your account has been successfully created, and your API token is ready to use.

YOUR API TOKEN:
${token}

IMPORTANT: Save this token securely - it will not be shown again.

SECURITY NOTICE: Keep this token secure and never share it publicly. Anyone with this token can access the API on your behalf.

GETTING STARTED:
- Use this token in the Authorization header of your API requests
- Format: Authorization: Bearer YOUR_TOKEN
- Visit the dashboard to manage your tokens and view usage statistics

Best regards,
Pocket Indexer Team

---
This is an automated message, please do not reply to this email.
    `.trim();
  }

  /**
   * Send welcome email after successful verification
   * @param {string} to - Recipient email address
   * @param {string} name - User's name
   * @returns {Promise<Object>}
   */
  async sendWelcomeEmail(to, name = '') {
    if (!this.isConfigured) {
      throw new Error('Email service is not configured');
    }

    const firstName = name ? name.split(' ')[0] : 'there';

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || 'Pocket Indexer',
        address: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER,
      },
      to: to,
      subject: 'Welcome to Pocket Indexer! 🎉',
      html: this.getWelcomeEmailTemplate(firstName),
      text: this.getWelcomeEmailText(firstName),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`📧 Welcome email sent to ${to}:`, info.messageId);
      return {
        success: true,
        messageId: info.messageId,
        to: to,
      };
    } catch (error) {
      console.error(`❌ Failed to send welcome email to ${to}:`, error.message);
      // Don't throw - welcome email is not critical
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * HTML template for welcome email
   * @param {string} name - User's first name
   * @returns {string}
   */
  getWelcomeEmailTemplate(name) {
    const dashboardUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Pocket Indexer</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9fafb;
    }
    .container {
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 40px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #10b981;
    }
    .logo {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    }
    .title {
      font-size: 22px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 10px 0;
    }
    .subtitle {
      font-size: 14px;
      color: #6b7280;
      margin: 0;
    }
    .message {
      font-size: 15px;
      color: #374151;
      margin-bottom: 20px;
      line-height: 1.7;
    }
    .success-box {
      background-color: #d1fae5;
      border-left: 4px solid #10b981;
      padding: 15px;
      margin: 25px 0;
      border-radius: 4px;
    }
    .success-box p {
      margin: 0;
      color: #065f46;
      font-size: 14px;
      font-weight: 500;
    }
    .button-container {
      text-align: center;
      margin: 30px 0;
    }
    .dashboard-button {
      display: inline-block;
      padding: 12px 30px;
      background-color: #059669;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 600;
      border: 2px solid #047857;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Pocket Indexer</div>
      <h1 class="title">Welcome Aboard!</h1>
      <p class="subtitle">Your account is now active</p>
    </div>

    <div class="message">
      <p>Hi ${name},</p>
      <p>Your email has been verified successfully! Welcome to Pocket Indexer.</p>
    </div>

    <div class="success-box">
      <p>You now have full access to the API and can start building amazing applications.</p>
    </div>

    <div class="message">
      <p>Visit your dashboard to manage your API tokens, view usage statistics, and explore our documentation to get started.</p>
      <p>Happy coding!</p>
    </div>

    <div class="button-container">
      <a href="${dashboardUrl}" class="dashboard-button">Go to Dashboard</a>
    </div>

    <div class="footer">
      <p>Best regards,<br><strong>Pocket Indexer Team</strong></p>
      <p style="margin-top: 15px; font-size: 12px;">
        This is an automated message, please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Plain text version for welcome email
   * @param {string} name - User's first name
   * @returns {string}
   */
  getWelcomeEmailText(name) {
    return `
Hi ${name},

Your email has been verified successfully! Welcome to Pocket Indexer.

You now have full access to the API and can start building amazing applications.

Happy coding!

Best regards,
Pocket Indexer Team
    `.trim();
  }

  /**
   * Send password reset email with reset link
   * @param {string} to - Recipient email address
   * @param {string} token - Password reset token (unhashed)
   * @param {string} name - User's name
   * @returns {Promise<Object>}
   */
  async sendPasswordResetEmail(to, token, name = '') {
    if (!this.isConfigured) {
      throw new Error('Email service is not configured');
    }

    const firstName = name ? name.split(' ')[0] : 'there';
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${baseUrl}/reset-password?token=${token}`;

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || 'Pocket Indexer',
        address: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER,
      },
      to: to,
      subject: 'Reset Your Password - Pocket Indexer',
      html: this.getPasswordResetEmailTemplate(resetLink, firstName),
      text: this.getPasswordResetEmailText(resetLink, firstName),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`📧 Password reset email sent to ${to}:`, info.messageId);
      return {
        success: true,
        messageId: info.messageId,
        to: to,
      };
    } catch (error) {
      console.error(`❌ Failed to send password reset email to ${to}:`, error.message);
      throw new Error('Failed to send password reset email. Please try again later.');
    }
  }

  /**
   * HTML template for password reset email
   * @param {string} resetLink - Complete password reset link
   * @param {string} name - User's first name
   * @returns {string}
   */
  getPasswordResetEmailTemplate(resetLink, name) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9fafb;
    }
    .container {
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 40px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #dc2626;
    }
    .logo {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    }
    .title {
      font-size: 22px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 10px 0;
    }
    .subtitle {
      font-size: 14px;
      color: #6b7280;
      margin: 0;
    }
    .message {
      font-size: 15px;
      color: #374151;
      margin-bottom: 20px;
      line-height: 1.7;
    }
    .button-container {
      text-align: center;
      margin: 30px 0;
    }
    .reset-button {
      display: inline-block;
      padding: 14px 32px;
      background-color: #dc2626;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
      border: 2px solid #b91c1c;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .expiry {
      background-color: #fef2f2;
      border-left: 4px solid #dc2626;
      padding: 15px;
      margin: 25px 0;
      border-radius: 4px;
      font-size: 14px;
      color: #991b1b;
    }
    .warning-box {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      margin: 25px 0;
      border-radius: 4px;
    }
    .warning-box p {
      margin: 0;
      color: #92400e;
      font-size: 14px;
    }
    .link-box {
      background-color: #f9fafb;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 15px;
      margin: 20px 0;
      word-break: break-all;
    }
    .link-box p {
      margin: 5px 0;
      font-size: 12px;
      color: #6b7280;
    }
    .link-box a {
      color: #3b82f6;
      text-decoration: none;
      font-size: 13px;
    }
    .info-list {
      margin: 20px 0;
      padding-left: 20px;
    }
    .info-list li {
      margin: 8px 0;
      color: #374151;
      font-size: 14px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Pocket Indexer</div>
      <h1 class="title">Reset Your Password</h1>
      <p class="subtitle">Secure password recovery</p>
    </div>

    <div class="message">
      <p>Hi ${name},</p>
      <p>We received a request to reset your password. Click the button below to choose a new password for your account.</p>
    </div>

    <div class="button-container">
      <a href="${resetLink}" class="reset-button">Reset Password</a>
    </div>

    <div class="expiry">
      This link will expire in 1 hour for security reasons
    </div>

    <div class="link-box">
      <p><strong>Alternative: Copy and paste this link</strong></p>
      <a href="${resetLink}">${resetLink}</a>
    </div>

    <div class="warning-box">
      <p><strong>Security Notice:</strong> If you didn't request a password reset, please ignore this email. Your account is safe and no changes have been made.</p>
    </div>

    <div class="message">
      <p><strong>Important Information:</strong></p>
      <ul class="info-list">
        <li>This link can only be used once</li>
        <li>All active sessions will be logged out after password reset</li>
        <li>You'll need to log in again with your new password</li>
      </ul>
      <p>If you're having trouble or didn't request this, contact our support team for assistance.</p>
    </div>

    <div class="footer">
      <p>Best regards,<br><strong>Pocket Indexer Team</strong></p>
      <p style="margin-top: 15px; font-size: 12px;">
        This is an automated message, please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Plain text version for password reset email
   * @param {string} resetLink - Complete password reset link
   * @param {string} name - User's first name
   * @returns {string}
   */
  getPasswordResetEmailText(resetLink, name) {
    return `
Hi ${name},

We received a request to reset your password.

To reset your password, please click the link below:

${resetLink}

This link will expire in 1 hour for security reasons.

SECURITY NOTICE: If you didn't request a password reset, please ignore this email. Your account is safe and no changes have been made.

Important:
- This link can only be used once
- All active sessions will be logged out after password reset
- You'll need to log in again with your new password

Best regards,
Pocket Indexer Team

---
This is an automated message, please do not reply to this email.
    `.trim();
  }

  /**
   * HTML template for user credentials email
   * @param {string} email - User's email
   * @param {string} password - Temporary password
   * @param {string} name - User's first name
   * @param {string} loginUrl - URL to login page
   * @returns {string}
   */
  getUserCredentialsEmailTemplate(email, password, name, loginUrl) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Pocket Indexer</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color: #2563eb; padding: 50px 40px; text-align: center;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size: 32px; font-weight: 700; color: #ffffff; margin-bottom: 10px; letter-spacing: -0.5px;">
                    Pocket Indexer
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 26px; font-weight: 600; color: #ffffff; padding-top: 15px; padding-bottom: 8px;">
                    Welcome Aboard!
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 16px; color: rgba(255, 255, 255, 0.9);">
                    Your account has been created successfully
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

                <!-- Welcome Message -->
                <tr>
                  <td style="font-size: 16px; line-height: 1.8; color: #374151; padding-bottom: 30px;">
                    <p style="margin: 0 0 15px 0;">Hi <strong>${name}</strong>,</p>
                    <p style="margin: 0;">Welcome to Pocket Indexer! Your account has been successfully created by an administrator. Below are your login credentials to access the platform.</p>
                  </td>
                </tr>

                <!-- Credentials Box -->
                <tr>
                  <td style="padding-bottom: 30px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f9ff; border: 2px solid #2563eb; border-radius: 10px; padding: 28px;">
                      <tr>
                        <td>
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="font-size: 17px; font-weight: 600; color: #1e40af; padding-bottom: 18px;">
                                Your Login Credentials
                              </td>
                            </tr>
                            <!-- Email Credential -->
                            <tr>
                              <td style="background-color: #ffffff; border-radius: 6px; padding: 15px; margin-bottom: 12px;">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.8px; padding-bottom: 6px;">
                                      Email Address
                                    </td>
                                  </tr>
                                  <tr>
                                    <td style="font-size: 17px; font-weight: 600; color: #1f2937; font-family: 'Courier New', monospace; word-break: break-all;">
                                      ${email}
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <!-- Spacing -->
                            <tr><td style="padding: 6px;"></td></tr>
                            <!-- Password Credential -->
                            <tr>
                              <td style="background-color: #ffffff; border-radius: 6px; padding: 15px;">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                  <tr>
                                    <td style="font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.8px; padding-bottom: 6px;">
                                      Temporary Password
                                    </td>
                                  </tr>
                                  <tr>
                                    <td style="font-size: 17px; font-weight: 600; color: #1f2937; font-family: 'Courier New', monospace; word-break: break-all;">
                                      ${password}
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Security Warning -->
                <tr>
                  <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 18px 20px; margin-bottom: 30px;">
                    <p style="margin: 0; font-size: 14px; color: #92400e; line-height: 1.6;">
                      <strong>Security Notice:</strong> This is a temporary password. For your security, please change it immediately after your first login.
                    </p>
                  </td>
                </tr>

                <!-- Getting Started Section -->
                <tr>
                  <td style="padding: 30px 0 20px 0;">
                    <p style="margin: 0; font-size: 19px; font-weight: 600; color: #1f2937;">
                      Getting Started (First Login Guide)
                    </p>
                  </td>
                </tr>

                <!-- Step 1 -->
                <tr>
                  <td style="padding-bottom: 12px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 16px;">
                      <tr>
                        <td width="50" valign="top">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width: 38px; height: 38px; background-color: #2563eb; border-radius: 50%; text-align: center; color: #ffffff; font-weight: 600; font-size: 17px; line-height: 38px;">
                                1
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="padding-left: 12px;">
                          <p style="margin: 0 0 4px 0; font-weight: 600; font-size: 15px; color: #1f2937;">Access the Platform</p>
                          <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.5;">Click the button below or visit the login page.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Step 2 -->
                <tr>
                  <td style="padding-bottom: 12px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 16px;">
                      <tr>
                        <td width="50" valign="top">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width: 38px; height: 38px; background-color: #2563eb; border-radius: 50%; text-align: center; color: #ffffff; font-weight: 600; font-size: 17px; line-height: 38px;">
                                2
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="padding-left: 12px;">
                          <p style="margin: 0 0 4px 0; font-weight: 600; font-size: 15px; color: #1f2937;">Login with Your Credentials</p>
                          <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.5;">Use your email and the temporary password provided above to sign in.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Step 3 -->
                <tr>
                  <td style="padding-bottom: 12px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 16px;">
                      <tr>
                        <td width="50" valign="top">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width: 38px; height: 38px; background-color: #2563eb; border-radius: 50%; text-align: center; color: #ffffff; font-weight: 600; font-size: 17px; line-height: 38px;">
                                3
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="padding-left: 12px;">
                          <p style="margin: 0 0 4px 0; font-weight: 600; font-size: 15px; color: #1f2937;">Change Your Password</p>
                          <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.5;">Go to your profile settings and update your password immediately.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Step 4 -->
                <tr>
                  <td style="padding-bottom: 30px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 16px;">
                      <tr>
                        <td width="50" valign="top">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width: 38px; height: 38px; background-color: #2563eb; border-radius: 50%; text-align: center; color: #ffffff; font-weight: 600; font-size: 17px; line-height: 38px;">
                                4
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="padding-left: 12px;">
                          <p style="margin: 0 0 4px 0; font-weight: 600; font-size: 15px; color: #1f2937;">Explore the Dashboard</p>
                          <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.5;">Familiarize yourself with the features and start working.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td align="center" style="padding: 30px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background-color: #2563eb; border-radius: 8px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);">
                          <a href="${loginUrl}" style="display: inline-block; padding: 16px 40px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 17px; letter-spacing: 0.3px;">
                            Login to Dashboard
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Security Tips -->
                <tr>
                  <td style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; margin-top: 30px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 15px; font-weight: 600; color: #1f2937; padding-bottom: 12px;">
                          Security Best Practices
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 13px; color: #6b7280; line-height: 1.8;">
                          <p style="margin: 0 0 8px 0;"><strong>•</strong> Change your password immediately after first login</p>
                          <p style="margin: 0 0 8px 0;"><strong>•</strong> Use a strong password with at least 8 characters (uppercase, lowercase, numbers, special characters)</p>
                          <p style="margin: 0 0 8px 0;"><strong>•</strong> Never share your credentials with anyone</p>
                          <p style="margin: 0 0 8px 0;"><strong>•</strong> Log out when you're done using the platform</p>
                          <p style="margin: 0;"><strong>•</strong> Report any suspicious activity immediately</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 30px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size: 15px; font-weight: 600; color: #374151; padding-bottom: 12px;">
                    Pocket Indexer Team
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 12px; color: #6b7280; line-height: 1.6;">
                    This is an automated message. Please do not reply to this email.<br>
                    If you didn't request this account, please contact support immediately.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  /**
   * Plain text version of user credentials email
   * @param {string} email - User's email
   * @param {string} password - Temporary password
   * @param {string} name - User's first name
   * @param {string} loginUrl - URL to login page
   * @returns {string}
   */
  getUserCredentialsEmailText(email, password, name, loginUrl) {
    return `
Welcome to Pocket Indexer!

Hi ${name},

Your account has been successfully created by an administrator. Below are your login credentials:

YOUR LOGIN CREDENTIALS
-----------------------
Email: ${email}
Temporary Password: ${password}

SECURITY NOTICE: This is a temporary password. Please change it immediately after your first login.

GETTING STARTED (FIRST LOGIN GUIDE)
------------------------------------

Step 1: Access the Platform
Visit: ${loginUrl}

Step 2: Login with Your Credentials
Use your email and the temporary password provided above.

Step 3: Change Your Password
Go to your profile settings and update your password immediately.

Step 4: Explore the Dashboard
Familiarize yourself with the features and start working.

SECURITY BEST PRACTICES
------------------------
- Change your password immediately after first login
- Use a strong password (8+ characters with uppercase, lowercase, numbers, special characters)
- Never share your credentials with anyone
- Log out when done
- Report suspicious activity immediately

If you have questions or need assistance, contact our support team.

Best regards,
Pocket Indexer Team

---
This is an automated message. Please do not reply.
If you didn't request this account, contact support immediately.
    `.trim();
  }
}

// Create singleton instance
const emailService = new EmailService();

module.exports = emailService;
