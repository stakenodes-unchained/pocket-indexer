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
   * Send verification email with 6-digit code
   * @param {string} to - Recipient email address
   * @param {string} code - 6-digit verification code
   * @param {string} name - User's name (optional)
   * @returns {Promise<Object>}
   */
  async sendVerificationEmail(to, code, name = '') {
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
      subject: 'Verify Your Email Address - Pocket Indexer',
      html: this.getVerificationEmailTemplate(code, firstName),
      text: this.getVerificationEmailText(code, firstName),
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
   * @param {string} code - 6-digit verification code
   * @param {string} name - User's first name
   * @returns {string}
   */
  getVerificationEmailTemplate(code, name) {
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
      margin-bottom: 30px;
    }
    .code-container {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 10px;
      padding: 30px;
      text-align: center;
      margin: 30px 0;
    }
    .code {
      font-size: 48px;
      font-weight: bold;
      color: #ffffff;
      letter-spacing: 10px;
      font-family: 'Courier New', monospace;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
    }
    .code-label {
      color: rgba(255, 255, 255, 0.9);
      font-size: 14px;
      margin-top: 10px;
      text-transform: uppercase;
      letter-spacing: 2px;
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
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #9ca3af;
      font-size: 14px;
    }
    .footer a {
      color: #6366f1;
      text-decoration: none;
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
      <p>Thank you for registering with Pocket Indexer! To complete your registration and activate your account, please use the verification code below:</p>
    </div>

    <div class="code-container">
      <div class="code">${code}</div>
      <div class="code-label">Your Verification Code</div>
    </div>

    <div class="expiry">
      ⏰ This code will expire in 1 hour
    </div>

    <div class="info-box">
      <p><strong>⚠️ Security Notice:</strong> If you didn't request this verification code, please ignore this email. Your account is safe.</p>
    </div>

    <div class="message">
      <p>After verifying your email, you'll have full access to the Pocket Indexer API with your authentication token.</p>
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
   * @param {string} code - 6-digit verification code
   * @param {string} name - User's first name
   * @returns {string}
   */
  getVerificationEmailText(code, name) {
    return `
Hi ${name},

Thank you for registering with Pocket Indexer!

Your verification code is: ${code}

This code will expire in 1 hour.

To verify your email, enter this code when prompted during registration.

If you didn't request this verification code, please ignore this email. Your account is safe.

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
}

// Create singleton instance
const emailService = new EmailService();

module.exports = emailService;
