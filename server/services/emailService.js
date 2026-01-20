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
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f4f4f4;
    }
    .container {
      background-color: #ffffff;
      border-radius: 10px;
      padding: 40px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      color: #6366f1;
      margin-bottom: 10px;
    }
    .title {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 20px;
    }
    .message {
      font-size: 16px;
      color: #4b5563;
      margin-bottom: 20px;
    }
    .button-container {
      text-align: center;
      margin: 40px 0;
    }
    .verify-button {
      display: inline-block;
      padding: 16px 40px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff;
      text-decoration: none;
      border-radius: 8px;
      font-size: 18px;
      font-weight: 600;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      transition: transform 0.2s;
    }
    .verify-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
    }
    .expiry {
      text-align: center;
      color: #6b7280;
      font-size: 14px;
      margin: 20px 0;
    }
    .info-box {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      margin: 20px 0;
      border-radius: 5px;
    }
    .info-box p {
      margin: 0;
      color: #92400e;
      font-size: 14px;
    }
    .link-box {
      background-color: #f3f4f6;
      border-radius: 5px;
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
      color: #6366f1;
      text-decoration: none;
      font-size: 12px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #9ca3af;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">🔐 Pocket Indexer</div>
      <h1 class="title">Verify Your Email Address</h1>
    </div>

    <div class="message">
      <p>Hi ${name},</p>
      <p>Thank you for registering with Pocket Indexer! To complete your registration and activate your account, please click the button below:</p>
    </div>

    <div class="button-container">
      <a href="${verificationLink}" class="verify-button">Verify Email Address</a>
    </div>

    <div class="expiry">
      ⏰ This link will expire in 24 hours
    </div>

    <div class="link-box">
      <p><strong>Or copy and paste this link:</strong></p>
      <a href="${verificationLink}">${verificationLink}</a>
    </div>

    <div class="info-box">
      <p><strong>⚠️ Security Notice:</strong> If you didn't request this verification, please ignore this email. Your account is safe.</p>
    </div>

    <div class="message">
      <p>After verifying your email, you'll have full access to the Pocket Indexer API.</p>
      <p>If you have any questions or need assistance, feel free to reach out to our support team.</p>
    </div>

    <div class="footer">
      <p>Best regards,<br><strong>Pocket Indexer Team</strong></p>
      <p style="margin-top: 20px; font-size: 12px;">
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
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f4f4f4;
    }
    .container {
      background-color: #ffffff;
      border-radius: 10px;
      padding: 40px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      color: #6366f1;
      margin-bottom: 10px;
    }
    .title {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 20px;
    }
    .message {
      font-size: 16px;
      color: #4b5563;
      margin-bottom: 20px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #9ca3af;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">🎉 Pocket Indexer</div>
      <h1 class="title">Welcome Aboard!</h1>
    </div>

    <div class="message">
      <p>Hi ${name},</p>
      <p>Your email has been verified successfully! Welcome to Pocket Indexer.</p>
      <p>You now have full access to the API and can start building amazing applications.</p>
      <p>Happy coding!</p>
    </div>

    <div class="footer">
      <p>Best regards,<br><strong>Pocket Indexer Team</strong></p>
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
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f4f4f4;
    }
    .container {
      background-color: #ffffff;
      border-radius: 10px;
      padding: 40px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      color: #6366f1;
      margin-bottom: 10px;
    }
    .title {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 20px;
    }
    .message {
      font-size: 16px;
      color: #4b5563;
      margin-bottom: 20px;
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
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      transition: background-color 0.3s ease;
    }
    .reset-button:hover {
      background-color: #b91c1c;
    }
    .expiry {
      background-color: #fef2f2;
      border-left: 4px solid #dc2626;
      padding: 12px 16px;
      margin: 20px 0;
      border-radius: 4px;
      font-size: 14px;
      color: #991b1b;
    }
    .info-box {
      background-color: #fffbeb;
      border-left: 4px solid #f59e0b;
      padding: 12px 16px;
      margin: 20px 0;
      border-radius: 4px;
      font-size: 14px;
      color: #92400e;
    }
    .link-box {
      background-color: #f3f4f6;
      border-radius: 5px;
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
      color: #6366f1;
      text-decoration: none;
      font-size: 12px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #9ca3af;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">🔐 Pocket Indexer</div>
      <h1 class="title">Reset Your Password</h1>
    </div>

    <div class="message">
      <p>Hi ${name},</p>
      <p>We received a request to reset your password. Click the button below to choose a new password:</p>
    </div>

    <div class="button-container">
      <a href="${resetLink}" class="reset-button">Reset Password</a>
    </div>

    <div class="expiry">
      ⏰ This link will expire in 1 hour for security reasons
    </div>

    <div class="link-box">
      <p><strong>Or copy and paste this link:</strong></p>
      <a href="${resetLink}">${resetLink}</a>
    </div>

    <div class="info-box">
      <p><strong>⚠️ Security Notice:</strong> If you didn't request a password reset, please ignore this email. Your account is safe and no changes have been made.</p>
    </div>

    <div class="message">
      <p><strong>Important:</strong></p>
      <ul>
        <li>This link can only be used once</li>
        <li>All active sessions will be logged out after password reset</li>
        <li>You'll need to log in again with your new password</li>
      </ul>
      <p>If you're having trouble, contact our support team for assistance.</p>
    </div>

    <div class="footer">
      <p>Best regards,<br><strong>Pocket Indexer Team</strong></p>
      <p style="margin-top: 20px; font-size: 12px;">
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
}

// Create singleton instance
const emailService = new EmailService();

module.exports = emailService;
