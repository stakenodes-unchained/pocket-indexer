const express = require('express');
const router = express.Router();
const userManagementService = require('../../services/userManagementService');
const { getUserLogs, getUserAnalytics } = require('../../middleware/apiLogger');
const emailService = require('../../services/emailService');
const { clearUserCache: clearRbacUserCache } = require('../../middleware/rbac');

/**
 * @route GET /api/admin/users
 * @desc Get all users with optional filters
 * @access Admin
 */
router.get('/', async (req, res) => {
  try {
    const { role_id, status, search, limit, offset } = req.query;

    const filters = {
      role_id: role_id ? parseInt(role_id) : undefined,
      status,
      search,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    };

    const result = await userManagementService.getAllUsers(filters);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/users/:id
 * @desc Get user by ID
 * @access Admin
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    const user = await userManagementService.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/users
 * @desc Create new user
 * @access Admin
 */
router.post('/', async (req, res) => {
  try {
    const { email, password, name, role_id, organization } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
      });
    }

    if (!role_id) {
      return res.status(400).json({
        success: false,
        error: 'Role is required',
      });
    }

    const userData = {
      email,
      password,
      name,
      role_id: parseInt(role_id),
      organization,
    };

    const user = await userManagementService.createUser(userData);

    // Send credentials email to the new user
    if (password) {
      try {
        const loginUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        await emailService.sendUserCredentialsEmail(
          email,
          password,
          name || email,
          loginUrl
        );
        console.log(`📧 Credentials email sent to ${email}`);
      } catch (emailError) {
        console.error('Failed to send credentials email:', emailError);
        // Don't fail user creation if email fails
        return res.status(201).json({
          success: true,
          data: user,
          message: 'User created successfully, but failed to send credentials email. Please provide credentials manually.',
          emailSent: false,
        });
      }
    }

    res.status(201).json({
      success: true,
      data: user,
      message: 'User created successfully. Credentials have been sent to their email.',
      emailSent: true,
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/admin/users/:id
 * @desc Update user
 * @access Admin
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { name, organization, role_id } = req.body;

    const userData = {
      name,
      organization,
      role_id: role_id ? parseInt(role_id) : undefined,
    };

    const user = await userManagementService.updateUser(userId, userData);

    // Clear RBAC cache for this user if role was changed
    if (role_id) {
      clearRbacUserCache(userId);
    }

    res.json({
      success: true,
      data: user,
      message: 'User updated successfully',
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route DELETE /api/admin/users/:id
 * @desc Delete user
 * @access Admin
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    const deleted = await userManagementService.deleteUser(userId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route PATCH /api/admin/users/:id/status
 * @desc Update user status
 * @access Admin
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { status } = req.body;

    if (!status || !['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Valid status is required (active, inactive, suspended)',
      });
    }

    const user = await userManagementService.updateUserStatus(userId, status);

    res.json({
      success: true,
      data: user,
      message: 'User status updated successfully',
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/admin/users/:id/reset-password
 * @desc Reset user password (admin action)
 * @access Admin
 */
router.post('/:id/reset-password', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { new_password } = req.body;

    if (!new_password || new_password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters',
      });
    }

    await userManagementService.resetUserPassword(userId, new_password);

    res.json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/users/:id/activity
 * @desc Get user activity logs
 * @access Admin
 */
router.get('/:id/activity', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { limit, offset } = req.query;

    const filters = {
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    };

    const result = await getUserLogs(userId, filters);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/admin/users/:id/analytics
 * @desc Get user analytics
 * @access Admin
 */
router.get('/:id/analytics', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { start_date, end_date } = req.query;

    const filters = {
      start_date,
      end_date,
    };

    const result = await getUserAnalytics(userId, filters);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
